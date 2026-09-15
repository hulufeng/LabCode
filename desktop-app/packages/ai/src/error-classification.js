/**
 * 错误分类 - 区分可重试/不可重试错误
 */
class ErrorClassifier {
  classify(error) {
    const msg = String(error.message || error);
    if (/ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/.test(msg)) return { type: 'network', retryable: true };
    if (/429|rate.?limit/.test(msg)) return { type: 'rate_limit', retryable: true, delay: 5000 };
    if (/401|403|unauthorized|invalid.?key/.test(msg)) return { type: 'auth', retryable: false };
    if (/500|502|503|504|internal.?error/.test(msg)) return { type: 'server', retryable: true, delay: 2000 };
    if (/timeout|TIMEOUT/.test(msg)) return { type: 'timeout', retryable: true };
    return { type: 'unknown', retryable: false };
  }
}
module.exports = ErrorClassifier;
