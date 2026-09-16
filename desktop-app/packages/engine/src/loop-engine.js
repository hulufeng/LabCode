/**
 * Agent 主循环引擎 v2
 * 对齐 TrieCode agent-runner.js：
 * - 上下文预算管理（自动裁剪/压缩）
 * - 验证闸门（必须真跑代码才能收尾）
 * - 循环检测（重复失败/空转拦截）
 * - Todo 列表 + 停滞提醒
 * - 大输出落盘
 * - 模型分档提示
 */
const PermissionPolicy = require('./permission-policy');
const AskUser = require('./ask-user');
const ContextManager = require('./context-manager');
const ToolFailure = require('./tool-failure');
const FileChangeTracker = require('./file-change-tracker');
const VerificationAgent = require('./verification-agent');
const VerificationGate = require('./verification-gate');
const CircleDetector = require('./circle-detector');
const TodoList = require('./todo-list');
const ToolOutputManager = require('./tool-output-manager');
const CrashAnalyzer = require('./crash-analyzer');
const { buildModelGuidance } = require('./model-guidance');
const Events = require('./events');

class LoopEngine {
  constructor(options = {}) {
    this.aiProvider = options.aiProvider;
    this.toolRegistry = options.toolRegistry || new Map();
    this.permissionPolicy = new PermissionPolicy(options.mode || 'default');
    this.askUser = new AskUser();
    this.contextManager = new ContextManager(options.maxTokens);
    this.toolFailure = new ToolFailure();
    this.fileTracker = new FileChangeTracker();
    this.verifier = new VerificationAgent();
    this.verifyGate = new VerificationGate();
    this.circleDetector = new CircleDetector();
    this.todoList = new TodoList();
    this.toolOutputMgr = new ToolOutputManager();
    this.crashAnalyzer = new CrashAnalyzer();
    this.maxRounds = options.maxRounds || 20;
    this.modelLabel = options.modelLabel || 'local';
    this.running = false;
  }

  registerTool(name, fn, schema) {
    this.toolRegistry.set(name, { fn, schema });
  }

  async run(userMessage, history = []) {
    this.running = true;
    this.verifyGate.reset();
    this.circleDetector.reset();
    this.todoList.reset();

    const sysPrompt = this._systemPrompt();
    const messages = [
      { role: 'system', content: sysPrompt },
      ...history,
      { role: 'user', content: userMessage }
    ];
    const results = [];
    let currentTurn = 0;

    for (let round = 0; round < this.maxRounds && this.running; round++) {
      currentTurn = round;
      Events.emit('round-start', { round, messages: messages.length });

      // 上下文压缩
      const compressed = this.contextManager.compressIfNeeded(messages);
      if (compressed.length !== messages.length) {
        messages.length = 0;
        messages.push(...compressed);
      }

      // Todo 停滞提醒
      if (this.todoList.shouldRemind(currentTurn)) {
        messages.push({ role: 'user', content: this.todoList.getReminderMessage(currentTurn) });
      }

      // 调 AI
      const tools = this._toolsSchema();
      let response;
      try {
        response = await this.aiProvider.chat({ messages, tools });
      } catch (e) {
        // 上下文超长错误：压缩后重试
        if (/context.?length|token.*limit|too.?long/i.test(e.message)) {
          messages.push({ role: 'user', content: '[系统] 上下文超长，已自动压缩。请继续。' });
          continue;
        }
        throw e;
      }

      messages.push({ role: 'assistant', content: response.content || '', tool_calls: response.toolCalls || [] });

      if (!response.toolCalls || response.toolCalls.length === 0) {
        // 模型想收尾 → 验证闸门
        if (this.verifyGate.needsVerificationNudge()) {
          messages.push({ role: 'user', content: this.verifyGate.getNudgeMessage() });
          continue;
        }
        // Todo 未完成提醒
        if (this.todoList.hasIncomplete()) {
          messages.push({ role: 'user', content: `[待办收口] 还有未完成项：\n${this.todoList.getIncompleteSummary()}\n请继续完成或标记为 skipped。` });
          continue;
        }
        Events.emit('done', { final: response.content });
        return { final: response.content, results };
      }

      // 执行工具调用
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

        // 循环失败检测
        if (this.circleDetector.isRepeatingFailure(call.name, call.args)) {
          const msg = this.circleDetector.getRepeatMessage(call.name);
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          continue;
        }

        // 执行工具（带重试）
        let result, success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            result = await tool.fn(call.args);
            success = true;
            break;
          } catch (e) {
            result = { error: e.message };
            if (!this.toolFailure.shouldRetry(e.message, attempt)) break;
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
          }
        }

        // 工具输出处理（大的落盘）
        const resultText = typeof result === 'string' ? result : JSON.stringify(result);
        const { text: processedText } = this.toolOutputMgr.process(call.name, resultText);

        // 记录到各检测器
        this.fileTracker.record('tool', call.name, JSON.stringify(call.args).slice(0, 100));
        this.circleDetector.recordTool(call.name, call.args, success);
        this.verifyGate.recordToolResult(call.name, call.args, success);

        // todo_write 特殊处理
        if (call.name === 'todo_write') {
          this.todoList.set(call.args.todos || call.args.items || []);
        }

        messages.push({ role: 'tool', tool_call_id: call.id, content: processedText });
        results.push({ tool: call.name, args: call.args, result: success ? 'ok' : 'error' });
      }

      // 空转检测
      if (this.circleDetector.isSpinning()) {
        messages.push({ role: 'user', content: this.circleDetector.getSpinMessage() });
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
    const base = '你是 LabCode AI 编程助手。你可以：\n- 读写和编辑项目文件\n- 执行终端命令\n- 编译和烧录 Arduino/ESP32 项目\n\n规则：\n1. 每次只调用一个工具，等结果后再决定下一步\n2. 编译失败时，仔细阅读错误信息，修改代码后重试\n3. 不要执行危险操作\n4. 用中文回复\n5. 完成前必须实际运行/编译验证，不能只说"已完成"';
    return base + buildModelGuidance(this.modelLabel);
  }
}
module.exports = LoopEngine;
