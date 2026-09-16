/**
 * Todo 列表管理 - 任务分解 + 停滞提醒
 * 对齐 TrieCode todo_write 工具 + P0-3/P1-4 提醒
 */
const TODO_REMINDER_INTERVAL = 10;
const MAX_TODO_REMINDERS = 2;

class TodoList {
  constructor() {
    this.items = []; // [{id, text, status: 'pending'|'in_progress'|'completed'|'skipped'}]
    this.lastReminderTurn = -Infinity;
    this.reminderCount = 0;
  }

  set(items) {
    this.items = items.map((it, i) => ({
      id: it.id || String(i + 1),
      text: it.text || it.content || '',
      status: it.status || 'pending'
    }));
  }

  update(id, patch) {
    const item = this.items.find(i => i.id === id);
    if (item) Object.assign(item, patch);
  }

  getPending() {
    return this.items.filter(i => i.status === 'pending' || i.status === 'in_progress');
  }

  getCompleted() {
    return this.items.filter(i => i.status === 'completed');
  }

  isEmpty() { return this.items.length === 0; }

  /** 距离上次提醒是否足够久 */
  shouldRemind(currentTurn) {
    if (this.getPending().length === 0) return false;
    if (this.reminderCount >= MAX_TODO_REMINDERS) return false;
    if (currentTurn - this.lastReminderTurn < TODO_REMINDER_INTERVAL) return false;
    return true;
  }

  getReminderMessage(currentTurn) {
    this.lastReminderTurn = currentTurn;
    this.reminderCount++;
    const pending = this.getPending().map(i => `- [${i.status}] ${i.text}`).join('\n');
    return `[待办提醒] 当前任务清单：\n${pending}\n\n请继续推进未完成的项。`;
  }

  /** 模型要收尾时检查是否还有未完成项 */
  hasIncomplete() {
    return this.getPending().length > 0;
  }

  getIncompleteSummary() {
    return this.getPending().map(i => `- ${i.text}`).join('\n');
  }

  reset() {
    this.items = [];
    this.lastReminderTurn = -Infinity;
    this.reminderCount = 0;
  }
}
module.exports = TodoList;
