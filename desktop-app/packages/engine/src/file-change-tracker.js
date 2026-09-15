/**
 * 文件变更追踪 - 记录 agent 修改了哪些文件
 */
class FileChangeTracker {
  constructor() { this.changes = []; }
  record(operation, filePath, detail = '') {
    this.changes.push({ operation, filePath, detail, ts: Date.now() });
  }
  list() { return this.changes; }
  reset() { this.changes = []; }
  getModifiedFiles() {
    return [...new Set(this.changes.filter(c => c.operation === 'write' || c.operation === 'edit').map(c => c.filePath))];
  }
}
module.exports = FileChangeTracker;
