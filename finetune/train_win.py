#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
train_win.py - Windows 原生 LoRA/QLoRA 微调（替代 Unsloth 路线）

为什么不用 train_unsloth.py：Unsloth 依赖 triton，官方只支持 Linux/WSL；
本机没有 WSL（wsl 命令不存在），所以走 transformers + peft 的原生路线，
显存占用靠 4bit(bnb) / bf16 + gradient checkpointing 控制。

训练目标形状与上线完全一致：assistant 的决策轮输出
    {"tool":"read_file","arguments":{...}}
即 main/index.js 里 buildToolGbnf 约束出的那个 JSON；只对这一轮算 loss。

用法：
  python train_win.py --base Qwen/Qwen2.5-Coder-3B-Instruct --epochs 3
  python train_win.py --base Qwen/Qwen2.5-Coder-7B-Instruct --load-4bit   # 8GB 显存也能跑
  python train_win.py --base <本地目录> --dry-run                          # 只看数据管线，不训练
导出：
  1) LoRA 适配器 -> out/lora
  2) 合并后的完整模型 -> out/merged（再用 llama.cpp convert_hf_to_gguf.py 转 GGUF）
"""
import argparse
import json
import os
import random

import torch

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def read_jsonl(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def build_prompt_completion(tok, messages):
    """把 ShareGPT 多轮切成 (prompt, completion)：只训练最后一个 assistant 决策轮。"""
    full = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    marker = '<|im_start|>assistant'
    idx = full.rfind(marker)
    if idx < 0:
        # 模板不含 im_start（自定义模板）时退化为「最后一条 assistant 之前」
        raise ValueError('chat template 缺少 assistant 标记')
    prompt = full[:idx]
    completion = full[idx:]
    if not full.startswith(prompt):
        raise ValueError('prompt/completion 切分不一致')
    return prompt, completion


class DecisionDataset(torch.utils.data.Dataset):
    """每行 = 一个训练样本：prompt 不计 loss，只有最后一个 assistant 决策轮计 loss。

    过长的样本（Hermes 长对话）会丢掉 completion，所以按 max_len 过滤并记录原因，
    便于在 dry-run 里看到「到底丢了多少、为什么丢」。
    """

    def __init__(self, rows, tok, max_len):
        self.items = []
        self.skip_reasons = {'template': 0, 'too_long': 0, 'empty': 0}
        self.skip_samples = []
        for r in rows:
            try:
                p, c = build_prompt_completion(tok, r['messages'])
            except Exception as e:
                self.skip_reasons['template'] += 1
                if len(self.skip_samples) < 5:
                    self.skip_samples.append(('template', str(e)[:120]))
                continue
            pid = tok(p, add_special_tokens=False)['input_ids']
            cid = tok(c, add_special_tokens=False)['input_ids']
            if len(pid) + len(cid) > max_len:
                self.skip_reasons['too_long'] += 1
                continue
            if not cid:
                self.skip_reasons['empty'] += 1
                continue
            self.items.append((pid + cid, [-100] * len(pid) + cid))
        self.skipped = sum(self.skip_reasons.values())

    def __len__(self):
        return len(self.items)

    def __getitem__(self, i):
        ids, labels = self.items[i]
        return {'input_ids': ids, 'labels': labels}

    @property
    def length(self):
        """供 Trainer 的 group_by_length 使用（避免它自己遍历整个数据集猜长度）"""
        if getattr(self, '_lengths', None) is None:
            self._lengths = [len(x[0]) for x in self.items]
        return self._lengths


def collate(batch, pad_id):
    n = max(len(b['input_ids']) for b in batch)
    input_ids, labels, attn = [], [], []
    for b in batch:
        pad = n - len(b['input_ids'])
        input_ids.append(b['input_ids'] + [pad_id] * pad)
        labels.append(b['labels'] + [-100] * pad)
        attn.append([1] * len(b['input_ids']) + [0] * pad)
    return {
        'input_ids': torch.tensor(input_ids, dtype=torch.long),
        'labels': torch.tensor(labels, dtype=torch.long),
        'attention_mask': torch.tensor(attn, dtype=torch.long),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='Qwen/Qwen2.5-Coder-3B-Instruct')
    ap.add_argument('--train', default=os.path.join(BASE_DIR, 'train.jsonl'))
    ap.add_argument('--val', default=os.path.join(BASE_DIR, 'val.jsonl'))
    ap.add_argument('--out', default=os.path.join(BASE_DIR, 'out_win'))
    ap.add_argument('--epochs', type=int, default=3)
    ap.add_argument('--lr', type=float, default=1e-4)
    ap.add_argument('--bs', type=int, default=1)
    ap.add_argument('--accum', type=int, default=8)
    ap.add_argument('--max-len', type=int, default=2048)
    ap.add_argument('--lora-r', type=int, default=16)
    ap.add_argument('--load-4bit', action='store_true', help='bitsandbytes NF4 QLoRA（省显存）')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--dry-run', action='store_true', help='只检查数据管线，不训练')
    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

    print('加载 tokenizer:', args.base)
    tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    train_rows = read_jsonl(args.train)
    val_rows = read_jsonl(args.val) if os.path.exists(args.val) else []
    print(f'样本: train={len(train_rows)} val={len(val_rows)}')

    ds = DecisionDataset(train_rows, tok, args.max_len)
    print(f'可用训练样本: {len(ds)}（跳过 {ds.skipped}，原因 {ds.skip_reasons}）')
    for reason, msg in ds.skip_samples:
        print('  跳过样例:', reason, msg)
    lens = sorted(len(x[0]) for x in ds.items)
    if lens:
        print(f'token 长度: min={lens[0]} p50={lens[len(lens)//2]} p90={lens[int(len(lens)*0.9)]} max={lens[-1]}')
    if args.dry_run:
        print('--- 前 3 条样本的监督目标（只训这部分）---')
        for i in range(min(3, len(ds))):
            item = ds[i]
            ids, labels = item['input_ids'], item['labels']
            sup = [t for t in labels if t != -100]
            print(f'[{i}] 总长 {len(ids)} / 监督 {len(sup)} token :: {tok.decode(sup)!r}')
        print('--- 第 1 条完整文本（前 400 字符）---')
        print(tok.decode(ds[0]['input_ids'])[:400])
        return

    vds = DecisionDataset(val_rows, tok, args.max_len) if val_rows else None

    kw = dict(trust_remote_code=True, torch_dtype=torch.bfloat16)
    if args.load_4bit:
        from transformers import BitsAndBytesConfig
        kw['quantization_config'] = BitsAndBytesConfig(
            load_in_4bit=True, bnb_4bit_quant_type='nf4',
            bnb_4bit_compute_dtype=torch.bfloat16, bnb_4bit_use_double_quant=True)
        kw.pop('torch_dtype')
    else:
        kw['device_map'] = {'': 0}

    print('加载基座模型:', args.base, '(4bit)' if args.load_4bit else '(bf16)')
    model = AutoModelForCausalLM.from_pretrained(args.base, **kw)
    model.config.use_cache = False

    from peft import LoraConfig, get_peft_model
    lc = LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_r, lora_dropout=0.0, bias='none',
        task_type='CAUSAL_LM',
        target_modules=['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'])
    model = get_peft_model(model, lc)
    model.print_trainable_parameters()

    targs = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.bs,
        gradient_accumulation_steps=args.accum,
        learning_rate=args.lr,
        lr_scheduler_type='cosine',
        warmup_ratio=0.05,
        logging_steps=5,
        # 每个 epoch 结束都存一份 LoRA：可以只跑 1 个 epoch 就先验收，不必等全部跑完
        save_strategy='epoch',
        save_total_limit=3,
        # 长度分组：p50=763 而 max=1917，不分组会有大量 padding 白算（实测明显省时间）
        group_by_length=True,
        length_column_name='length',
        bf16=True,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={'use_reentrant': False},
        report_to=None,
        dataloader_num_workers=0,
        seed=args.seed,
    )

    trainer = Trainer(model=model, args=targs, train_dataset=ds, eval_dataset=vds,
                      data_collator=lambda b: collate(b, tok.pad_token_id))
    trainer.train()

    lora_dir = os.path.join(args.out, 'lora')
    os.makedirs(lora_dir, exist_ok=True)
    model.save_pretrained(lora_dir)
    tok.save_pretrained(lora_dir)
    print('LoRA 已保存:', lora_dir)

    merged_dir = os.path.join(args.out, 'merged')
    os.makedirs(merged_dir, exist_ok=True)
    try:
        del model
        torch.cuda.empty_cache()
        base = AutoModelForCausalLM.from_pretrained(args.base, trust_remote_code=True, torch_dtype=torch.bfloat16)
        from peft import PeftModel
        merged = PeftModel.from_pretrained(base, lora_dir).merge_and_unload()
        merged.save_pretrained(merged_dir, safe_serialization=True)
        tok.save_pretrained(merged_dir)
        print('合并模型已保存:', merged_dir)
    except Exception as e:
        print('合并失败（LoRA 仍可用）:', str(e)[:300])


if __name__ == '__main__':
    main()
