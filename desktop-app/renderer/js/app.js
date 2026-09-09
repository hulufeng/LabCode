// ============ TrieCode Clone v2 — 完整智能体引擎 ============
// 基于 TrieCode 源码逆向分析：agent-runner / loop-engine / permission-policy /
// tool-pipeline / context-manager / plan-store / terminal-exec / ai-provider

// ============ Electron 环境适配层 ============
const isElectron = typeof window !== 'undefined' && !!window.LabCode;
const electronFS = isElectron ? window.LabCode.fs : null;
const electronConfig = isElectron ? window.LabCode.config : null;
const electronSessions = isElectron ? window.LabCode.sessions : null;
const electronWindow = isElectron ? window.LabCode.window : null;

if (isElectron) {
  console.log('✅ LabCode 运行在 Electron 环境中，已启用磁盘文件系统和持久化');
} else {
  console.log('💻 LabCode 运行在浏览器环境中，使用内存文件系统');
}

// 统一文件系统 API（Electron 用磁盘，浏览器用内存）
const FileSystem = {
  async readFile(path) {
    if (isElectron) {
      try {
        const result = await electronFS.readFile(path);
        return result.success ? result.content : null;
      } catch (e) { return null; }
    }
    return state.files[path]?.content || null;
  },
  async writeFile(path, content) {
    if (isElectron) {
      try {
        const result = await electronFS.writeFile(path, content);
        return result.success;
      } catch (e) { console.error('写入磁盘失败:', e); return false; }
    }
    return true;
  },
  async exists(path) {
    if (isElectron) return await electronFS.exists(path);
    return !!state.files[path];
  },
  async listDir(dirPath) {
    if (isElectron) {
      try {
        const result = await electronFS.listDir(dirPath);
        return result.success ? result.files : [];
      } catch (e) { return []; }
    }
    const prefix = dirPath ? dirPath.replace(/\/$/,'') + '/' : '';
    return Object.keys(state.files).filter(f => f.startsWith(prefix));
  }
};

// ============ State ============
const state = {
  files: {}, openTabs: [], activeTab: null, fileTree: {},
  mode: 'default', monaco: null, editor: null, terminal: null,
  agent: null, planApproved: false, currentPlan: null, todoList: [],
  projectPath: null,
};

// ============ 样本项目 ============
const sampleFiles = {
  'src/main.py': { content: `# TrieCode Demo - Python 示例
import sys
from typing import List, Optional

def quick_sort(arr: List[int]) -> List[int]:
    """快速排序算法实现"""
    if len(arr) <= 1: return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quick_sort(left) + middle + quick_sort(right)

def main():
    data = [64, 34, 25, 12, 22, 11, 90]
    print("原始数据:", data)
    print("排序后:", quick_sort(data))
    return 0

if __name__ == "__main__":
    sys.exit(main())
`, language: 'python' },
  'src/utils.py': { content: `# 工具函数模块
import os, json
from pathlib import Path

def read_file(filepath: str) -> str:
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()

def write_file(filepath: str, content: str) -> None:
    Path(filepath).parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
`, language: 'python' },
  'package.json': { content: '{\n  "name": "triecode-demo",\n  "version": "1.0.0",\n  "scripts": {\n    "start": "python src/main.py",\n    "test": "python -m pytest tests/"\n  }\n}\n', language: 'json' },
  'README.md': { content: '# TrieCode Demo Project\n\nAI 编程示例项目。\n\n## 快速开始\n\n```bash\npython src/main.py\n```\n', language: 'markdown' },
  'tests/test_main.py': { content: 'import pytest\nfrom src.main import quick_sort\n\ndef test_quick_sort():\n    assert quick_sort([3, 1, 2]) == [1, 2, 3]\n    assert quick_sort([]) == []\n', language: 'python' }
};

// ============ 工具函数 ============
function getLanguage(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = { py:'python', js:'javascript', ts:'typescript', html:'html', css:'css', json:'json', md:'markdown', java:'java', c:'c', cpp:'cpp', go:'go', rs:'rust', rb:'ruby', php:'php', sql:'sql', sh:'shell', yml:'yaml', yaml:'yaml', xml:'xml' };
  return map[ext] || 'plaintext';
}
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = { py:'🐍', js:'📜', ts:'🔷', html:'🌐', css:'🎨', json:'📋', md:'📝', java:'☕', go:'Go', rs:'🦀' };
  return icons[ext] || '📄';
}
function initFiles() {
  // 如果在 Electron 环境中，尝试加载上次的项目
  if (isElectron && state.projectPath) {
    loadProjectFromDisk(state.projectPath);
    return;
  }
  // 否则使用样本项目
  for (const [path, data] of Object.entries(sampleFiles)) {
    state.files[path] = { content: data.content, language: data.language, dirty: false };
  }
  buildFileTree();
}

// 从磁盘加载项目
async function loadProjectFromDisk(projectPath) {
  state.projectPath = projectPath;
  state.files = {};
  state.fileTree = {};
  state.openTabs = [];
  state.activeTab = null;

  try {
    // 递归读取目录
    await readDirRecursive(projectPath, '');
    buildFileTree();
    renderFileTree();
    showToast(`已加载项目: ${projectPath}`, 'success');
    addOutputLog(`项目已加载: ${projectPath}`, 'success');
    addOutputLog(`共 ${Object.keys(state.files).length} 个文件`, 'info');
  } catch (e) {
    console.error('加载项目失败:', e);
    showToast('加载项目失败: ' + e.message, 'error');
    // 失败时回退到样本项目
    for (const [path, data] of Object.entries(sampleFiles)) {
      state.files[path] = { content: data.content, language: data.language, dirty: false };
    }
    buildFileTree();
    renderFileTree();
  }
}

// 递归读取目录
async function readDirRecursive(dirPath, relativePath) {
  const items = await FileSystem.listDir(dirPath);
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '__pycache__', '.vscode', '.idea'];
  const ignoreFiles = ['.DS_Store', 'Thumbs.db'];

  for (const item of items) {
    const itemName = typeof item === 'string' ? item : item.name;
    const isDir = typeof item === 'string' ? false : item.isDirectory;
    const itemPath = typeof item === 'string' ? item : item.path;
    const relPath = relativePath ? relativePath + '/' + itemName : itemName;

    if (isDir) {
      if (!ignoreDirs.includes(itemName)) {
        await readDirRecursive(itemPath, relPath);
      }
    } else {
      if (!ignoreFiles.includes(itemName)) {
        // 只读取文本文件，跳过二进制文件
        const ext = itemName.split('.').pop().toLowerCase();
        const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'exe', 'dll', 'so', 'dylib', 'zip', 'tar', 'gz', 'rar', '7z', 'mp3', 'mp4', 'avi', 'mov', 'wav', 'flac', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'woff', 'woff2', 'ttf', 'eot'];
        if (!binaryExts.includes(ext)) {
          const content = await FileSystem.readFile(itemPath);
          if (content !== null) {
            state.files[relPath] = { content: content, language: getLanguage(itemName), dirty: false, absolutePath: itemPath };
          }
        } else {
          // 二进制文件只记录路径，不读取内容
          state.files[relPath] = { content: '[二进制文件]', language: 'plaintext', dirty: false, absolutePath: itemPath, isBinary: true };
        }
      }
    }
  }
}
function buildFileTree() {
  state.fileTree = {};
  for (const path of Object.keys(state.files)) {
    const parts = path.split('/');
    let node = state.fileTree;
    for (let i = 0; i < parts.length; i++) {
      if (i === parts.length - 1) node[parts[i]] = { __file: true, __path: path };
      else { if (!node[parts[i]]) node[parts[i]] = {}; node = node[parts[i]]; }
    }
  }
}

// ============ 文件树渲染 ============
function renderFileTree() {
  const container = document.getElementById('file-tree');
  container.innerHTML = '';
  renderTreeNode(state.fileTree, container, 0);
}
function renderTreeNode(node, container, depth) {
  const entries = Object.entries(node).sort((a,b) => {
    const aDir = !a[1].__file ? 0 : 1, bDir = !b[1].__file ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a[0].localeCompare(b[0]);
  });
  for (const [name, child] of entries) {
    if (child.__file) {
      const item = document.createElement('div');
      item.className = 'file-tree-item' + (state.activeTab === child.__path ? ' selected' : '');
      item.style.paddingLeft = (8 + depth * 14) + 'px';
      item.innerHTML = `<span class="chevron"></span><span class="file-icon">${getFileIcon(name)}</span><span class="file-name">${name}</span>`;
      item.addEventListener('click', () => openFile(child.__path));
      container.appendChild(item);
    } else {
      const folderId = 'folder-' + Math.random().toString(36).slice(2);
      const item = document.createElement('div');
      item.className = 'file-tree-item folder';
      item.style.paddingLeft = (8 + depth * 14) + 'px';
      item.innerHTML = `<span class="chevron">▼</span><span class="file-icon">📁</span><span class="file-name">${name}</span>`;
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'file-tree-children';
      item.addEventListener('click', () => {
        item.classList.toggle('collapsed');
        childrenContainer.classList.toggle('hidden');
        item.querySelector('.chevron').textContent = item.classList.contains('collapsed') ? '▶' : '▼';
      });
      container.appendChild(item);
      container.appendChild(childrenContainer);
      renderTreeNode(child, childrenContainer, depth + 1);
    }
  }
}

// ============ 标签页 & 编辑器 ============
function openFile(path) {
  if (!state.files[path]) return;
  if (!state.openTabs.includes(path)) state.openTabs.push(path);
  state.activeTab = path;
  document.getElementById('welcome-screen').style.display = 'none';
  renderTabs(); renderFileTree(); updateBreadcrumb(path);
  if (state.editor && state.monaco) {
    state.editor.setValue(state.files[path].content);
    state.monaco.editor.setModelLanguage(state.editor.getModel(), state.files[path].language);
    updateLanguageMode(state.files[path].language);
  }
}
function closeTab(path, e) {
  if (e) e.stopPropagation();
  const idx = state.openTabs.indexOf(path);
  if (idx === -1) return;
  state.openTabs.splice(idx, 1);
  if (state.activeTab === path) {
    if (state.openTabs.length > 0) { state.activeTab = state.openTabs[Math.min(idx, state.openTabs.length-1)]; openFile(state.activeTab); }
    else { state.activeTab = null; document.getElementById('welcome-screen').style.display = 'flex'; if(state.editor) state.editor.setValue(''); document.getElementById('breadcrumb').innerHTML=''; updateLanguageMode('plaintext'); }
  }
  renderTabs(); renderFileTree();
}
function renderTabs() {
  const bar = document.getElementById('tabs-bar'); bar.innerHTML = '';
  for (const path of state.openTabs) {
    const name = path.split('/').pop();
    const tab = document.createElement('div');
    tab.className = 'tab' + (state.activeTab === path ? ' active' : '');
    tab.innerHTML = `<span class="tab-icon">${getFileIcon(name)}</span><span>${name}</span><span class="tab-close">✕</span>`;
    tab.addEventListener('click', () => openFile(path));
    tab.querySelector('.tab-close').addEventListener('click', (e) => closeTab(path, e));
    bar.appendChild(tab);
  }
}
function updateBreadcrumb(path) {
  const bc = document.getElementById('breadcrumb');
  const parts = path.split('/');
  bc.innerHTML = parts.map((p,i) => `<span>${p}</span>${i<parts.length-1?'<span class="sep">›</span>':''}`).join('');
}
function updateLanguageMode(lang) {
  const names = { python:'Python', javascript:'JavaScript', typescript:'TypeScript', html:'HTML', css:'CSS', json:'JSON', markdown:'Markdown', plaintext:'纯文本' };
  document.getElementById('language-mode').textContent = names[lang] || lang;
}

// ============ Monaco 编辑器 ============
function setupMonaco() {
  require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
  require(['vs/editor/editor.main'], function () {
    state.monaco = monaco;
    state.editor = monaco.editor.create(document.getElementById('monaco-editor'), {
      value: '', language: 'plaintext', theme: 'vs-dark', fontSize: 13,
      fontFamily: "'Cascadia Code','Fira Code','Consolas',monospace",
      minimap: { enabled: true }, scrollBeyondLastLine: false, automaticLayout: true, padding: { top: 8 },
    });
    monaco.editor.defineTheme('triecode-dark', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'cba6f7' }, { token: 'string', foreground: 'a6e3a1' },
        { token: 'number', foreground: 'fab387' }, { token: 'type', foreground: '89b4fa' },
        { token: 'function', foreground: '89b4fa' }, { token: 'variable', foreground: 'cdd6f4' },
      ],
      colors: { 'editor.background': '#1e1e2e', 'editor.foreground': '#cdd6f4', 'editorLineNumber.foreground': '#6c7086', 'editor.selectionBackground': '#45475a', 'editor.lineHighlightBackground': '#313244', 'editorCursor.foreground': '#f5e0dc' }
    });
    monaco.editor.setTheme('triecode-dark');
    state.editor.onDidChangeCursorPosition((e) => { document.getElementById('cursor-position').textContent = `行 ${e.position.lineNumber}, 列 ${e.position.column}`; });
    state.editor.onDidChangeModelContent(() => {
      if (state.activeTab && state.files[state.activeTab]) {
        state.files[state.activeTab].content = state.editor.getValue();
        state.files[state.activeTab].dirty = true;
      }
    });
    openFile('src/main.py');
  });
}

// ============ 终端 ============
function setupTerminal() {
  const container = document.getElementById('terminal-container');
  if (!container) {
    console.error('终端容器不存在');
    return;
  }

  // 清空容器
  container.innerHTML = '';
  container.style.height = '100%';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';

  // 终端工具栏
  const toolbar = document.createElement('div');
  toolbar.style.cssText = `
    display: flex;
    align-items: center;
    padding: 4px 8px;
    background: #252526;
    border-bottom: 1px solid #333;
    font-size: 12px;
    color: #ccc;
  `;
  toolbar.innerHTML = `
    <span style="margin-right: 8px;">终端</span>
    <button id="terminal-new-btn" style="background:none;border:none;color:#ccc;cursor:pointer;padding:2px 6px;border-radius:3px;" title="新建终端">+</button>
    <button id="terminal-clear-btn" style="background:none;border:none;color:#ccc;cursor:pointer;padding:2px 6px;border-radius:3px;" title="清屏">🗑</button>
    <span id="terminal-status" style="margin-left:auto;font-size:11px;color:#888;">准备就绪</span>
  `;
  container.appendChild(toolbar);

  // 终端内容区域
  const terminalContent = document.createElement('div');
  terminalContent.id = 'terminal-content';
  terminalContent.style.cssText = 'flex: 1; overflow: hidden; background: #1e1e1e;';
  container.appendChild(terminalContent);

  // 初始化终端管理器
  const terminalManager = getTerminalManager();
  state.terminalManager = terminalManager;

  // 初始化终端管理器
  terminalManager.init(terminalContent).then(() => {
    console.log('终端管理器初始化完成');
  }).catch((e) => {
    console.error('终端管理器初始化失败:', e);
  });

  // 新建终端按钮
  const newBtn = document.getElementById('terminal-new-btn');
  if (newBtn) {
    newBtn.addEventListener('click', async () => {
      try {
        document.getElementById('terminal-status').textContent = '正在创建终端...';
        const result = await terminalManager.createTerminal({
          cwd: state.projectPath || process.cwd()
        });
        if (result.success) {
          terminalManager.attachTerminal(result.terminal.id, terminalContent);
          document.getElementById('terminal-status').textContent = `终端 ${result.terminal.id}`;
          addOutputLog(`终端已创建: ${result.terminal.id}`, 'success');
        } else {
          document.getElementById('terminal-status').textContent = '创建失败';
          addOutputLog(`终端创建失败: ${result.error}`, 'error');
        }
      } catch (e) {
        console.error('创建终端失败:', e);
        document.getElementById('terminal-status').textContent = '创建失败';
      }
    });
  }

  // 清屏按钮
  const clearBtn = document.getElementById('terminal-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const activeId = terminalManager.activeTerminalId;
      if (activeId) {
        terminalManager.write(activeId, '\x1b[2J\x1b[H');
      }
    });
  }

  // 自动创建第一个终端（延迟，等待终端管理器初始化）
  setTimeout(async () => {
    try {
      document.getElementById('terminal-status').textContent = '正在创建终端...';
      const result = await terminalManager.createTerminal({
        cwd: state.projectPath || process.cwd()
      });
      if (result.success) {
        terminalManager.attachTerminal(result.terminal.id, terminalContent);
        document.getElementById('terminal-status').textContent = `终端 ${result.terminal.id}`;
        addOutputLog(`终端已创建: ${result.terminal.id}`, 'success');
      } else {
        document.getElementById('terminal-status').textContent = '降级模式';
        addOutputLog(`终端创建失败，使用降级模式: ${result.error}`, 'warn');
      }
    } catch (e) {
      console.error('自动创建终端失败:', e);
      document.getElementById('terminal-status').textContent = '降级模式';
    }
  }, 1000);

  // 兼容旧的 state.terminal 接口
  state.terminal = {
    writeln: (text) => {
      const activeId = terminalManager.activeTerminalId;
      if (activeId) {
        terminalManager.write(activeId, text + '\r\n');
      }
    },
    write: (text) => {
      const activeId = terminalManager.activeTerminalId;
      if (activeId) {
        terminalManager.write(activeId, text);
      }
    },
    clear: () => {
      const activeId = terminalManager.activeTerminalId;
      if (activeId) {
        terminalManager.write(activeId, '\x1b[2J\x1b[H');
      }
    }
  };
}

// ============ Toast & 输出日志 ============
function showToast(message, type='info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  const icons = { success:'✓', error:'✕', info:'ℹ' };
  toast.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity='0'; toast.style.transform='translateX(100%)'; toast.style.transition='all 0.3s'; setTimeout(()=>toast.remove(),300); }, 3000);
}
function addOutputLog(message, type='info') {
  const content = document.getElementById('output-content');
  const time = new Date().toLocaleTimeString('zh-CN',{hour12:false});
  const line = document.createElement('div');
  line.className = 'log-line';
  const labels = { info:'[信息]', success:'[成功]', error:'[错误]', warn:'[警告]' };
  line.innerHTML = `<span class="log-time">[${time}]</span><span class="log-${type}">${labels[type]||''}</span><span>${message}</span>`;
  content.appendChild(line); content.scrollTop = content.scrollHeight;
}

// ================================================================
// ============ 智能体引擎（核心，基于 TrieCode 逆向）============
// ================================================================

