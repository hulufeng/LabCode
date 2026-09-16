/**
 * 循环检测 - 同一工具同参数连续失败/空转时拦截
 * 对齐 TrieCode decision ledger + progress gate
 *
 * 判定：
 * - 同工具同参数失败 3 次 → 注入"你在重复失败"提示
 * - 连续 3 轮只调用只读工具（read/list/search）且无新结果 → 提示"没有进展"
 */
const MAX_REPEAT_FAILURES = 3;
const NEUTRAL_TOOL_RE = /^(read_file|list_files|search_files|find_files|code_symbols|lsp_|git_status|git_diff|web_search|web_fetch|list_memories|list_plugins|list_servers|ask_user|get_config)/i;

class CircleDetector {
  constructor() {
    this.failureLedger = new Map(); // key -> count
    this.neutralStreak = 0;
    this.totalTurns = 0;
  }

  _key(toolName, args) {
    return `${toolName}|${JSON.stringify(args || {}).slice(0, 160)}`;
  }

  /** 工具执行后调用 */
  recordTool(toolName, args, success) {
    this.totalTurns++;
    const key = this._key(toolName, args);

    // 失败计数
    if (!success) {
      const count = (this.failureLedger.get(key) || 0) + 1;
      this.failureLedger.set(key, count);
    } else {
      this.failureLedger.delete(key); // 成功了清零
    }

    // 只读工具连续计数
    if (NEUTRAL_TOOL_RE.test(toolName)) {
      this.neutralStreak++;
    } else {
      this.neutralStreak = 0;
    }
  }

  /** 是否在循环失败 */
  isRepeatingFailure(toolName, args) {
    const key = this._key(toolName, args);
    return (this.failureLedger.get(key) || 0) >= MAX_REPEAT_FAILURES;
  }

  getRepeatMessage(toolName) {
    this.failureLedger.clear();
    return `[循环检测] 工具 ${toolName} 已连续失败 ${MAX_REPEAT_FAILURES} 次，参数相同。请换一种方法，不要重复尝试同样的操作。`;
  }

  /** 是否在空转（连续只读） */
  isSpinning() {
    return this.neutralStreak >= 5;
  }

  getSpinMessage() {
    this.neutralStreak = 0;
    return '[进展检测] 连续多轮只在读取/搜索文件，没有实际修改或执行。请直接开始写代码或执行命令推进任务。';
  }

  reset() {
    this.failureLedger.clear();
    this.neutralStreak = 0;
    this.totalTurns = 0;
  }
}
module.exports = CircleDetector;
