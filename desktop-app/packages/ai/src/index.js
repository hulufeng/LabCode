/**
 * AI 模型抽象层 - 入口
 */
const AIFactory = require('./ai-provider-factory');
const ProviderRegistry = require('./provider-registry');
const ResponseCache = require('./cache');
const PromptTemplates = require('./prompt-templates');
const ErrorClassifier = require('./error-classification');

module.exports = { AIFactory, ProviderRegistry, ResponseCache, PromptTemplates, ErrorClassifier };