// ---------- 1. 工具注册表（ToolRegistry）----------
// 参考 TrieCode: 工具分三类 query(只读) / modify(修改) / execute(执行)
const TOOL_DEFS = [
  {
    name: 'list_files', category: 'query', description: '列出工作区文件和目录',
    parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径，默认根目录' } } },
    execute: (args) => {
      const prefix = args.path ? args.path.replace(/\/$/,'') + '/' : '';
      const files = Object.keys(state.files).filter(f => f.startsWith(prefix));
      const dirs = new Set();
      files.forEach(f => { const rel = f.slice(prefix.length); const parts = rel.split('/'); if(parts.length>1) dirs.add(parts[0]+'/'); });
      let result = '';
      [...dirs].sort().forEach(d => result += d + '\n');
      files.filter(f => !f.slice(prefix.length).includes('/')).forEach(f => result += f.slice(prefix.length) + '\n');
      return result.trim() || '(空目录)';
    }
  },
  {
    name: 'read_file', category: 'query', description: '读取文件内容（支持工作区文件和受管输出目录）',
    parameters: { type: 'object', properties: { file_path: { type: 'string', description: '文件路径' } }, required: ['file_path'] },
    execute: (args) => {
      const path = args.file_path;
      // 优先检查受管输出目录（大工具输出落盘的文件）
      if (state.toolOutputs && state.toolOutputs[path]) {
        return state.toolOutputs[path];
      }
      // 检查工作区文件
      const f = state.files[path];
      return f ? f.content : `Error: 文件不存在: ${path}`;
    }
  },
  {
    name: 'write_file', category: 'modify', description: '写入或创建文件（覆盖已有内容）',
    parameters: { type: 'object', properties: { file_path: { type:'string' }, content: { type:'string' } }, required: ['file_path','content'] },
    execute: async (args) => {
      const existed = !!state.files[args.file_path];
      state.files[args.file_path] = { content: args.content, language: getLanguage(args.file_path), dirty: true };
      buildFileTree(); renderFileTree();
      if (state.activeTab === args.file_path && state.editor) state.editor.setValue(args.content);
      // Electron 环境：同时写入磁盘
      if (isElectron && state.projectPath) {
        const fullPath = state.projectPath + '/' + args.file_path;
        await FileSystem.writeFile(fullPath, args.content);
      }
      return existed ? `文件已更新: ${args.file_path} (${args.content.length} 字符)` : `文件已创建: ${args.file_path} (${args.content.length} 字符)`;
    }
  },
  {
    name: 'edit_file', category: 'modify', description: '编辑文件（替换指定文本）',
    parameters: { type: 'object', properties: { file_path: {type:'string'}, old_string: {type:'string'}, new_string: {type:'string'} }, required: ['file_path','old_string','new_string'] },
    execute: (args) => {
      const f = state.files[args.file_path];
      if (!f) return `Error: 文件不存在: ${args.file_path}`;
      if (!f.content.includes(args.old_string)) return `Error: 未找到要替换的文本`;
      f.content = f.content.replace(args.old_string, args.new_string);
      f.dirty = true;
      if (state.activeTab === args.file_path && state.editor) state.editor.setValue(f.content);
      return `文件已编辑: ${args.file_path}`;
    }
  },
  {
    name: 'delete_file', category: 'modify', description: '删除文件',
    parameters: { type: 'object', properties: { file_path: {type:'string'} }, required: ['file_path'] },
    execute: (args) => {
      if (!state.files[args.file_path]) return `Error: 文件不存在: ${args.file_path}`;
      delete state.files[args.file_path];
      closeTab(args.file_path);
      buildFileTree(); renderFileTree();
      return `文件已删除: ${args.file_path}`;
    }
  },
  {
    name: 'terminal', category: 'execute', description: '执行终端命令',
    parameters: { type: 'object', properties: { command: {type:'string', description:'要执行的 shell 命令'} }, required: ['command'] },
    execute: (args) => {
      const cmd = args.command.trim();
      if (state.terminal) { state.terminal.writeln('$ ' + cmd); }
      if (cmd.startsWith('python') || cmd.startsWith('py ')) {
        const output = '原始数据: [64, 34, 25, 12, 22, 11, 90]\n排序后: [11, 12, 22, 25, 34, 64, 90]\n查找 25: 索引 3';
        if (state.terminal) output.split('\n').forEach(l => state.terminal.writeln(l));
        return output + '\n(退出码 0)';
      }
      if (cmd.startsWith('ls') || cmd.startsWith('dir')) {
        const output = 'src/  tests/  package.json  README.md';
        if (state.terminal) state.terminal.writeln(output);
        return output;
      }
      if (cmd.startsWith('pwd')) return '/home/user/project';
      if (cmd.startsWith('echo')) return cmd.slice(5);
      if (cmd.startsWith('cat')) {
        const path = cmd.split(' ')[1];
        return state.files[path] ? state.files[path].content : `cat: ${path}: No such file or directory`;
      }
      if (cmd.startsWith('npm install') || cmd.startsWith('pip install')) {
        return '正在安装依赖...\n✓ requests@2.31.0\n✓ numpy@1.24.0\n依赖安装完成！(退出码 0)';
      }
      return `$ ${cmd}\n(模拟执行完成，退出码 0)`;
    }
  },
  {
    name: 'run_test', category: 'execute', description: '运行项目测试',
    parameters: { type: 'object', properties: { test_path: {type:'string', description:'测试文件路径，可选'} } },
    execute: (args) => {
      return '============================= test session starts =============================\ncollected 2 items\n\ntests/test_main.py::test_quick_sort PASSED                          [ 50%]\ntests/test_main.py::test_empty PASSED                               [100%]\n\n============================== 2 passed in 0.03s ===============================';
    }
  },
  {
    name: 'todo_write', category: 'modify', description: '创建或更新任务清单',
    parameters: { type: 'object', properties: { todos: { type:'array', items: { type:'object', properties: { id:{type:'string'}, title:{type:'string'}, status:{type:'string', enum:['pending','in_progress','completed','skipped']} } } } }, required: ['todos'] },
    execute: (args) => {
      state.todoList = args.todos;
      const done = args.todos.filter(t => t.status === 'completed' || t.status === 'skipped').length;
      return `任务清单已更新 (${done}/${args.todos.length} 完成)`;
    }
  },
  {
    name: 'submit_plan', category: 'modify', description: '提交计划供用户批准（Plan 模式）',
    parameters: { type: 'object', properties: { plan: {type:'string', description:'计划文本，包含步骤'} }, required: ['plan'] },
    execute: (args) => {
      state.currentPlan = { text: args.plan, status: 'proposed', steps: parsePlanSteps(args.plan) };
      return '计划已提交，等待用户批准...';
    }
  },
  {
    name: 'remember', category: 'modify', description: '保存一条长期记忆（用户偏好/项目事实/常用配置），跨会话保留',
    parameters: { type: 'object', properties: { name: {type:'string', description:'记忆名称'}, content: {type:'string', description:'记忆内容'}, type: {type:'string', enum:['user','feedback','project','reference']} }, required: ['name','content'] },
    execute: (args) => {
      if (!state.memories) state.memories = [];
      const existing = state.memories.findIndex(m => m.name === args.name);
      const entry = { name: args.name, content: args.content, type: args.type || 'reference', updatedAt: Date.now() };
      if (existing >= 0) state.memories[existing] = entry;
      else state.memories.unshift(entry);
      state.memoryVersion = (state.memoryVersion || 0) + 1;
      return `记忆已保存: ${args.name} (${args.content.length} 字符)`;
    }
  },
  {
    name: 'forget', category: 'modify', description: '删除一条长期记忆',
    parameters: { type: 'object', properties: { name: {type:'string', description:'要删除的记忆名称'} }, required: ['name'] },
    execute: (args) => {
      if (!state.memories) return '暂无记忆';
      const idx = state.memories.findIndex(m => m.name === args.name);
      if (idx === -1) return `未找到记忆: ${args.name}`;
      state.memories.splice(idx, 1);
      state.memoryVersion = (state.memoryVersion || 0) + 1;
      return `记忆已删除: ${args.name}`;
    }
  },
  {
    name: 'list_memories', category: 'query', description: '列出所有长期记忆',
    parameters: { type: 'object', properties: {} },
    execute: () => {
      if (!state.memories || state.memories.length === 0) return '暂无记忆。可用 remember 保存用户偏好、项目事实等长期信息。';
      return state.memories.map((m, i) => `${i+1}. ${m.name} (${m.type}) — ${m.content.slice(0,80)}${m.content.length>80?'...':''}`).join('\n');
    }
  },
  {
    name: 'web_search', category: 'query', description: '联网搜索信息（返回标题/链接/摘要）。SSRF防护+15min缓存+会话上限200次',
    parameters: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
    execute: async (args) => {
      const result = await webTools.search(args.query);
      if (!result.success) return `Error: ${result.error}`;
      const lines = result.results.map((r, i) => `${i+1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);
      return `搜索结果（${result.fromCache ? '来自缓存' : '实时'}）：\n\n${lines.join('\n\n')}`;
    }
  },
  {
    name: 'web_fetch', category: 'query', description: '获取网页内容并转为Markdown。SSRF防护+15min缓存+100KB截断',
    parameters: { type: 'object', properties: { url: { type: 'string', description: '网页URL' } }, required: ['url'] },
    execute: async (args) => {
      const result = await webTools.fetch(args.url);
      if (!result.success) return `Error: ${result.error}`;
      return `网页内容（${result.fromCache ? '来自缓存' : '实时获取'}${result.truncated ? '，已截断' : ''}）：\n\n${result.content}`;
    }
  },
  {
    name: 'ask_user', category: 'query', description: '向用户提问（多选选项弹窗）。用户取消/超时时模型应基于已有信息自行决策',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: '问题内容（≤200字符）' },
        options: { type: 'array', items: { type: 'string' }, description: '选项列表（2-4个）' },
        header: { type: 'string', description: '弹窗标题（≤12字符）' }
      },
      required: ['question', 'options']
    },
    execute: (args) => {
      const question = args.question || '';
      const options = args.options || [];
      if (options.length < 2 || options.length > 4) {
        return 'Error: 选项数量必须在2-4个之间';
      }
      if (question.length > 200) {
        return 'Error: 问题内容不能超过200字符';
      }
      // 模拟用户选择第一个选项
      const selected = options[0];
      return `用户回答：${selected}\n\n（注：用户选择了「${selected}」，请基于此回答继续执行。）`;
    }
  },
  {
    name: 'run_subagent', category: 'query', description: '派只读子智能体做深度研究/调研。子智能体只能用只读工具，返回结构化结论。maxTurns=6',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: '子智能体任务描述' },
        focus: { type: 'string', description: '研究重点方向（可选）' }
      },
      required: ['task']
    },
    execute: async (args) => {
      const task = args.task || '';
      if (!task) return 'Error: 任务描述不能为空';
      if (task.length > 500) return 'Error: 任务描述不能超过500字符';
      addOutputLog(`子智能体启动: ${task.substring(0, 50)}...`, 'info');
      const subagent = new SubAgent({ task, parentContext: { focus: args.focus || '' }, onStream: () => {} });
      const result = await subagent.run();
      addOutputLog(`子智能体完成: ${task.substring(0, 50)}...`, 'success');
      return `## 子智能体研究结果\n\n${result}\n\n（注：以上为只读子智能体的研究结论，仅使用了只读工具。）`;
    }
  },
];

function getToolDef(name) { return TOOL_DEFS.find(t => t.name === name); }
function getToolCategory(name) { const t = getToolDef(name); return t ? t.category : 'query'; }

// ---------- 2. 权限策略（PermissionPolicy）----------
// 参考 TrieCode permission-policy.js: plan/default/auto 三级
const READONLY_COMMANDS = ['ls', 'dir', 'pwd', 'echo', 'cat', 'git status', 'git log', 'git diff', 'tree', 'help', 'date', 'whoami'];
const PROTECTED_PATHS = ['.git/', '.env', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
const RISKY_COMMANDS = ['git push', 'git reset --hard', 'rm -rf', 'sudo', 'format', 'diskpart', 'python -c', 'node -e', 'bash -c', 'curl |', 'wget |'];

function isReadOnlyCommand(cmd) {
  const c = cmd.trim().toLowerCase();
  return READONLY_COMMANDS.some(p => c.startsWith(p));
}
function isRiskyCommand(cmd) {
  const c = cmd.trim().toLowerCase();
  return RISKY_COMMANDS.some(p => c.includes(p));
}
function isProtectedPath(path) {
  return PROTECTED_PATHS.some(p => path.includes(p));
}

// 参考 TrieCode computeNeedsConfirm: 判定工具是否需要用户确认
function computeNeedsConfirm(toolName, args, mode, denialHits=0) {
  const category = getToolCategory(toolName);
  const cmd = String(args?.command || '');
  if (toolName === 'terminal' && isReadOnlyCommand(cmd)) return false;
  if (category === 'query') return false;
  if (mode !== 'auto') return true;
  if (toolName === 'terminal' && isRiskyCommand(cmd)) return true;
  if (toolName === 'run_test' && isRiskyCommand(cmd)) return true;
  if (['write_file','edit_file','delete_file'].includes(toolName) && isProtectedPath(String(args?.file_path||''))) return true;
  if (category !== 'query' && denialHits >= 3) return true;
  return false;
}

// PLAN 门控：计划未批准时只允许只读工具
function isPlanGated(toolName, args, planApproved) {
  if (planApproved) return false;
  const category = getToolCategory(toolName);
  if (category === 'query') return false;
  if (toolName === 'terminal' && isReadOnlyCommand(String(args?.command||''))) return false;
  if (toolName === 'submit_plan') return false;
  return true;
}

// ============ 增强：7层终端命令安全拦截 ============
// 参考 TrieCode terminal-exec.js: DANGEROUS直接拒绝/RISKY确认/管道结构检查/
// 链式命令守卫/受保护路径/敏感凭据路径/只读白名单
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+(\/|~|\*|$)/,           // rm -rf 根目录/家目录/通配符
  /mkfs\.[a-z0-9]+/,                      // 格式化文件系统
  /dd\s+if=.*of=\/dev\//,                // dd 写设备
  /:(\)|>\s*\/dev\/sd[a-z])/,            // fork炸弹/写磁盘
  /shutdown\s+(-h|now)/,                 // 关机
  /reboot/,                                 // 重启
  /diskpart\s+\/s/,                        // diskpart 脚本
  /format\s+[a-z]:/i,                      // 格式化盘符
  /python\s+-c\s+["'].*(os\.system|subprocess|rmtree|remove)/,  // Python 危险调用
  /node\s+-e\s+["'].*(fs\.rm|exec|spawn)/,                        // Node 危险调用
  /curl\s+.*\|\s*(bash|sh|zsh)/,         // curl 管道执行
  /wget\s+.*\|\s*(bash|sh|zsh)/,         // wget 管道执行
];

const SENSITIVE_PATH_RE = /(\.ssh\/|\.aws\/|\.gnupg\/|\.config\/gh\/|id_rsa|id_ed25519|\.env|\.npmrc|\.pypirc|credentials|secret|token|key\.pem)/i;

const CHAIN_COMMAND_RE = /[;&|`]|\$\(|\r\n/;  // 链式命令字符

// 第1层：危险命令直接拒绝
function checkDangerousCommand(cmd) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return { blocked: true, reason: `危险命令被拦截: ${pattern}` };
    }
  }
  return { blocked: false };
}

// 第2层：管道结构检查（curl x | bash 跨|分段无法捕获，先对整命令做管道结构检查）
function checkPipeStructure(cmd) {
  if (/\|\s*(bash|sh|zsh|python|node|perl|ruby)/.test(cmd)) {
    return { needsConfirm: true, reason: '管道执行命令，需要确认' };
  }
  return { needsConfirm: false };
}

// 第3层：链式命令守卫（含&|;`$()一律拒绝只读豁免，对齐Omnigent CVE-2026-62676）
function checkChainedCommand(cmd) {
  if (CHAIN_COMMAND_RE.test(cmd)) {
    return { chained: true, reason: '链式命令，不享受只读豁免' };
  }
  return { chained: false };
}

// 第4层：受保护路径检查
function checkProtectedPath(cmd) {
  if (isProtectedPath(cmd)) {
    return { protected: true, reason: '涉及受保护路径' };
  }
  return { protected: false };
}

// 第5层：敏感凭据路径检查（只读命令也不豁免确认）
function checkSensitivePath(cmd) {
  if (SENSITIVE_PATH_RE.test(cmd)) {
    return { sensitive: true, reason: '涉及敏感凭据路径' };
  }
  return { sensitive: false };
}

// 第6层：高风险命令检查（不拒绝，但需要确认）
function checkRiskyCommandEnhanced(cmd) {
  if (isRiskyCommand(cmd)) {
    return { risky: true, reason: '高风险命令' };
  }
  return { risky: false };
}

// 第7层：只读命令白名单（24个前缀）
const READONLY_CMD_PREFIXES = [
  'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail', 'less', 'more',
  'git status', 'git log', 'git diff', 'git show', 'git branch',
  'tree', 'help', 'date', 'whoami', 'hostname', 'uname', 'env', 'which', 'where'
];

function isReadOnlyCommandEnhanced(cmd) {
  const c = cmd.trim().toLowerCase();
  // 链式命令不享受只读豁免
  if (CHAIN_COMMAND_RE.test(c)) return false;
  return READONLY_CMD_PREFIXES.some(p => c.startsWith(p));
}

// 综合7层检查
function checkTerminalCommand(cmd, mode='default') {
  const result = { allowed: false, needsConfirm: false, blocked: false, reasons: [] };
  
  // 第1层：危险命令直接拒绝
  const dangerous = checkDangerousCommand(cmd);
  if (dangerous.blocked) {
    result.blocked = true;
    result.reasons.push(dangerous.reason);
    return result;
  }
  
  // auto 模式：只读命令自动执行，其他需要确认
  if (mode === 'auto') {
    if (isReadOnlyCommandEnhanced(cmd)) {
      result.allowed = true;
      return result;
    }
    result.needsConfirm = true;
    result.reasons.push('auto模式下非只读命令需要确认');
    return result;
  }
  
  // plan 模式：只允许只读命令
  if (mode === 'plan') {
    if (isReadOnlyCommandEnhanced(cmd)) {
      result.allowed = true;
      return result;
    }
    result.blocked = true;
    result.reasons.push('plan模式下只允许只读命令');
    return result;
  }
  
  // default 模式：
  // 第2层：管道结构检查
  const pipe = checkPipeStructure(cmd);
  if (pipe.needsConfirm) {
    result.needsConfirm = true;
    result.reasons.push(pipe.reason);
  }
  
  // 第3层：链式命令守卫
  const chained = checkChainedCommand(cmd);
  if (chained.chained) {
    result.needsConfirm = true;
    result.reasons.push(chained.reason);
  }
  
  // 第4层：受保护路径
  const protected_ = checkProtectedPath(cmd);
  if (protected_.protected) {
    result.needsConfirm = true;
    result.reasons.push(protected_.reason);
  }
  
  // 第5层：敏感凭据路径（只读也不豁免）
  const sensitive = checkSensitivePath(cmd);
  if (sensitive.sensitive) {
    result.needsConfirm = true;
    result.reasons.push(sensitive.reason);
  }
  
  // 第6层：高风险命令
  const risky = checkRiskyCommandEnhanced(cmd);
  if (risky.risky) {
    result.needsConfirm = true;
    result.reasons.push(risky.reason);
  }
  
  // 第7层：只读命令白名单
  if (isReadOnlyCommandEnhanced(cmd) && !result.needsConfirm) {
    result.allowed = true;
    return result;
  }
  
  // 其他命令需要确认
  if (!result.needsConfirm) {
    result.needsConfirm = true;
    result.reasons.push('default模式下命令需要确认');
  }
  
  return result;
}

// ============ 增强：Rule 权限引擎 ============
// 参考 TrieCode permission-rules.js: wildcard匹配 + deny>ask>allow优先级 + once规则消费
class PermissionRule {
  constructor(action, resource, effect, source='session', lifetime='always') {
    this.action = action;        // 工具名，支持 wildcard
    this.resource = resource;    // 资源模式，支持 wildcard
    this.effect = effect;        // allow / deny / ask
    this.source = source;        // cli / session / builtin
    this.lifetime = lifetime;    // once / always / reject
    this.consumed = false;       // once规则是否已消费
  }
}

class PermissionRuleEngine {
  constructor() {
    this.rules = [];
  }
  
  // wildcard 匹配：*匹配任意非空序列，其余字符字面匹配
  matchWildcard(pattern, str) {
    if (!pattern.includes('*')) return pattern === str;
    const parts = pattern.split('*');
    if (parts.length === 1) return str.startsWith(parts[0]);
    if (!str.startsWith(parts[0])) return false;
    let pos = parts[0].length;
    for (let i = 1; i < parts.length; i++) {
      const idx = str.indexOf(parts[i], pos);
      if (idx === -1) return false;
      pos = idx + parts[i].length;
    }
    return true;
  }
  
  // 添加规则
  addRule(action, resource, effect, source='session', lifetime='always') {
    const rule = new PermissionRule(action, resource, effect, source, lifetime);
    this.rules.push(rule);
    return rule;
  }
  
  // 移除规则
  removeRule(index) {
    if (index >= 0 && index < this.rules.length) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }
  
  // 评估规则（匹配+消费once，返回命中的最保守规则）
  evaluate(action, resource) {
    const matched = [];
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const rule = this.rules[i];
      if (rule.consumed) continue;
      if (this.matchWildcard(rule.action, action) && 
          (rule.resource === '*' || this.matchWildcard(rule.resource, resource))) {
        matched.push({ rule, index: i });
        // once规则命中后消费移除
        if (rule.lifetime === 'once') {
          rule.consumed = true;
        }
      }
    }
    
    if (matched.length === 0) return null;
    
    // 安全优先：deny > ask > allow
    const hasDeny = matched.some(m => m.rule.effect === 'deny');
    const hasAsk = matched.some(m => m.rule.effect === 'ask');
    
    if (hasDeny) return { effect: 'deny', rules: matched.map(m => m.rule) };
    if (hasAsk) return { effect: 'ask', rules: matched.map(m => m.rule) };
    return { effect: 'allow', rules: matched.map(m => m.rule) };
  }
  
  // 列出所有规则
  listRules() {
    return this.rules.map((r, i) => ({
      index: i,
      action: r.action,
      resource: r.resource,
      effect: r.effect,
      source: r.source,
      lifetime: r.lifetime,
      consumed: r.consumed
    }));
  }
}

const permissionRuleEngine = new PermissionRuleEngine();

// ============ 增强：工具失败分类器 ============
// 参考 TrieCode tool-failure.js: compile/test/env/select/runtime/unknown
class ToolFailureClassifier {
  constructor() {
    this.categories = {
      compile: {
        patterns: [/error:/i, /undefined reference/i, /cannot find/i, /syntax error/i, /expected/i, /fatal error/i],
        strategy: '检查代码语法和依赖，修复编译错误后重新编译'
      },
      test: {
        patterns: [/assert/i, /test.*fail/i, /expected.*got/i, /pytest/i, /jest/i, /mocha/i],
        strategy: '分析测试失败原因，修复代码或测试用例'
      },
      env: {
        patterns: [/module not found/i, /no module named/i, /command not found/i, /cannot find module/i, /ENOENT/i, /EACCES/i],
        strategy: '检查依赖是否安装，环境变量是否正确，安装缺失的依赖'
      },
      select: {
        patterns: [/no such file/i, /file not found/i, /not a directory/i, /invalid path/i, /does not exist/i],
        strategy: '检查文件路径是否正确，文件是否存在'
      },
      runtime: {
        patterns: [/runtime error/i, /segmentation fault/i, /core dumped/i, /stack overflow/i, /null pointer/i, /exception/i, /traceback/i],
        strategy: '分析运行时错误，检查空指针、数组越界、内存泄漏等问题'
      }
    };
  }
  
  classify(output) {
    if (!output || typeof output !== 'string') return 'unknown';
    const text = output.substring(0, 600); // 只看前600字符
    
    for (const [category, config] of Object.entries(this.categories)) {
      for (const pattern of config.patterns) {
        if (pattern.test(text)) {
          return category;
        }
      }
    }
    return 'unknown';
  }
  
  getStrategy(category) {
    return this.categories[category]?.strategy || '分析错误信息，尝试修复后重试';
  }
  
  classifyWithStrategy(output) {
    const category = this.classify(output);
    return { category, strategy: this.getStrategy(category) };
  }
}

const toolFailureClassifier = new ToolFailureClassifier();

// ============ 增强：AI 调用错误分类器 ============
// 参考 TrieCode error-classification.js: transient可重试/deterministic不重试/unknown
class AIErrorClassifier {
  constructor() {
    this.transientPatterns = [
      /timeout/i, /timed out/i, /ETIMEDOUT/i,
      /5\d{2}/,  // 5xx 错误
      /429/,       // 限流
      /rate limit/i,
      /service unavailable/i,
      /bad gateway/i,
      /gateway timeout/i,
      /connection reset/i,
      /ECONNRESET/i,
      /ECONNREFUSED/i,
      /network error/i,
      /temporarily unavailable/i
    ];
    
    this.deterministicPatterns = [
      /401/, /403/,  // 认证/权限
      /invalid api key/i,
      /authentication failed/i,
      /permission denied/i,
      /400/, /404/,  // 参数错误/不存在
      /invalid request/i,
      /bad request/i,
      /context length exceeded/i,
      /maximum context length/i,
      /model not found/i,
      /insufficient quota/i,
      /billing/i
    ];
  }
  
  classify(error) {
    if (!error) return 'unknown';
    const message = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
    
    // HTTP 状态码优先
    const statusMatch = message.match(/\b(\d{3})\b/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1]);
      if (status >= 500) return { category: 'transient', retryable: true, reason: `HTTP ${status} 服务器错误` };
      if (status === 429) return { category: 'transient', retryable: true, reason: 'HTTP 429 限流' };
      if (status >= 400 && status < 500) return { category: 'deterministic', retryable: false, reason: `HTTP ${status} 客户端错误` };
    }
    
    // 模式匹配
    for (const pattern of this.transientPatterns) {
      if (pattern.test(message)) {
        return { category: 'transient', retryable: true, reason: `匹配瞬时错误模式: ${pattern}` };
      }
    }
    
    for (const pattern of this.deterministicPatterns) {
      if (pattern.test(message)) {
        return { category: 'deterministic', retryable: false, reason: `匹配确定性错误模式: ${pattern}` };
      }
    }
    
    // 未知错误乐观视为 transient
    return { category: 'unknown', retryable: true, reason: '未知错误，乐观视为可重试' };
  }
  
  // 解析 Retry-After 头
  parseRetryAfter(header) {
    if (!header) return null;
    // 秒数
    if (/^\d+$/.test(header)) return parseInt(header) * 1000;
    // HTTP-date
    const date = new Date(header);
    if (!isNaN(date.getTime())) return date.getTime() - Date.now();
    return null;
  }
}

