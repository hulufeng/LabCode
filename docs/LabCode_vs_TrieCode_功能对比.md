# LabCode vs TrieCode 功能对比与修改计划

> 对比时间：2026-09-05
> 对比范围：LabCode 仿写版本（v2.2，1334行）vs TrieCode v1.2.9 原始源码（36个核心文件，约450KB）

---

## 一、总体对比

| 维度 | TrieCode 原始源码 | LabCode 仿写版本 | 差异程度 |
|------|------------------|----------------|---------|
| 代码量 | 36个核心文件，约450KB | 单文件1334行 | 大幅简化 |
| 智能体引擎 | agent-runner.js（89KB）+ loop-engine.js + tool-pipeline.js | 简化版 AgentRunner | 核心逻辑保留，细节简化 |
| 工具数量 | 20+ 工具（含 web_search/web_fetch/vision/crash_analyzer等） | 13 个工具 | 缺少7个专业工具 |
| 权限系统 | permission-policy.js + permission-rules.js + approval-audit.js | 简化版三级权限 | 缺少 Rule 引擎和审计 |
| 终端安全 | terminal-exec.js（18KB，7层拦截） | 简单模拟终端 | 大幅简化 |
| 上下文管理 | context-manager.js（27KB，四级压缩） | 简化版压缩 | 核心逻辑保留 |
| 记忆系统 | memory.js + auto-memory.js | 简化版记忆 | 缺少自动记忆提取 |
| 验证系统 | verification-agent.js + 验证硬闸门(P0-4) | 验证硬闸门 | 缺少独立验证代理 |
| 子智能体 | subagent.js（只读子智能体） | ❌ 未实现 | 完全缺失 |
| Web 工具 | web-tools.js（34KB，SSRF防护） | ❌ 未实现 | 完全缺失 |
| 文件回滚 | file-change-tracker.js（24.5KB） | ❌ 未实现 | 完全缺失 |
| 测试运行器 | test-runner.js（结构化测试解析） | 简单模拟 | 大幅简化 |
| 插件系统 | plugin.js + mcp.js + PluginManager（主进程） | ❌ 未实现 | 完全缺失 |
| AI 提供商 | ai-provider.js + generic-provider.js + provider-registry.js | MockAI 模拟 | 缺少真实 AI 集成 |
| 会话存储 | session-store.js（SQLite） | 内存存储 | 缺少持久化 |
| 视觉桥接 | vision.js | ❌ 未实现 | 完全缺失 |
| 崩溃分析 | crash-analyzer.js（11种ESP32崩溃签名） | ❌ 未实现 | 完全缺失 |
| 工具钩子 | hooks.js（PreToolUse/PostToolUse） | ❌ 未实现 | 完全缺失 |
| 错误分类 | error-classification.js + tool-failure.js | ❌ 未实现 | 完全缺失 |
| 主动提问 | ask-user.js（多选选项弹窗） | ❌ 未实现 | 完全缺失 |
| LRU 缓存 | cache.js | ❌ 未实现 | 完全缺失 |
| 大输出管理 | tool-output.js（受管目录） | ❌ 未实现 | 完全缺失 |
| 模型族提示词 | prompt-core.js（分档引导） | ❌ 未实现 | 完全缺失 |
| 思考强度 | thinking.js（四档：fast/light/standard/deep） | ❌ 未实现 | 完全缺失 |
| Skill 系统 | 通过插件 manifest.skills 注册 | 3个内置Skill | 基本实现 |
| Electron 主进程 | main/dist/index.js（3.87MB，159个IPC） | 简化版主进程（435行） | 核心功能保留 |

---

## 二、核心功能差异详情

### 2.1 智能体引擎

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| 统一 turn 循环 | ✅ agent-runner.js | ✅ 已实现 | - |
| 并行组有界池 | ✅ PARALLEL_LIMIT=5 | ❌ 串行执行 | 🔴 高 |
| 残缺调用丢弃 | ✅ 校验工具调用完整性 | ✅ 已实现 | - |
| 验证硬闸门(P0-4) | ✅ 有文件修改未验证时追问 | ✅ 已实现 | - |
| 占位符验证检测 | ✅ echo ok/空输出检测 | ✅ 已实现 | - |
| 进展闸 | ✅ 连续3轮无进展注入换策略 | ✅ 已实现 | - |
| 反幻觉检测 | ✅ 检测谎报测试通过 | ⚠️ 部分实现 | 🟡 中 |
| 预算耗尽收尾总结 | ✅ 预算耗尽时自动总结 | ⚠️ 简单停止 | 🟡 中 |
| 四阶段工具瀑布 | ✅ pre/guard/around/post | ❌ 直接执行 | 🔴 高 |
| 全局策略注册 | ✅ 插件可贡献工具策略 | ❌ 未实现 | 🟡 中 |

