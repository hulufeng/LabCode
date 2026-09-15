/**
 * 事件总线 - agent 引擎内部事件
 */
const { EventEmitter } = require('events');
class Events extends EventEmitter {
  constructor() { super(); this.setMaxListeners(50); }
}
module.exports = new Events();
