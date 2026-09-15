/**
 * Agent 主循环引擎
 * 协调：AI provider → 工具调用 → 权限检查 → 验证 → 重试
 */
const PermissionPolicy = require('./permission-policy');
const AskUser = require('./ask-user');
const ContextManager = require('./context-manager');
const ToolFailure = require('./tool-failure');
const FileChangeTracker = require('./file-change-tracker');
const VerificationAgent = require('./verification-agent');
const CrashAnalyzer = require('./crash-analyzer');
const Events = require('./events');

class LoopEngine {
  constructor(options = {}) {
    this.aiProvider = options.aiProvider;
    this.toolRegistry = options.toolRegistry || new Map();
    this.permissionPolicy = new PermissionPolicy(options.mode || 'default');
    this.askUser = new AskUser();
    this.contextManager = new ContextManager();
    this.toolFailure = new ToolFailure();
    this.fileTracker = new FileChangeTracker();
    this.verifier = new VerificationAgent();
    this.crashAnalyzer = new CrashAnalyzer();
    this.maxRounds = options.maxRounds || 15;
    this.running = false;
  }

  registerTool(name, fn, schema) {
    this.toolRegistry.set(name, { fn, schema });
  }

  async run(userMessage, history = []) {
    this.running = true;
    const messages = [
      { role: 'system', content: this._systemPrompt() },
      ...history,
      { role: 'user', content: userMessage }
    ];
    const results = [];

    for (let round = 0; round < this.maxRounds && this.running; round++) {
      Events.emit('round-start', { round, messages: messages.length });

      // 1. 调 AI
      const tools = this._toolsSchema();
      const response = await this.aiProvider.chat({ messages, tools });
      messages.push({ role: 'assistant', content: response.content || '', tool_calls: response.toolCalls || [] });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        Events.emit('done', { final: response.content });
        return { final: response.content, results };
      }

      // 2. 执行每个工具调用
      for (const call of response.toolCalls) {
        const tool = this.toolRegistry.get(call.name);
        if (!tool) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: `Error: 工具 ${call.name} 不存在` });
          continue;
        }

        // 权限检查
        if (this.permissionPolicy.requiresApproval(call.name, call.args)) {
          const approved = await this.askUser.ask(`允许执行 ${call.name}?`, ['yes', 'no']);
          if (approved !== 'yes') {
            messages.push({ role: 'tool', tool_call_id: call.id, content: '用户拒绝执行此操作' });
            continue;
          }
        }

        // 执行工具（带重试）
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await tool.fn(call.args);
            break;
          } catch (e) {
            if (!this.toolFailure.shouldRetry(e.message, attempt)) throw e;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        this.fileTracker.record('tool', call.name, JSON.stringify(call.args).slice(0, 100));
        messages.push({ role: 'tool', tool_call_id: call.id, content: typeof result === 'string' ? result : JSON.stringify(result) });
        results.push({ tool: call.name, args: call.args, result });
      }

      // 上下文截断
      const truncated = this.contextManager.truncate(messages);
      if (truncated.length !== messages.length) {
        messages.length = 0;
        messages.push(...truncated);
      }
    }
    Events.emit('max-rounds');
    return { final: '达到最大轮数', results, truncated: true };
  }

  stop() { this.running = false; }

  _toolsSchema() {
    return Array.from(this.toolRegistry.entries()).map(([name, t]) => ({
      type: 'function',
      function: { name, description: t.schema?.description || '', parameters: t.schema?.parameters || { type: 'object', properties: {} } }
    }));
  }

  _systemPrompt() {
    return '你是 LabCode AI 编程助手。可以调用工具读写文件、执行命令。每次只做一个工具调用，等待结果后再决定下一步。';
  }
}
module.exports = LoopEngine;