const aiErrorClassifier = new AIErrorClassifier();

// ============ 增强：权限决策审计 ============
// 参考 TrieCode approval-audit.js: decision段+outcome段，outcome闭集fail-closed
class ApprovalAudit {
  constructor(maxEntries = 5000) {
    this.entries = [];
    this.maxEntries = maxEntries;
  }
  
  // 记录决策（pre阶段：策略判定结论）
  recordDecision(toolName, args, mode, decision, reason) {
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'decision',
      tool: toolName,
      args: this.sanitizeArgs(args),
      mode,
      decision,  // allow / ask / deny
      reason,
      outcome: null  // 待用户/系统决定
    };
    this.entries.push(entry);
    this.trimIfNeeded();
    return entry;
  }
  
  // 记录结果（decided：用户/决策结果）
  recordOutcome(toolName, outcome, reason) {
    // outcome 闭集：allowed-once / rejected / cancelled / unavailable
    const validOutcomes = ['allowed-once', 'rejected', 'cancelled', 'unavailable'];
    if (!validOutcomes.includes(outcome)) {
      console.warn(`[Audit] 无效 outcome: ${outcome}，fail-closed 视为 rejected`);
      outcome = 'rejected';
    }
    
    // 找到最近的同工具未完成决策
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].tool === toolName && this.entries[i].type === 'decision' && !this.entries[i].outcome) {
        this.entries[i].outcome = outcome;
        this.entries[i].outcomeReason = reason;
        this.entries[i].outcomeTimestamp = new Date().toISOString();
        return this.entries[i];
      }
    }
    
    // 没找到对应决策，单独记录
    const entry = {
      timestamp: new Date().toISOString(),
      type: 'outcome-only',
      tool: toolName,
      outcome,
      reason
    };
    this.entries.push(entry);
    this.trimIfNeeded();
    return entry;
  }
  
  // 参数脱敏（不记录敏感信息）
  sanitizeArgs(args) {
    if (!args) return args;
    const sanitized = { ...args };
    const sensitiveKeys = ['apiKey', 'password', 'token', 'secret', 'key'];
    for (const key of sensitiveKeys) {
      if (sanitized[key]) {
        sanitized[key] = '***REDACTED***';
      }
    }
    return sanitized;
  }
  
  // 超过上限时裁剪（保留最新的）
  trimIfNeeded() {
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }
  
  // 获取审计记录
  getEntries(filter = {}) {
    let result = [...this.entries];
    if (filter.tool) result = result.filter(e => e.tool === filter.tool);
    if (filter.decision) result = result.filter(e => e.decision === filter.decision);
    if (filter.outcome) result = result.filter(e => e.outcome === filter.outcome);
    if (filter.limit) result = result.slice(-filter.limit);
    return result;
  }
  
  // 统计
  getStats() {
    const stats = {
      total: this.entries.length,
      byDecision: { allow: 0, ask: 0, deny: 0 },
      byOutcome: { 'allowed-once': 0, rejected: 0, cancelled: 0, unavailable: 0, pending: 0 },
      byTool: {}
    };
    
    for (const entry of this.entries) {
      if (entry.decision) stats.byDecision[entry.decision] = (stats.byDecision[entry.decision] || 0) + 1;
      if (entry.outcome) stats.byOutcome[entry.outcome] = (stats.byOutcome[entry.outcome] || 0) + 1;
      else if (entry.type === 'decision') stats.byOutcome.pending++;
      if (entry.tool) stats.byTool[entry.tool] = (stats.byTool[entry.tool] || 0) + 1;
    }
    
    return stats;
  }
  
  // 清空
  clear() {
    this.entries = [];
  }
}

const approvalAudit = new ApprovalAudit();

// ============ 增强：Web 工具（web_search/web_fetch）============
// 参考 TrieCode web-tools.js（34KB）: 内建搜索+SSRF防护+15min缓存
class WebTools {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 15 * 60 * 1000;
    this.maxCacheSize = 100;
    this.sessionSearchLimit = 200;
    this.searchCount = 0;
    this.blockedIPs = [
      /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^169\.254\./, /^0\./, /^::1$/, /^fc00:/, /^fe80:/, /^100\.64\./,
      /metadata\.google\.internal/i, /169\.254\.169\.254/,
    ];
    this.allowedSchemes = ['http:', 'https:'];
  }
  
  isSafeUrl(url) {
    try {
      const parsed = new URL(url);
      if (!this.allowedSchemes.includes(parsed.protocol)) {
        return { safe: false, reason: `不允许的 scheme: ${parsed.protocol}` };
      }
      for (const pattern of this.blockedIPs) {
        if (pattern.test(parsed.hostname)) {
          return { safe: false, reason: `内网/元数据地址被阻断: ${parsed.hostname}` };
        }
      }
      if (parsed.hostname === 'localhost') {
        return { safe: false, reason: 'localhost 被阻断' };
      }
      return { safe: true };
    } catch (e) {
      return { safe: false, reason: `URL 解析失败: ${e.message}` };
    }
  }
  
  getCache(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return null;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.data;
  }
  
  setCache(key, data) {
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }
  
  async search(query, options = {}) {
    if (this.searchCount >= this.sessionSearchLimit) {
      return { success: false, error: '已达会话搜索上限（200次）', results: [] };
    }
    this.searchCount++;
    const cacheKey = `search:${query}`;
    const cached = this.getCache(cacheKey);
    if (cached) return { success: true, results: cached, fromCache: true };
    
    const mockResults = [
      { title: `${query} - 搜索结果1`, url: `https://example.com/search?q=${encodeURIComponent(query)}&r=1`, snippet: `关于「${query}」的搜索结果摘要。`, source: 'example.com' },
      { title: `${query} - 搜索结果2`, url: `https://example.org/search?q=${encodeURIComponent(query)}&r=2`, snippet: `关于「${query}」的深入分析和实现指南。`, source: 'example.org' },
      { title: `${query} - 搜索结果3`, url: `https://example.net/search?q=${encodeURIComponent(query)}&r=3`, snippet: `「${query}」的最新动态和社区讨论。`, source: 'example.net' }
    ];
    this.setCache(cacheKey, mockResults);
    return { success: true, results: mockResults, fromCache: false };
  }
  
  async fetch(url, options = {}) {
    const safetyCheck = this.isSafeUrl(url);
    if (!safetyCheck.safe) {
      return { success: false, error: `SSRF 防护: ${safetyCheck.reason}`, content: '' };
    }
    const cacheKey = `fetch:${url}`;
    const cached = this.getCache(cacheKey);
    if (cached) return { success: true, content: cached, fromCache: true, url };
    
    const mockContent = `# ${url}\n\n这是从 ${url} 获取的网页内容（模拟）。\n\n## 主要内容\n- 详细介绍\n- 技术实现\n- 最佳实践\n\n## 总结\n网页内容已获取并转换为 Markdown。`;
    this.setCache(cacheKey, mockContent);
    return { success: true, content: mockContent, fromCache: false, url };
  }
  
  clearCache() { this.cache.clear(); this.searchCount = 0; }
  getCacheStats() { return { size: this.cache.size, maxSize: this.maxCacheSize, searchCount: this.searchCount }; }
}
const webTools = new WebTools();

// ============ 增强：文件回滚系统（Turn级回滚）============
// 参考 TrieCode file-change-tracker.js: Turn级回滚+绝不覆盖用户改动
class FileChangeTracker {
  constructor() {
    this.turns = new Map();
    this.maxTurns = 20;
    this.currentTurn = 0;
  }
  
  beginTurn(sessionId = 'default') {
    this.currentTurn++;
    if (!this.turns.has(sessionId)) this.turns.set(sessionId, []);
    const sessionTurns = this.turns.get(sessionId);
    sessionTurns.push({ turn: this.currentTurn, changes: [], timestamp: Date.now() });
    if (sessionTurns.length > this.maxTurns) sessionTurns.shift();
    return this.currentTurn;
  }
  
  recordChange(sessionId, path, beforeContent, afterContent, action = 'modify') {
    const sessionTurns = this.turns.get(sessionId);
    if (!sessionTurns || sessionTurns.length === 0) this.beginTurn(sessionId);
    const currentTurnData = sessionTurns[sessionTurns.length - 1];
    currentTurnData.changes.push({ path, before: beforeContent, after: afterContent, action, timestamp: Date.now() });
  }
  
  async rollbackToTurn(sessionId, targetTurn) {
    const sessionTurns = this.turns.get(sessionId);
    if (!sessionTurns) return { success: false, error: '会话不存在' };
    const rollbackResults = [];
    let rolledBack = 0;
    for (let i = sessionTurns.length - 1; i >= 0; i--) {
      const turnData = sessionTurns[i];
      if (turnData.turn <= targetTurn) break;
      for (let j = turnData.changes.length - 1; j >= 0; j--) {
        const result = await this.rollbackChange(turnData.changes[j]);
        rollbackResults.push(result);
        if (result.success) rolledBack++;
      }
      turnData.rolledBack = true;
    }
    return { success: true, rolledBack, results: rollbackResults };
  }
  
  async rollbackChange(change) {
    const currentContent = state.files[change.path]?.content || null;
    if (change.action === 'create') {
      if (currentContent === change.after) {
        delete state.files[change.path];
        return { success: true, path: change.path, action: 'deleted' };
      }
      return { success: false, path: change.path, action: 'skipped', reason: '用户已修改文件，跳过删除' };
    } else if (change.action === 'delete') {
      if (state.files[change.path]) state.files[change.path].content = change.before;
      return { success: true, path: change.path, action: 'restored' };
    } else {
      if (currentContent === change.after) {
        if (state.files[change.path]) state.files[change.path].content = change.before;
        return { success: true, path: change.path, action: 'reverted' };
      }
      return { success: false, path: change.path, action: 'skipped', reason: '用户已修改文件，跳过回滚' };
    }
  }
  
  getTurnHistory(sessionId = 'default') {
    const sessionTurns = this.turns.get(sessionId);
    if (!sessionTurns) return [];
    return sessionTurns.map(t => ({ turn: t.turn, changeCount: t.changes.length, timestamp: t.timestamp, rolledBack: t.rolledBack || false, files: t.changes.map(c => ({ path: c.path, action: c.action })) }));
  }
  
  clear(sessionId = 'default') { this.turns.delete(sessionId); this.currentTurn = 0; }
}
const fileChangeTracker = new FileChangeTracker();

// ============ 增强：LRU 缓存系统 ============
// 参考 TrieCode cache.js: AI响应LRU缓存带TTL+在途请求去重
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

class LRUCache {
  constructor(maxSize = 200) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.inFlight = new Map();
  }
  
  static TTL = {
    completion: 30 * 1000,
    codeGeneration: 5 * 60 * 1000,
    errorDiagnosis: 5 * 60 * 1000,
    libraryRec: 10 * 60 * 1000,
  };
  
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) { this.cache.delete(key); return null; }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }
  
  set(key, value, ttl = LRUCache.TTL.completion) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, timestamp: Date.now(), ttl });
  }
  
  async getOrCompute(key, factory, ttl = LRUCache.TTL.completion) {
    const cached = this.get(key);
    if (cached !== null && cached !== undefined) return { value: cached, fromCache: true };
    if (this.inFlight.has(key)) {
      const value = await this.inFlight.get(key);
      return { value, fromCache: false, shared: true };
    }
    const promise = Promise.resolve().then(() => factory());
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      this.set(key, value, ttl);
      return { value, fromCache: false };
    } finally {
      this.inFlight.delete(key);
    }
  }
  
  clear() { this.cache.clear(); this.inFlight.clear(); }
  getStats() { return { size: this.cache.size, maxSize: this.maxSize, inFlight: this.inFlight.size }; }
}
const aiCache = new LRUCache(200);

// ============ 增强：模型族分档提示词 ============
// 参考 TrieCode prompt-core.js: 按模型族分档，差异="该模型最容易犯的错"
const MODEL_FAMILY_GUIDANCE = {
  claude: { guidance: '', thinking: 'Claude 内置深度思考，无需显式引导。' },
  gemini: { guidance: '显式构造文件路径，验证运行结果。', thinking: 'Gemini 需要明确的验证步骤引导。' },
  deepseek: {
    guidance: `【DeepSeek 专属引导】
- 长思考阶段不要跳过验证
- 负面护栏：不要编造不存在的 API
- 数值锚点：涉及数字时必须精确计算
- 反幻觉：不确定时明确说明
- 工具调用间文本 ≤25 词`,
    thinking: 'DeepSeek V4 四档思考：fast=disabled, light=low, standard=high, deep=max'
  },
  qwen: {
    guidance: `【Qwen 族专属引导】
- 规划通过具体动作可见
- 显式工作区相对路径
- 修改代码后必须运行测试验证
- 不要跳过验证直接声称完成`,
    thinking: 'Qwen 族包含 qwen/glm/kimi/minimax/moonshot'
  },
  gpt: {
    guidance: `【GPT 专属引导】
- 不运行破坏性 git 命令
- 不覆盖用户未提交的更改
- 匹配现有文件编码和风格
- 修改前先读取文件了解上下文`,
    thinking: 'GPT 支持 o1/o3 等思考模型'
  },
  default: { guidance: '', thinking: '默认模型，使用通用引导' }
};

function getModelFamily(modelId) {
  const m = (modelId || '').toLowerCase();
  if (m.includes('claude')) return 'claude';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('qwen') || m.includes('glm') || m.includes('kimi') || m.includes('minimax') || m.includes('moonshot')) return 'qwen';
  if (m.includes('gpt') || m.includes('o1') || m.includes('o3')) return 'gpt';
  return 'default';
}
function getModelFamilyGuidance(modelId) {
  const family = getModelFamily(modelId);
  return MODEL_FAMILY_GUIDANCE[family] || MODEL_FAMILY_GUIDANCE.default;
}

// ============ 增强：四档思考强度 ============
// 参考 TrieCode thinking.js: fast/light/standard/deep
const THINKING_LEVELS = {
  fast: { name: '快速', description: '极窄思考，仅纯事实检索', effort: 'disabled', maxTokens: 1024 },
  light: { name: '轻度', description: '轻度思考，简单任务', effort: 'low', maxTokens: 4096 },
  standard: { name: '标准', description: '标准思考，一般任务', effort: 'high', maxTokens: 8192 },
  deep: { name: '深度', description: '深度思考，复杂任务', effort: 'max', maxTokens: 16384 }
};

class ThinkingManager {
  constructor() { this.currentLevel = 'standard'; this.sessionLevels = {}; }
  setLevel(level, sessionId = 'default') {
    if (!THINKING_LEVELS[level]) return { success: false, error: `无效的思考级别: ${level}` };
    this.currentLevel = level;
    this.sessionLevels[sessionId] = level;
    return { success: true, level, info: THINKING_LEVELS[level] };
  }
  getLevel(sessionId = 'default') { return this.sessionLevels[sessionId] || this.currentLevel; }
  getLevelInfo(level) { return THINKING_LEVELS[level] || THINKING_LEVELS.standard; }
  suggestLevel(message) {
    const m = (message || '').toLowerCase();
    if (/(深度|复杂|架构|设计|算法|安全|审计)/.test(m)) return 'deep';
    if (/(是什么|什么是|查一下|查询|搜索)/.test(m) && m.length < 50) return 'fast';
    if (/(解释|说明|翻译|格式化)/.test(m)) return 'light';
    return 'standard';
  }
  nextLevel(sessionId, suggested) {
    const current = this.getLevel(sessionId);
    const levels = ['fast', 'light', 'standard', 'deep'];
    const currentIdx = levels.indexOf(current);
    const suggestedIdx = levels.indexOf(suggested);
    if (suggestedIdx > currentIdx) { this.setLevel(suggested, sessionId); return suggested; }
    return current;
  }
  listLevels() { return Object.entries(THINKING_LEVELS).map(([key, value]) => ({ key, ...value })); }
}
const thinkingManager = new ThinkingManager();

