/**
 * ask-user - 需要用户确认时的回调
 */
class AskUser {
  constructor() { this.handler = null; }
  setHandler(fn) { this.handler = fn; }
  async ask(question, options = []) {
    if (this.handler) return await this.handler(question, options);
    console.log('[ask-user]', question, options);
    return options[0] || 'yes';
  }
}
module.exports = AskUser;
