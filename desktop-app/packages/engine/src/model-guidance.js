/**
 * 模型分档提示 - 按模型族追加针对性引导
 * 对齐 TrieCode prompt-core.js
 */
function modelFamily(label) {
  const l = String(label || '').toLowerCase();
  if (l.includes('claude') || l.includes('anthropic')) return 'claude';
  if (l.includes('gemini')) return 'gemini';
  if (l.includes('deepseek')) return 'deepseek';
  if (l.includes('qwen') || l.includes('glm') || l.includes('kimi') || l.includes('minimax') || l.includes('moonshot') || l.includes('llama')) return 'qwen';
  if (l.includes('gpt') || l.includes('o1') || l.includes('o3') || l.includes('o4')) return 'gpt';
  return 'default';
}

const FAMILY_GUIDANCE = {
  claude: '',
  gemini: 'Construct file paths explicitly relative to the workspace (forward slashes). Verify by running what you wrote — do not rely on internal reasoning as evidence of correctness.',
  deepseek: 'You are a reasoning model. Do NOT skip verification because you "reasoned it through": ALWAYS run what you wrote and cite the real output. Keep text between tool calls short.',
  qwen: 'Make your planning VISIBLE through concrete actions and tool calls. Use explicit workspace-relative paths. Verify by running; do not rely on internal correctness check as evidence.',
  gpt: 'Do NOT run destructive git commands (push --force, reset --hard, checkout ., clean -f) unless explicitly requested. Prefer edits that match existing file encoding.',
  default: ''
};

function buildModelGuidance(modelLabel) {
  const family = modelFamily(modelLabel);
  const text = FAMILY_GUIDANCE[family];
  return text ? `\n\n## MODEL-SPECIFIC GUIDANCE\n${text}\n` : '';
}

module.exports = { modelFamily, buildModelGuidance, FAMILY_GUIDANCE };