### 2.2 权限与安全

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| 三级权限（plan/default/auto） | ✅ | ✅ 已实现 | - |
| plan 门控 | ✅ 计划未批准只允许只读 | ✅ 已实现 | - |
| denialKey 细分计数 | ✅ 按命令前缀细分 | ⚠️ 简单计数 | 🟡 中 |
| 连续拒绝降级 | ✅ ≥3次降级每次确认 | ❌ 未实现 | 🟡 中 |
| Rule 引擎 | ✅ wildcard匹配+deny>ask>allow+once消费 | ❌ 未实现 | 🔴 高 |
| 权限决策审计 | ✅ decision+outcome闭集 | ❌ 未实现 | 🟡 中 |
| 7层终端命令拦截 | ✅ DANGEROUS/RISKY/管道/链式/受保护路径/敏感路径/只读白名单 | ❌ 简单模拟 | 🔴 高 |
| SSRF 防护 | ✅ scheme白名单+内网阻断+DNS rebinding TOCTOU | ❌ 未实现 | 🟡 中（需web工具） |

### 2.3 上下文与记忆

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| 四级压缩 | ✅ snip→prune→折叠→系统提示压缩 | ✅ 简化版（prune旧输出） | - |
| 主动水位 | ✅ proactiveBudget | ❌ 未实现 | 🟡 中 |
| actualTokens 真实值 | ✅ 模型报告真实输入token | ❌ 估算值 | 🟡 中 |
| forceFold 兜底 | ✅ 估算偏低但实际超窗时强制折叠 | ❌ 未实现 | 🟡 中 |
| `<history-summary>` 边界标签 | ✅ 防提示注入 | ❌ 未实现 | 🟡 中 |
| memdir 长期记忆 | ✅ MEMORY.md+{slug}.md | ✅ 内存版记忆 | - |
| 关键词相关性排序 | ✅ 英文≥3字符+中文bigram | ❌ 简单列表 | 🟡 中 |
| 自动记忆提取 | ✅ 会话结束时LLM提炼 | ❌ 未实现 | 🟡 中 |
| 语义去重 | ✅ bigram Jaccard>0.7丢弃 | ❌ 未实现 | 🟢 低 |

### 2.4 验证与子智能体

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| 独立验证代理 | ✅ VERDICT协议(PASS/FAIL/PARTIAL/UNVERIFIABLE) | ❌ 未实现 | 🔴 高 |
| "只有verifier发verdict" | ✅ 主代理不能自评 | ❌ 未实现 | 🔴 高 |
| 只读子智能体 | ✅ 运行时硬门+结构化输出契约 | ❌ 未实现 | 🔴 高 |
| 子智能体maxTurns=6 | ✅ 收紧轮次 | ❌ 未实现 | 🟡 中 |
| 验证跟踪 | ✅ lastFileModTurn/lastVerifyTurn轮次比较 | ✅ 已实现 | - |

### 2.5 工具与专业功能

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| web_search/web_fetch | ✅ 内建+SSRF防护+15min缓存 | ❌ 未实现 | 🔴 高 |
| vision 视觉桥接 | ✅ 图片→文字描述回填 | ❌ 未实现 | 🟡 中 |
| crash_analyzer 崩溃分析 | ✅ 11种ESP32/ARM崩溃签名 | ❌ 未实现 | 🟡 中（Arduino专用） |
| test-runner 结构化测试 | ✅ 解析pytest/jest/go/cargo | ⚠️ 简单模拟 | 🟡 中 |
| file-change-tracker 文件回滚 | ✅ Turn级回滚+绝不覆盖用户改动 | ❌ 未实现 | 🟡 中 |
| tool-output 大输出管理 | ✅ 受管目录+read_file读全量 | ❌ 硬截断 | 🟡 中 |
| hooks 工具钩子 | ✅ PreToolUse/PostToolUse | ❌ 未实现 | 🟢 低 |
| ask-user 主动提问 | ✅ 多选选项弹窗 | ❌ 未实现 | 🟡 中 |
| error-classification AI错误分类 | ✅ transient/deterministic/unknown | ❌ 未实现 | 🟡 中 |
| tool-failure 工具失败分类 | ✅ compile/test/env/select/runtime/unknown | ❌ 未实现 | 🟡 中 |
| cache LRU缓存 | ✅ completion/codeGen/diagnosis/libRec | ❌ 未实现 | 🟢 低 |
| prompt-core 模型族提示词 | ✅ claude/gemini/deepseek/qwen/gpt分档 | ❌ 未实现 | 🟡 中 |
| thinking 四档思考强度 | ✅ fast/light/standard/deep | ❌ 未实现 | 🟡 中 |

