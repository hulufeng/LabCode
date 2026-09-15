/**
 * Agent 执行引擎 - 入口
 * 对齐 TrieCode packages/engine/dist/
 * 导出主循环、权限策略、子代理、验证器等
 */
const LoopEngine = require('./loop-engine');
const PermissionPolicy = require('./permission-policy');
const AskUser = require('./ask-user');
const SubAgent = require('./subagent');
const VerificationAgent = require('./verification-agent');
const ContextManager = require('./context-manager');
const SessionStore = require('./session-store');
const PlanStore = require('./plan-store');
const AutoMemory = require('./auto-memory');
const CrashAnalyzer = require('./crash-analyzer');
const ToolFailure = require('./tool-failure');
const FileChangeTracker = require('./file-change-tracker');
const TestRunner = require('./test-runner');
const NetGuard = require('./net-guard');
const Hooks = require('./hooks');
const Events = require('./events');

module.exports = {
  LoopEngine,
  PermissionPolicy,
  AskUser,
  SubAgent,
  VerificationAgent,
  ContextManager,
  SessionStore,
  PlanStore,
  AutoMemory,
  CrashAnalyzer,
  ToolFailure,
  FileChangeTracker,
  TestRunner,
  NetGuard,
  Hooks,
  Events
};
