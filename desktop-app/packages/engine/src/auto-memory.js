/**
 * 自动记忆 - 跨会话记住用户偏好和项目事实
 */
const fs = require('fs');
const path = require('path');
class AutoMemory {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'memory.json');
    this.memories = this._load();
  }
  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf-8')); }
    catch (e) { return { facts: [], preferences: {} }; }
  }
  addFact(fact) {
    this.memories.facts.push({ fact, ts: Date.now() });
    this._save();
  }
  setPreference(key, value) {
    this.memories.preferences[key] = value;
    this._save();
  }
  getRelevant(query) {
    return this.memories.facts.filter(f =>
      query.toLowerCase().includes(f.fact.toLowerCase().slice(0, 10))
    );
  }
  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.memories, null, 2), 'utf-8');
  }
}
module.exports = AutoMemory;