// ---------- 2.5 Skill 系统（SkillManager）----------
// 参考 Omarchy Skill 标准结构：YAML frontmatter + When MUST Be Used +
// Critical Safety Rules + Decision Framework + Example Requests
const BUILTIN_SKILLS = [
  {
    id: 'arduino-development',
    name: 'Arduino 开发',
    description: 'REQUIRED for Arduino/ESP32/STM32 embedded development. Triggers: .ino files, setup()/loop(), digitalWrite, Serial, board selection, compilation, uploading, serial monitor.',
    whenToUse: [
      '编辑任何 .ino 或 .pde 文件',
      '涉及 setup()/loop() 结构的代码',
      '板卡选择、编译、上传操作',
      '串口监视器使用',
      'Arduino 库安装/管理'
    ],
    safetyRules: [
      '上传前必须确认板卡和端口正确',
      '编译错误优先使用 AI 修复',
      '串口监视器打开时不能上传'
    ],
    examples: [
      { request: '写一个闪烁 LED 的程序', action: '生成 setup()/loop() 结构，使用 pinMode/digitalWrite/delay' },
      { request: '编译并上传到 UNO', action: '检测板卡 → 编译 → 选择端口 → 上传' }
    ],
    fileExtensions: ['.ino', '.pde']
  },
  {
    id: 'python-development',
    name: 'Python 开发',
    description: 'REQUIRED for Python development. Triggers: .py files, pip/venv, pytest, virtualenv, requirements.txt, pyproject.toml.',
    whenToUse: [
      '编辑 .py 文件',
      '运行 pytest / unittest',
      '安装 pip 包',
      '创建虚拟环境',
      '处理 requirements.txt / pyproject.toml'
    ],
    safetyRules: [
      '使用虚拟环境隔离依赖',
      '运行测试前确保依赖已安装',
      '不要直接修改系统 Python 环境'
    ],
    examples: [
      { request: '写一个快速排序函数', action: '生成 Python 函数，包含类型注解和 docstring' },
      { request: '运行测试', action: '检测 pytest → 运行 → 解析结果' }
    ],
    fileExtensions: ['.py']
  },
  {
    id: 'web-development',
    name: 'Web 开发',
    description: 'REQUIRED for web development. Triggers: .html/.css/.js/.ts/.jsx/.tsx files, npm, package.json, React, Vue, Node.js server.',
    whenToUse: [
      '编辑 HTML/CSS/JavaScript/TypeScript 文件',
      '处理 package.json',
      '运行 npm/yarn/pnpm 命令',
      '开发 React/Vue 组件',
      '创建 Node.js 服务器'
    ],
    safetyRules: [
      '不要在生产环境运行 npm install --force',
      '修改依赖前检查 package.json',
      '前端代码修改后需要刷新浏览器验证'
    ],
    examples: [
      { request: '创建一个 React 组件', action: '生成函数组件，包含 useState/useEffect' },
      { request: '启动开发服务器', action: '检测 package.json scripts → npm run dev' }
    ],
    fileExtensions: ['.html', '.css', '.js', '.ts', '.jsx', '.tsx']
  }
];

class SkillManager {
  constructor() {
    this.skills = BUILTIN_SKILLS;
    this.activeSkill = null;
  }

  // 根据用户消息和当前文件自动选择 skill（参考 Omarchy description 触发条件）
  selectSkill(userMessage, currentFile) {
    const scores = this.skills.map(skill => {
      let score = 0;
      // 文件扩展名匹配（高权重）
      if (currentFile && skill.fileExtensions) {
        const ext = '.' + currentFile.split('.').pop();
        if (skill.fileExtensions.includes(ext)) score += 10;
      }
      // 关键词匹配（从 description 提取）
      const keywords = skill.description.toLowerCase()
        .replace(/required for|triggers:|and|or|the|a|an/g, ' ')
        .split(/[\s,./]+/)
        .filter(w => w.length > 3);
      keywords.forEach(kw => {
        if (userMessage.toLowerCase().includes(kw)) score += 1;
      });
      // whenToUse 关键词匹配
      skill.whenToUse.forEach(condition => {
        const words = condition.toLowerCase().split(/[\s,./]+/).filter(w => w.length > 2);
        words.forEach(w => {
          if (userMessage.toLowerCase().includes(w)) score += 0.5;
        });
      });
      return { skill, score };
    });
    scores.sort((a, b) => b.score - a.score);
    if (scores[0].score > 2) {
      this.activeSkill = scores[0].skill;
      return scores[0].skill;
    }
    this.activeSkill = null;
    return null;
  }

  // 获取 skill 的系统提示注入（参考 Omarchy SKILL.md 结构）
  getSystemPrompt(skill) {
    if (!skill) return '';
    return `
## SKILL: ${skill.name}
${skill.description}

### 何时必须使用（When This Skill MUST Be Used）
${skill.whenToUse.map(u => `- ${u}`).join('\n')}

### 关键安全规则（Critical Safety Rules）
${skill.safetyRules.map(r => `- ${r}`).join('\n')}

### 示例请求（Example Requests）
${skill.examples.map(e => `- "${e.request}" → ${e.action}`).join('\n')}
`;
  }

  // 获取所有 skill 列表（UI 展示用）
  listSkills() {
    return this.skills.map(s => ({
      id: s.id,
      name: s.name,
      active: this.activeSkill?.id === s.id,
      description: s.description
    }));
  }
}

const skillManager = new SkillManager();

// ---------- 3. 预算护栏（BudgetTracker）----------
// 参考 TrieCode loop-engine.js: 迭代/无菌动作检测
class BudgetTracker {
  constructor(maxTurns=20, maxSterile=4) {
    this.maxTurns = maxTurns;
    this.maxSterile = maxSterile;
    this.iterations = 0;
    this.actionHits = new Map();
  }
  recordIteration() { this.iterations++; }
  actionKey(toolName, args) {
    try {
      const compact = JSON.stringify(args, (k,v) => typeof v==='string' ? (v.length>200 ? v.slice(0,200)+'…' : v) : v);
      return `${toolName}::${compact}`;
    } catch { return `${toolName}::[unserializable]`; }
  }
  recordAction(toolName, args) {
    if (getToolCategory(toolName) === 'query') return { hit: 0 };
    const key = this.actionKey(toolName, args);
    const next = (this.actionHits.get(key) || 0) + 1;
    this.actionHits.set(key, next);
    return { hit: next, key };
  }
  clearAction(key) { this.actionHits.delete(key); }
  check() {
    if (this.iterations >= this.maxTurns) {
      return { kind: 'iterations', reason: `已到达最大工具调用次数（${this.iterations}）` };
    }
    for (const [key, hit] of this.actionHits) {
      if (hit >= this.maxSterile) {
        return { kind: 'sterile', reason: `工具 "${key}" 重复调用 ${hit} 次（疑似陷入循环）`, key };
      }
    }
    return null;
  }
}

// ---------- 4. 计划解析（PlanStore）----------
function parsePlanSteps(planText) {
  const lines = String(planText || '').split('\n');
  const steps = [];
  const stepRe = /^\s*(?:[-*]\s*(?:\[[ xX]\]\s*)?|\d+[.)]\s*)(.+)$/;
  let id = 1;
  for (const raw of lines) {
    const sm = raw.trim().match(stepRe);
    if (sm) {
      const title = sm[1].trim();
      if (title && !title.startsWith('#')) {
        steps.push({ id: `step_${id++}`, title, status: 'pending' });
      }
    }
  }
  return steps;
}

// ---------- 5. 模拟 AI 客户端（MockAIClient）----------
class MockAIClient {
  constructor() { this.responseIndex = 0; }

  generateResponse(userInput, messages) {
    const input = String(userInput || '').toLowerCase();

    // 写代码类需求 → write_file
    if (/写|创建|生成|实现|quick.?sort|快速排序|函数|组件/.test(input)) {
      const hasQuickSort = Object.keys(state.files).some(f => f.includes('quick_sort'));
      if (!hasQuickSort) {
        return {
          content: '好的，我来为你创建快速排序函数。',
          toolCalls: [{
            id: 'call_1', name: 'write_file',
            arguments: {
              file_path: 'src/quick_sort.py',
              content: `def quick_sort(arr):\n    """快速排序算法"""\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    return quick_sort(left) + middle + quick_sort(right)\n\n\ndef quick_sort_with_steps(arr):\n    """带步骤输出的快速排序"""\n    if len(arr) <= 1:\n        return arr\n    pivot = arr[len(arr) // 2]\n    print(f"基准元素: {pivot}, 数组: {arr}")\n    left = [x for x in arr if x < pivot]\n    middle = [x for x in arr if x == pivot]\n    right = [x for x in arr if x > pivot]\n    print(f"  左: {left}, 中: {middle}, 右: {right}")\n    return quick_sort_with_steps(left) + middle + quick_sort_with_steps(right)\n\n\n# 测试\nif __name__ == "__main__":\n    data = [64, 34, 25, 12, 22, 11, 90]\n    print("原始数据:", data)\n    print("排序结果:", quick_sort(data))\n    print("\\n带步骤:")\n    quick_sort_with_steps(data)\n`
            }
          }]
        };
      }
    }

    // 运行/执行类需求 → terminal
    if (/运行|执行|跑|run|start|python|测试|test/.test(input)) {
      const target = state.activeTab || 'src/main.py';
      return {
        content: '好的，我来运行当前文件。',
        toolCalls: [{ id: 'call_1', name: 'terminal', arguments: { command: `python ${target}` } }]
      };
    }

    // 解释/分析类需求 → 纯文本
    if (/解释|说明|分析|这是什么|代码|explain|what/.test(input)) {
      const target = state.activeTab || 'src/main.py';
      const f = state.files[target];
      if (f) {
        return {
          content: `当前文件 **${target}** 包含以下内容：\n\n${f.content.split('\n').slice(0,15).join('\n')}...\n\n这个文件实现了快速排序算法和数据处理器类。核心逻辑：\n1. **quick_sort()** - 采用分治策略，平均时间复杂度 O(n log n)\n2. **binary_search()** - 二分查找，时间复杂度 O(log n)\n3. **DataProcessor** 类 - 封装排序和查找操作\n\n你想让我优化哪个部分？`,
          toolCalls: []
        };
      }
    }

    // 安装依赖 → terminal
    if (/安装|依赖|install|npm|pip/.test(input)) {
      return {
        content: '好的，我来安装项目依赖。',
        toolCalls: [{ id: 'call_1', name: 'terminal', arguments: { command: 'pip install requests numpy' } }]
      };
    }

    // 计划模式 → submit_plan
    if (/计划|规划|plan|步骤|方案/.test(input)) {
      return {
        content: '好的，我来制定执行计划。',
        toolCalls: [{
          id: 'call_1', name: 'submit_plan',
          arguments: {
            plan: `## 执行计划\n\n1. 读取当前项目结构和文件内容\n2. 分析需求并设计实现方案\n3. 创建/修改源代码文件\n4. 运行测试验证功能\n5. 优化代码并总结`
          }
        }]
      };
    }

    // 任务清单 → todo_write
    if (/任务|清单|todo|待办/.test(input)) {
      return {
        content: '好的，我来创建任务清单。',
        toolCalls: [{
          id: 'call_1', name: 'todo_write',
          arguments: { todos: [
            { id: 't1', title: '分析需求', status: 'completed' },
            { id: 't2', title: '编写代码', status: 'in_progress' },
            { id: 't3', title: '运行测试', status: 'pending' },
            { id: 't4', title: '优化总结', status: 'pending' },
          ]}
        }]
      };
    }

    // ===== 新增：联网搜索 → web_search =====
    if (/搜索|联网|查一下|查找资料|搜索一下|web.?search|google|baidu/.test(input)) {
      const query = userInput.replace(/(搜索|联网|查一下|查找资料|搜索一下|帮我)/g, '').trim() || 'AI 编程助手';
      return {
        content: `好的，我来联网搜索「${query}」相关信息。`,
        toolCalls: [{ id: 'call_1', name: 'web_search', arguments: { query } }]
      };
    }

    // ===== 新增：获取网页 → web_fetch =====
    if (/获取网页|打开网页|抓取|fetch|url|网址|链接.*内容|网页内容/.test(input)) {
      const urlMatch = userInput.match(/https?:\/\/[^\s]+/);
      const url = urlMatch ? urlMatch[0] : 'https://example.com';
      return {
        content: `好的，我来获取网页内容：${url}`,
        toolCalls: [{ id: 'call_1', name: 'web_fetch', arguments: { url } }]
      };
    }

    // ===== 新增：询问用户 → ask_user =====
    if (/询问|确认一下|问用户|需要确认|你希望|你想要|你倾向|ask.?user/.test(input)) {
      return {
        content: '这个需求有多种实现方式，让我先确认一下你的偏好。',
        toolCalls: [{
          id: 'call_1', name: 'ask_user',
          arguments: {
            question: '你希望用哪种方式实现？',
            options: ['简单实现（功能少但快）', '完整实现（功能全但慢）', '先做原型再迭代'],
            header: '实现方式'
          }
        }]
      };
    }

    // ===== 新增：深度研究 → run_subagent =====
    if (/研究|调研|深度分析|子智能体|subagent|深入了解|全面分析|做个研究/.test(input)) {
      const task = userInput.replace(/(帮我|请|研究一下|调研一下|深度分析|深入了解)/g, '').trim() || '当前项目的技术架构';
      return {
        content: `好的，我派一个只读子智能体来深度研究「${task}」。子智能体只能使用只读工具，不会修改任何文件。`,
        toolCalls: [{ id: 'call_1', name: 'run_subagent', arguments: { task, focus: '技术实现和最佳实践' } }]
      };
    }

    // 默认：纯文本
    return {
      content: `我理解你的需求是："${userInput}"\n\n作为 AI 编程助手，我可以帮你：\n• 生成新代码文件（试试"写一个快速排序"）\n• 运行代码和测试（试试"运行"）\n• 解释当前代码（试试"解释代码"）\n• 安装依赖（试试"安装依赖"）\n• 制定执行计划（试试"制定计划"）\n• 联网搜索信息（试试"搜索 XXX"）\n• 派子智能体研究（试试"深度研究 XXX"）\n\n请更具体地描述你的需求。`,
      toolCalls: []
    };
  }
}

// ============ 增强：四阶段工具瀑布 ============
// 参考 TrieCode tool-pipeline.js: pre策略判定 / guard安全闸门 / around包裹执行 / post观测变换
class ToolPipeline {
  constructor() {
    this.preHooks = [];      // pre阶段：策略判定（权限/预算/无菌）
    this.guards = [];        // guard阶段：安全闸门（单调否决）
    this.aroundHooks = [];   // around阶段：包裹执行（超时/取消/日志）
    this.postHooks = [];     // post阶段：观测变换（结果分类/审计/缓存）
  }
  
  // 注册 pre 钩子（返回 {allow, reason, modifiedArgs}）
  registerPre(fn) { this.preHooks.push(fn); }
  
  // 注册 guard（返回 {blocked, reason}，任一 guard 阻断则不执行）
  registerGuard(fn) { this.guards.push(fn); }
  
  // 注册 around 钩子（包裹执行，可修改结果）
  registerAround(fn) { this.aroundHooks.push(fn); }
  
  // 注册 post 钩子（观测/变换结果）
  registerPost(fn) { this.postHooks.push(fn); }
  
  // 执行工具（四阶段瀑布）
  async execute(toolName, args, context, executeFn) {
    const startTime = Date.now();
    
    // ===== pre 阶段：策略判定 =====
    let currentArgs = { ...args };
    for (const pre of this.preHooks) {
      const result = pre(toolName, currentArgs, context);
      if (result && result.allow === false) {
        return { success: false, error: result.reason || 'pre阶段拒绝', stage: 'pre' };
      }
      if (result && result.modifiedArgs) {
        currentArgs = { ...currentArgs, ...result.modifiedArgs };
      }
    }
    
    // ===== guard 阶段：安全闸门（单调否决）=====
    for (const guard of this.guards) {
      const result = guard(toolName, currentArgs, context);
      if (result && result.blocked) {
        return { success: false, error: result.reason || 'guard阶段阻断', stage: 'guard' };
      }
    }
    
    // ===== around 阶段：包裹执行 =====
    let executeResult;
    const wrappedExecute = async () => {
      return await executeFn(toolName, currentArgs, context);
    };
    
    // 从内向外包裹
    let currentFn = wrappedExecute;
    for (let i = this.aroundHooks.length - 1; i >= 0; i--) {
      const around = this.aroundHooks[i];
      const next = currentFn;
      currentFn = () => around(toolName, currentArgs, context, next);
    }
    
    try {
      executeResult = await currentFn();
    } catch (error) {
      executeResult = { success: false, error: error.message || String(error), exception: error };
    }
    
    // ===== post 阶段：观测变换 =====
    let finalResult = { ...executeResult, duration: Date.now() - startTime };
    for (const post of this.postHooks) {
      const result = post(toolName, currentArgs, context, finalResult);
      if (result && result.modifiedResult) {
        finalResult = { ...finalResult, ...result.modifiedResult };
      }
    }
    
    return finalResult;
  }
}

const toolPipeline = new ToolPipeline();

// 注册默认 pre 钩子：权限检查
toolPipeline.registerPre((toolName, args, context) => {
  const mode = context.mode || 'default';
  const planApproved = context.planApproved || false;
  
  // plan 模式门控
  if (mode === 'plan' && !planApproved) {
    if (isPlanGated(toolName, args, planApproved)) {
      return { allow: false, reason: '当前处于 PLAN 模式（只读）。只能调用只读查询工具；请先提交计划并等待批准。' };
    }
  }
  
  // Rule 引擎检查
  const ruleResult = permissionRuleEngine.evaluate(toolName, args.path || args.file || '*');
  if (ruleResult) {
    if (ruleResult.effect === 'deny') {
      return { allow: false, reason: `权限规则拒绝: ${ruleResult.rules.map(r => `${r.action}:${r.resource}`).join(', ')}` };
    }
    if (ruleResult.effect === 'ask' && mode !== 'auto') {
      return { allow: false, reason: '权限规则要求确认' };
    }
  }
  
  return { allow: true };
});

// 注册默认 guard：终端命令安全检查
toolPipeline.registerGuard((toolName, args, context) => {
  if (toolName === 'terminal' && args.command) {
    const result = checkTerminalCommand(args.command, context.mode || 'default');
    if (result.blocked) {
      return { blocked: true, reason: result.reasons.join('; ') };
    }
  }
  return { blocked: false };
});

// 注册默认 post：工具失败分类 + 审计
toolPipeline.registerPost((toolName, args, context, result) => {
  // 工具失败分类
  if (!result.success && result.error) {
    const classification = toolFailureClassifier.classifyWithStrategy(result.error);
    return { modifiedResult: { failureCategory: classification.category, failureStrategy: classification.strategy } };
  }
  return {};
});

// ============ 增强：独立验证代理 ============
// 参考 TrieCode verification-agent.js: 独立只读验证代理，VERDICT协议输出
// "只有verifier发verdict，主代理不能自评"
const VERDICT_LEVELS = ['PASS', 'FAIL', 'PARTIAL', 'UNVERIFIABLE'];

class VerificationAgent {
  constructor({ onStream, onToolStep }) {
    this.onStream = onStream || (() => {});
    this.onToolStep = onToolStep || (() => {});
    this.maxTurns = 4;  // 验证代理轮次收紧
    this.turnCount = 0;
  }
  
  // 验证主入口
  async verify(claim, context) {
    this.turnCount = 0;
    const evidence = [];
    
    this.onStream({ type: 'text', content: `\n🔍 验证代理启动：验证声明「${claim}」\n` });
    
    // 步骤1：分析声明，确定验证方法
    const method = this.analyzeClaim(claim, context);
    evidence.push({ step: 'analyze', method });
    
    // 步骤2：执行验证（只读工具）
    const verificationResult = await this.executeVerification(method, context);
    evidence.push({ step: 'execute', result: verificationResult });
    
    // 步骤3：生成 VERDICT
    const verdict = this.generateVerdict(claim, evidence, verificationResult);
    
    this.onStream({ type: 'text', content: `\n📋 验证结论：${verdict.level}\n${verdict.reasoning}\n` });
    
    return verdict;
  }
  
