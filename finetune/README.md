# LabCode 本地模型「工具决策专家」微调套件

目标：把 Qwen2.5-Coder-7B（本地 GGUF）微调成**会选工具、会填参数**的决策模型，治「笨」的本。
与线上 GBNF 约束解码（`desktop-app/main/index.js` 的 `buildToolGbnf`）配合：约束保格式，微调保选择质量。

## 工作流（四步）

```bash
# 0) 环境（Python 3.10+，NVIDIA 8GB+）
pip install "unsloth @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps "trl==0.11.4" peft accelerate transformers datasets

# 1) 下载开源工具调用数据（国内用 hf-mirror）
#    hermes-function-calling-v1（开放无 gated，56k 下载）
curl -L -o func-calling.json https://hf-mirror.com/datasets/NousResearch/hermes-function-calling-v1/resolve/main/func-calling.json

# 2) 数据准备：Hermes 多轮对话 -> 决策 JSON（与 GBNF 形状一致）；labcode 真实工具样本自动加权 5 份
python prepare_data.py --hermes func-calling.json --labcode labcode_tools_examples.jsonl --out .

# 3) 训练（RTX 5060 Ti 8GB 约 1-2 小时）
python train_unsloth.py --data . --out lora_out
#    产出 lora_out/（adapter）+ lora_out/gguf/（可直接用的 GGUF）

# 4) 验收：训练前/后对比（同一 GBNF + 同一套题，14 类用例 x N 次）
python eval_tools.py --baseline "D:\LabCode\models\qwen2.5-coder-7b-instruct-q4_k_m.gguf" ^
                     --model   "lora_out\gguf\qwen2.5-coder-7b-tools-Q4_K_M.gguf" --repeat 3
```

## 文件

| 文件 | 作用 |
|---|---|
| `labcode_tools_examples.jsonl` | 22 条 LabCode 真实工具场景（读/写/改/编译/搜索/装插件 + 多轮循环 + none） |
| `prepare_data.py` | ShareGPT → 决策 JSON；自动抽取每个工具调用轮作为训练目标，带完整上文 |
| `train_unsloth.py` | Unsloth QLoRA（r16, 4bit, seq4096）；合并 + 导出 GGUF |
| `eval_tools.py` | 启动 llama-server 跑 14 类工具决策题，输出准确率；支持基线对比 |

## 设计要点

1. **训练形状 = 线上形状**：assistant 目标就是 `{"tool":..., "arguments":{...}}`，与 GBNF 约束逐字节一致，训完直接受益，不丢分在格式上。
2. **多轮上下文**：从 Hermes 多轮对话抽取「工具结果已回填」的样本（读→改→编译循环），教模型** Sequencing**，不是单发预测。
3. **none 也是正类**：闲聊/解释类必须学会不调用工具（线上 grammar 里 none 是首选退路，选错=浪费一轮）。
4. **labcode 样本 5 倍加权**：防止真实工具名被通用数据淹没。
5. **只训 assistant 决策轮**（prompt/completion 截取差集），system+user 上下文不算 loss。

## 预期效果

基线（未微调 7B）在本套题约 60-80%；微调后目标 ≥95%（选择质量），配合 GBNF 后格式 100%。
验收不过线（<90%）就调数据：加 labcode 样本、降 hermes 占比、或加训一轮。

## 后续可选

- 数据扩充：`THUDM/AgentInstruct`（智能体轨迹，hf-mirror 可下）、ToolACE（HF 数据集）
- 换基座：Qwen3-8B-Instruct（混合思考，工具调用更强；8GB 卡 Q4 可行）
- 进阶：DPO/GRPO 用「线上真实失败案例」做偏好优化（把 AgentRunner 里 noProgressRounds 触发的失败对话导出成训练数据）
