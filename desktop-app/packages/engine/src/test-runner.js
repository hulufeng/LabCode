/**
 * 测试运行器 - 运行项目测试
 */
const { execFile } = require('child_process');
class TestRunner {
  async run(cwd, cmd = 'npm test') {
    return new Promise((resolve) => {
      const [bin, ...args] = cmd.split(' ');
      execFile(bin, args, { cwd, timeout: 60000, maxBuffer: 5 * 1024 * 1024 },
        (err, stdout, stderr) => {
          resolve({
            passed: !err,
            output: (stdout || '') + (stderr || ''),
            exitCode: err ? (err.code || 1) : 0
          });
        });
    });
  }
}
module.exports = TestRunner;