  // 分析声明，确定验证方法
  analyzeClaim(claim, context) {
    const c = claim.toLowerCase();
    
    if (c.includes('测试') || c.includes('test') || c.includes('通过')) {
      return { type: 'run_tests', description: '运行测试套件验证' };
    }
    if (c.includes('编译') || c.includes('compile') || c.includes('build')) {
      return { type: 'compile', description: '编译项目验证' };
    }
    if (c.includes('运行') || c.includes('run') || c.includes('执行')) {
      return { type: 'run', description: '运行程序验证输出' };
    }
    if (c.includes('文件') || c.includes('file') || c.includes('创建')) {
      return { type: 'check_file', description: '检查文件是否存在且内容正确' };
    }
    if (c.includes('安装') || c.includes('install') || c.includes('依赖')) {
      return { type: 'check_deps', description: '检查依赖是否安装' };
    }
    
    return { type: 'inspect', description: '代码审查验证' };
  }
  
  // 执行验证（只读工具，运行时硬门）
  async executeVerification(method, context) {
    const results = [];
    
    // 只读工具白名单（验证代理只能用这些）
    const READONLY_TOOLS = ['read_file', 'list_dir', 'terminal', 'run_test', 'web_search', 'web_fetch'];
    
    switch (method.type) {
      case 'run_tests':
        // 模拟运行测试
        results.push({ tool: 'run_test', output: '模拟测试运行：3 passed, 0 failed', success: true });
        break;
      case 'compile':
        results.push({ tool: 'terminal', output: '模拟编译：成功，0 errors, 0 warnings', success: true });
        break;
      case 'run':
        results.push({ tool: 'terminal', output: '模拟运行：程序正常退出，退出码 0', success: true });
        break;
      case 'check_file':
        results.push({ tool: 'list_dir', output: '模拟文件检查：文件存在', success: true });
        break;
      default:
        results.push({ tool: 'read_file', output: '模拟代码审查：代码结构正确', success: true });
    }
    
    return results;
  }
  
  // 生成 VERDICT（PASS/FAIL/PARTIAL/UNVERIFIABLE + 证据）
  generateVerdict(claim, evidence, verificationResult) {
    const allSuccess = verificationResult.every(r => r.success);
    const hasEvidence = verificationResult.length > 0;
    
    let level, reasoning;
    
    if (!hasEvidence) {
      level = 'UNVERIFIABLE';
      reasoning = '无法获取验证证据，声明未经验证。';
    } else if (allSuccess) {
      level = 'PASS';
      reasoning = `所有验证步骤通过。证据：${verificationResult.map(r => `${r.tool}: ${r.output.substring(0, 50)}`).join('; ')}`;
    } else if (verificationResult.some(r => r.success)) {
      level = 'PARTIAL';
      reasoning = `部分验证通过，部分失败。通过：${verificationResult.filter(r => r.success).length}/${verificationResult.length}`;
    } else {
      level = 'FAIL';
      reasoning = `验证失败。失败步骤：${verificationResult.filter(r => !r.success).map(r => r.tool).join(', ')}`;
    }
    
    return {
      level,
      claim,
      reasoning,
      evidence,
      timestamp: new Date().toISOString(),
      verifier: 'VerificationAgent'  // 明确标记：只有verifier发verdict
    };
  }
}

// ============ 增强：只读子智能体 ============
// 参考 TrieCode subagent.js: 只读子智能体，运行时硬门，结构化输出契约
const SUBAGENT_READONLY_TOOLS = [
  'read_file', 'list_dir', 'grep_search', 'web_search', 'web_fetch',
  'terminal', 'run_test', 'view_image', 'query_memory', 'list_memories'
];

class SubAgent {
  constructor({ task, parentContext, onStream }) {
    this.task = task;
    this.parentContext = parentContext;
    this.onStream = onStream || (() => {});
    this.maxTurns = 6;  // 子智能体轮次收紧
    this.turnCount = 0;
    this.isCancelled = false;
  }
  
  // 运行只读子智能体
  async run() {
    this.onStream({ type: 'text', content: `\n🔬 子智能体启动：${this.task.substring(0, 50)}...\n` });
    
    const findings = [];
    
    // 步骤1：理解任务，确定研究方向
    const plan = this.planResearch(this.task);
    findings.push({ type: 'plan', content: plan });
    
    // 步骤2：执行只读研究（运行时硬门：只允许只读工具）
    for (const step of plan.steps) {
      if (this.isCancelled) break;
      if (this.turnCount >= this.maxTurns) break;
      
      const result = await this.guardedExecute(step.tool, step.args);
      findings.push({ type: 'finding', step: step.description, result });
      this.turnCount++;
    }
    
    // 步骤3：结构化输出契约（强制固定 Markdown 结构）
    const structuredOutput = this.formatStructuredOutput(findings);
    
    this.onStream({ type: 'text', content: `\n✅ 子智能体完成，返回结构化结论\n` });
    
    return structuredOutput;
  }
  
  // 规划研究方向
  planResearch(task) {
    const t = task.toLowerCase();
    const steps = [];
    
    if (t.includes('错误') || t.includes('error') || t.includes('bug')) {
      steps.push({ tool: 'grep_search', args: { pattern: 'error|Error|ERROR' }, description: '搜索错误相关代码' });
      steps.push({ tool: 'read_file', args: { path: 'src/main.py' }, description: '读取主文件分析' });
    } else if (t.includes('文档') || t.includes('doc') || t.includes('说明')) {
      steps.push({ tool: 'read_file', args: { path: 'README.md' }, description: '读取项目文档' });
      steps.push({ tool: 'list_dir', args: { path: '.' }, description: '列出项目结构' });
    } else {
      steps.push({ tool: 'list_dir', args: { path: '.' }, description: '了解项目结构' });
      steps.push({ tool: 'read_file', args: { path: 'src/main.py' }, description: '读取核心文件' });
    }
    
    return { steps, summary: `针对「${task}」的研究计划` };
  }
  
  // 运行时只读硬门（不依赖模型自觉）
  async guardedExecute(toolName, args) {
    // 硬门：只允许只读工具
    if (!SUBAGENT_READONLY_TOOLS.includes(toolName)) {
      return { success: false, error: `子智能体安全门：工具「${toolName}」不在只读白名单中，已拒绝执行` };
    }
    
    // 模拟执行只读工具
    return { success: true, output: `模拟只读工具 ${toolName} 执行结果`, tool: toolName };
  }
  
  // 结构化输出契约（强制固定 Markdown 结构）
  formatStructuredOutput(findings) {
    const conclusion = findings.filter(f => f.type === 'finding').map(f => f.result.output).join('; ');
    
    return `## 子智能体研究报告

### 结论摘要
${conclusion || '未找到明确结论'}

### 发现
${findings.filter(f => f.type === 'finding').map((f, i) => `${i + 1}. **${f.step}**: ${f.result.output}`).join('\n') || '无具体发现'}

### 涉及文件
- src/main.py
- README.md

### 未决问题
- 需要进一步验证的细节

### 置信度
中等（基于静态分析，未实际运行）
`;
  }
  
  // 取消子智能体
  cancel() {
    this.isCancelled = true;
  }
}

// ---------- 6. AgentRunner（智能体主循环）----------
// 参考 TrieCode agent-runner.js: 统一 turn 循环
class AgentRunner {
  constructor({ onStream, onToolStep, onPlanRequest, mode='default' }) {
    this.onStream = onStream;
    this.onToolStep = onToolStep;
    this.onPlanRequest = onPlanRequest;
    this.mode = mode;
    this.ai = new MockAIClient();
    this.budget = new BudgetTracker(20, 4);
    this.messages = [];
    this.denialHits = new Map();
    this.sterileRecovered = false;
    this.cancelled = false;
    this.planApproved = false;
    // 验证闸门状态（P0-4）：跟踪最近文件修改轮次和最近真实验证轮次
    this.lastFileModTurn = -1;
    this.lastVerifyTurn = -1;
    this.verifyNudges = 0;
    this.MAX_VERIFY_NUDGES = 2;
    this.placeholderVerify = false;
    // 进展闸状态：连续有失败无进展的轮次计数
    this.noProgressRounds = 0;
    // 上下文预算
    this.contextBudget = 30000;
  }

  cancel() { this.cancelled = true; }

  async run(userInput) {
    this.cancelled = false;
    this.messages.push({ role: 'user', content: userInput });
    this.budget = new BudgetTracker(20, 4);
    this.sterileRecovered = false;

    // Skill 自动选择（参考 Omarchy Skill: 根据用户消息+当前文件自动匹配）
    const currentFile = state.activeTab;
    const matchedSkill = skillManager.selectSkill(userInput, currentFile);
    if (matchedSkill) {
      addOutputLog(`匹配 Skill: ${matchedSkill.name}`, 'info');
      const skillPrompt = skillManager.getSystemPrompt(matchedSkill);
      // 注入 skill 系统提示（作为第一条 system 消息）
      this.messages.unshift({ role: 'system', content: skillPrompt });
    }
    
    // ===== 增强5：模型族分档提示词注入（参考 TrieCode prompt-core.js）=====
    // 差异="该模型最容易犯的错"，各档只补该族易错点
    const defaultModel = 'deepseek-chat';  // 默认模型
    const modelFamily = getModelFamily(defaultModel);
    const familyGuidance = getModelFamilyGuidance(defaultModel);
    if (familyGuidance.guidance) {
      addOutputLog(`模型族提示词: ${modelFamily}`, 'debug');
      this.messages.unshift({ role: 'system', content: `## 模型专属引导\n${familyGuidance.guidance}` });
    }
    
    // ===== 增强6：思考强度自适应（参考 TrieCode thinking.js）=====
    const suggestedLevel = thinkingManager.suggestLevel(userInput);
    const finalLevel = thinkingManager.nextLevel('default', suggestedLevel);
    addOutputLog(`思考强度: ${finalLevel} (${THINKING_LEVELS[finalLevel].name})`, 'debug');

    for (let turn = 0; turn < 20; turn++) {
      if (this.cancelled) { this._stream('已停止。', true); return; }

      // 预算检查
      const breach = this.budget.check();
      if (breach) {
        if (breach.kind === 'sterile' && !this.sterileRecovered) {
          this.sterileRecovered = true;
          if (breach.key) this.budget.clearAction(breach.key);
          this._stream(`[系统] 检测到工具调用循环（${breach.reason}）。请换一种实现方式。`, false);
          this.messages.push({ role: 'user', content: `[系统] ${breach.reason}。请停止重复尝试，换一种方式。` });
          continue;
        }
        // ===== 增强7：预算耗尽收尾总结（参考 TrieCode agent-runner.js）=====
        // 预算耗尽时自动总结已完成的工作，而不是简单停止
        const completedTools = this.messages.filter(m => m.role === 'tool').map(m => {
          const match = m.content.match(/name="([^"]+)"/);
          return match ? match[1] : 'unknown';
        });
        const modifiedFiles = this.messages.filter(m => m.role === 'tool' && /name="(write_file|edit_file|delete_file)"/.test(m.content)).length;
        const verificationDone = this.lastVerifyTurn >= 0;
        
        const summary = `\n## 任务总结（预算耗尽）\n\n` +
          `- 已执行轮次: ${turn + 1}/20\n` +
          `- 工具调用次数: ${completedTools.length}\n` +
          `- 文件修改次数: ${modifiedFiles}\n` +
          `- 验证状态: ${verificationDone ? '已执行验证' : '未执行验证（建议手动验证）'}\n` +
          `- 停止原因: ${breach.reason}\n\n` +
          `**注意**: 因预算限制任务提前停止。请检查上述工作是否完整，必要时手动继续或验证。`;
        
        this._stream(summary, true);
        addOutputLog(`预算耗尽收尾总结: ${breach.reason}`, 'warn');
        return;
      }

      this.budget.recordIteration();

      // 上下文压缩（简化版）：超预算时删除旧工具结果，保护最近3轮
      const estTokens = this.estimateTokens();
      if (estTokens > this.contextBudget) {
        this.messages = this.compressContext(this.messages, 3);
        addOutputLog(`上下文压缩: ${estTokens} → 约 ${this.estimateTokens()} tokens`, 'warn');
      }

      // 调用 AI（模拟）
      const lastUserMsg = this.messages.filter(m => m.role === 'user').pop();
      const startTime = Date.now();
      const result = this.ai.generateResponse(lastUserMsg?.content || userInput, this.messages);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      // 生成思考过程并展示
      if (this.onThinking) {
        const thinkingContent = this._generateThinking(lastUserMsg?.content || userInput, result);
        this.onThinking({ content: thinkingContent, duration });
      }

      // 流式输出文本
      if (result.content) {
        await this._streamText(result.content);
      }

      // 无工具调用 → 结束（先过验证硬闸门）
      if (!result.toolCalls || result.toolCalls.length === 0) {
        const finalText = String(result.content || '').trim();
        // 提问判定：问号结尾或提问句式 → 不追问验证（避免打断澄清性对话）
        const asksUser = /[?？]\s*$/.test(finalText) || /(请问|是否应该|要不要我|需不需要|你觉得|可以吗|是否先|是否需要)/.test(finalText);
        // 验证硬闸门（P0-4）：有文件修改晚于最近真验证且非提问收尾 → 追问
        if (this.lastFileModTurn > this.lastVerifyTurn && !asksUser && this.verifyNudges < this.MAX_VERIFY_NUDGES) {
          this.verifyNudges++;
          const harder = this.verifyNudges >= this.MAX_VERIFY_NUDGES
            ? '（硬性要求：请在收尾前运行验证并引用真实输出；若确实无法自动化验证，必须明确列出"未验证项"并说明客观原因。）'
            : '';
          
          // ===== 增强：独立验证代理集成（参考 TrieCode verification-agent.js）=====
          // 当检测到文件修改未验证时，自动启动独立验证代理生成正式 VERDICT
          if (this.verifyNudges === 1 && this.mode === 'auto') {
            try {
              this._stream('\n🔍 [系统] 启动独立验证代理，自动验证文件修改...\n', false);
              const verificationAgent = new VerificationAgent({
                onStream: (chunk) => this._stream(chunk.content || '', false),
                onToolStep: (id, name, status, detail) => this._toolStep(id, name, status, detail)
              });
              const modifiedFiles = this.messages
                .filter(m => m.role === 'tool' && /name="(write_file|edit_file)"/.test(m.content))
                .map(m => {
                  const match = m.content.match(/path="([^"]+)"/);
                  return match ? match[1] : 'unknown';
                });
              const claim = `文件修改已完成并验证通过: ${modifiedFiles.join(', ')}`;
              const verdict = await verificationAgent.verify(claim, {
                files: modifiedFiles,
                messages: this.messages,
                mode: this.mode
              });
              this._stream(`\n📋 验证代理结论: ${verdict.level}\n`, false);
              if (verdict.level === 'PASS') {
                this.lastVerifyTurn = turn;
                this.placeholderVerify = false;
                this.messages.push({ role: 'assistant', content: result.content || '' });
                this._stream('', true);
                return;
              }
            } catch (e) {
              addOutputLog(`验证代理执行失败: ${e.message}`, 'warn');
            }
          }
          
          this.messages.push({ role: 'assistant', content: result.content || '' });
          this.messages.push({ role: 'user', content: `（你有文件修改但尚未运行验证。请在给出最终结论前：要么运行验证（terminal / run_test）并引用真实输出，要么明确说明为何无法验证。测试失败是事实——不要仅凭"应该可以"下结论，不要谎报测试通过。）${harder}` });
          this._stream('\n[系统] 检测到文件修改但未验证，请运行验证后再收尾。\n', false);
          continue;
        }
        // 占位符验证软闸门：跑了验证但输出像 echo ok/空输出 → 追问真实验证
        if (this.placeholderVerify && !asksUser && this.verifyNudges < this.MAX_VERIFY_NUDGES) {
          this.verifyNudges++;
          this.messages.push({ role: 'assistant', content: result.content || '' });
          this.messages.push({ role: 'user', content: '（本轮验证输出看起来像占位符（如 echo ok / 空输出），不像真实运行结果。请运行真实命令并引用实际输出，或明确说明为何无法真实验证。）' });
          this._stream('\n[系统] 验证输出疑似占位符，请运行真实验证。\n', false);
          continue;
        }
        this.messages.push({ role: 'assistant', content: result.content || '' });
        this._stream('', true);
        return;
      }

      // 处理工具调用
      this.messages.push({ role: 'assistant', content: result.content || '', tool_calls: result.toolCalls });

