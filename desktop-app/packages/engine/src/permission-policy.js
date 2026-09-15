/**
 * 权限策略 - plan / default / auto 三级
 * plan: 只出方案不执行
 * default: 危险操作弹确认
 * auto: 全自动执行
 */
class PermissionPolicy {
  constructor(mode = 'default') {
    this.mode = mode; // 'plan' | 'default' | 'auto'
  }

  setMode(mode) { this.mode = mode; }
  getMode() { return this.mode; }

  /** 判断某个工具调用是否需要用户确认 */
  requiresApproval(toolName, args = {}) {
    if (this.mode === 'auto') return false;
    if (this.mode === 'plan') return true;
    // default: 危险操作需要确认
    const dangerous = ['delete_file', 'write_file', 'run_command', 'git_push', 'git_commit'];
    return dangerous.some(d => toolName.toLowerCase().includes(d));
  }
}
module.exports = PermissionPolicy;
