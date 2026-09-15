/**
 * 上下文管理 - 控制发给模型的 token 数量
 * 截断旧消息，保留最近 N 轮
 */
class ContextManager {
  constructor(maxTokens = 8000) { this.maxTokens = maxTokens; }
  truncate(messages) {
    // 简单策略：保留 system + 最近 20 条
    const system = messages.filter(m => m.role === 'system');
    const rest = messages.filter(m => m.role !== 'system');
    if (rest.length <= 20) return messages;
    return [...system, ...rest.slice(-20)];
  }
  estimateTokens(text) { return Math.ceil(text.length / 3); }
}
module.exports = ContextManager;