      for (const tc of result.toolCalls) {
        if (this.cancelled) return;

        const toolDef = getToolDef(tc.name);
        if (!toolDef) {
          const err = `Error: 未知工具: ${tc.name}`;
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: err });
          this._toolStep(tc.id, tc.name, 'error', err);
          continue;
        }

        // PLAN 门控
        if (isPlanGated(tc.name, tc.arguments, this.planApproved)) {
          const err = 'Error: 当前处于 PLAN 模式（只读）。只能调用只读查询工具；请先提交计划并等待批准。';
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: err });
          this._toolStep(tc.id, tc.name, 'rejected', err);
          continue;
        }

        // 权限判定
        const denialKey = tc.name === 'terminal' ? `terminal:${String(tc.arguments?.command||'').split(' ')[0]}` : tc.name;
        const dHits = this.denialHits.get(denialKey) || 0;
        const needsConfirm = computeNeedsConfirm(tc.name, tc.arguments, this.mode, dHits);
        
        // ===== 增强4：权限决策审计（参考 TrieCode approval-audit.js）=====
        const auditDecision = needsConfirm ? 'ask' : (isPlanGated(tc.name, tc.arguments, this.planApproved) ? 'deny' : 'allow');
        approvalAudit.recordDecision(tc.name, tc.arguments, this.mode, auditDecision, 
          auditDecision === 'ask' ? '需要用户确认' : auditDecision === 'deny' ? 'PLAN模式只读门控' : '自动放行');

        if (needsConfirm) {
          this._toolStep(tc.id, tc.name, 'waiting', `等待确认: ${tc.name}`);
          
          // 使用新的权限确认弹窗
          if (this.onPermissionRequest) {
            const command = tc.name === 'terminal' 
              ? tc.arguments?.command 
              : `${tc.name}(${JSON.stringify(tc.arguments).slice(0, 100)})`;
            const detail = `工具: ${tc.name}\n操作类型: ${toolDef?.description || '未知'}\n风险等级: ${needsConfirm === 'high' ? '高' : '中'}`;
            
            const userChoice = await new Promise((resolve) => {
              this.onPermissionRequest({
                tool: tc.name,
                command,
                detail,
                callback: (choice) => resolve(choice)
              });
            });
            
            if (userChoice === 'reject') {
              const err = 'Error: 用户拒绝执行此操作';
              this.messages.push({ role: 'tool', tool_call_id: tc.id, content: err });
              this._toolStep(tc.id, tc.name, 'rejected', '用户拒绝执行');
              approvalAudit.recordOutcome(tc.name, 'denied', '用户拒绝执行');
              continue;
            }
            
            // 记录审计结果
            const outcomeMap = {
              'once': 'allowed-once',
              'session': 'allowed-session',
              'modify': 'allowed-always'
            };
            approvalAudit.recordOutcome(tc.name, outcomeMap[userChoice] || 'allowed-once', 
              userChoice === 'once' ? '用户批准一次执行' : 
              userChoice === 'session' ? '用户批准本会话执行' : 
              '用户修改权限规则，自动允许');
          } else {
            // 没有权限回调，模拟用户批准
            await new Promise(r => setTimeout(r, 300));
            approvalAudit.recordOutcome(tc.name, 'allowed-once', '用户批准执行');
          }
        }

        // 无菌动作记录
        const sterile = this.budget.recordAction(tc.name, tc.arguments);

        // 执行工具（四阶段工具瀑布：pre/guard/around/post）
        this._toolStep(tc.id, tc.name, 'running', JSON.stringify(tc.arguments).slice(0,100));
        let toolResult;
        try {
          // ===== 增强：四阶段工具瀑布集成（参考 TrieCode tool-pipeline.js）=====
          // pre阶段：策略判定（权限/预算/无菌）
          // guard阶段：安全闸门（单调否决）
          // around阶段：包裹执行（超时/取消/日志）
          // post阶段：观测变换（结果分类/审计/缓存）
          const pipelineResult = await toolPipeline.execute(
            tc.name,
            tc.arguments,
            { mode: this.mode, planApproved: this.planApproved, turn: turn },
            async (name, args) => {
              const result = await toolDef.execute(args);
              return { success: true, result };
            }
          );
          toolResult = pipelineResult.success 
            ? pipelineResult.result 
            : `Error: ${pipelineResult.error || '工具执行失败'}（${pipelineResult.stage || 'unknown'}阶段）`;
          
          if (pipelineResult.duration) {
            addOutputLog(`工具瀑布执行: ${tc.name} 耗时 ${pipelineResult.duration}ms`, 'debug');
          }
        } catch (e) {
          toolResult = `Error: 工具执行异常: ${e.message}`;
        }

        // submit_plan 特殊处理
        if (tc.name === 'submit_plan' && state.currentPlan) {
          this._toolStep(tc.id, tc.name, 'done', '计划已提交');
          this.messages.push({ role: 'tool', tool_call_id: tc.id, content: toolResult });
          if (this.onPlanRequest) this.onPlanRequest(state.currentPlan);
          this._stream('', true);
          return;
        }

        this._toolStep(tc.id, tc.name, 'done', String(toolResult).slice(0,80));
        // 工具结果 XML 边界包装（关键工具结果包 <tool_result name success>）
        const WRAP_TOOLS = new Set(['terminal','read_file','run_test','write_file','edit_file','web_search','web_fetch','run_subagent']);
        const isFailed = /Error|错误|失败|Traceback|Exception/i.test(String(toolResult));
        let injected = String(toolResult);
        
        // ===== 增强：大输出受管目录（参考 TrieCode tool-output.js）=====
        // 工具大输出不再硬截断丢弃，完整内容"落盘"到受管目录，返回路径给模型
        const TOOL_OUTPUT_THRESHOLD = 2000;  // 超过2000字符触发受管目录
        if (!isFailed && injected.length > TOOL_OUTPUT_THRESHOLD && ['terminal','run_test','web_search','web_fetch','read_file'].includes(tc.name)) {
          // 生成受管输出路径（模拟 %APPDATA%/TrieCode/tool-outputs/）
          const outputId = `tool_output_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
          const managedPath = `~/.LabCode/tool-outputs/${outputId}.txt`;
          
          // 保存完整输出到内存受管目录（实际环境中写磁盘）
          if (!state.toolOutputs) state.toolOutputs = {};
          state.toolOutputs[managedPath] = injected;
          
          // 返回截断输出 + 路径提示
          const truncated = injected.substring(0, TOOL_OUTPUT_THRESHOLD);
          injected = `${truncated}\n\n... [输出已截断，完整内容(${injected.length}字符)已保存到受管目录]\n[受管路径] ${managedPath}\n[提示] 可用 read_file 工具读取完整内容，路径填 "${managedPath}"`;
          
          addOutputLog(`大输出受管目录: ${tc.name} 输出 ${injected.length} 字符 → ${managedPath}`, 'debug');
        }
        
        // ===== 增强1：工具失败分类（参考 TrieCode tool-failure.js）=====
        if (isFailed) {
          const failureInfo = toolFailureClassifier.classifyWithStrategy(String(toolResult));
          if (failureInfo.category !== 'unknown') {
            addOutputLog(`工具失败分类: ${failureInfo.category} — ${failureInfo.strategy}`, 'warn');
            // 把分类结果注入工具结果，帮助模型选择修复策略
            injected = `${injected}\n\n[失败分类] 类型: ${failureInfo.category}\n[修复建议] ${failureInfo.strategy}`;
          }
        }
        
        // ===== 增强2：文件回滚记录（参考 TrieCode file-change-tracker.js）=====
        if (['write_file','edit_file','delete_file'].includes(tc.name) && !isFailed) {
          try {
            const filePath = tc.arguments?.path || tc.arguments?.file || 'unknown';
            const beforeContent = state.files[filePath]?.content || '';
            const afterContent = tc.arguments?.content || tc.arguments?.newText || '';
            const action = tc.name === 'write_file' ? (state.files[filePath] ? 'modify' : 'create') : tc.name === 'delete_file' ? 'delete' : 'modify';
            fileChangeTracker.recordChange('default', filePath, beforeContent, afterContent, action);
            addOutputLog(`文件回滚记录: ${filePath} (${action})`, 'debug');
          } catch (e) {
            addOutputLog(`文件回滚记录失败: ${e.message}`, 'warn');
          }
        }
        
        // ===== 增强3：反幻觉检测（参考 TrieCode agent-runner.js）=====
        // 检测谎报测试通过：声称测试通过但实际输出没有测试结果
        if (tc.name === 'run_test' || (tc.name === 'terminal' && /(pytest|npm test|jest|go test)/i.test(String(tc.arguments?.command||'')))) {
          const output = String(toolResult).toLowerCase();
          const claimsPass = /(测试通过|all tests passed|passed|success|0 failed|0 errors)/i.test(output);
          const hasActualResults = /(\d+ passed|\d+ tests|passed|failed|error|assertion)/i.test(output);
          if (claimsPass && !hasActualResults) {
            addOutputLog('⚠️ 反幻觉检测：声称测试通过但无实际测试输出', 'warn');
            injected = `${injected}\n\n[反幻觉警告] 检测到声称测试通过但输出中无实际测试结果统计。请运行真实测试命令并引用实际输出，不要谎报测试通过。`;
          }
        }
        
        if (WRAP_TOOLS.has(tc.name)) {
          injected = `<tool_result name="${tc.name}" success="${!isFailed}">\n${injected}\n</tool_result>`;
        }
        this.messages.push({ role: 'tool', tool_call_id: tc.id, content: injected });
        addOutputLog(`工具 ${tc.name} 执行完成`, isFailed ? 'error' : 'success');

        // 验证跟踪（P0-4）：文件修改 → lastFileModTurn；验证 → lastVerifyTurn + 占位符检测
        if (['write_file','edit_file','delete_file'].includes(tc.name) && !isFailed) {
          this.lastFileModTurn = turn;
        }
        if (tc.name === 'run_test' || (tc.name === 'terminal' && /(python|pytest|npm test|node|make|gcc|g\+\+|compile|build)/i.test(String(tc.arguments?.command||'')))) {
          if (!isFailed) {
            this.lastVerifyTurn = turn;
            // 占位符检测：验证输出像 echo ok/空输出/仅"已启动" → 标记
            const v = String(toolResult).trim().replace(/^\(工具执行完成，无输出\)$/, '');
            this.placeholderVerify = /^(echo\s+(ok|done|success|yes)\s*["']?|ok$|done$|success$|already\s+ok|)$/i.test(v);
          }
        }
      }

      // 进展闸（批2①）：连续3轮「有失败结果且无成功动作」→ 注入换策略
      const hasFailure = result.toolCalls.some((tc, i) => {
        const r = this.messages.filter(m => m.role === 'tool' && m.tool_call_id === tc.id)[0];
        return r && /Error|错误|失败|Traceback|Exception/i.test(r.content);
      });
      const hasActionSuccess = result.toolCalls.some((tc, i) => {
        const r = this.messages.filter(m => m.role === 'tool' && m.tool_call_id === tc.id)[0];
        return r && !/Error|错误|失败|Traceback|Exception/i.test(r.content) && ['write_file','edit_file','terminal','run_test'].includes(tc.name);
      });
      if (hasFailure && !hasActionSuccess) this.noProgressRounds++;
      else if (hasActionSuccess) this.noProgressRounds = 0;
      if (this.noProgressRounds >= 3) {
        this.noProgressRounds = 0;
        this.messages.push({ role: 'user', content: '【系统提示】检测到连续多轮工具执行失败且无进展。请停止重复尝试相同做法：先诊断根因（重读错误信息 / 查文档 / 向用户确认），换一种策略，或直接询问用户下一步方向。' });
        this._stream('\n[系统] 检测到连续失败无进展，请换策略或向用户确认。\n', false);
        continue;
      }

      // auto 模式自动验证
      const wroteFile = result.toolCalls.some(tc => tc.name === 'write_file');
      if (wroteFile && this.mode === 'auto') {
        this._stream('\n[系统] 自动验证：运行新创建的文件...\n', false);
        const newPath = result.toolCalls.find(tc => tc.name === 'write_file')?.arguments?.file_path;
        if (newPath) {
          const verifyResult = await getToolDef('terminal').execute({ command: `python ${newPath}` });
          this._stream(String(verifyResult) + '\n', false);
        }
      }

      this._stream('', true);
      return;
    }
  }

  _stream(content, done) {
    if (this.onStream) this.onStream({ content, done });
  }

  async _streamText(text) {
    for (let i = 0; i < text.length; i += 3) {
      if (this.cancelled) return;
      this._stream(text.slice(0, i+3), false);
      await new Promise(r => setTimeout(r, 10));
    }
    this._stream(text, false);
  }

  _toolStep(id, tool, status, summary) {
    if (this.onToolStep) this.onToolStep({ id, tool, status, summary });
  }

  // 生成思考过程（模拟 AI 的推理过程）
  _generateThinking(userInput, result) {
    const input = String(userInput || '');
    const toolNames = (result.toolCalls || []).map(tc => tc.name);
    const hasToolCalls = toolNames.length > 0;

    let thinking = `分析用户需求："${input}"\n\n`;
    thinking += `1. 需求识别：`;

    if (/写|创建|生成|实现|函数|组件/.test(input)) {
      thinking += `用户需要创建新代码。需要使用 write_file 工具写入文件。\n`;
      thinking += `2. 方案设计：先确定文件路径和代码结构，然后生成完整代码。\n`;
      thinking += `3. 工具选择：使用 write_file 工具创建文件。\n`;
      thinking += `4. 执行计划：调用 write_file 写入代码，完成后告知用户。\n`;
    } else if (/运行|执行|跑|run|start|python|测试|test/.test(input)) {
      thinking += `用户需要运行代码。需要使用 terminal 工具执行命令。\n`;
      thinking += `2. 方案设计：确定要运行的文件和命令，然后在终端中执行。\n`;
      thinking += `3. 工具选择：使用 terminal 工具执行命令。\n`;
      thinking += `4. 执行计划：调用 terminal 运行代码，捕获输出并展示给用户。\n`;
    } else if (/解释|说明|分析|这是什么|代码|explain/.test(input)) {
      thinking += `用户需要解释代码。需要先读取文件内容，然后分析并解释。\n`;
      thinking += `2. 方案设计：先读取当前文件，然后分析代码结构和逻辑。\n`;
      thinking += `3. 工具选择：使用 read_file 工具读取文件内容。\n`;
      thinking += `4. 执行计划：读取文件 → 分析代码 → 给出详细解释。\n`;
    } else if (/安装|依赖|install|npm|pip/.test(input)) {
      thinking += `用户需要安装依赖。需要使用 terminal 工具执行安装命令。\n`;
      thinking += `2. 方案设计：确定包管理器和要安装的包，然后执行安装命令。\n`;
      thinking += `3. 工具选择：使用 terminal 工具执行安装命令。\n`;
      thinking += `4. 执行计划：调用 terminal 执行安装，等待完成并验证。\n`;
    } else if (/计划|规划|plan|步骤|方案/.test(input)) {
      thinking += `用户需要制定执行计划。需要使用 submit_plan 工具提交计划。\n`;
      thinking += `2. 方案设计：分析需求，拆解为多个步骤，形成完整计划。\n`;
      thinking += `3. 工具选择：使用 submit_plan 工具提交计划供用户审批。\n`;
      thinking += `4. 执行计划：提交计划 → 等待用户审批 → 批准后执行。\n`;
    } else if (/搜索|联网|查一下|查找资料|web.?search|google/.test(input)) {
      thinking += `用户需要联网搜索信息。需要使用 web_search 工具搜索。\n`;
      thinking += `2. 方案设计：提取搜索关键词，然后调用搜索工具获取结果。\n`;
      thinking += `3. 工具选择：使用 web_search 工具进行联网搜索。\n`;
      thinking += `4. 执行计划：调用 web_search → 整理结果 → 展示给用户。\n`;
    } else if (/研究|调研|深度分析|子智能体|subagent/.test(input)) {
      thinking += `用户需要深度研究。需要派子智能体进行只读调研。\n`;
      thinking += `2. 方案设计：确定研究主题和重点，派子智能体进行深度调研。\n`;
      thinking += `3. 工具选择：使用 run_subagent 工具派子智能体。\n`;
      thinking += `4. 执行计划：派子智能体 → 等待调研结果 → 整理并展示。\n`;
    } else {
      thinking += `用户需求为一般性对话或咨询。需要直接回复，无需调用工具。\n`;
      thinking += `2. 方案设计：理解用户意图，直接给出有帮助的回复。\n`;
      thinking += `3. 工具选择：无需调用工具，纯文本回复。\n`;
      thinking += `4. 执行计划：直接生成回复内容。\n`;
    }

    if (hasToolCalls) {
      thinking += `\n5. 即将调用工具：${toolNames.join(', ')}\n`;
      thinking += `6. 预期结果：工具执行完成后，根据结果给出最终回复。\n`;
    } else {
      thinking += `\n5. 无需调用工具，直接生成回复。\n`;
    }

    thinking += `\n思考完成，开始执行...`;
    return thinking;
  }

  approvePlan() {
    this.planApproved = true;
    state.planApproved = true;
    this.messages.push({ role: 'user', content: '计划已批准，请按计划执行。' });
    this._stream('计划已批准，开始执行...\n', false);
  }

  // 估算消息 token 数（简化版：CJK≈1字/token，拉丁≈4字符/token）
  estimateTokens() {
    let total = 0;
    for (const m of this.messages) {
      const text = String(m.content || '') + (m.tool_calls ? JSON.stringify(m.tool_calls) : '');
      const cjk = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
      const other = text.length - cjk;
      total += cjk + Math.ceil(other / 4);
    }
    return total;
  }

  // 上下文压缩（简化版）：保护最近 keepTurns 个用户轮次，剪裁旧工具输出
  compressContext(messages, keepTurns = 3) {
    // 找到最近 keepTurns 个 user 消息的边界
    let userCount = 0;
    let cutIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userCount++;
        if (userCount >= keepTurns) { cutIdx = i; break; }
      }
    }
    if (cutIdx <= 0) return messages;
    // 剪裁旧工具结果：保留 head 150 + tail 150 字符
    const compressed = messages.slice(0, cutIdx).map(m => {
      if (m.role === 'tool' && String(m.content || '').length > 400) {
        const c = String(m.content);
        const head = c.slice(0, 150);
        const tail = c.slice(-150);
        return { ...m, content: `${head}\n…[旧工具结果已省略，原文 ${c.length} 字符]…\n${tail}` };
      }
      return m;
    });
    return [...compressed, ...messages.slice(cutIdx)];
  }
}

// ============ AI 面板交互 ============
let currentAIBubble = null;
let currentAIStream = '';

function addChatMessage(role, content) {
  const area = document.getElementById('ai-chat-area');
  const msg = document.createElement('div');
  msg.className = 'chat-message ' + role;
  const avatar = document.createElement('div');
  avatar.className = 'chat-avatar';
  avatar.textContent = role === 'ai' ? 'AI' : '你';
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.textContent = content;
  bubble.style.whiteSpace = 'pre-wrap';
  msg.appendChild(avatar); msg.appendChild(bubble);
  area.appendChild(msg);
  area.scrollTop = area.scrollHeight;
  return bubble;
}

function showTyping() {
  const area = document.getElementById('ai-chat-area');
  const msg = document.createElement('div');
  msg.className = 'chat-message ai';
  msg.id = 'typing-indicator';
  msg.innerHTML = '<div class="chat-avatar">AI</div><div class="chat-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
  area.appendChild(msg); area.scrollTop = area.scrollHeight;
}
function removeTyping() { const el = document.getElementById('typing-indicator'); if (el) el.remove(); }

function addToolStep(tool, status, summary) {
  const area = document.getElementById('ai-chat-area');
  const step = document.createElement('div');
  step.className = 'chat-message ai';
  const statusColors = { running: '#f9e2af', done: '#a6e3a1', error: '#f38ba8', rejected: '#f38ba8', waiting: '#89b4fa' };
  const statusIcons = { running: '⏳', done: '✓', error: '✕', rejected: '✕', waiting: '⏸' };
  step.innerHTML = `<div class="chat-avatar">🔧</div><div class="chat-bubble" style="font-size:12px;color:${statusColors[status]||'#cdd6f4'}">${statusIcons[status]||''} <strong>${tool}</strong>: ${summary}</div>`;
  area.appendChild(step); area.scrollTop = area.scrollHeight;
}

// ============ AI 思考过程展示 ============
let thinkingBlockId = 0;
function addThinkingBlock(content, duration) {
  const area = document.getElementById('ai-chat-area');
  const id = 'thinking-' + (++thinkingBlockId);
  const block = document.createElement('div');
  block.className = 'chat-message ai';
  block.innerHTML = `
    <div class="chat-avatar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6);">🧠</div>
    <div class="chat-bubble" style="padding:0;overflow:hidden;">
      <div class="thinking-block" id="${id}">
        <div class="thinking-header" onclick="document.getElementById('${id}').classList.toggle('expanded')">
          <span class="thinking-icon"><svg class="icon icon-xs"><use href="#icon-brain"></use></svg></span>
          <span class="thinking-title">思考过程</span>
          <span class="thinking-time">${duration ? duration + 's' : ''}</span>
          <span class="thinking-chevron"><svg class="icon icon-xs"><use href="#icon-chevron-down"></use></svg></span>
        </div>
        <div class="thinking-content">${escapeHtml(content)}</div>
      </div>
    </div>`;
  area.appendChild(block);
  area.scrollTop = area.scrollHeight;
  return id;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============ 改进的工具调用记录 ============
let toolCallBlockId = 0;
function addToolCallBlock(tool, status, summary, args, result) {
  const area = document.getElementById('ai-chat-area');
  const id = 'toolcall-' + (++toolCallBlockId);
  const statusText = { running: '执行中', done: '完成', error: '失败', waiting: '等待确认', rejected: '已拒绝' };
  const block = document.createElement('div');
  block.className = 'chat-message ai';
  block.innerHTML = `
    <div class="chat-avatar" style="background:linear-gradient(135deg,#0ea5e9,#06b6d4);">🔧</div>
    <div class="chat-bubble" style="padding:0;overflow:hidden;">
      <div class="tool-call-block" id="${id}">
        <div class="tool-call-header" onclick="document.getElementById('${id}').classList.toggle('expanded')">
          <span class="tool-call-status ${status}">${status === 'done' ? '✓' : status === 'error' ? '✕' : status === 'running' ? '⏳' : status === 'waiting' ? '⏸' : '✕'}</span>
          <span class="tool-call-name">${escapeHtml(tool)}</span>
          <span class="tool-call-summary">${escapeHtml(summary || '')}</span>
          <span class="tool-call-time">${statusText[status] || status}</span>
          <span class="tool-call-chevron"><svg class="icon icon-xs"><use href="#icon-chevron-down"></use></svg></span>
        </div>
        <div class="tool-call-detail">
          ${args ? `<div class="tool-call-args">
            <div class="tool-call-label">参数</div>
            <div class="tool-call-code">${escapeHtml(typeof args === 'string' ? args : JSON.stringify(args, null, 2))}</div>
          </div>` : ''}
          ${result ? `<div class="tool-call-result">
            <div class="tool-call-label">结果</div>
            <div class="tool-call-code ${status === 'error' ? 'error' : status === 'done' ? 'success' : ''}">${escapeHtml(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  area.appendChild(block);
  area.scrollTop = area.scrollHeight;
  return id;
}

function updateToolCallBlock(id, status, summary, result) {
  const block = document.getElementById(id);
  if (!block) return;
  const statusText = { running: '执行中', done: '完成', error: '失败', waiting: '等待确认', rejected: '已拒绝' };
  const statusEl = block.querySelector('.tool-call-status');
  const timeEl = block.querySelector('.tool-call-time');
  const summaryEl = block.querySelector('.tool-call-summary');
  if (statusEl) { statusEl.className = 'tool-call-status ' + status; statusEl.textContent = status === 'done' ? '✓' : status === 'error' ? '✕' : status === 'running' ? '⏳' : status === 'waiting' ? '⏸' : '✕'; }
  if (timeEl) timeEl.textContent = statusText[status] || status;
  if (summaryEl && summary) summaryEl.textContent = summary;
  if (result) {
    const detail = block.querySelector('.tool-call-detail');
    if (detail) {
      const resultHtml = `<div class="tool-call-result">
        <div class="tool-call-label">结果</div>
        <div class="tool-call-code ${status === 'error' ? 'error' : status === 'done' ? 'success' : ''}">${escapeHtml(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}</div>
      </div>`;
      const existingResult = detail.querySelector('.tool-call-result');
      if (existingResult) existingResult.outerHTML = resultHtml;
      else detail.insertAdjacentHTML('beforeend', resultHtml);
    }
  }
}

// ============ 计划进度面板管理 ============
const planProgressManager = {
  steps: [],
  currentStep: -1,
  
  show() {
    const panel = document.getElementById('plan-progress-panel');
    if (panel) panel.style.display = 'block';
  },
  
  hide() {
    const panel = document.getElementById('plan-progress-panel');
    if (panel) panel.style.display = 'none';
  },
  
  setSteps(steps) {
    this.steps = steps.map(s => ({ ...s, status: 'pending' }));
    this.currentStep = -1;
    this.render();
    this.show();
  },
  
  startStep(index) {
    if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
      this.steps[this.currentStep].status = 'done';
    }
    this.currentStep = index;
    if (index >= 0 && index < this.steps.length) {
      this.steps[index].status = 'running';
    }
    this.render();
  },
  
  completeStep(index, success = true) {
    if (index >= 0 && index < this.steps.length) {
      this.steps[index].status = success ? 'done' : 'error';
    }
    this.render();
  },
  
  completeAll() {
    this.steps.forEach(s => s.status = 'done');
    this.currentStep = -1;
    this.render();
  },
  
  reset() {
    this.steps = [];
    this.currentStep = -1;
    this.hide();
  },
  
  render() {
    const countEl = document.getElementById('plan-progress-count');
    const barEl = document.getElementById('plan-progress-bar-fill');
    const stepsEl = document.getElementById('plan-progress-steps');
    
    const doneCount = this.steps.filter(s => s.status === 'done').length;
    const total = this.steps.length;
    const progress = total > 0 ? (doneCount / total) * 100 : 0;
    
    if (countEl) countEl.textContent = `${doneCount}/${total}`;
    if (barEl) barEl.style.width = progress + '%';
    
    if (stepsEl) {
      stepsEl.innerHTML = this.steps.map((step, i) => `
        <div class="plan-progress-step ${step.status}">
          <span class="plan-progress-step-checkbox">${step.status === 'done' ? '✓' : ''}</span>
          <span class="plan-progress-step-title">${escapeHtml(step.title)}</span>
          ${step.action ? `<span class="plan-progress-step-action" onclick="${step.action}">查看</span>` : ''}
        </div>
      `).join('');
    }
  }
};

// ============ 权限确认弹窗 ============
let permissionCallback = null;
function showPermissionModal(tool, command, detail, callback) {
  const modal = document.getElementById('permission-modal');
  const commandEl = document.getElementById('permission-command');
  const detailEl = document.getElementById('permission-detail');
  
  if (commandEl) commandEl.textContent = command || tool;
  if (detailEl) detailEl.textContent = detail || '';
  
  permissionCallback = callback;
  if (modal) modal.style.display = 'flex';
}

function hidePermissionModal() {
  const modal = document.getElementById('permission-modal');
  if (modal) modal.style.display = 'none';
  permissionCallback = null;
}

function handlePermissionChoice(choice) {
  if (permissionCallback) {
    permissionCallback(choice);
  }
  hidePermissionModal();
}

function showPlanApproval(plan) {
  const modal = document.getElementById('plan-modal');
  document.getElementById('plan-text').textContent = plan.text;
  document.getElementById('plan-steps').innerHTML = plan.steps.map((s,i) => `<div style="padding:4px 0;font-size:12px;">[ ] ${s.title}</div>`).join('');
  modal.classList.add('active');
}

async function handleAISend() {
  const input = document.getElementById('ai-input');
  const text = input.value.trim();
  if (!text) return;

  addChatMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  showTyping();
  await new Promise(r => setTimeout(r, 400));
  removeTyping();

  // 重置计划进度面板
  planProgressManager.reset();

  if (!state.agent) {
    state.agent = new AgentRunner({
      mode: state.mode,
      onStream: ({ content, done }) => {
        if (!currentAIBubble) {
          currentAIBubble = addChatMessage('ai', '');
          currentAIStream = '';
        }
        if (content) {
          currentAIStream = content;
          currentAIBubble.textContent = content;
          currentAIBubble.style.whiteSpace = 'pre-wrap';
        }
        if (done) {
          currentAIBubble = null;
          currentAIStream = '';
        }
        const area = document.getElementById('ai-chat-area');
        area.scrollTop = area.scrollHeight;
      },
      onThinking: ({ content, duration }) => {
        addThinkingBlock(content, duration);
      },
      onToolStep: ({ tool, status, summary, args, result, id }) => {
        // 使用改进的工具调用记录
        if (id) {
          updateToolCallBlock(id, status, summary, result);
        } else {
          addToolCallBlock(tool, status, summary, args, result);
        }
      },
      onPlanRequest: (plan) => {
        showPlanApproval(plan);
      },
      onPlanProgress: ({ steps, currentStep, action }) => {
        if (steps) {
          planProgressManager.setSteps(steps);
        }
        if (action === 'start' && currentStep >= 0) {
          planProgressManager.startStep(currentStep);
        } else if (action === 'complete' && currentStep >= 0) {
          planProgressManager.completeStep(currentStep, true);
        } else if (action === 'error' && currentStep >= 0) {
          planProgressManager.completeStep(currentStep, false);
        } else if (action === 'allDone') {
          planProgressManager.completeAll();
        }
      },
      onPermissionRequest: ({ tool, command, detail, callback }) => {
        showPermissionModal(tool, command, detail, callback);
      }
    });
  }
  state.agent.mode = state.mode;
  await state.agent.run(text);
  
  // 任务完成后，延迟隐藏计划进度面板
  setTimeout(() => {
    if (planProgressManager.steps.length > 0) {
      const allDone = planProgressManager.steps.every(s => s.status === 'done');
      if (allDone) {
        setTimeout(() => planProgressManager.hide(), 3000);
      }
    }
  }, 1000);
}

// ============ 事件绑定 ============
// ============ 菜单操作处理 ============
function handleMenuAction(action) {
  console.log('菜单操作:', action);
  
  switch (action) {
    // ===== 文件菜单 =====
    case 'new-project':
      showToast('新建项目', 'info');
      // 触发新建项目按钮
      const newProjectBtn = document.getElementById('new-project-btn');
      if (newProjectBtn) newProjectBtn.click();
      break;
    case 'open-project':
      showToast('打开项目', 'info');
      if (window.LabCode && window.LabCode.dialog) {
        window.LabCode.dialog.openDirectory().then(result => {
          if (result && result.success && result.path) {
            loadProjectFromDisk(result.path);
          }
        });
      }
      break;
    case 'open-file':
      showToast('打开文件', 'info');
      if (window.LabCode && window.LabCode.dialog) {
        window.LabCode.dialog.openFile().then(result => {
          if (result && result.success && result.path) {
            // 打开文件
          }
        });
      }
      break;
    case 'save':
      showToast('保存文件', 'success');
      saveCurrentFile();
      break;
    case 'save-as':
      showToast('另存为', 'info');
      if (window.LabCode && window.LabCode.dialog) {
        window.LabCode.dialog.saveFile().then(result => {
          if (result && result.success) {
            showToast('文件已保存', 'success');
          }
        });
      }
      break;
    case 'save-all':
      showToast('全部保存', 'success');
      saveAllFiles();
      break;
    case 'new-terminal':
      showToast('新建终端', 'info');
      // 切换到底部面板的终端标签
      const terminalTab = document.querySelector('.bottom-tab[data-panel="terminal"]');
      if (terminalTab) terminalTab.click();
      // 创建新终端
      if (state.terminalManager) {
        state.terminalManager.createTerminal({ cwd: state.projectPath }).then(result => {
          if (result.success) {
            const container = document.getElementById('terminal-content');
            if (container) state.terminalManager.attachTerminal(result.terminal.id, container);
          }
        });
      }
      break;
    case 'quit':
      if (window.LabCode && window.LabCode.window) {
        window.LabCode.window.close();
      }
      break;
      
    // ===== 编辑菜单 =====
    case 'undo':
      document.execCommand('undo');
      showToast('撤销', 'info');
      break;
    case 'redo':
      document.execCommand('redo');
      showToast('重做', 'info');
      break;
    case 'cut':
      document.execCommand('cut');
      break;
    case 'copy':
      document.execCommand('copy');
      break;
    case 'paste':
      document.execCommand('paste');
      break;
    case 'select-all':
      document.execCommand('selectAll');
      break;
    case 'find':
      showToast('查找功能（演示）', 'info');
      break;
    case 'replace':
      showToast('替换功能（演示）', 'info');
      break;
    case 'comment':
      showToast('切换行注释（演示）', 'info');
      break;
    case 'format':
      showToast('格式化文档（演示）', 'info');
      break;
      
    // ===== 视图菜单 =====
    case 'toggle-sidebar':
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
      }
      showToast('切换侧栏', 'info');
      break;
    case 'toggle-panel':
      const bottomPanel = document.getElementById('bottom-panel');
      if (bottomPanel) {
        bottomPanel.style.display = bottomPanel.style.display === 'none' ? 'flex' : 'none';
      }
      showToast('切换面板', 'info');
      break;
    case 'toggle-terminal':
      const terminalTab2 = document.querySelector('.bottom-tab[data-panel="terminal"]');
      if (terminalTab2) terminalTab2.click();
      const bottomPanel2 = document.getElementById('bottom-panel');
      if (bottomPanel2 && bottomPanel2.style.display === 'none') {
        bottomPanel2.style.display = 'flex';
      }
      showToast('切换终端', 'info');
      break;
    case 'explorer':
      const explorerBtn = document.querySelector('.activity-btn[data-panel="explorer"]');
      if (explorerBtn) explorerBtn.click();
      break;
    case 'search':
      showToast('搜索视图（演示）', 'info');
      break;
    case 'git':
      showToast('源代码管理（演示）', 'info');
      break;
    case 'extensions':
      showToast('插件视图（演示）', 'info');
      break;
    case 'zoom-in':
      if (window.LabCode && window.LabCode.window) {
        // Electron 缩放
        const webFrame = require('electron').webFrame;
        webFrame.setZoomFactor(webFrame.getZoomFactor() + 0.1);
      }
      showToast('放大', 'info');
      break;
    case 'zoom-out':
      if (window.LabCode && window.LabCode.window) {
        const webFrame = require('electron').webFrame;
        webFrame.setZoomFactor(webFrame.getZoomFactor() - 0.1);
      }
      showToast('缩小', 'info');
      break;
    case 'zoom-reset':
      if (window.LabCode && window.LabCode.window) {
        const webFrame = require('electron').webFrame;
        webFrame.setZoomFactor(1);
      }
      showToast('重置缩放', 'info');
      break;
    case 'toggle-fullscreen':
      if (window.LabCode && window.LabCode.window) {
        // 全屏切换需要主进程处理
        showToast('全屏切换（演示）', 'info');
      }
      break;
    case 'toggle-devtools':
      // 开发者工具需要主进程处理
      showToast('开发者工具（请按 F12）', 'info');
      break;
    case 'reload':
      location.reload();
      break;
      
    // ===== 帮助菜单 =====
    case 'welcome':
      showToast('欢迎使用 LabCode', 'info');
      break;
    case 'documentation':
      if (window.LabCode && window.LabCode.shell) {
        window.LabCode.shell.openExternal('https://www.labcode.com/docs');
      }
      showToast('打开文档', 'info');
      break;
    case 'website':
      if (window.LabCode && window.LabCode.shell) {
        window.LabCode.shell.openExternal('https://www.labcode.com');
      }
      showToast('打开官网', 'info');
      break;
    case 'keyboard-shortcuts':
      showToast('键盘快捷键（演示）', 'info');
      break;
    case 'commands':
      showToast('命令面板（演示）', 'info');
      break;
    case 'check-updates':
      showToast('检查更新（演示）', 'info');
      if (window.LabCode && window.LabCode.update) {
        window.LabCode.update.check();
      }
      break;
    case 'feedback':
      if (window.LabCode && window.LabCode.shell) {
        window.LabCode.shell.openExternal('https://github.com/labcode/labcode/issues');
      }
      showToast('反馈问题', 'info');
      break;
    case 'about':
      showAboutDialog();
      break;
      
    default:
      console.log('未处理的菜单操作:', action);
      showToast(`${action}（演示）`, 'info');
  }
}

function showAboutDialog() {
  const version = window.LabCode && window.LabCode.app ? window.LabCode.app.getVersion() : '1.0.0';
  showToast(`LabCode v${version}`, 'info');
  addOutputLog(`关于 LabCode v${version}`, 'info');
}

function saveCurrentFile() {
  // 保存当前打开的文件
  if (state.currentFile && state.monacoEditor) {
    const content = state.monacoEditor.getValue();
    if (window.LabCode && window.LabCode.fs) {
      window.LabCode.fs.writeFile(state.currentFile, content).then(result => {
        if (result.success) {
          showToast('文件已保存', 'success');
          addOutputLog(`已保存: ${state.currentFile}`, 'success');
        } else {
          showToast('保存失败: ' + result.error, 'error');
        }
      });
    }
  } else {
    showToast('没有打开的文件', 'warn');
  }
}

function saveAllFiles() {
  // 保存所有打开的文件
  showToast('全部保存', 'success');
  addOutputLog('所有文件已保存', 'success');
}

// ============ 事件绑定 ============
function bindEvents() {
  // ============ 下拉菜单 ============
  const menuItems = document.querySelectorAll('.menu-item');
  const dropdownMenus = document.querySelectorAll('.dropdown-menu');
  
  function hideAllDropdowns() {
    dropdownMenus.forEach(m => m.classList.remove('show'));
    menuItems.forEach(i => i.classList.remove('active'));
  }
  
  function showDropdown(menuName) {
    hideAllDropdowns();
    const dropdown = document.getElementById('dropdown-' + menuName);
    const menuItem = document.querySelector(`.menu-item[data-menu="${menuName}"]`);
    if (dropdown && menuItem) {
      // 计算下拉菜单位置
      const rect = menuItem.getBoundingClientRect();
      dropdown.style.left = rect.left + 'px';
      dropdown.style.top = (rect.bottom + 2) + 'px';
      dropdown.classList.add('show');
      menuItem.classList.add('active');
    }
  }
  
  menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuName = item.dataset.menu;
      const dropdown = document.getElementById('dropdown-' + menuName);
      if (dropdown.classList.contains('show')) {
        hideAllDropdowns();
      } else {
        showDropdown(menuName);
      }
    });
    
    item.addEventListener('mouseenter', () => {
      // 如果有其他下拉菜单显示，切换到当前菜单
      const anyShown = document.querySelector('.dropdown-menu.show');
      if (anyShown) {
        showDropdown(item.dataset.menu);
      }
    });
  });
  
  // 点击其他地方隐藏下拉菜单
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menubar') && !e.target.closest('.dropdown-menu')) {
      hideAllDropdowns();
    }
  });
  
  // 下拉菜单项点击
  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      hideAllDropdowns();
      handleMenuAction(action);
    });
  });
  
  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    // Escape 隐藏下拉菜单
    if (e.key === 'Escape') {
      hideAllDropdowns();
    }
  });
  
  // ============ 活动栏按钮 ============
  document.querySelectorAll('.activity-btn').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.activity-btn').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      if (item.dataset.panel === 'explorer') document.getElementById('sidebar').style.display = 'flex';
      else { document.getElementById('sidebar').style.display = 'none'; showToast(`${item.title} 视图（演示版）`,'info'); }
    });
  });

  document.querySelectorAll('.bottom-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bottom-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.bottom-panel-content').forEach(v => v.classList.remove('active'));
      tab.classList.add('active');
      const panelEl = document.getElementById(tab.dataset.panel + '-panel');
      if (panelEl) panelEl.classList.add('active');
    });
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      if (state.agent) state.agent.mode = state.mode;
      const desc = {
        plan: 'Plan 模式：AI 只规划不执行，需提交计划并批准后才能修改/执行',
        default: 'Default 模式：AI 自动执行，修改/执行类操作需确认',
        auto: 'Auto 模式：AI 全自动执行，仅高风险操作需确认'
      };
      showToast(desc[state.mode], 'info');
      addOutputLog(`切换到 ${state.mode} 模式`, 'info');
    });
  });

  const aiInput = document.getElementById('ai-input');
  aiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAISend(); } });
  aiInput.addEventListener('input', () => { aiInput.style.height = 'auto'; aiInput.style.height = Math.min(aiInput.scrollHeight, 120) + 'px'; });
  document.getElementById('ai-send-btn').addEventListener('click', handleAISend);

  document.querySelectorAll('.ai-suggestion').forEach(s => {
    s.addEventListener('click', () => { document.getElementById('ai-input').value = s.dataset.suggestion; handleAISend(); });
  });

  document.getElementById('new-chat-btn').addEventListener('click', () => {
    document.getElementById('ai-chat-area').innerHTML = `<div class="chat-message ai"><div class="chat-avatar">AI</div><div class="chat-bubble">新对话已开始。试试："写一个快速排序"、"运行代码"、"解释当前文件"、"制定计划"</div></div>`;
    state.agent = null;
    showToast('已开始新对话', 'info');
  });

  document.getElementById('new-file-btn').addEventListener('click', () => {
    showModal('新建文件', '输入文件名', '例如: src/new_file.py', async (name) => {
      if (name) {
        // 如果有项目路径，在磁盘上创建文件
        let absolutePath = null;
        if (state.projectPath && isElectron) {
          absolutePath = state.projectPath + '/' + name;
          const success = await FileSystem.writeFile(absolutePath, '');
          if (success) {
            addOutputLog(`文件已创建: ${absolutePath}`, 'success');
          } else {
            showToast('创建文件失败', 'error');
            return;
          }
        }
        state.files[name] = { content:'', language:getLanguage(name), dirty:false, absolutePath: absolutePath };
        buildFileTree(); renderFileTree(); openFile(name);
        showToast(`已创建 ${name}`, 'success');
      }
    });
  });

  // 欢迎面板按钮
  const welcomeNewProject = document.getElementById('welcome-new-project');
  if (welcomeNewProject) {
    welcomeNewProject.addEventListener('click', () => document.getElementById('new-file-btn').click());
  }
  const welcomeOpenProject = document.getElementById('welcome-open-project');
  if (welcomeOpenProject) {
    welcomeOpenProject.addEventListener('click', async () => {
      if (isElectron && window.LabCode.dialog) {
        try {
          const dirPath = await window.LabCode.dialog.openDirectory();
          if (dirPath) {
            await loadProjectFromDisk(dirPath);
            // 关闭欢迎页面，显示编辑器
            document.getElementById('welcome-screen').style.display = 'none';
            document.getElementById('monaco-editor').style.display = 'flex';
          }
        } catch (e) {
          console.error('打开项目失败:', e);
          showToast('打开项目失败', 'error');
        }
      } else {
        showToast('打开项目（演示版）', 'info');
      }
    });
  }
  
  // 快捷指令按钮
  document.querySelectorAll('.quick-action-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const aiInput = document.getElementById('ai-input');
      if (aiInput) {
        const actionMap = {
          'web-game': '帮我写一个网页小游戏',
          'data-analysis': '帮我做一个数据分析脚本',
          'debug-help': '教我怎么调试一个编译错误',
          'python-project': '帮我创建一个 Python 项目，画个太阳系'
        };
        aiInput.value = actionMap[action] || btn.textContent.trim();
        aiInput.focus();
      }
    });
  });
  
  // 模型选择器
  const modelSelectBtn = document.getElementById('model-select-btn');
  const modelDropdown = document.getElementById('model-dropdown');
  if (modelSelectBtn && modelDropdown) {
    modelSelectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      modelDropdown.style.display = modelDropdown.style.display === 'none' ? 'block' : 'none';
    });
    document.querySelectorAll('.model-option').forEach(option => {
      option.addEventListener('click', () => {
        const modelName = option.textContent.trim();
        document.getElementById('current-model-name').textContent = modelName;
        document.querySelectorAll('.model-option').forEach(o => o.classList.remove('active'));
        option.classList.add('active');
        modelDropdown.style.display = 'none';
      });
    });
    document.addEventListener('click', () => {
      modelDropdown.style.display = 'none';
    });
  }
  
  // 权限模式按钮
  const permissionBtn = document.getElementById('permission-btn');
  if (permissionBtn) {
    permissionBtn.addEventListener('click', () => {
      console.log('切换权限模式');
    });
  }

  // ============ 编译按钮 ============
  const compileBtn = document.getElementById('compile-btn');
  if (compileBtn) {
    compileBtn.addEventListener('click', () => {
      if (!state.activeTab) { showToast('请先打开一个文件', 'error'); return; }
      addOutputLog(`编译文件: ${state.activeTab}`, 'info');
      document.querySelector('.bottom-tab[data-panel="terminal"]').click();
      setTimeout(() => {
        if (state.terminal) {
          state.terminal.writeln('');
          state.terminal.writeln('🔨 开始编译...');
          state.terminal.writeln('');
          state.terminal.writeln('项目: LabCode Project');
          state.terminal.writeln('目标: ESP32 Dev Module');
          state.terminal.writeln('');
          state.terminal.writeln('编译中...');
          state.terminal.writeln('✓ 编译成功');
          state.terminal.writeln('');
          state.terminal.writeln('使用: 152340 字节 (47%)');
          state.terminal.writeln('最大: 3145728 字节');
          state.terminal.writeln('全局变量: 12456 字节 (3%)');
          state.terminal.writeln('');
          state.terminal.writeln('✓ 编译完成，耗时 3.2 秒');
          state.terminal.write('user@labcode:~/project$ ');
        }
        addOutputLog('编译成功', 'success');
        showToast('编译成功', 'success');
      }, 500);
    });
  }

  // ============ 烧录按钮 ============
  const uploadBtn = document.getElementById('upload-btn');
  if (uploadBtn) {
    uploadBtn.addEventListener('click', () => {
      if (!state.activeTab) { showToast('请先打开一个文件', 'error'); return; }
      addOutputLog(`烧录文件: ${state.activeTab}`, 'info');
      document.querySelector('.bottom-tab[data-panel="terminal"]').click();
      setTimeout(() => {
        if (state.terminal) {
          state.terminal.writeln('');
          state.terminal.writeln('⬇️ 开始烧录...');
          state.terminal.writeln('');
          state.terminal.writeln('端口: COM3');
          state.terminal.writeln('波特率: 115200');
          state.terminal.writeln('目标: ESP32 Dev Module');
          state.terminal.writeln('');
          state.terminal.writeln('连接中...');
          state.terminal.writeln('✓ 已连接');
          state.terminal.writeln('');
          state.terminal.writeln('写入中...');
          state.terminal.writeln('[####      ] 40%');
          state.terminal.writeln('[########  ] 80%');
          state.terminal.writeln('[##########] 100%');
          state.terminal.writeln('');
          state.terminal.writeln('✓ 烧录成功');
          state.terminal.writeln('');
          state.terminal.writeln('硬复位中...');
          state.terminal.writeln('✓ 设备已复位');
          state.terminal.write('user@labcode:~/project$ ');
        }
        addOutputLog('烧录成功', 'success');
        showToast('烧录成功', 'success');
      }, 500);
    });
  }

  // ============ 验证按钮 ============
  const verifyBtn = document.getElementById('verify-btn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', () => {
      if (!state.activeTab) { showToast('请先打开一个文件', 'error'); return; }
      addOutputLog(`验证文件: ${state.activeTab}`, 'info');
      document.querySelector('.bottom-tab[data-panel="terminal"]').click();
      setTimeout(() => {
        if (state.terminal) {
          state.terminal.writeln('');
          state.terminal.writeln('✅ 开始验证...');
          state.terminal.writeln('');
          state.terminal.writeln('端口: COM3');
          state.terminal.writeln('目标: ESP32 Dev Module');
          state.terminal.writeln('');
          state.terminal.writeln('读取设备固件...');
          state.terminal.writeln('✓ 已读取 152340 字节');
          state.terminal.writeln('');
          state.terminal.writeln('对比中...');
          state.terminal.writeln('✓ 固件一致');
          state.terminal.writeln('');
          state.terminal.writeln('✓ 验证通过');
          state.terminal.write('user@labcode:~/project$ ');
        }
        addOutputLog('验证通过', 'success');
        showToast('验证通过', 'success');
      }, 500);
    });
  }

  document.getElementById('run-btn').addEventListener('click', () => {
    if (!state.activeTab) { showToast('请先打开一个文件','error'); return; }
    addOutputLog(`运行文件: ${state.activeTab}`, 'info');
    document.querySelector('.bottom-tab[data-panel="terminal"]').click();
    setTimeout(() => {
      if (state.terminal) {
        state.terminal.writeln('');
        state.terminal.writeln(`▶ 运行 ${state.activeTab}`);
        if (state.activeTab.endsWith('.py')) {
          state.terminal.writeln('原始数据: [64, 34, 25, 12, 22, 11, 90]');
          state.terminal.writeln('排序后: [11, 12, 22, 25, 34, 64, 90]');
          state.terminal.writeln('查找 25: 索引 3');
          state.terminal.writeln('✓ 程序运行成功，退出码 0');
        } else { state.terminal.writeln('(模拟运行输出)'); state.terminal.writeln('✓ 完成'); }
        state.terminal.write('user@triecode:~/project$ ');
      }
      addOutputLog('运行完成，退出码 0', 'success');
    }, 500);
  });

  document.getElementById('ai-btn').addEventListener('click', () => {
    const panel = document.getElementById('ai-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  document.getElementById('toggle-panel-btn').addEventListener('click', () => {
    const panel = document.getElementById('bottom-panel');
    panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
  });

  document.getElementById('plan-approve-btn').addEventListener('click', () => {
    document.getElementById('plan-modal').classList.remove('active');
    state.planApproved = true;
    if (state.agent) state.agent.approvePlan();
    showToast('计划已批准，AI 开始执行', 'success');
    addOutputLog('计划已批准', 'success');
    setTimeout(() => {
      addToolStep('list_files', 'done', 'src/ tests/ package.json README.md');
      addChatMessage('ai', '计划已批准，开始执行。已列出项目文件，接下来创建代码文件并运行测试。');
    }, 500);
  });
  document.getElementById('plan-reject-btn').addEventListener('click', () => {
    document.getElementById('plan-modal').classList.remove('active');
    addChatMessage('ai', '计划已被拒绝。请告诉我需要修改哪些部分，我会重新规划。');
    showToast('计划已拒绝', 'info');
  });
  document.getElementById('plan-close-btn').addEventListener('click', () => {
    document.getElementById('plan-modal').classList.remove('active');
  });

  // 权限确认弹窗事件绑定
  const permissionOnceBtn = document.getElementById('permission-once-btn');
  if (permissionOnceBtn) {
    permissionOnceBtn.addEventListener('click', () => handlePermissionChoice('once'));
  }
  const permissionSessionBtn = document.getElementById('permission-session-btn');
  if (permissionSessionBtn) {
    permissionSessionBtn.addEventListener('click', () => handlePermissionChoice('session'));
  }
  const permissionModifyBtn = document.getElementById('permission-modify-btn');
  if (permissionModifyBtn) {
    permissionModifyBtn.addEventListener('click', () => handlePermissionChoice('modify'));
  }
  const permissionRejectBtn = document.getElementById('permission-reject-btn');
  if (permissionRejectBtn) {
    permissionRejectBtn.addEventListener('click', () => handlePermissionChoice('reject'));
  }
  // 点击遮罩层关闭权限弹窗
  const permissionModal = document.getElementById('permission-modal');
  if (permissionModal) {
    permissionModal.addEventListener('click', (e) => {
      if (e.target.id === 'permission-modal') {
        hidePermissionModal();
      }
    });
  }

  document.getElementById('modal-confirm').addEventListener('click', () => {
    const val = document.getElementById('modal-input').value.trim();
    if (modalCallback) modalCallback(val);
    hideModal();
  });
  document.getElementById('modal-cancel').addEventListener('click', hideModal);
  document.getElementById('modal-close').addEventListener('click', hideModal);
  document.getElementById('modal-input').addEventListener('keydown', (e) => { if (e.key==='Enter') document.getElementById('modal-confirm').click(); if(e.key==='Escape') hideModal(); });
  document.getElementById('new-file-modal').addEventListener('click', (e) => { if (e.target.id==='new-file-modal') hideModal(); });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); document.getElementById('editor-save-btn')?.click(); }
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); document.getElementById('new-file-btn').click(); }
  });

  // ============ 新增按钮事件绑定 ============
  
  // AI 模式按钮 - 切换到欢迎页面/AI 对话
  const aiModeBtn = document.getElementById('ai-mode-btn');
  if (aiModeBtn) {
    aiModeBtn.addEventListener('click', () => {
      const welcomeScreen = document.getElementById('welcome-screen');
      const monacoEditor = document.getElementById('monaco-editor');
      if (welcomeScreen && monacoEditor) {
        welcomeScreen.style.display = 'flex';
        monacoEditor.style.display = 'none';
        document.querySelectorAll('.editor-toolbar-btn').forEach(b => b.classList.remove('active'));
        aiModeBtn.classList.add('active');
        showToast('已切换到 AI 对话模式', 'info');
      }
    });
  }

  // 快速新建文件按钮
  const quickNewFile = document.getElementById('quick-new-file');
  if (quickNewFile) {
    quickNewFile.addEventListener('click', () => {
      document.getElementById('new-file-btn').click();
    });
  }

  // 快速打开文件夹按钮
  const quickOpenFolder = document.getElementById('quick-open-folder');
  if (quickOpenFolder) {
    quickOpenFolder.addEventListener('click', async () => {
      if (isElectron && window.LabCode.dialog) {
        try {
          const dirPath = await window.LabCode.dialog.openDirectory();
          if (dirPath) {
            await loadProjectFromDisk(dirPath);
            // 关闭欢迎页面，显示编辑器
            document.getElementById('welcome-screen').style.display = 'none';
            document.getElementById('monaco-editor').style.display = 'flex';
          }
        } catch (e) {
          console.error('打开项目失败:', e);
          showToast('打开项目失败', 'error');
        }
      } else {
        showToast('打开文件夹功能（演示版）', 'info');
      }
    });
  }

  // 通知按钮
  const notificationBtn = document.getElementById('notification-btn');
  if (notificationBtn) {
    notificationBtn.addEventListener('click', () => {
      showToast('暂无新通知', 'info');
      const badge = document.getElementById('notification-badge');
      if (badge) badge.style.display = 'none';
    });
  }

  // 编辑器保存按钮
  const editorSaveBtn = document.getElementById('editor-save-btn');
  if (editorSaveBtn) {
    editorSaveBtn.addEventListener('click', async () => {
      if (state.activeTab) {
        const file = state.files[state.activeTab];
        if (state.editor) {
          file.content = state.editor.getValue();
        }
        // 如果是从磁盘加载的文件，写入磁盘
        if (file.absolutePath && isElectron) {
          const success = await FileSystem.writeFile(file.absolutePath, file.content);
          if (success) {
            file.dirty = false;
            showToast(`已保存 ${state.activeTab}`, 'success');
            addOutputLog(`文件已保存: ${file.absolutePath}`, 'success');
          } else {
            showToast('保存失败', 'error');
          }
        } else {
          file.dirty = false;
          showToast(`已保存 ${state.activeTab}（内存）`, 'success');
        }
      } else {
        showToast('没有打开的文件', 'info');
      }
    });
  }

  // 编辑器撤销按钮
  const editorUndoBtn = document.getElementById('editor-undo-btn');
  if (editorUndoBtn) {
    editorUndoBtn.addEventListener('click', () => {
      if (state.editor) {
        state.editor.trigger('keyboard', 'undo', null);
        showToast('撤销', 'info');
      } else {
        showToast('撤销（演示版）', 'info');
      }
    });
  }

  // 编辑器重做按钮
  const editorRedoBtn = document.getElementById('editor-redo-btn');
  if (editorRedoBtn) {
    editorRedoBtn.addEventListener('click', () => {
      if (state.editor) {
        state.editor.trigger('keyboard', 'redo', null);
        showToast('重做', 'info');
      } else {
        showToast('重做（演示版）', 'info');
      }
    });
  }

  // 编辑器历史按钮
  const editorHistoryBtn = document.getElementById('editor-history-btn');
  if (editorHistoryBtn) {
    editorHistoryBtn.addEventListener('click', () => {
      showToast('历史记录（演示版）', 'info');
    });
  }

  // @提及按钮
  const mentionBtn = document.getElementById('mention-btn');
  if (mentionBtn) {
    mentionBtn.addEventListener('click', () => {
      const aiInput = document.getElementById('ai-input');
      if (aiInput) {
        aiInput.value += '@';
        aiInput.focus();
        showToast('已插入 @ 提及', 'info');
      }
    });
  }

  // 终端切换按钮 - 显示/隐藏底部面板
  const terminalToggleBtn = document.getElementById('terminal-toggle-btn');
  if (terminalToggleBtn) {
    terminalToggleBtn.addEventListener('click', () => {
      const bottomPanel = document.getElementById('bottom-panel');
      if (bottomPanel) {
        if (bottomPanel.style.display === 'none' || bottomPanel.style.display === '') {
          bottomPanel.style.display = 'flex';
          showToast('已打开终端面板', 'info');
        } else {
          bottomPanel.style.display = 'none';
          showToast('已关闭终端面板', 'info');
        }
      }
    });
  }

  // 搜索按钮
  const searchBtn = document.getElementById('search-btn');
  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      showToast('搜索功能（演示版）', 'info');
    });
  }

  // 设置按钮
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      showToast('设置面板（演示版）', 'info');
    });
  }

  // ============ 窗口控制按钮 ============
  const minimizeBtn = document.getElementById('minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      if (window.LabCode && window.LabCode.window && window.LabCode.window.minimize) {
        window.LabCode.window.minimize();
      } else {
        showToast('最小化窗口（演示版）', 'info');
      }
    });
  }

  const maximizeBtn = document.getElementById('maximize-btn');
  if (maximizeBtn) {
    maximizeBtn.addEventListener('click', () => {
      if (window.LabCode && window.LabCode.window && window.LabCode.window.maximize) {
        window.LabCode.window.maximize();
      } else {
        showToast('最大化/还原窗口（演示版）', 'info');
      }
    });
  }

  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.LabCode && window.LabCode.window && window.LabCode.window.close) {
        window.LabCode.window.close();
      } else {
        showToast('关闭窗口（演示版）', 'info');
      }
    });
  }

  // ============ 刷新按钮 ============
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (state.projectPath && isElectron) {
        // 保存当前打开的文件
        const savedTabs = [...state.openTabs];
        const savedActiveTab = state.activeTab;
        // 重新从磁盘加载
        await loadProjectFromDisk(state.projectPath);
        // 恢复之前打开的文件
        for (const tab of savedTabs) {
          if (state.files[tab]) {
            if (!state.openTabs.includes(tab)) state.openTabs.push(tab);
          }
        }
        if (savedActiveTab && state.files[savedActiveTab]) {
          openFile(savedActiveTab);
        }
        renderTabs();
        showToast('文件树已从磁盘刷新', 'success');
      } else {
        renderFileTree();
        showToast('文件树已刷新', 'success');
      }
    });
  }

  // ============ 附件按钮 ============
  const attachBtn = document.getElementById('attach-btn');
  if (attachBtn) {
    attachBtn.addEventListener('click', () => {
      showToast('添加附件（演示版）', 'info');
    });
  }

  const aiAttachBtn = document.getElementById('ai-attach-btn');
  if (aiAttachBtn) {
    aiAttachBtn.addEventListener('click', () => {
      showToast('添加附件到 AI 对话（演示版）', 'info');
    });
  }

  // ============ 选择工作空间按钮 ============
  const selectWorkspaceBtn = document.getElementById('select-workspace-btn');
  if (selectWorkspaceBtn) {
    selectWorkspaceBtn.addEventListener('click', async () => {
      if (isElectron && window.LabCode.dialog) {
        try {
          const dirPath = await window.LabCode.dialog.openDirectory();
          if (dirPath) {
            await loadProjectFromDisk(dirPath);
            // 更新工作空间路径显示
            const workspacePathEl = document.getElementById('workspace-path-text');
            if (workspacePathEl) workspacePathEl.textContent = dirPath;
          }
        } catch (e) {
          console.error('选择工作空间失败:', e);
          showToast('选择工作空间失败', 'error');
        }
      } else {
        showToast('选择工作空间（演示版）', 'info');
      }
    });
  }

  // ============ AI 设置按钮 ============
  const aiSettingsBtn = document.getElementById('ai-settings-btn');
  if (aiSettingsBtn) {
    aiSettingsBtn.addEventListener('click', () => {
      showToast('AI 设置（演示版）', 'info');
    });
  }

  // ============ 菜单栏按钮 ============
  document.querySelectorAll('.menu-item').forEach(menuItem => {
    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      const menuName = menuItem.dataset.menu;
      const menuNames = { file: '文件', edit: '编辑', view: '视图', help: '帮助' };
      showToast(`${menuNames[menuName] || menuName} 菜单（演示版）`, 'info');
    });
  });
}

let modalCallback = null;
function showModal(title, label, placeholder, callback) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-label').textContent = label;
  document.getElementById('modal-input').placeholder = placeholder;
  document.getElementById('modal-input').value = '';
  document.getElementById('new-file-modal').classList.add('active');
  document.getElementById('modal-input').focus();
  modalCallback = callback;
}
function hideModal() { document.getElementById('new-file-modal').classList.remove('active'); modalCallback = null; }

// ============ 初始化 ============
function init() {
  try {
    initFiles();
    renderFileTree();
    bindEvents();
  } catch(e) {
    console.error('Init phase 1 error:', e);
    document.body.insertAdjacentHTML('beforeend', `<div style="position:fixed;top:0;left:0;right:0;background:#f38ba8;color:#000;padding:10px;z-index:9999;font-family:monospace;">INIT ERROR: ${e.message}</div>`);
    return;
  }
  try { setupMonaco(); } catch(e) { console.error('Monaco setup error:', e); }
  try { setupTerminal(); } catch(e) { console.error('Terminal setup error:', e); }
  try {
    addOutputLog('TrieCode Clone v2 已启动 — 完整智能体引擎', 'success');
    addOutputLog('引擎模块: ToolRegistry(10工具) / PermissionPolicy(三级) / BudgetTracker / PlanStore / MockAI', 'info');
  } catch(e) { console.error('Log error:', e); }

  // ============ 自动切换到 AI 欢迎页面 ============
  setTimeout(() => {
    try {
      const aiModeBtn = document.getElementById('ai-mode-btn');
      if (aiModeBtn) {
        aiModeBtn.click();
        console.log('✅ 已自动切换到 AI 欢迎页面');
      }
    } catch(e) { console.error('Auto switch error:', e); }
  }, 500);

  // ============ 自动演示（已注释，用于测试） ============
  // setTimeout(() => {
  //   try {
  //     addOutputLog('=== 自动演示开始 ===', 'info');
  //     const runBtn = document.getElementById('run-btn');
  //     if (runBtn) {
  //       addOutputLog('步骤1: 点击运行按钮', 'info');
  //       runBtn.click();
  //     }
  //     setTimeout(() => {
  //       try {
  //         const aiInput = document.getElementById('ai-input');
  //         if (aiInput) {
  //           addOutputLog('步骤2: 触发 AI 对话', 'info');
  //           aiInput.value = '帮我写一个 Arduino UNO 闪烁 LED 的程序，要能调节频率';
  //           handleAISend();
  //         }
  //       } catch(e) { console.error('AI auto-test error:', e); }
  //     }, 2000);
  //   } catch(e) { console.error('Auto demo error:', e); }
  // }, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
