/**
 * 响应缓存 - 相同 prompt 不重复请求
 */
const crypto = require('crypto');
class ResponseCache {
  constructor() { this.cache = new Map(); }
  _key(messages, tools) {
    const s = JSON.stringify({ messages: messages.slice(-3), tools: (tools || []).length });
    return crypto.createHash('md5').update(s).digest('hex');
  }
  get(messages, tools) { return this.cache.get(this._key(messages, tools)); }
  set(messages, tools, response) { this.cache.set(this._key(messages, tools), response); }
  clear() { this.cache.clear(); }
}
module.exports = ResponseCache;
