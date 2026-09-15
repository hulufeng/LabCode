/**
 * AI Provider 基类
 */
class AIProvider {
  constructor(config = {}) {
    this.config = config;
    this.name = 'base';
  }
  async chat(_opts) { throw new Error('chat() not implemented'); }
  async streamChat(_opts) { throw new Error('streamChat() not implemented'); }
  async checkConnection() { return { ok: false, error: 'not implemented' }; }
}
module.exports = AIProvider;
