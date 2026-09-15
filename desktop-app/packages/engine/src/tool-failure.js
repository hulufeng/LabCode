/**
 * 工具失败处理 - 解析工具错误，决定重试策略
 */
class ToolFailure {
  shouldRetry(error, attempt) {
    if (attempt >= 3) return false;
    if (/ETIMEDOUT|ECONNRESET|ENOTFOUND/.test(error)) return true;
    if (/no such file|not found/.test(error)) return false;
    return false;
  }
  classify(error) {
    if (/ETIMEDOUT|ECONNRESET/.test(error)) return 'network';
    if (/ENOENT/.test(error)) return 'missing_file';
    if (/EACCES|EPERM/.test(error)) return 'permission';
    return 'unknown';
  }
}
module.exports = ToolFailure;