### 2.6 基础设施

| 功能 | TrieCode 实现 | LabCode 实现 | 修改优先级 |
|------|--------------|------------|-----------|
| 真实 AI 提供商集成 | ✅ 10个提供商+流式SSE | ❌ MockAI模拟 | 🔴 高（需API Key） |
| MCP 服务器集成 | ✅ stdio/http/sse三类型 | ❌ 未实现 | 🟡 中 |
| 插件系统 | ✅ PluginManager+8种能力+7类通道 | ❌ 未实现 | 🟡 中 |
| 真实文件系统操作 | ✅ fs读写 | ❌ 内存模拟 | 🟡 中（Electron环境可实现） |
| 真实终端 | ✅ node-pty+xterm | ❌ 模拟终端 | 🟡 中（Electron环境可实现） |
| SQLite 会话存储 | ✅ node:sqlite | ❌ 内存存储 | 🟡 中 |
| 自动更新 | ✅ electron-updater | ✅ 已实现（主进程） | - |
| 代理设置 | ✅ system/manual/direct | ✅ 已实现（主进程） | - |
| gRPC Arduino CLI 对接 | ✅ client-factory+完整proto | ❌ 未实现 | 🟢 低（Arduino专用） |
| 159个IPC接口 | ✅ 完整实现 | ⚠️ 核心接口实现 | - |

---

## 三、本次修改计划（优先实现高价值核心功能）

### 🔴 高优先级（本次实现）

1. **并行工具调用**（PARALLEL_LIMIT=5）— 参考 agent-runner.js
2. **四阶段工具瀑布**（pre/guard/around/post）— 参考 tool-pipeline.js
3. **7层终端命令安全拦截** — 参考 terminal-exec.js
4. **独立验证代理**（VERDICT协议）— 参考 verification-agent.js
5. **只读子智能体** — 参考 subagent.js
6. **Rule 权限引擎**（wildcard+deny>ask>allow+once）— 参考 permission-rules.js

### 🟡 中优先级（本次实现）

7. **工具失败分类**（compile/test/env/select/runtime/unknown）— 参考 tool-failure.js
8. **AI 调用错误分类**（transient/deterministic/unknown）— 参考 error-classification.js
9. **权限决策审计**（decision+outcome闭集）— 参考 approval-audit.js
10. **反幻觉检测增强** — 参考 agent-runner.js

### 🟢 低优先级（文档说明，后续实现）

- Web 工具（需网络请求能力）
- 视觉桥接（需视觉模型API）
- 崩溃分析（Arduino专用）
- 文件回滚（需真实文件系统）
- 工具钩子（需插件系统）
- LRU 缓存（需真实AI调用）
- MCP/插件系统（需大量基础设施）
- 真实AI提供商集成（需API Key）

---

## 四、修改后的架构变化

```
修改前：
AgentRunner.run()
  └── 直接调用 tool.execute(args)

修改后：
AgentRunner.run()
  ├── ToolPipeline.execute(tool, args)
  │   ├── pre阶段：策略判定（权限/预算/无菌）
  │   ├── guard阶段：安全闸门（单调否决）
  │   ├── around阶段：包裹执行（并行组/超时/取消）
  │   └── post阶段：观测变换（结果分类/审计/缓存）
  ├── ParallelExecutor（并行组有界池，PARALLEL_LIMIT=5）
  ├── VerificationAgent（独立验证代理，VERDICT协议）
  ├── SubAgent（只读子智能体，运行时硬门）
  ├── PermissionRuleEngine（Rule引擎，wildcard+deny>ask>allow+once）
  ├── TerminalSafetyGuard（7层命令拦截）
  ├── ToolFailureClassifier（工具失败分类）
  ├── AIErrorClassifier（AI错误分类）
  └── ApprovalAudit（权限决策审计）
```

---

*对比文档完成。接下来按优先级逐步实现核心功能。*
