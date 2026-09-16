/**
 * 工具大输出落盘管理
 * 对齐 TrieCode tool-output.js
 *
 * 超过阈值的工具输出不硬截断，写到临时文件，返回路径给模型。
 * 模型可以用 read_file 读取完整内容。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const OUTPUT_THRESHOLD = 4000; // 超过 4000 字符就落盘
const MAX_INLINE = 2000;       // 直接返回给模型的最大字符数

class ToolOutputManager {
  constructor() {
    this.dir = path.join(os.tmpdir(), 'labcode-tool-outputs');
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) {}
  }

  /**
   * 处理工具输出：大的落盘，小的直接返回
   * @returns {text: string, savedPath: string|null}
   */
  process(toolName, content) {
    const str = String(content || '');
    if (str.length <= OUTPUT_THRESHOLD) {
      return { text: str, savedPath: null };
    }
    // 落盘
    const safeLabel = String(toolName || 'out').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const filename = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${safeLabel}.txt`;
    const filepath = path.join(this.dir, filename);
    try {
      fs.writeFileSync(filepath, str, 'utf-8');
      const head = str.slice(0, MAX_INLINE);
      const note = `\n\n... [输出共 ${str.length} 字符，已保存到 ${filepath}] ...\n你可以用 read_file 读取完整内容。`;
      return { text: head + note, savedPath: filepath };
    } catch (e) {
      // 落盘失败，降级为截断
      return { text: str.slice(0, MAX_INLINE) + `\n... [truncated, ${str.length - MAX_INLINE} chars]`, savedPath: null };
    }
  }

  /** 清理过期文件（保留 1 天） */
  cleanup() {
    try {
      const now = Date.now();
      const files = fs.readdirSync(this.dir);
      for (const f of files) {
        const fp = path.join(this.dir, f);
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(fp);
        }
      }
    } catch (e) {}
  }
}
module.exports = ToolOutputManager;
