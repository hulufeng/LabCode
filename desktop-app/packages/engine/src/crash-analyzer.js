/**
 * 崩溃分析器 - 解析编译/运行时错误，提取关键信息
 */
class CrashAnalyzer {
  analyze(output = '') {
    const lines = output.split('\n');
    const errors = [];
    for (const line of lines) {
      // 编译错误：file:line:col: error: ...
      const m = line.match(/(.+?):(\d+):(\d+):\s*error:\s*(.+)/);
      if (m) errors.push({ file: m[1], line: +m[2], col: +m[3], message: m[4] });
      // Arduino 错误
      if (/error:/.test(line) && !m) errors.push({ message: line.trim() });
    }
    return { errors, hasError: errors.length > 0, summary: errors[0]?.message || '' };
  }
}
module.exports = CrashAnalyzer;
