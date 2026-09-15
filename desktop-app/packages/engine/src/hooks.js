/**
 * 钩子系统 - 在工具调用前后插入自定义逻辑
 */
class Hooks {
  constructor() { this.beforeHooks = []; this.afterHooks = []; }
  before(fn) { this.beforeHooks.push(fn); }
  after(fn) { this.afterHooks.push(fn); }
  async runBefore(toolName, args) {
    for (const fn of this.beforeHooks) await fn(toolName, args);
  }
  async runAfter(toolName, args, result) {
    for (const fn of this.afterHooks) await fn(toolName, args, result);
  }
}
module.exports = Hooks;
