/**
 * Provider 工厂 - 根据配置创建对应 provider
 */
const AIProvider = require('./ai-provider');
class AIFactory {
  static create(config = {}) {
    const type = config.provider || 'local';
    // 动态加载 provider
    try {
      const ProviderClass = require(`./providers/${type}-provider.js`);
      return new ProviderClass(config);
    } catch (e) {
      // fallback: generic
      const GenericProvider = require('./providers/generic-provider.js');
      return new GenericProvider(config);
    }
  }
}
module.exports = AIFactory;
