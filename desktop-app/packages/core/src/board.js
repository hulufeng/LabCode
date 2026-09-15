/**
 * 开发板管理 - FQBN 映射
 */
const BOARD_MAP = {
  'esp32': 'esp32:esp32:esp32',
  'esp32-s3': 'esp32:esp32:esp32s3',
  'esp32-c3': 'esp32:esp32:esp32c3',
  'uno': 'arduino:avr:uno',
  'nano': 'arduino:avr:nano'
};
class Board {
  static getFQBN(boardId) { return BOARD_MAP[boardId] || boardId; }
  static list() { return Object.keys(BOARD_MAP); }
}
module.exports = Board;
