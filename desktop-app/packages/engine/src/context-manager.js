/**
 * 上下文管理 - 接近预算时自动裁剪/压缩旧工具输出
 * 对齐 TrieCode context-manager.js
 *
 * 策略（无损优先）：
 * 1. 旧 tool 输出超过 2000 字符的，裁剪为前 500 + 后 500 + "... [truncated]"
 * 2. 保留 system 消息完整不动
 * 3. 最近 5 个用户轮次内的消息不动
 * 4. 总 token 估算超预算时，进一步裁剪
 */
const CONTEXT_BUDGET = 30000; // 保守预算（9B Q4 模型实际窗口 ~32K）
const PROTECTED_TURNS = 5;
const TOOL_OUTPUT_MAX = 2000;
const TOOL_OUTPUT_KEEP_HEAD = 500;
const TOOL_OUTPUT_KEEP_TAIL = 300;

class ContextManager {
  constructor(maxTokens = CONTEXT_BUDGET) {
    this.maxTokens = maxTokens;
  }

  estimateTokens(text) {
    return Math.ceil(String(text || '').length / 3);
  }

  estimateMessages(messages) {
    return messages.reduce((sum, m) => sum + this.estimateTokens(m.content || '') + 50, 0);
  }

  /** 裁剪旧工具输出，保护最近 N 轮 */
  pruneOldToolOutputs(messages) {
    // 找到最近 PROTECTED_TURNS 个 user 消息的位置
    let protectedUserCount = 0;
    let protectedAfter = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        protectedUserCount++;
        if (protectedUserCount >= PROTECTED_TURNS) { protectedAfter = i; break; }
      }
    }

    return messages.map((m, idx) => {
      if (idx < protectedAfter) return m; // 保护区域不动
      if (m.role !== 'tool') return m;
      const content = String(m.content || '');
      if (content.length <= TOOL_OUTPUT_MAX) return m;
      // 裁剪：保留头尾
      const head = content.slice(0, TOOL_OUTPUT_KEEP_HEAD);
      const tail = content.slice(-TOOL_OUTPUT_KEEP_TAIL);
      return { ...m, content: head + `\n... [truncated, ${content.length - TOOL_OUTPUT_KEEP_HEAD - TOOL_OUTPUT_KEEP_TAIL} chars removed] ...\n` + tail };
    });
  }

  /** 接近预算时自动压缩 */
  compressIfNeeded(messages) {
    let estimated = this.estimateMessages(messages);
    if (estimated < this.maxTokens) return messages;

    // 第一轮：裁剪旧工具输出
    let result = this.pruneOldToolOutputs(messages);
    estimated = this.estimateMessages(result);
    if (estimated < this.maxTokens) return result;

    // 第二轮：更激进地裁剪工具输出（只保留前 200 字符）
    result = result.map(m => {
      if (m.role !== 'tool') return m;
      const content = String(m.content || '');
      if (content.length <= 400) return m;
      return { ...m, content: content.slice(0, 200) + `\n... [heavily truncated] ...` };
    });
    estimated = this.estimateMessages(result);
    if (estimated < this.maxTokens) return result;

    // 第三轮：丢弃最老的 1/3 非 system 消息
    const system = result.filter(m => m.role === 'system');
    const rest = result.filter(m => m.role !== 'system');
    const keepCount = Math.max(rest.length - Math.floor(rest.length / 3), 10);
    return [...system, ...rest.slice(-keepCount)];
  }
}
module.exports = ContextManager;
