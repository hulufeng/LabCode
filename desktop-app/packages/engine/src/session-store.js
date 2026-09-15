/**
 * 会话存储 - chat-session 持久化为 JSON
 */
const fs = require('fs');
const path = require('path');
class SessionStore {
  constructor(sessionsDir) { this.dir = sessionsDir; }
  save(session) {
    const file = path.join(this.dir, session.id + '.json');
    fs.writeFileSync(file, JSON.stringify(session, null, 2), 'utf-8');
  }
  list() {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf-8')); }
      catch (e) { return null; }
    }).filter(Boolean);
  }
  delete(id) {
    const file = path.join(this.dir, id + '.json');
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}
module.exports = SessionStore;
