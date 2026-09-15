/**
 * 子代理 - 可并行执行的子任务
 */
class SubAgent {
  constructor(engine) { this.engine = engine; this.tasks = new Map(); }
  async run(name, description, taskFn) {
    const id = 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    this.tasks.set(id, { name, description, status: 'running' });
    try {
      const result = await taskFn();
      this.tasks.set(id, { name, description, status: 'done', result });
      return result;
    } catch (e) {
      this.tasks.set(id, { name, description, status: 'error', error: e.message });
      throw e;
    }
  }
  list() { return Array.from(this.tasks.values()); }
}
module.exports = SubAgent;
