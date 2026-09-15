/**
 * 验证代理 - 代码写完后自动验证
 * 运行测试、编译、lint，失败自动反馈给主循环
 */
class VerificationAgent {
  async verify(runTestFn) {
    if (!runTestFn) return { passed: true, skipped: true };
    try {
      const result = await runTestFn();
      return { passed: result.exitCode === 0, output: result.output, exitCode: result.exitCode };
    } catch (e) {
      return { passed: false, error: e.message };
    }
  }
}
module.exports = VerificationAgent;
