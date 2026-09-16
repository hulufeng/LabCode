/**
 * 验证闸门 - 模型不能"声称完成"而不真跑代码
 * 对齐 TrieCode P0-4：收尾未验证时追问，最多 2 次
 *
 * 判定：
 * - 验证类工具：terminal（含 test/build/compile 命令）、run_test、compile_*、build_*
 * - 纯导航命令不算验证：ls/cd/echo/git status/pwd
 */
const MAX_VERIFY_NUDGES = 2;

const VERIFICATION_TOOLS = /^(terminal|run_test|compile|build|upload|flash|verify|run_test|hardware_compile)/i;
const VERIFICATION_CMD_RE = /(test|check|build|compile|verify|lint|typecheck|tsc|pytest)/i;
const NAV_CMD_RE = /^(ls|dir|cd|pwd|echo|cls|clear|git\s+(status|log|diff|branch)|tasklist|netstat|where|cat|tree|help|ver)\b/i;

class VerificationGate {
  constructor() {
    this.hasVerifiedThisTask = false;
    this.verifyNudges = 0;
    this.lastVerifyTurn = -Infinity;
  }

  /** 工具执行后调用：判断是否算"真验证" */
  recordToolResult(toolName, args, success) {
    if (!success) return;
    const n = String(toolName || '').toLowerCase();

    // 验证类工具名
    if (VERIFICATION_TOOLS.test(n)) {
      // terminal 需要进一步看命令内容
      if (n === 'terminal' || n === 'run_command' || n === 'execute_command') {
        const cmd = String(args.command || args.cmd || '').trim();
        if (NAV_CMD_RE.test(cmd)) return; // 纯导航不算
        if (VERIFICATION_CMD_RE.test(cmd) || /^(python|node|npm|npx|go|cargo|gcc|make|java|dotnet)\b/i.test(cmd)) {
          this.hasVerifiedThisTask = true;
          return;
        }
        return;
      }
      this.hasVerifiedThisTask = true;
    }
  }

  /** 模型要收尾时调用：是否需要追问验证 */
  needsVerificationNudge() {
    if (this.hasVerifiedThisTask) return false;
    if (this.verifyNudges >= MAX_VERIFY_NUDGES) return false;
    return true;
  }

  getNudgeMessage() {
    this.verifyNudges++;
    return `[验证闸门] 你还没有实际运行代码验证。请运行编译/测试命令确认代码能工作，不要只说"已完成"。这是第 ${this.verifyNudges}/${MAX_VERIFY_NUDGES} 次提醒。`;
  }

  reset() {
    this.hasVerifiedThisTask = false;
    this.verifyNudges = 0;
    this.lastVerifyTurn = -Infinity;
  }
}
module.exports = VerificationGate;
