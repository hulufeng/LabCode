/**
 * Provider 注册表
 */
class ProviderRegistry {
  constructor() { this.providers = new Map(); this.models = new Map(); }
  register(name, providerClass) { this.providers.set(name, providerClass); }
  registerModel(provider, modelInfo) { this.models.set(modelInfo.id, modelInfo); }
  listProviders() { return Array.from(this.providers.keys()); }
  listModels(provider) { return [...this.models.values()].filter(m => m.provider === provider); }
}
module.exports = new ProviderRegistry();
