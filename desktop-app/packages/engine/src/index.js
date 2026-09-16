/**
 * Agent 执行引擎 - 入口
 * 对齐 TrieCode packages/engine/dist/
 */
const LoopEngine = require('./loop-engine');
const PermissionPolicy = require('./permission-policy');
const AskUser = require('./ask-user');
const SubAgent = require('./subagent');
const VerificationAgent = require('./verification-agent');
const VerificationGate = require('./verification-gate');
const CircleDetector = require('./circle-detector');
const TodoList = require('./todo-list');
const ContextManager = require('./context-manager');
const SessionStore = require('./session-store');
const PlanStore = require('./plan-store');
const AutoMemory = require('./auto-memory');
const CrashAnalyzer = require('./crash-analyzer');
const ToolFailure = require('./tool-failure');
const ToolOutputManager = require('./tool-output-manager');
const FileChangeTracker = require('./file-change-tracker');
const TestRunner = require('./test-runner');
const NetGuard = require('./net-guard');
const Hooks = require('./hooks');
const Events = require('./events');
const { buildModelGuidance, modelFamily } = require('./model-guidance');

module.exports = {
  LoopEngine,
  PermissionPolicy,
  AskUser,
  SubAgent,
  VerificationAgent,
  VerificationGate,
  CircleDetector,
  TodoList,
  ContextManager,
  SessionStore,
  PlanStore,
  AutoMemory,
  CrashAnalyzer,
  ToolFailure,
  ToolOutputManager,
  FileChangeTracker,
  TestRunner,
  NetGuard,
  Hooks,
  Events,
  buildModelGuidance,
  modelFamily
};
