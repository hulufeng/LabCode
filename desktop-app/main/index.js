// ============ LabCode Electron 涓昏繘绋?============
// 鍩轰簬涓氱晫 IDE 璁捐瀹炶返锛氱獥鍙ｇ鐞?/ IPC / 鑷姩鏇存柊 / 浠ｇ悊 / 浼氳瘽瀛樺偍

const { app, BrowserWindow, ipcMain, Menu, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { spawn, execFile } = require('child_process');

// 缁堢鏈嶅姟
const { getTerminalService } = require('./terminal');
const terminalService = getTerminalService();

// 鍏ㄥ眬鍙橀噺
let mainWindow = null;
let isDev = process.argv.includes('--dev');

// 鐢ㄦ埛鏁版嵁鐩綍
const USER_DATA_PATH = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA_PATH, 'config.json');
const SESSIONS_PATH = path.join(USER_DATA_PATH, 'sessions');

// 纭繚鐩綍瀛樺湪
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(SESSIONS_PATH);

// ============ Arduino 数据目录隔离 ============
// 商业化：LabCode 用自己的 arduino15 数据目录，不污染系统 Arduino15
// 迁移逻辑：如果系统 Arduino15 已有 esp32 平台，复用它（开发机/老用户）；否则用隔离目录
const ARDUINO_ISOLATED_DIR = path.join(USER_DATA_PATH, 'arduino15');
const ARDUINO_SYSTEM_DIR = path.join(process.env.LOCALAPPDATA || '', 'Arduino15');

function resolveArduinoDataDir() {
  // 1. 隔离目录已有平台 → 用隔离目录
  const isolatedPkg = path.join(ARDUINO_ISOLATED_DIR, 'packages', 'esp32');
  if (fs.existsSync(isolatedPkg)) return ARDUINO_ISOLATED_DIR;
  // 2. 系统目录已有 esp32 平台 → 复用（开发机/老用户迁移）
  const systemPkg = path.join(ARDUINO_SYSTEM_DIR, 'packages', 'esp32');
  if (fs.existsSync(systemPkg)) return ARDUINO_SYSTEM_DIR;
  // 3. 全新用户 → 隔离目录（触发自动安装）
  return ARDUINO_ISOLATED_DIR;
}
const ARDUINO_DATA_DIR = resolveArduinoDataDir();
process.env.ARDUINO_DIRECTORIES_DATA = ARDUINO_DATA_DIR;
process.env.ARDUINO_DIRECTORIES_DOWNLOADS = path.join(ARDUINO_DATA_DIR, 'staging');
ensureDir(ARDUINO_DATA_DIR);
ensureDir(process.env.ARDUINO_DIRECTORIES_DOWNLOADS);
console.log('📁 Arduino 数据目录:', ARDUINO_DATA_DIR);

// ============ 閰嶇疆瀛樺偍 ============
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('鍔犺浇閰嶇疆澶辫触:', e.message);
  }
  return getDefaultConfig();
}

function getDefaultConfig() {
  return {
    ai: {
      provider: 'gateway',
      model: 'deepseek-flash',
      apiKey: '',
      thinkingLevel: 'standard',
      agentMode: 'default'
    },
    proxy: {
      mode: 'system',
      host: '',
      port: ''
    },
    window: {
      width: 1400,
      height: 900,
      maximized: false
    },
    theme: 'dark',
    recentProjects: [],
    extra: {
      skills: [],
      mcpServers: [
        // 2026-09-15 瀵归綈 TrieCode browser-toolchain锛氶粯璁ゆ敞閲婃帀锛岀敤鎴疯 playwright 鍚庡彇娑堟敞閲?
        // { name: 'browser', command: 'npx', args: ['-y', '@playwright/mcp@latest'], env: {} }
      ],
      hooks: {}
    }
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('淇濆瓨閰嶇疆澶辫触:', e.message);
    return false;
  }
}

let config = loadConfig();

// ============ 浼氳瘽瀛樺偍 ============
function loadSessions() {
  try {
    const files = fs.readdirSync(SESSIONS_PATH).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_PATH, f), 'utf-8'));
      return { id: f.replace('.json', ''), ...content };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (e) {
    console.error('鍔犺浇浼氳瘽澶辫触:', e.message);
    return [];
  }
}

function saveSession(session) {
  try {
    const filePath = path.join(SESSIONS_PATH, `${session.id}.json`);
    session.updatedAt = Date.now();
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('淇濆瓨浼氳瘽澶辫触:', e.message);
    return false;
  }
}

function deleteSession(id) {
  try {
    const filePath = path.join(SESSIONS_PATH, `${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    console.error('鍒犻櫎浼氳瘽澶辫触:', e.message);
    return false;
  }
}

// ============ 绐楀彛绠＄悊 ============
function createMainWindow() {
  const windowConfig = config.window || {};

  mainWindow = new BrowserWindow({
    width: windowConfig.width || 1400,
    height: windowConfig.height || 900,
    minWidth: 1024,
    minHeight: 680,
    frame: false,
    backgroundColor: '#1e1e2e',
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      webviewTag: true
    }
  });

  // 鍔犺浇娓叉煋杩涚▼
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 鏄剧ず绐楀彛锛坮eady-to-show 鏃舵渶澶у寲锛?
  mainWindow.once('ready-to-show', () => {
    if (windowConfig.maximized) mainWindow.maximize();
  });
  
  // 鍏滃簳锛?绉掑悗寮哄埗鏄剧ず绐楀彛锛堥槻姝?ready-to-show 涓嶈Е鍙戯級
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('鍏滃簳鏄剧ず绐楀彛');
      mainWindow.show();
    }
  }, 3000);

  // 绐楀彛澶у皬鍙樺寲淇濆瓨
  mainWindow.on('resize', () => {
    if (!mainWindow.isMaximized()) {
      const bounds = mainWindow.getBounds();
      config.window = { ...config.window, width: bounds.width, height: bounds.height };
      saveConfig(config);
    }
  });

  mainWindow.on('maximize', () => {
    config.window = { ...config.window, maximized: true };
    saveConfig(config);
  });

  mainWindow.on('unmaximize', () => {
    config.window = { ...config.window, maximized: false };
    saveConfig(config);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 寮€鍙戞ā寮忔墦寮€ DevTools
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

// ============ 鑿滃崟 ============
function createMenu() {
  const template = [
    {
      label: '鏂囦欢',
      submenu: [
        { label: '鏂板缓椤圭洰', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-project') },
        { label: '鎵撳紑椤圭洰', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-project') },
        { type: 'separator' },
        { label: '淇濆瓨', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: '鍙﹀瓨涓?, accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-as') },
        { type: 'separator' },
        { role: 'quit', label: '閫€鍑? }
      ]
    },
    {
      label: '缂栬緫',
      submenu: [
        { role: 'undo', label: '鎾ら攢' },
        { role: 'redo', label: '閲嶅仛' },
        { type: 'separator' },
        { role: 'cut', label: '鍓垏' },
        { role: 'copy', label: '澶嶅埗' },
        { role: 'paste', label: '绮樿创' },
        { role: 'selectAll', label: '鍏ㄩ€? }
      ]
    },
    {
      label: '瑙嗗浘',
      submenu: [
        { role: 'reload', label: '閲嶆柊鍔犺浇' },
        { role: 'forceReload', label: '寮哄埗閲嶆柊鍔犺浇' },
        { role: 'toggleDevTools', label: '寮€鍙戣€呭伐鍏? },
        { type: 'separator' },
        { role: 'resetZoom', label: '閲嶇疆缂╂斁' },
        { role: 'zoomIn', label: '鏀惧ぇ' },
        { role: 'zoomOut', label: '缂╁皬' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '鍏ㄥ睆' }
      ]
    },
    {
      label: '甯姪',
      submenu: [
        { label: '鏂囨。', click: () => shell.openExternal('https://www.LabCode.com/docs') },
        { label: '瀹樼綉', click: () => shell.openExternal('https://www.LabCode.com') },
        { type: 'separator' },
        { label: '鍏充簬 LabCode', click: () => showAboutDialog() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '鍏充簬 LabCode',
    message: 'LabCode v1.0.0',
    detail: '閫氱敤 AI 杞欢寮€鍙戞櫤鑳戒綋\n\n鍐呯疆鐪熸鍔ㄦ墜鐨?AI 鏅鸿兘浣擄細璇诲啓浠ｇ爜銆佹墽琛屽懡浠ゃ€佽繍琛屾祴璇曘€佽仈缃戞绱€俓n\n漏 2026 LabCode Team. All rights reserved.',
    buttons: ['纭畾']
  });
}

// ============ IPC 鎺ュ彛 ============
function setupIPC() {
  // 绐楀彛鎺у埗
  ipcMain.handle('app:getCwd', () => process.cwd());

  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
    return mainWindow?.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

  // 閰嶇疆
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:set', (_, key, value) => {
    const keys = key.split('.');
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    return saveConfig(config);
  });
  ipcMain.handle('config:save', (_, newConfig) => {
    config = { ...config, ...newConfig };
    return saveConfig(config);
  });

  // ============ MCP 鏈嶅姟鍣紙Model Context Protocol stdio 鎺ュ叆锛?===========
  const mcpService = require('./mcp').getMcpService();
  require('./mcp').initMcp({ getConfig: () => config, saveConfig });
  ipcMain.handle('mcp:list-servers', () => mcpService.listServers());
  ipcMain.handle('mcp:add-server', (_, cfg) => mcpService.addServer(cfg || {}));
  ipcMain.handle('mcp:remove-server', (_, name) => mcpService.removeServer(name));
  ipcMain.handle('mcp:list-tools', (_, name) => mcpService.listTools(name));
  ipcMain.handle('mcp:call-tool', (_, serverName, toolName, args) => mcpService.callTool(serverName, toolName, args));
  ipcMain.handle('mcp:start-all', () => mcpService.startAll());
  ipcMain.handle('mcp:stop-all', () => { mcpService.stopAll(); return true; });

  // ============ clangd LSP 瀹㈡埛绔紙瀵归綈 TrieCode code-symbols.db锛?===========
  const lspClients = new Map(); // language -> { proc, pending: Map<id, resolve>, buf, initialized }
  function spawnLsp(language, cmd, args) {
    if (lspClients.has(language)) return lspClients.get(language);
    let proc;
    try {
      proc = spawn(cmd, args || [], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error('鏃犳硶鍚姩 ' + cmd + ': ' + e.message);
    }
    const client = { proc, pending: new Map(), buf: '', initialized: false, seq: 1, failed: false };
    proc.on('error', (err) => {
      client.failed = true;
      client.pending.forEach((resolve) => resolve({ error: { code: -2, message: 'spawn 澶辫触: ' + err.message } }));
      client.pending.clear();
      lspClients.delete(language);
    });
    proc.stdout.on('data', (chunk) => {
      client.buf += chunk.toString('utf8');
      // 鎸?Content-Length 澶村垏甯?
      while (true) {
        const headerEnd = client.buf.indexOf('\r\n\r\n');
        if (headerEnd < 0) break;
        const m = client.buf.slice(0, headerEnd).match(/Content-Length:\s*(\d+)/i);
        if (!m) { client.buf = client.buf.slice(headerEnd + 4); continue; }
        const len = parseInt(m[1], 10);
        const bodyStart = headerEnd + 4;
        if (client.buf.length < bodyStart + len) break;
        const body = client.buf.slice(bodyStart, bodyStart + len);
        client.buf = client.buf.slice(bodyStart + len);
        try {
          const msg = JSON.parse(body);
          if (msg.id && client.pending.has(msg.id)) {
            client.pending.get(msg.id)(msg);
            client.pending.delete(msg.id);
          }
        } catch (e) {}
      }
    });
    proc.stderr.on('data', (d) => console.warn('[clangd]', d.toString().slice(0, 200)));
    proc.on('close', () => { lspClients.delete(language); });
    lspClients.set(language, client);
    return client;
  }
  function lspSend(client, msg) {
    return new Promise((resolve) => {
      const id = client.seq++;
      client.pending.set(id, resolve);
      msg.id = id;
      const body = JSON.stringify(msg);
      client.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      // 30s 瓒呮椂
      setTimeout(() => { if (client.pending.has(id)) { client.pending.delete(id); resolve({ error: { code: -1, message: 'timeout' } }); } }, 30000);
    });
  }
  ipcMain.handle('lsp:start', async (_, { language, cmd, args, rootPath }) => {
    try {
      const client = spawnLsp(language, cmd || 'clangd', args || []);
      if (!client.initialized) {
        await lspSend(client, {
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            processId: process.pid,
            rootUri: 'file://' + (rootPath || '').replace(/\\/g, '/'),
            capabilities: { textDocument: { hover: { contentFormat: ['plaintext', 'markdown'] }, definition: { linkSupport: true }, references: {}, documentSymbol: {} } }
          }
        });
        client.initialized = true;
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('lsp:request', async (_, { language, method, params }) => {
    const client = lspClients.get(language);
    if (!client) return { success: false, error: 'LSP 鏈惎鍔? };
    const r = await lspSend(client, { jsonrpc: '2.0', method, params: params || {} });
    return { success: true, result: r.result, error: r.error };
  });
  ipcMain.handle('lsp:notify', async (_, { language, method, params }) => {
    const client = lspClients.get(language);
    if (!client) return { success: false, error: 'LSP 鏈惎鍔? };
    const body = JSON.stringify({ jsonrpc: '2.0', method, params: params || {} });
    client.proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    return { success: true };
  });
  ipcMain.handle('lsp:stop', (_, { language }) => {
    const c = lspClients.get(language);
    if (c) { try { c.proc.kill(); } catch (e) {} lspClients.delete(language); }
    return { success: true };
  });
  // ============ DAP 调试器客户端（对齐 TrieCode 路线图：DAP 调试器与断点）============
  const dapClients = new Map(); // sessionId -> { proc, pending, buf, seq, sender }
  function dapSend(sessionId, msg) {
    return new Promise((resolve) => {
      const cli = dapClients.get(sessionId);
      if (!cli) return resolve({ success: false, error: '调试会话不存在' });
      msg.seq = cli.seq++;
      cli.pending.set(msg.seq, resolve);
      const body = JSON.stringify(msg);
      try {
        cli.proc.stdin.write('Content-Length: ' + Buffer.byteLength(body) + '\r\n\r\n' + body);
      } catch (e) {
        cli.pending.delete(msg.seq);
        resolve({ success: false, error: e.message });
      }
      setTimeout(() => {
        if (cli.pending.has(msg.seq)) { cli.pending.delete(msg.seq); resolve({ success: false, error: 'timeout' }); }
      }, 30000);
    });
  }
  ipcMain.handle('dap:start', async (_, { sessionId, dapPath, args, cwd, sender }) => {
    try {
      if (dapClients.has(sessionId)) return { success: true, alreadyRunning: true };
      const proc = spawn(dapPath, args || [], { cwd: cwd || process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      const cli = { proc, pending: new Map(), buf: '', seq: 1, sender: sender || null };
      proc.on('error', (err) => {
        cli.pending.forEach(r => r({ success: false, error: err.message }));
        cli.pending.clear();
        dapClients.delete(sessionId);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dap:event', { sessionId, event: 'terminated', reason: err.message });
      });
      proc.stdout.on('data', (chunk) => {
        cli.buf += chunk.toString('utf8');
        while (true) {
          const he = cli.buf.indexOf('\r\n\r\n');
          if (he < 0) break;
          const m = cli.buf.slice(0, he).match(/Content-Length:\s*(\d+)/i);
          if (!m) { cli.buf = cli.buf.slice(he + 4); continue; }
          const len = parseInt(m[1]);
          const bs = he + 4;
          if (cli.buf.length < bs + len) break;
          const body = cli.buf.slice(bs, bs + len);
          cli.buf = cli.buf.slice(bs + len);
          try {
            const msg = JSON.parse(body);
            if (msg.type === 'response' && cli.pending.has(msg.request_seq)) {
              const resolve = cli.pending.get(msg.request_seq);
              cli.pending.delete(msg.request_seq);
              resolve({ success: msg.success, body: msg });
            } else if (msg.type === 'event') {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('dap:event', { sessionId, event: msg.event, body: msg.body || {} });
              }
            }
          } catch (e) {}
        }
      });
      proc.stderr.on('data', (d) => console.warn('[dap]', d.toString().slice(0, 200)));
      proc.on('close', () => {
        dapClients.delete(sessionId);
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dap:event', { sessionId, event: 'terminated' });
      });
      dapClients.set(sessionId, cli);
      // DAP initialize
      const initResp = await dapSend(sessionId, { type: 'request', command: 'initialize', arguments: {
        adapterID: 'labcode', clientID: 'labcode', clientName: 'LabCode',
        linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path',
        supportsRunInTerminalRequest: false, supportsVariableType: true,
        supportsVariablePaging: false, supportsRunInTerminalRequest: false
      }});
      return { success: true, initialized: true, capabilities: initResp.body && initResp.body.body };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('dap:request', async (_, { sessionId, command, args }) => {
    const r = await dapSend(sessionId, { type: 'request', command, arguments: args || {} });
    return r;
  });
  ipcMain.handle('dap:stop', async (_, { sessionId }) => {
    const cli = dapClients.get(sessionId);
    if (cli) {
      try { await dapSend(sessionId, { type: 'request', command: 'disconnect', arguments: {} }); } catch (e) {}
      setTimeout(() => { try { cli.proc.kill(); } catch (e) {} }, 500);
    }
    dapClients.delete(sessionId);
    return { success: true };
  });
  // 自动下载 debugpy（Python 调试适配器）
  const DEBUGPY_DIR = path.join(TOOLS_DIR, 'debugpy');
  const DEBUGPY_PY = path.join(DEBUGPY_DIR, 'venv', 'Scripts', 'python.exe');
  ipcMain.handle('dap:ensureDebugpy', async () => {
    if (fs.existsSync(DEBUGPY_PY)) return { success: true, path: DEBUGPY_PY, cached: true };
    try {
      fs.mkdirSync(DEBUGPY_DIR, { recursive: true });
      await new Promise((resolve, reject) => {
        execFile('python', ['-m', 'venv', DEBUGPY_DIR + '\\venv'], { timeout: 60000 }, (err) => err ? reject(err) : resolve());
      });
      const pip = DEBUGPY_PY;
      await new Promise((resolve, reject) => {
        execFile(pip, ['-m', 'pip', 'install', 'debugpy', '-q', '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'], { timeout: 120000 }, (err) => err ? reject(err) : resolve());
      });
      return { success: true, path: DEBUGPY_PY, cached: false };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ Git 鎿嶄綔 ============
  const { execFile: gitExec } = require('child_process');
  function runGit(cwd, args) {
    return new Promise((resolve) => {
      gitExec('git', args, { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: stdout || '', stderr: stderr || '', code: err ? (err.code || 1) : 0 });
      });
    });
  }
  ipcMain.handle('git:status', async (_, cwd) => {
    const r = await runGit(cwd, ['status', '--porcelain', '-b']);
    if (!r.ok) return { success: false, error: r.stderr };
    const lines = r.stdout.split('\n').filter(Boolean);
    const branch = lines[0] && lines[0].startsWith('##') ? lines[0].slice(3).split('...')[0] : '(unknown)';
    const files = lines.slice(1).map(l => {
      const status = l.slice(0, 2);
      const path = l.slice(3);
      return { status: status.trim(), path };
    });
    return { success: true, branch, files };
  });
  ipcMain.handle('git:add', async (_, cwd, paths) => {
    const args = ['add', ...(Array.isArray(paths) ? paths : [paths])];
    const r = await runGit(cwd, args);
    return { success: r.ok, error: r.stderr };
  });
  ipcMain.handle('git:commit', async (_, cwd, message) => {
    const r = await runGit(cwd, ['commit', '-m', message]);
    return { success: r.ok, stdout: r.stdout, error: r.stderr };
  });
  ipcMain.handle('git:log', async (_, cwd, n) => {
    const r = await runGit(cwd, ['log', `-${n || 10}`, '--pretty=format:%h|%an|%ar|%s']);
    if (!r.ok) return { success: false, error: r.stderr };
    const entries = r.stdout.split('\n').filter(Boolean).map(l => {
      const [hash, author, time, ...msg] = l.split('|');
      return { hash, author, time, message: msg.join('|') };
    });
    return { success: true, entries };
  });
  ipcMain.handle('git:push', async (_, cwd) => {
    const r = await runGit(cwd, ['push']);
    return { success: r.ok, stdout: r.stdout, error: r.stderr };
  });
  ipcMain.handle('git:pull', async (_, cwd) => {
    const r = await runGit(cwd, ['pull']);
    return { success: r.ok, stdout: r.stdout, error: r.stderr };
  });
  // ===== Git 图形面板：diff / branch（对齐 TrieCode 路线图第一项）=====
  ipcMain.handle('git:diff', async (_, cwd, filePath) => {
    const args = ['diff', '--unified=3'];
    if (filePath) args.push('--', filePath);
    const r = await runGit(cwd, args);
    return { success: r.ok, diff: r.stdout || '(无变更)', error: r.stderr };
  });
  ipcMain.handle('git:branches', async (_, cwd) => {
    const r = await runGit(cwd, ['branch', '--list', '--format=%(refname:short)|%(objectname:short)|%(subject)|%(committerdate:relative)']);
    if (!r.ok) return { success: false, branches: [], error: r.stderr };
    const branches = r.stdout.split('\n').filter(Boolean).map(l => {
      const [name, hash, ...rest] = l.split('|');
      return { name, hash, subject: rest.slice(0, -1).join('|'), lastCommit: rest[rest.length - 1] || '' };
    });
    // 当前分支
    const cur = await runGit(cwd, ['branch', '--show-current']);
    const current = cur.stdout.trim();
    return { success: true, branches, current };
  });
  ipcMain.handle('git:checkout', async (_, cwd, branchName) => {
    const r = await runGit(cwd, ['checkout', branchName]);
    return { success: r.ok, error: r.stderr };
  });
  ipcMain.handle('git:createBranch', async (_, cwd, branchName) => {
    const r = await runGit(cwd, ['checkout', '-b', branchName]);
    return { success: r.ok, error: r.stderr };
  });
  ipcMain.handle('git:unstage', async (_, cwd, paths) => {
    const args = ['reset', 'HEAD', ...(Array.isArray(paths) ? paths : [paths])];
    const r = await runGit(cwd, args);
    return { success: r.ok, error: r.stderr };
  });
  ipcMain.handle('git:discard', async (_, cwd, paths) => {
    const args = ['checkout', '--', ...(Array.isArray(paths) ? paths : [paths])];
    const r = await runGit(cwd, args);
    return { success: r.ok, error: r.stderr };
  });

  // ============ 宸ュ叿鑷姩涓嬭浇锛坈langd 绛夛紝涓嶆墦鍖呰繘瀹夎鍖咃紝棣栨鐢ㄦ椂鎷夛級============
  const TOOLS_DIR = path.join(app.getPath('userData'), 'tools');
  const CLANGD_DIR = path.join(TOOLS_DIR, 'clangd');
  const CLANGD_EXE = path.join(CLANGD_DIR, 'bin', 'clangd.exe');

  function downloadFile(url, dest, redirects = 5) {
    return new Promise((resolve, reject) => {
      const follow = (u) => {
        https.get(u, { headers: { 'User-Agent': 'LabCode' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects <= 0) return reject(new Error('too many redirects'));
            return follow(res.headers.location);
          }
          if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const ws = fs.createWriteStream(dest);
          res.pipe(ws);
          ws.on('finish', () => ws.close(() => resolve(dest)));
          ws.on('error', reject);
        }).on('error', reject);
      };
      follow(url);
    });
  }

  function extractZip(zipPath, destDir) {
    // 鐢?PowerShell Expand-Archive
    return new Promise((resolve, reject) => {
      execFile('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`],
        { encoding: 'utf8', timeout: 120000 }, (err) => err ? reject(err) : resolve());
    });
  }

  ipcMain.handle('tools:ensure-clangd', async () => {
    if (fs.existsSync(CLANGD_EXE)) return { success: true, path: CLANGD_EXE, cached: true };
    const mirrors = [
      'https://github.com/clangd/clangd/releases/download/22.1.6/clangd-windows-22.1.6.zip',
      'https://ghproxy.net/https://github.com/clangd/clangd/releases/download/22.1.6/clangd-windows-22.1.6.zip',
      'https://mirror.ghproxy.com/https://github.com/clangd/clangd/releases/download/22.1.6/clangd-windows-22.1.6.zip'
    ];
    const zipPath = path.join(TOOLS_DIR, 'clangd.zip');
    let lastErr = null;
    for (const url of mirrors) {
      try {
        console.log('[clangd] trying', url);
        await downloadFile(url, zipPath);
        const sz = fs.statSync(zipPath).size;
        if (sz < 1000000) throw new Error('涓嬭浇鏂囦欢澶皬 (' + sz + ' bytes)锛屽彲鑳芥槸閿欒椤?);
        await extractZip(zipPath, CLANGD_DIR);
        // clangd zip 瑙ｅ帇鍚庢槸 clangd_18.1.8/bin/clangd.exe锛岄渶瑕侀摵骞?
        const subDir = fs.readdirSync(CLANGD_DIR).find(f => f.startsWith('clangd'));
        if (subDir) {
          const src = path.join(CLANGD_DIR, subDir);
          fs.cpSync(src, CLANGD_DIR, { recursive: true });
          fs.rmSync(src, { recursive: true, force: true });
        }
        fs.unlinkSync(zipPath);
        if (fs.existsSync(CLANGD_EXE)) return { success: true, path: CLANGD_EXE, cached: false };
        throw new Error('瑙ｅ帇鍚庢壘涓嶅埌 clangd.exe');
      } catch (e) { lastErr = e; console.warn('[clangd] mirror failed:', e.message); }
    }
    return { success: false, error: '鎵€鏈夐暅鍍忛兘澶辫触: ' + (lastErr && lastErr.message) };
  });

  // ============ AI 瀵硅瘽锛圤penAI 鍏煎 API锛欴eepSeek / 鏈湴 llama 寮曟搸 / Ollama / 鑷畾涔夛級============
  const AI_PROVIDERS = {
    deepseek: { baseURL: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
    gateway:  { baseURL: process.env.GATEWAY_URL || 'https://bluebubai.work', defaultModel: 'deepseek-flash' },
    local:    { baseURL: 'http://127.0.0.1:8080/v1', defaultModel: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf' },
    ollama:   { baseURL: 'http://localhost:11434/v1', defaultModel: 'qwen2.5-coder:7b' },
    openai:   { baseURL: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
    custom:   { baseURL: '', defaultModel: '' }
  };

  ipcMain.handle('ai:chat', async (_, options) => {
    const { messages, model, temperature = 0.7, maxTokens = 4096 } = options || {};
    const aiCfg = config.ai || {};
    const provider = AI_PROVIDERS[aiCfg.provider] || AI_PROVIDERS.deepseek;
    const baseURL = (aiCfg.provider === 'gateway' && aiCfg.gatewayUrl) ? aiCfg.gatewayUrl : (aiCfg.baseURL || provider.baseURL);
    const useModel = model || aiCfg.model || provider.defaultModel;
    const apiKey = aiCfg.apiKey || '';

    if (!baseURL) {
      return { success: false, error: '鏈厤缃?API baseURL锛岃鍦ㄨ缃腑閰嶇疆' };
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return { success: false, error: '娑堟伅涓虹┖' };
    }

    try {
      // ===== 缃戝叧妯″紡锛堢櫥褰曡处鍙?鈫?鍐呯疆妯″瀷姹?鈫?鎵ｇН鍒嗭級=====
      if (aiCfg.provider === 'gateway') {
        const gwToken = aiCfg.gatewayToken || '';
        if (!gwToken) return { success: false, error: '鏈櫥褰曠綉鍏宠处鍙凤紝璇峰湪璁剧疆涓櫥褰? };
        const gwUrl = baseURL.replace(/\/$/, '') + '/api/chat';
        const gwResp = await net.fetch(gwUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + gwToken },
          body: JSON.stringify({ model: useModel, messages, temperature })
        });
        const gwData = await gwResp.json().catch(() => ({}));
        if (!gwResp.ok) {
          if (gwResp.status === 402) {
            return { success: false, error: gwData.error || '绉垎涓嶈冻', creditsInsufficient: true, creditsLeft: gwData.creditsLeft };
          }
          return { success: false, error: `缃戝叧杩斿洖 ${gwResp.status}: ${(gwData.error || '')}` };
        }
        return { success: true, content: gwData.content || '', creditsLeft: gwData.creditsLeft, cost: gwData.cost, totalTokens: gwData.totalTokens, model: useModel, gateway: true };
      }

      const url = baseURL.replace(/\/$/, '') + '/chat/completions';
      const body = JSON.stringify({
        model: useModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false
      });

      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

      const response = await net.fetch(url, {
        method: 'POST',
        headers,
        body
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        return { success: false, error: `API 杩斿洖 ${response.status}: ${errText.slice(0, 500)}` };
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const usage = data?.usage || {};
      return { success: true, content, usage, model: useModel };
    } catch (e) {
      return { success: false, error: 'AI 璇锋眰澶辫触: ' + (e.message || String(e)) };
    }
  });

  // ============ AI 娴佸紡瀵硅瘽锛圫SE + 鐪?function calling锛?===========
  // 閫氳繃 ai:stream 浜嬩欢鎺ㄩ€佹墽琛岃繃绋嬶細delta / tool_calls / usage / done / error
  const activeAiStreams = new Map();
  // 2026-09-15锛氭瘡 runId 涓€涓?AbortController锛宑ancel/鐪嬮棬鐙楀洖閫€鏃剁湡鏂?fetch锛?
  // 鍚﹀垯 llama-server 鏃ц姹傝繕鍗犵潃 slot锛屾柊璇锋眰鍙堣繘鏉?鈫?GPU 骞跺彂璺戞弧 鈫?瀹㈡埛绔穿銆?
  const activeAiControllers = new Map();

  // 瑙ｆ瀽 OpenAI 鍏煎 SSE 娴?
  // 瑙ｆ瀽 OpenAI 鍏煎 SSE 娴侊紙淇濈暀 event: 琛岋紝渚涚綉鍏?credits/error 浜嬩欢閫忎紶锛?
  async function* parseSSEStream(body) {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let pendingEvent = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          for (const line of chunk.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('event:')) {
              pendingEvent = trimmed.slice(6).trim();
              continue;
            }
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') { pendingEvent = ''; continue; }
            try {
              const obj = JSON.parse(payload);
              if (pendingEvent) { obj._event = pendingEvent; pendingEvent = ''; }
              yield obj;
            } catch (e) { /* 蹇界暐鍧忚 */ }
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (e) {}
    }
  }

  // 鍗曡疆娴佸紡璋冪敤锛堟敮鎸?tools / function calling锛涘け璐ヨ嚜鍔ㄥ洖閫€闈炴祦寮忥級
  async function streamChatCompletion(sender, runId, { messages, model, temperature, maxTokens, tools, aiCfg }) {
    const provider = AI_PROVIDERS[aiCfg.provider] || AI_PROVIDERS.deepseek;
    const baseURL = (aiCfg.provider === 'gateway' && aiCfg.gatewayUrl) ? aiCfg.gatewayUrl : (aiCfg.baseURL || provider.baseURL);
    let useModel = model || aiCfg.model || provider.defaultModel;
    const abortCtrl = new AbortController();
    activeAiControllers.set(runId, abortCtrl);
    const acSignal = abortCtrl.signal;
    // 2026-09-14锛氫慨澶嶈疆鑷姩璺敱鍒?coder 妯″瀷
    // 鏍瑰洜锛歲wen3.5:9b 鍦?ollama 涓嬫湁 ~4096 token 鐢熸垚纭檺鍒?+ 闀夸笂涓嬫枃涓嬭緭鍑虹┖锛坱hink=true/false 鍧囩┖锛夛紝
    // 鏃犳硶鑷剤缂栬瘧閿欒銆俼wen2.5-coder:7b 鏄笓鐢ㄧ紪鐮佹ā鍨嬶紝宸查獙璇佽兘杈撳嚭瀹屾暣浠ｇ爜骞剁紪璇戦€氳繃銆?
    const _lastUserMsg = messages.filter(m => m.role === 'user').pop();
    const _isFixTurn = !!(aiCfg.provider === 'ollama' && _lastUserMsg && /缂栬瘧澶辫触|淇浠ｇ爜|浠嶇劧澶辫触|缂栬瘧閿欒|浠ｇ爜涓嶅畬鏁磡琚埅鏂?.test(_lastUserMsg.content || ''));
    if (_isFixTurn) {
      useModel = 'qwen2.5-coder:7b';
      console.warn('[chatStream] 淇杞嚜鍔ㄥ垏鎹㈠埌 qwen2.5-coder:7b锛?b 闀夸笂涓嬫枃杈撳嚭绌猴級');
    }
    const apiKey = aiCfg.apiKey || '';
    const isGateway = aiCfg.provider === 'gateway';
    // 缃戝叧妯″紡锛氳蛋鍐呯疆妯″瀷姹?+ 绉垎鎵ｈ垂锛涜姹備綋鍙彂妯″瀷 id 涓庢秷鎭紙Key 鍦ㄦ湇鍔＄锛?
    const url = isGateway
      ? (baseURL || '').replace(/\/$/, '') + '/api/chat/stream'
      : (baseURL || '').replace(/\/$/, '') + '/chat/completions';
    if (!url || url === '/api/chat/stream' || url === '/chat/completions') throw new Error('鏈厤缃?API baseURL锛岃鍦ㄨ缃腑閰嶇疆');

    const headers = { 'Content-Type': 'application/json' };
    if (isGateway) {
      const gwToken = aiCfg.gatewayToken || '';
      if (!gwToken) throw new Error('鏈櫥褰曠綉鍏宠处鍙凤紝璇峰湪璁剧疆涓櫥褰?);
      headers['Authorization'] = 'Bearer ' + gwToken;
    } else if (apiKey) {
      headers['Authorization'] = 'Bearer ' + apiKey;
    }
    const bodyObj = isGateway
      ? { model: useModel, messages, temperature }
      : { model: useModel, messages, temperature, max_tokens: maxTokens, stream: true };
    // 缃戝叧妯″紡鍚屾牱閫忎紶 tools锛堢綉鍏虫敮鎸?function calling 杞彂锛?
    if (isGateway && Array.isArray(tools) && tools.length > 0) {
      bodyObj.tools = tools;
    }
    // 鏈湴寮曟搸涓嶆敞鍏?tools锛歭lama.cpp --jinja + tools 浼氱敤 grammar 寮哄埗妯″瀷杈撳嚭宸ュ叿 JSON锛?
    // 鏈湴灏忔ā鍨嬶紙Qwen3.5-9B锛夊湪 grammar 绾︽潫涓嬩細杈撳嚭绌?澶辫触锛堟鏂囦涪澶憋級銆?
    // 鏈湴妯″瀷鐨勪富璺緞鏄?姝ｆ枃浠ｇ爜鍧?鈫?搴旂敤灞傝惤鐩?鈫?IDE 鑷姩缂栬瘧楠岃瘉"锛屼笉渚濊禆宸ュ叿璋冪敤銆?
    if (Array.isArray(tools) && tools.length > 0 && aiCfg.provider !== 'local' && aiCfg.provider !== 'ollama' && !isGateway) {
      bodyObj.tools = tools;
    }
    // 鏈湴寮曟搸锛圦wen3 绛夋€濊€冩ā鍨嬶級锛?
    // 宸插疄娴嬶細enable_thinking=true + 娴佸紡 + max_tokens 鍏呰冻鏃讹紝reasoning_content 涓庢鏂囦細鍏堝悗杈撳嚭锛?
    // finish=stop锛堢湡瀹炶眴鍖呭紡鎬濊€冩祦锛夈€傛€濊€冭繃闀垮崰婊?max_tokens 鏃舵鏂囧彲鑳戒负绌猴紝
    // 鐢?doStreamOnce 鍐?绌烘鏂団啋鍏抽棴鎬濊€冮噸璇?闄嶇骇鍏滃簳锛屼繚璇佹鏂囪緭鍑恒€?
    // 鏈湴寮曟搸锛圦wen3 绛夋€濊€冩ā鍨嬶級锛?
    // 宸插疄娴嬶細enable_thinking=true + 娴佸紡 + max_tokens 鍏呰冻鏃讹紝reasoning_content 涓庢鏂囦細鍏堝悗杈撳嚭锛?
    // finish=stop锛堢湡瀹炶眴鍖呭紡鎬濊€冩祦锛夈€傛€濊€冭繃闀垮崰婊?max_tokens 鏃舵鏂囧彲鑳戒负绌猴紝
    // 鐢?doStreamOnce 鍐?绌烘鏂団啋鍏抽棴鎬濊€冮噸璇?闄嶇骇鍏滃簳锛屼繚璇佹鏂囪緭鍑恒€?
    if (aiCfg.provider === 'local') {
      // bodyObj.chat_template_kwargs 鐢?doStreamOnce(enableThinking) 鎸夎疆娆¤缃?
      // 2026-09-15锛氬伐鍏峰喅绛栬疆鍙€?JSON 绾︽潫銆?
      // 鍐掔儫锛坈url锛夊疄娴?response_format=json_object 涓?9B 鍚愬悎娉?JSON锛?
      // 浣嗙湡閾捐矾瀹炴祴锛氱害鏉熷鑷存祦寮?60s 鏃犳暟鎹啋鍥為€€闈炴祦寮忊啋鏂版棫璇锋眰鍙犲姞鈫扜PU 骞跺彂璺戞弧鈫掑鎴风宕┿€?
      // 鏁呴粯璁ゅ叧闂紝浠呭綋 ai.localForceToolJson=true 鏄惧紡寮€鍚€?
      if (Array.isArray(tools) && tools.length > 0 && aiCfg.localForceToolJson === true) {
        bodyObj.response_format = { type: 'json_object' };
      }
    } else if (aiCfg.provider === 'ollama') {
      bodyObj.think = false;
    }

    const send = (type, data) => {
      try { if (sender && !sender.isDestroyed()) sender.send('ai:stream', { runId, type, ...data }); } catch (e) {}
    };

    // 鍗曟璇锋眰 + 娴佽В鏋愶紙渚涢娆′笌寮曟搸閲嶅惎鍚庨噸璇曞叡鐢級
    async function doStreamOnce(enableThinking) {
      const b = Object.assign({}, bodyObj);
      if (aiCfg.provider === 'local') b.chat_template_kwargs = { enable_thinking: enableThinking !== false };
      else if (aiCfg.provider === 'ollama') b.think = enableThinking !== false;
      const toolCalls = [];
      const response = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(b), signal: acSignal });
      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const err = new Error(`API 杩斿洖 ${response.status}: ${errText.slice(0, 300)}`);
        if (response.status === 402) err.creditsInsufficient = true;
        throw Object.assign(err, { status: response.status, errText });
      }

      let fullText = '';
      let lastFinish = '';
      let lastUsage = null;
      for await (const evt of parseSSEStream(response.body)) {
        if (activeAiStreams.get(runId)) { activeAiStreams.delete(runId); break; }
        // 缃戝叧浜嬩欢琛岋紙event: credits / event: error锛夐€忎紶缁?renderer
        if (evt._event === 'credits') {
          send('credits', { used: evt.used, totalTokens: evt.totalTokens, remaining: evt.remaining });
          continue;
        }
        if (evt._event === 'error') {
          send('error', { error: evt.error || '缃戝叧娴侀敊璇? });
          continue;
        }
        if (evt.usage) lastUsage = evt.usage;
        const choice = evt.choices && evt.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) lastFinish = choice.finish_reason;
        if (choice.delta && choice.delta.reasoning_content) {
          send('thinking_delta', { delta: choice.delta.reasoning_content });
        }
        if (choice.delta && choice.delta.content) {
          fullText += choice.delta.content;
          send('delta', { delta: choice.delta.content });
        }
        if (choice.delta && Array.isArray(choice.delta.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index || 0;
            if (!toolCalls[idx]) toolCalls[idx] = { id: tc.id || ('call_' + idx), name: '', arguments: '' };
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function) {
              if (tc.function.name) toolCalls[idx].name += tc.function.name;
              if (tc.function.arguments) toolCalls[idx].arguments += tc.function.arguments;
            }
          }
        }
        if (evt.usage) send('usage', { usage: evt.usage });
      }

      const parsedToolCalls = toolCalls
        .filter(tc => tc.name)
        .map(tc => {
          let args = {};
          try { args = JSON.parse(tc.arguments || '{}'); } catch (e) { args = { _raw: tc.arguments }; }
          return { id: tc.id, name: tc.name, arguments: args };
        });

      // ===== 鏈湴鎬濊€冩祦闄嶇骇锛氭€濊€冭繃闀垮崰婊?max_tokens 鈫?姝ｆ枃涓虹┖ 鈫?鍏抽棴鎬濊€冮噸璇曚竴娆?=====
      // 2026-09-14锛氭墿灞曞埌 ollama锛圦wen3.5-9B 绛夋€濊€冩ā鍨嬪悓鏍蜂細鎬濊€冨崰婊￠绠楀鑷存鏂囨埅鏂?绌鸿緭鍑猴級
      if ((aiCfg.provider === 'local' || aiCfg.provider === 'ollama') && enableThinking !== false && !String(fullText || '').trim()) {
        console.warn('[streamChat] 鏈湴鎬濊€冩祦鏈骇鍑烘鏂囷紙鎬濊€冨崰婊￠绠楋級锛屽叧闂€濊€冮噸璇?);
        return doStreamOnce(false);
      }

      // 娉ㄦ剰锛氫笉鍦ㄦ send('done')鈥斺€斿灞傚彲鑳介渶瑕佽嚜鍔ㄧ画鍐欙紝鐢卞灞傜粺涓€鍙戦€佹渶缁?done
      return { success: true, content: fullText, toolCalls: parsedToolCalls, finishReason: lastFinish, usage: lastUsage };
    }

    // ===== 2026-09-14 鑷姩缁啓锛歰llama/local 妯″瀷浠ｇ爜鍧楁湭闂悎鏃讹紝鑷姩缁啓鎷兼帴 =====
    // 鏍瑰洜锛歰llama 0.33.x + qwen3.5:9b 鏈?~4096 token 鐢熸垚纭檺鍒讹紙num_predict 涓嶇敓鏁堬級锛岄暱浠ｇ爜鍦?4096 token 澶勮鍒囨柇銆?
    // 妫€娴嬶細``` 璁℃暟涓哄鏁帮紙浠ｇ爜鍧楁湭闂悎锛夋垨鑺辨嫭鍙蜂笉鍖归厤 鈫?鍙?璇风户缁?璇锋眰鎷兼帴锛屾渶澶?3 娆°€?
    function hasUnclosedCodeBlock(text) {
      const t = text || '';
      const ticks = t.match(/```/g);
      if (ticks && ticks.length % 2 === 1) return true;
      // 浠ｇ爜鍧楀凡闂悎浣嗚姳鎷彿涓嶅尮閰嶏紙鍑芥暟鏈啓瀹岋級涔熻涓烘湭瀹屾垚
      const open = (t.match(/\{/g) || []).length;
      const close = (t.match(/\}/g) || []).length;
      return open > close;
    }
    async function continueStream(prevContent, attempt) {
      const continueMessages = [
        ...messages,
        { role: 'assistant', content: prevContent },
        { role: 'user', content: '璇风洿鎺ョ户缁緭鍑哄墿浣欎唬鐮侊紝缁濆涓嶈杈撳嚭 ``` 闂悎鏍囪锛屼笉瑕侀噸澶嶅凡杈撳嚭鍐呭锛屼笉瑕佸啓瑙ｉ噴鏂囧瓧锛岀洿鍒版墍鏈夊嚱鏁板拰閫昏緫瀹屾暣銆佽姳鎷彿鍏ㄩ儴闂悎銆? }
      ];
      const b = Object.assign({}, bodyObj, { messages: continueMessages });
      if (aiCfg.provider === 'local') b.chat_template_kwargs = { enable_thinking: false };
      else if (aiCfg.provider === 'ollama') b.think = false;
      const resp = await net.fetch(url, { method: 'POST', headers, body: JSON.stringify(b), signal: acSignal });
      if (!resp.ok) throw new Error(`缁啓 API 杩斿洖 ${resp.status}`);
      let cont = '';
      let fin = '';
      for await (const evt of parseSSEStream(resp.body)) {
        if (activeAiStreams.get(runId)) break;
        const choice = evt.choices && evt.choices[0];
        if (!choice) continue;
        if (choice.finish_reason) fin = choice.finish_reason;
        if (choice.delta && choice.delta.content) { cont += choice.delta.content; send('delta', { delta: choice.delta.content }); }
      }
      return { content: cont, finishReason: fin };
    }

    try {
      // 2026-09-14锛氫慨澶嶈疆锛堢紪璇戝け璐ユ彁绀猴級寮哄埗鍏抽棴鎬濊€冣€斺€旈伩鍏嶆€濊€冨崰婊?4096 token 棰勭畻瀵艰嚧姝ｆ枃绌鸿緭鍑?
      const lastUserMsg = messages.filter(m => m.role === 'user').pop();
      const isFixTurn = !!(lastUserMsg && /缂栬瘧澶辫触|淇浠ｇ爜|浠嶇劧澶辫触|缂栬瘧閿欒/.test(lastUserMsg.content || ''));
      const thinkForTurn = isFixTurn ? false : true;
      if (isFixTurn) _log('妫€娴嬪埌缂栬瘧淇杞紝寮哄埗 think=false');
      let result = await doStreamOnce(thinkForTurn);
      // 鑷姩缁啓寰幆锛堜粎 ollama/local锛屼唬鐮佸潡鏈棴鍚堟椂鈥斺€斾笉渚濊禆 finish_reason锛宱llama 娴佸紡鍙兘涓嶄紶锛?
      const _fs = require('fs'); const _log = (s) => { try { _fs.appendFileSync(require('path').join(require('os').tmpdir(), 'labcode_stream.log'), new Date().toISOString() + ' ' + s + '\n'); } catch(e){} };
      _log(`doStreamOnce done, len=${result.content.length}, unclosed=${hasUnclosedCodeBlock(result.content)}`);
      if ((aiCfg.provider === 'ollama' || aiCfg.provider === 'local') && hasUnclosedCodeBlock(result.content)) {
        for (let i = 0; i < 3; i++) {
          _log(`缁啓绗?${i + 1} 娆″紑濮? 褰撳墠 len=${result.content.length}`);
          try {
            const cont = await continueStream(result.content, i + 1);
            _log(`缁啓绗?${i + 1} 娆″畬鎴? 缁帴 len=${cont.content.length}, finish=${cont.finishReason}`);
            result.content += cont.content;
            result.finishReason = cont.finishReason;
            if (!hasUnclosedCodeBlock(result.content)) { _log('浠ｇ爜鍧楀凡闂悎锛屽仠姝㈢画鍐?); break; }
          } catch (ce) {
            _log(`缁啓澶辫触: ${ce.message}`);
            console.warn('[streamChat] 缁啓澶辫触:', ce.message);
            break;
          }
        }
      }
      _log(`鏈€缁?done, len=${result.content.length}`);
      // 缁熶竴鍙戦€佹渶缁?done锛坉oStreamOnce 鍐呴儴涓嶅啀鍙?done锛岄伩鍏嶇画鍐?delta 琚拷鐣ワ級
      send('done', { content: result.content, toolCalls: result.toolCalls, usage: result.usage || null });
      return result;
    } catch (e) {
      // 鐢ㄦ埛/鐪嬮棬鐙椾富鍔ㄥ彇娑堬細涓嶉噸鍚紩鎿庛€佷笉鍥為€€闈炴祦寮忥紝鐩存帴闈欓粯缁撴潫
      if (e && (e.name === 'AbortError' || e.aborted)) {
        activeAiControllers.delete(runId);
        return { success: false, aborted: true };
      }
      // ===== 鏈湴寮曟搸鑷姩鎭㈠锛氳繛鎺ュけ璐ワ紙鍚鐩栧畨瑁呭悗鏃у疄渚嬪亣娲伙級鈫?寮烘潃娈嬬暀骞堕噸鍚紩鎿?鈫?閲嶈瘯涓€娆?=====
      if (!e.noFallback && aiCfg.provider === 'local' && !activeAiStreams.get(runId)) {
        try {
          console.warn('[streamChat] 鏈湴寮曟搸璇锋眰澶辫触锛岃嚜鍔ㄩ噸鍚紩鎿庡悗閲嶈瘯:', e.message);
          const sr = await startEngineInternal(aiCfg.model);
          if (sr && sr.success) {
            return await doStreamOnce(true);
          }
        } catch (re) { console.warn('[streamChat] 寮曟搸閲嶅惎閲嶈瘯澶辫触:', re.message); }
      }
      // 鍥為€€锛氬幓鎺?tools + stream:false 鍐嶈瘯涓€娆★紙鍏煎涓嶆敮鎸?function calling 鐨勬ā鍨嬶級
      if (!e.noFallback && !activeAiStreams.get(runId)) {
        try {
          // 缃戝叧妯″紡鍥為€€鍒伴潪娴佸紡绔偣 /api/chat
          const fbUrl = isGateway ? (baseURL || '').replace(/\/$/, '') + '/api/chat' : url;
          const fbBody = isGateway
            ? { model: useModel, messages, temperature }
            : { model: useModel, messages, temperature, max_tokens: maxTokens, stream: false };
          if (aiCfg.provider === 'local') fbBody.chat_template_kwargs = { enable_thinking: false };
          else if (aiCfg.provider === 'ollama') fbBody.think = false;
          const fbResp = await net.fetch(fbUrl, { method: 'POST', headers, body: JSON.stringify(fbBody), signal: acSignal });
          if (fbResp.ok) {
            const data = await fbResp.json();
            if (isGateway) {
              // 缃戝叧闈炴祦寮忓搷搴旓細{ content, creditsLeft, cost, totalTokens }
              const gwContent = data?.content || '';
              send('credits', { used: data?.cost || 0, totalTokens: data?.totalTokens || 0, remaining: data?.creditsLeft || 0 });
              send('done', { content: gwContent, toolCalls: [] });
              return { success: true, content: gwContent, toolCalls: [] };
            }
            const content = data?.choices?.[0]?.message?.content || '';
            const tc = data?.choices?.[0]?.message?.tool_calls || [];
            const parsed = Array.isArray(tc) ? tc.map(t => ({
              id: t.id,
              name: (t.function && t.function.name) || '',
              arguments: (() => { try { return JSON.parse((t.function && t.function.arguments) || '{}'); } catch (err) { return { _raw: t.function && t.function.arguments }; } })()
            })) : [];
            send('done', { content, toolCalls: parsed });
            return { success: true, content, toolCalls: parsed };
          }
        } catch (fbErr) { /* 缁х画鎶涘師濮嬮敊璇?*/ }
      }
      send('error', { error: e.message || String(e), creditsInsufficient: !!e.creditsInsufficient });
      return { success: false, error: e.message || String(e), creditsInsufficient: !!e.creditsInsufficient };
    }
  }

  ipcMain.handle('ai:chatStream', async (event, options = {}) => {
    const { runId = 'run_' + Date.now(), messages, model, temperature, maxTokens, tools } = options;
    const aiCfg = config.ai || {};
    activeAiStreams.delete(runId);
    // 寮傛鎵ц锛岀珛鍗宠繑鍥?runId锛岀粨鏋滅粡 ai:stream 浜嬩欢鎺ㄩ€?
    (async () => {
      try {
        await streamChatCompletion(event.sender, runId, { messages, model, temperature, maxTokens, tools, aiCfg });
      } catch (e) {
        try { event.sender.send('ai:stream', { runId, type: 'error', error: e.message || String(e) }); } catch (_) {}
      } finally {
        activeAiControllers.delete(runId);
      }
    })();
    return { success: true, runId };
  });

  // 鍙栨秷娴佸紡瀵硅瘽
  ipcMain.handle('ai:chatCancel', (_, runId) => {
    if (runId) {
      activeAiStreams.set(runId, true);
      const ctrl = activeAiControllers.get(runId);
      if (ctrl) { try { ctrl.abort(); } catch (e) {} }
    }
    return { success: true };
  });

  ipcMain.handle('ai:checkConnection', async (_, testConfig) => {
    // 娴嬭瘯 AI 杩炴帴锛堝彂涓€鏉℃渶鐭秷鎭級
    const aiCfg = { ...(config.ai || {}), ...(testConfig || {}) };
    const provider = AI_PROVIDERS[aiCfg.provider] || AI_PROVIDERS.deepseek;
    const baseURL = (aiCfg.provider === 'gateway' && aiCfg.gatewayUrl) ? aiCfg.gatewayUrl : (aiCfg.baseURL || provider.baseURL);
    const useModel = aiCfg.model || provider.defaultModel;
    if (!baseURL) return { success: false, error: '鏈厤缃?baseURL' };
    try {
      // 缃戝叧妯″紡锛氱敤 /api/me 楠岃瘉 token 鏈夋晥鎬э紙涓嶆秷鑰楃Н鍒嗭級
      if (aiCfg.provider === 'gateway') {
        const gwUrl = baseURL.replace(/\/$/, '') + '/api/me';
        const gwResp = await net.fetch(gwUrl, {
          headers: { Authorization: 'Bearer ' + (aiCfg.gatewayToken || '') }
        });
        if (!gwResp.ok) return { success: false, status: gwResp.status, error: '缃戝叧鐧诲綍澶辨晥锛岃閲嶆柊鐧诲綍' };
        const data = await gwResp.json().catch(() => ({}));
        const u = data?.user || {};
        return { success: true, model: useModel, gateway: true, creditsLeft: u.totalCredits ?? (u.planCredits || 0) + (u.rechargeCredits || 0) };
      }
      const url = baseURL.replace(/\/$/, '') + '/chat/completions';
      const headers = { 'Content-Type': 'application/json' };
      if (aiCfg.apiKey) headers['Authorization'] = 'Bearer ' + aiCfg.apiKey;
      const response = await net.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: useModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5, stream: false })
      });
      return { success: response.ok, status: response.status, model: useModel };
    } catch (e) {
      return { success: false, error: e.message || String(e) };
    }
  });

  // ============ 缃戝叧璐﹀彿锛堢櫥褰?/ 娉ㄥ唽 / 浣欓 / 鐧诲嚭锛?===========
  ipcMain.handle('ai:gatewayAuth', async (_, { action, email, password, gatewayUrl } = {}) => {
    // 浼樺厛绾э細鏄惧紡浼犲叆 > 宸蹭繚瀛?config.ai.gatewayUrl > 鐜鍙橀噺 > 榛樿鐢熶骇鍩熷悕
    const savedGw = (config.ai || {}).gatewayUrl || '';
    const gwBase = (gatewayUrl || savedGw || process.env.GATEWAY_URL || AI_PROVIDERS.gateway.baseURL || 'https://bluebubai.work').replace(/\/$/, '');
    try {
      if (action === 'login' || action === 'register') {
        if (!email || !password) return { success: false, error: '璇疯緭鍏ラ偖绠卞拰瀵嗙爜' };
        const res = await net.fetch(`${gwBase}/api/auth/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, error: data.error || `缃戝叧杩斿洖 ${res.status}` };
        if (!data.token) return { success: false, error: '缃戝叧鏈繑鍥?token' };
        const u = data.user || {};
        // 鎸佷箙鍖栧埌 config.ai
        const aiCfg = config.ai || {};
        aiCfg.gatewayToken = data.token;
        aiCfg.gatewayEmail = email;
        aiCfg.gatewayUrl = gwBase;
        config.ai = aiCfg;
        saveConfig(config);
        return {
          success: true,
          action,
          user: { email: u.email, totalCredits: u.totalCredits, planCredits: u.planCredits, rechargeCredits: u.rechargeCredits }
        };
      }
      if (action === 'me') {
        const token = (config.ai || {}).gatewayToken || '';
        if (!token) return { success: false, error: '鏈櫥褰? };
        const res = await net.fetch(`${gwBase}/api/me`, { headers: { Authorization: 'Bearer ' + token } });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { success: false, error: data.error || `缃戝叧杩斿洖 ${res.status}` };
        const u = data.user || {};
        return { success: true, user: { email: u.email, totalCredits: u.totalCredits, planCredits: u.planCredits, rechargeCredits: u.rechargeCredits } };
      }
      if (action === 'logout') {
        const aiCfg = config.ai || {};
        delete aiCfg.gatewayToken;
        delete aiCfg.gatewayEmail;
        config.ai = aiCfg;
        saveConfig(config);
        return { success: true };
      }
      return { success: false, error: '鏈煡鎿嶄綔: ' + action };
    } catch (e) {
      return { success: false, error: '缃戝叧璇锋眰澶辫触: ' + (e.message || String(e)) };
    }
  });

  // 浼氳瘽
  ipcMain.handle('sessions:list', () => loadSessions());
  ipcMain.handle('sessions:save', (_, session) => saveSession(session));
  ipcMain.handle('sessions:delete', (_, id) => deleteSession(id));

  // 鏂囦欢鎿嶄綔
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '鎵€鏈夋枃浠?, extensions: ['*'] },
        { name: '浠ｇ爜鏂囦欢', extensions: ['js', 'ts', 'py', 'cpp', 'c', 'ino', 'rs', 'go', 'java'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:saveFile', async (_, defaultPath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultPath || 'untitled'
    });
    return result.canceled ? null : result.filePath;
  });

  // 鏂囦欢璇诲啓锛堝甫缂栫爜鑷姩妫€娴嬶細UTF-8 BOM / 绾疷TF-8 / GBK 鍥為€€锛?
  ipcMain.handle('fs:readFile', (_, filePath) => {
    try {
      const buf = fs.readFileSync(filePath);
      // 1) UTF-8 BOM 鐩存帴鎸?UTF-8
      if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        return { success: true, content: buf.toString('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf-8' };
      }
      // 2) 灏濊瘯涓ユ牸 UTF-8 瑙ｇ爜锛圱extDecoder fatal 妯″紡锛?
      try {
        const td = new TextDecoder('utf-8', { fatal: true });
        const content = td.decode(buf);
        // 鏃?BOM 浣嗙函 ASCII/UTF-8 鏃剁洿鎺ヨ繑鍥?
        return { success: true, content, encoding: 'utf-8' };
      } catch (utfErr) {
        // 3) UTF-8 瑙ｇ爜澶辫触 鈫?GBK锛堣鐩栦腑鏂?Windows 甯歌 GB2312/GBK 缂栫爜鏂囦欢锛?
        const iconv = (() => {
          try { return require('iconv-lite'); } catch (e) { return null; }
        })();
        if (iconv) {
          return { success: true, content: iconv.decode(buf, 'gbk'), encoding: 'gbk' };
        }
        // 鏃?iconv-lite 鏃剁殑鍥為€€锛氭墜鍔?GBK鈫扷TF-8 琛ㄤ笉鐜板疄锛岀敤 latin1 鍏滃簳
        return { success: true, content: buf.toString('utf-8'), encoding: 'utf-8(鐤戜技GBK)' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fs:writeFile', (_, filePath, content) => {
    try {
      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fs:exists', (_, filePath) => fs.existsSync(filePath));

  ipcMain.handle('fs:listDir', (_, dirPath) => {
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      return {
        success: true,
        files: items.map(item => ({
          name: item.name,
          isDirectory: item.isDirectory(),
          path: path.join(dirPath, item.name)
        }))
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 澶嶅埗鏂囦欢
  ipcMain.handle('fs:copyFile', (_, srcPath, destPath) => {
    try {
      fs.copyFileSync(srcPath, destPath);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 读取 PDF 文件（对齐 TrieCode pdf.js）=====
  ipcMain.handle('fs:readPdf', async (_, filePath, maxPages = 20) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
      try {
        const pdf = require('pdf-parse');
        const buf = fs.readFileSync(filePath);
        const data = await pdf(buf);
        const pages = data.numpages || 1;
        const text = data.text || '';
        const pageTexts = text.split('\f');
        const limited = pageTexts.slice(0, maxPages);
        return { success: true, text: limited.join('\n---\n').slice(0, 30000), pages: limited.length, totalPages: pages, truncated: pageTexts.length > maxPages };
      } catch (pdfErr) {
        // pdf-parse 未安装，降级为简单字符串提取
        const buf = fs.readFileSync(filePath);
        const latin1 = buf.toString('latin1');
        const strings = latin1.match(/\((?:[^()\\]|\\.)*\)/g) || [];
        const extracted = strings.map(s => s.slice(1, -1)).filter(s => s.length > 10).join('\n');
        return { success: true, text: extracted.slice(0, 20000), pages: 1, totalPages: 1, truncated: extracted.length > 20000, note: 'pdf-parse未安装，降级提取' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 图片分析（对齐 TrieCode vision.js，需视觉模型）=====
  ipcMain.handle('fs:analyzeImage', async (_, filePath, prompt) => {
    try {
      if (!fs.existsSync(filePath)) return { success: false, error: '文件不存在' };
      const buf = fs.readFileSync(filePath);
      const ext = filePath.split('.').pop().toLowerCase();
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/' + ext;
      const b64 = buf.toString('base64');
      const dataUrl = 'data:' + mime + ';base64,' + b64;
      const aiCfg = config.ai || {};
      const provider = AI_PROVIDERS[aiCfg.provider] || AI_PROVIDERS.deepseek;
      const baseURL = aiCfg.baseURL || provider.baseURL;
      const apiKey = aiCfg.apiKey || '';
      const url = baseURL.replace(/\/$/, '') + '/chat/completions';
      const resp = await net.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
          model: aiCfg.model || provider.defaultModel,
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt || '请描述这张图片的内容' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]}],
          max_tokens: 1000
        })
      });
      if (!resp.ok) return { success: false, error: 'API ' + resp.status + '（当前模型可能不支持视觉）' };
      const data = await resp.json();
      return { success: true, description: (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '（无描述）' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ 缁堢 IPC ============
  
  // 鍒涘缓缁堢
  ipcMain.handle('terminal:create', (_, options = {}) => {
    try {
      const terminal = terminalService.createTerminal(options);
      
      // 鐩戝惉缁堢鏁版嵁杈撳嚭锛岄€氳繃 webContents 鍙戦€佸埌娓叉煋杩涚▼
      terminalService.onData(terminal.id, (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:data:${terminal.id}`, data);
        }
      });
      
      // 鐩戝惉缁堢閫€鍑?
      terminalService.onExit(terminal.id, ({ exitCode, signal }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:exit:${terminal.id}`, { exitCode, signal });
        }
      });
      
      return { success: true, terminal };
    } catch (e) {
      console.error('鍒涘缓缁堢澶辫触:', e);
      return { success: false, error: e.message };
    }
  });
  
  // 鍚戠粓绔啓鍏ユ暟鎹?
  ipcMain.handle('terminal:write', (_, id, data) => {
    try {
      terminalService.write(id, data);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 璋冩暣缁堢澶у皬
  ipcMain.handle('terminal:resize', (_, id, cols, rows) => {
    try {
      terminalService.resize(id, cols, rows);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 鑾峰彇缁堢缂撳啿鍖?
  ipcMain.handle('terminal:getBuffer', (_, id) => {
    try {
      const buffer = terminalService.getBuffer(id);
      return { success: true, buffer };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 娓呴櫎缁堢缂撳啿鍖?
  ipcMain.handle('terminal:clearBuffer', (_, id) => {
    try {
      terminalService.clearBuffer(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 鏉€姝荤粓绔?
  ipcMain.handle('terminal:kill', (_, id) => {
    try {
      terminalService.kill(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 鑾峰彇缁堢鍒楄〃
  ipcMain.handle('terminal:list', () => {
    try {
      const terminals = terminalService.listTerminals();
      return { success: true, terminals };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 鎵ц鍛戒护锛堜竴娆℃€ф墽琛岋級
  ipcMain.handle('terminal:execute', async (_, command, cwd, timeout, opts) => {
    try {
      const result = await terminalService.executeCommand(command, cwd, timeout, opts);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ============ Arduino 缂栬瘧/鐑у綍 ============
  // 鑷爺鏈綋 P0-1锛歛rduino-cli 澶氳矾寰勬帰娴嬶紙鍥哄畾鐩綍 鈫?鐢ㄦ埛閰嶇疆 鈫?PATH/甯歌瀹夎浣嶇疆锛?
  function resolveArduinoCli() {
    const candidates = [
      path.join(app.getPath('appData'), 'codelab-desktop', 'tools', 'arduino-cli', 'arduino-cli.exe'),
      path.join('C:\\Program Files\\Arduino CLI', 'arduino-cli.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Arduino15', 'arduino-cli.exe'),
      path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Arduino15', 'arduino-cli.exe')
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(c)) return c; } catch (e) {}
    }
    // 鏈€鍚庡皾璇?PATH锛坵here.exe锛?
    try {
      const r = execSync('where.exe arduino-cli', { encoding: 'utf8', timeout: 4000 });
      const first = r.split(/\r?\n/).map(s => s.trim()).find(s => s && fs.existsSync(s));
      if (first) return first;
    } catch (e) {}
    return candidates[0]; // 鍏滃簳锛氳繑鍥為粯璁よ矾寰勶紙runArduinoCli 鍐呬細鍒や笉瀛樺湪锛?
  }
  const ARDUINO_CLI = resolveArduinoCli();
  // 渚?renderer run_test 鑾峰彇鐪熷疄璺緞锛堥伩鍏?PATH 缂哄け瀵艰嚧 'arduino-cli' 瑁稿懡浠ゅけ璐ワ級
  ipcMain.handle('toolchain:getArduinoCliPath', () => {
    const p = resolveArduinoCli();
    return { path: p, exists: fs.existsSync(p) };
  });

  // toolchain.status锛氭娴?arduino-cli + 骞冲彴 + 搴擄紙瀵归綈 TrieCode锛?
  ipcMain.handle('toolchain:status', async () => {
    const p = resolveArduinoCli();
    const cliExists = fs.existsSync(p);
    let version = '';
    let platforms = [];
    if (cliExists) {
      try {
        const v = await new Promise(r => execFile(p, ['version'], { timeout: 10000 }, (e, so) => r((so || '').trim())));
        version = v;
        const pl = await new Promise(r => execFile(p, ['core', 'list'], { timeout: 10000 }, (e, so) => r(so || '')));
        platforms = pl.split('\n').slice(1).filter(l => l.trim()).map(l => l.split(/\s{2,}/)[0].trim());
      } catch (e) {}
    }
    return {
      ok: cliExists && platforms.length > 0,
      cliPath: p,
      cliExists,
      version,
      platforms,
      error: cliExists ? (platforms.length ? '' : '鏃犲凡瀹夎骞冲彴') : 'arduino-cli 鏈畨瑁?
    };
  });

  // ============ ESP32 工具链自动安装（商业化：首次启动自动下载） ============
  const ESP32_ADDITIONAL_URLS = [
    'https://jihulab.com/esp32-arduino/esp32/-/raw/gh-pages/package_esp32_index.json',
    'https://espressif.github.io/arduino-esp32/package_esp32_index.json'
  ].join(',');

  function isEsp32Installed() {
    try {
      const hwDir = path.join(ARDUINO_DATA_DIR, 'packages', 'esp32', 'hardware', 'esp32');
      if (!fs.existsSync(hwDir)) return false;
      return fs.readdirSync(hwDir).some(v => /^\d+\.\d+\.\d+/.test(v));
    } catch (e) { return false; }
  }

  function sendToolchainProgress(stage, percent, message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toolchain:progress', { stage, percent, message });
    }
  }

  async function ensureEsp32Toolchain() {
    if (isEsp32Installed()) {
      console.log('✅ ESP32 平台已安装，跳过自动下载');
      sendToolchainProgress('done', 100, 'ESP32 工具链已就绪');
      return { installed: true, skipped: true };
    }
    if (!fs.existsSync(ARDUINO_CLI)) {
      const msg = 'arduino-cli 未找到，无法自动安装 ESP32 工具链';
      console.error('❌', msg);
      sendToolchainProgress('error', 0, msg);
      return { installed: false, error: msg };
    }
    console.log('📦 开始自动安装 ESP32 工具链（约 1.5GB，请耐心等待）...');
    sendToolchainProgress('installing', 0, '正在准备 ESP32 工具链，首次需要下载约 1.5GB...');

    return new Promise((resolve) => {
      const args = ['core', 'install', 'esp32:esp32@3.3.11', '--additional-urls', ESP32_ADDITIONAL_URLS, '--no-color'];
      const child = spawn(ARDUINO_CLI, args, {
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let stderrBuf = '';
      let lastProgress = 0;

      child.stderr.on('data', (data) => {
        const text = data.toString();
        stderrBuf += text;
        // arduino-cli 进度格式："Downloading packages: [===>    ] 45% ..."
        // 或 "Downloading esp32:esp32@3.3.11: 12%"
        const m = text.match(/(\d+)%/);
        if (m) {
          const pct = parseInt(m[1], 10);
          if (pct > lastProgress) {
            lastProgress = pct;
            // 下载阶段 0-90%，安装阶段 90-100%
            const mapped = Math.min(90, pct);
            sendToolchainProgress('downloading', mapped, `正在下载 ESP32 工具链... ${mapped}%`);
          }
        }
        // 识别关键阶段
        if (/Installing platform/.test(text)) sendToolchainProgress('installing', 92, '正在安装 ESP32 平台...');
        if (/Installing tool esp32-arduino-libs/.test(text)) sendToolchainProgress('installing', 95, '正在安装 ESP32 库文件...');
        if (/Configuring esp32:esp32/.test(text)) sendToolchainProgress('installing', 98, '正在配置...');
      });
      child.stdout.on('data', (data) => { stderrBuf += data.toString(); });

      child.on('close', (code) => {
        if (code === 0 && isEsp32Installed()) {
          console.log('✅ ESP32 工具链安装完成');
          sendToolchainProgress('done', 100, 'ESP32 工具链安装完成');
          resolve({ installed: true, skipped: false });
        } else {
          const tail = stderrBuf.split('\n').slice(-10).join('\n');
          const msg = `ESP32 工具链安装失败（退出码 ${code}）: ${tail.slice(-500)}`;
          console.error('❌', msg);
          sendToolchainProgress('error', 0, '安装失败，请检查网络后重试');
          resolve({ installed: false, error: msg });
        }
      });
      child.on('error', (err) => {
        const msg = '启动 arduino-cli 失败: ' + err.message;
        console.error('❌', msg);
        sendToolchainProgress('error', 0, msg);
        resolve({ installed: false, error: msg });
      });
    });
  }

  // IPC：手动触发工具链安装（前端"重试"按钮）
  ipcMain.handle('toolchain:ensure', async () => {
    return await ensureEsp32Toolchain();
  });

  function runArduinoCli(args, cwd) {
    return new Promise((resolve) => {
      if (!fs.existsSync(ARDUINO_CLI)) {
        resolve({ success: false, error: 'arduino-cli 鏈壘鍒帮紝璇峰厛瀹夎 Arduino 缂栬瘧鎻掍欢', code: -1 });
        return;
      }
      const child = execFile(ARDUINO_CLI, args, { cwd: cwd || process.cwd(), maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        resolve({ success: !err, error: err ? err.message : '', output, code: err ? (err.code || 1) : 0 });
      });
    });
  }

  /**
   * Arduino sketch 鐩綍瑙勮寖鍖栵細
   * arduino-cli 瑕佹眰涓?.ino 鏂囦欢鍚嶅繀椤讳笌鎵€鍦ㄧ洰褰曞悓鍚嶏紙濡?esp32_robot/esp32_robot.ino锛夈€?
   * 鑻ョ敤鎴风殑 .ino 浣嶄簬涓嶅悓鍚嶇洰褰曪紙濡?PlatformIO 椋庢牸 src/esp32_robot.ino锛夛紝
   * 鑷姩鍒涘缓涓存椂鍚屽悕鐩綍骞跺鍒?sketch 婧愭枃浠讹紝缂栬瘧瀹屾垚鍚庢竻鐞嗐€?
   * @returns {{ target: string, cleanup: string|null, created: boolean }}
   */
  function normalizeSketchDir(sketchPath) {
    if (!sketchPath || !/\.ino$/i.test(sketchPath)) {
      return { target: sketchPath, cleanup: null, created: false };
    }
    const dir = path.dirname(sketchPath);
    const base = path.basename(sketchPath, path.extname(sketchPath));
    if (path.basename(dir) === base) {
      return { target: dir, cleanup: null, created: false };
    }
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'labcode-sketch-'));
    const target = path.join(tmpRoot, base);
    fs.mkdirSync(target, { recursive: true });
    let copied = 0;
    for (const f of fs.readdirSync(dir)) {
      const src = path.join(dir, f);
      const dst = path.join(target, f);
      try {
        if (fs.statSync(src).isFile()) { fs.copyFileSync(src, dst); copied++; }
      } catch (e) { /* 璺宠繃涓嶅彲澶嶅埗椤?*/ }
    }
    return { target, cleanup: tmpRoot, created: copied > 0 };
  }

  ipcMain.handle('compile:arduino', async (_, options) => {
    const { sketchPath, fqbn, outputDir } = options || {};
    if (!sketchPath) return { success: false, error: '缂哄皯 sketchPath' };
    if (!fqbn) return { success: false, error: '缂哄皯 fqbn锛堝紑鍙戞澘鍨嬪彿锛? };
    const norm = normalizeSketchDir(sketchPath);
    const args = ['compile', '--fqbn', fqbn];
    if (outputDir) args.push('--output-dir', outputDir);
    args.push(norm.target);
    const result = await runArduinoCli(args, path.dirname(norm.target));
    if (norm.cleanup) { try { fs.rmSync(norm.cleanup, { recursive: true, force: true }); } catch (e) {} }
    return result;
  });

  ipcMain.handle('compile:upload', async (_, options) => {
    const { sketchPath, fqbn, port } = options || {};
    if (!sketchPath) return { success: false, error: '缂哄皯 sketchPath' };
    if (!fqbn) return { success: false, error: '缂哄皯 fqbn' };
    if (!port) return { success: false, error: '缂哄皯涓插彛锛坧ort锛? };
    const norm = normalizeSketchDir(sketchPath);
    const args = ['upload', '--fqbn', fqbn, '--port', port, norm.target];
    const result = await runArduinoCli(args, path.dirname(norm.target));
    if (norm.cleanup) { try { fs.rmSync(norm.cleanup, { recursive: true, force: true }); } catch (e) {} }
    return result;
  });

  ipcMain.handle('compile:list-cores', async () => {
    return await runArduinoCli(['core', 'list']);
  });

  ipcMain.handle('compile:list-boards', async () => {
    return await runArduinoCli(['board', 'listall']);
  });

  ipcMain.handle('compile:list-ports', async () => {
    return await runArduinoCli(['board', 'list']);
  });

  ipcMain.handle('compile:cli-exists', async () => {
    return { exists: fs.existsSync(ARDUINO_CLI), path: ARDUINO_CLI };
  });

  // ============ 涓插彛鐩戣鍣?============
  let serialMonitorProc = null;   // 褰撳墠鎵撳紑鐨勪覆鍙ｇ洃瑙嗚繘绋?
  let serialMonitorPort = null;
  let serialMonitorBaud = 115200;

  ipcMain.handle('serial:list', async () => {
    // 鐢?arduino-cli board list 鑾峰彇涓插彛
    if (!fs.existsSync(ARDUINO_CLI)) return { success: true, ports: [] };
    return await new Promise((resolve) => {
      execFile(ARDUINO_CLI, ['board', 'list'], { maxBuffer: 5 * 1024 * 1024 }, (err, stdout) => {
        const ports = [];
        if (!err && stdout) {
          // 瑙ｆ瀽杈撳嚭琛岋細Port  Protocol Type  Board Name  FQBN  Core
          const lines = stdout.split('\n').slice(1);
          for (const line of lines) {
            const m = line.match(/(COM\d+)/);
            if (m) {
              const boardMatch = line.match(/^\S+\s+\S+\s+\S+\s+(.+?)\s{2,}/);
              ports.push({ port: m[1], board: boardMatch ? boardMatch[1].trim() : '鏈煡璁惧' });
            }
          }
        }
        resolve({ success: true, ports });
      });
    });
  });

  ipcMain.handle('serial:open', async (_, options) => {
    const { port, baud } = options || {};
    if (!port) return { success: false, error: '缂哄皯涓插彛' };
    if (!fs.existsSync(ARDUINO_CLI)) return { success: false, error: 'arduino-cli 鏈畨瑁? };
    // 鍏抽棴鏃т覆鍙?
    if (serialMonitorProc) {
      try { serialMonitorProc.kill(); } catch (e) {}
      serialMonitorProc = null;
    }
    serialMonitorPort = port;
    serialMonitorBaud = baud || 115200;
    try {
      serialMonitorProc = spawn(ARDUINO_CLI, ['monitor', '-p', port, '-c', 'baudrate=' + serialMonitorBaud], {
        windowsHide: true
      });
    } catch (e) {
      return { success: false, error: e.message };
    }
    // 杈撳嚭杞彂
    serialMonitorProc.stdout.on('data', (data) => {
      const text = data.toString('utf8');
      // 鍐欏叆鍚庡彴鏃ュ織缂撳啿
      text.split(/\r?\n/).forEach(line => {
        if (line.trim()) {
          serialLogBuffer.push({ ts: Date.now(), line });
          if (serialLogBuffer.length > MAX_LOG_LINES) serialLogBuffer.shift();
        }
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial:data', text);
      }
    });
    serialMonitorProc.stderr.on('data', (data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial:data', data.toString('utf8'));
      }
    });
    serialMonitorProc.on('close', (code) => {
      serialMonitorProc = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('serial:closed', { code });
      }
    });
    // 绛夊緟 800ms 鐪嬫槸鍚﹀惎鍔ㄥけ璐?
    await new Promise(r => setTimeout(r, 800));
    if (serialMonitorProc && serialMonitorProc.killed) {
      return { success: false, error: '涓插彛鎵撳紑澶辫触' };
    }
    return { success: true, port, baud: serialMonitorBaud };
  });

  ipcMain.handle('serial:close', async () => {
    if (serialMonitorProc) {
      try { serialMonitorProc.kill(); } catch (e) {}
      serialMonitorProc = null;
    }
    return { success: true };
  });

  ipcMain.handle('serial:write', async (_, data) => {
    if (!serialMonitorProc) return { success: false, error: '涓插彛鏈墦寮€' };
    try {
      serialMonitorProc.stdin.write(data + '\n');
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // ===== 鍚庡彴涓插彛鏃ュ織缂撳啿锛堝榻?TrieCode serialLog锛?====
  const serialLogBuffer = []; // [{ts, line}]
  const MAX_LOG_LINES = 5000;
  // 鎶?serial:data 鐨勮緭鍑哄悓鏃跺啓鍏ョ紦鍐?
  // 锛堝湪 serialMonitorProc.stdout.on 澶?push锛?
  ipcMain.handle('serial:log-tail', async (_, opts) => {
    const n = Math.min((opts && opts.line) || 50, 500);
    return { success: true, lines: serialLogBuffer.slice(-n).map(e => e.line) };
  });
  ipcMain.handle('serial:log-grep', async (_, opts) => {
    if (!opts || !opts.pattern) return { success: false, error: '缂?pattern' };
    const re = new RegExp(opts.pattern, 'i');
    const max = Math.min((opts.max) || 30, 200);
    const hits = serialLogBuffer.filter(e => re.test(e.line)).slice(-max).map(e => e.line);
    return { success: true, lines: hits };
  });
  ipcMain.handle('serial:log-analyze-crash', async () => {
    const patterns = [
      /Guru Meditation|Backtrace:/, /HardFault/, /panic\s*\(/.source, /assertion failed/,
      /segfault|stack overflow|watchdog|out of memory|heap corruption/, /abort\(\)/
    ];
    const matches = serialLogBuffer.filter(e => patterns.some(p => p instanceof RegExp ? p.test(e.line) : new RegExp(p).test(e.line)));
    if (!matches.length) return { success: true, diagnosis: '鏈娴嬪埌宕╂簝绛惧悕' };
    return { success: true, lines: matches.map(m => m.line), diagnosis: '妫€娴嬪埌 ' + matches.length + ' 琛屽穿婧冪浉鍏虫棩蹇? };
  });

  // 澶栭儴閾炬帴
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

  // 搴旂敤淇℃伅
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPath', (_, name) => app.getPath(name));
  ipcMain.handle('app:getPlatform', () => process.platform);

  // ============ 绯荤粺閰嶇疆妫€娴嬶紙澶фā鍨嬫帹鑽愮敤锛?============
  ipcMain.handle('system:getInfo', async () => {
    const cpus = os.cpus();
    const cpuModel = cpus[0] ? cpus[0].model : 'Unknown';
    const totalMemGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    const freeMemGB = Math.round(os.freemem() / 1024 / 1024 / 1024);

    // 纾佺洏鍙敤绌洪棿锛堢敤 PowerShell Get-PSDrive锛屾瘮 wmic 鍙潬锛?
    let diskFreeGB = 0;
    try {
      const { execSync } = require('child_process');
      if (process.platform === 'win32') {
        const out = execSync('powershell -NoProfile -Command "(Get-PSDrive C).Free"', { encoding: 'utf8', timeout: 5000 });
        const free = parseInt(out.trim());
        if (!isNaN(free)) diskFreeGB = Math.round(free / 1024 / 1024 / 1024);
      }
    } catch (e) { console.error('纾佺洏妫€娴嬪け璐?', e.message); }

    // GPU 妫€娴嬶紙蹇€熸柟寮忥細璇绘敞鍐岃〃鎴栫幆澧冨彉閲忥紝閬垮厤鎱㈢殑 CIM 鏌ヨ锛?
    let gpus = [];
    let hasNvidia = false;
    let maxVramGB = 0;
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        // 鐢?nvidia-smi 妫€娴?NVIDIA GPU锛堟洿蹇洿鍑嗙‘锛?
        try {
          const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { encoding: 'utf8', timeout: 5000 });
          const lines = out.trim().split('\n').filter(l => l.trim());
          lines.forEach(line => {
            const parts = line.split(',').map(s => s.trim());
            const name = parts[0] || 'NVIDIA GPU';
            const vram = parseInt(parts[1]) || 0;
            gpus.push({ name, vramGB: Math.round(vram / 1024), driver: 'nvidia' });
            hasNvidia = true;
            maxVramGB = Math.max(maxVramGB, Math.round(vram / 1024));
          });
        } catch (e) { /* 鏃?NVIDIA GPU */ }
        // 濡傛灉娌℃湁 NVIDIA锛岀敤 PowerShell 蹇€熸娴嬪叾浠?GPU
        if (gpus.length === 0) {
          try {
            const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"', { encoding: 'utf8', timeout: 5000 });
            const names = out.trim().split('\n').filter(n => n.trim());
            names.forEach(name => {
              gpus.push({ name: name.trim(), vramGB: 0, driver: 'unknown' });
            });
          } catch (e) { /* GPU 妫€娴嬪け璐?*/ }
        }
      }
    } catch (e) { console.error('GPU 妫€娴嬪け璐?', e.message); }

    return {
      cpu: { model: cpuModel, cores: cpus.length },
      memory: { totalGB: totalMemGB, freeGB: freeMemGB },
      disk: { freeGB: diskFreeGB },
      gpus,
      hasNvidia,
      maxVramGB,
      platform: process.platform,
      arch: process.arch
    };
  });

  // ============ 鏈湴澶фā鍨嬪紩鎿庯紙llama.cpp锛屽唴缃紝鏃犻渶 Ollama锛?===========
  // 寮曟搸鐩綍锛歳esources/llama锛堝畨瑁呭寘鍐呯疆锛夛紱妯″瀷鐩綍锛欴:\LabCode\models锛堟彃浠跺競鍦轰笅杞斤級
  function getEngineDir() {
    // 寮€鍙戞ā寮忥細D:\LabCode\runtime\llama-cpp-*锛涙墦鍖呭悗锛歳esources/llama
    const candidates = [
      path.join(process.resourcesPath, 'llama'),           // 鎵撳寘鍚庡唴缃?
      path.join(__dirname, '..', 'resources', 'llama'),    // 寮€鍙戠洰褰?
      'D:\\LabCode\\runtime\\llama-cpp-vulkan',            // 鏈満楠岃瘉鐩綍
      'D:\\LabCode\\runtime\\llama-cpp-cpu'
    ];
    for (const c of candidates) {
      try { if (fs.existsSync(path.join(c, 'llama-server.exe'))) return c; } catch (e) {}
    }
    return '';
  }

  function getModelsDir() {
    // 妯″瀷缁熶竴鏀?D:\LabCode\models锛堝悗缁敼涓虹敤鎴锋暟鎹洰褰曪級
    return 'D:\\LabCode\\models';
  }

  function scanLocalModels() {
    const dir = getModelsDir();
    const models = [];
    // 鍙嬪ソ鏄剧ず鍚嶆槧灏勶紙瀵规壂鎻忓埌鐨?GGUF 鏂囦欢鍚嶅仛鍙鍖栵級
    const friendlyName = (f) => {
      const base = f.replace(/\.gguf$/i, '');
      const lower = base.toLowerCase();
      if (lower.includes('qwen3.5') || lower.includes('qwen-3.5')) return 'Qwen3.5-9B (Q4_K_M)';
      if (lower.includes('qwen2.5-coder-14b')) return 'Qwen2.5-Coder 14B';
      if (lower.includes('qwen2.5-coder-7b')) return 'Qwen2.5-Coder 7B';
      if (lower.includes('qwen2.5-coder-1.5b')) return 'Qwen2.5-Coder 1.5B';
      return base;
    };
    try {
      if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(f => {
          if (f.toLowerCase().endsWith('.gguf')) {
            const full = path.join(dir, f);
            const stat = fs.statSync(full);
            models.push({ file: f, name: friendlyName(f), sizeGB: (stat.size / 1024 / 1024 / 1024) });
          }
        });
      }
    } catch (e) { console.error('鎵弿鏈湴妯″瀷澶辫触:', e.message); }
    return models;
  }

  // 妫€娴?llama 寮曟搸鏄惁杩愯锛?080 OpenAI 鍏煎绔偣锛?
  async function isEngineRunning() {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await net.fetch('http://127.0.0.1:8080/health', { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch (e) { return false; }
  }

  // 妫€娴嬫湰鍦板ぇ妯″瀷杩愯鏃讹紙LabCode 鍐呯疆 llama 寮曟搸锛?
  let currentEngineModel = null;
  ipcMain.handle('system:checkLLMRuntime', async () => {
    const result = { engine: false, engineVersion: null, engineRunning: false, models: [], engineDir: '', runningModel: '' };
    try {
      const engineDir = getEngineDir();
      if (engineDir) {
        result.engine = true;
        result.engineDir = engineDir;
        try {
          const verFile = path.join(engineDir, '..', '..', 'llama-version.txt');
          if (fs.existsSync(verFile)) result.engineVersion = fs.readFileSync(verFile, 'utf8').trim();
        } catch (e) {}
        if (!result.engineVersion) result.engineVersion = '鍐呯疆寮曟搸锛坙lama.cpp锛?;
      }
      result.engineRunning = await isEngineRunning();
      result.models = scanLocalModels();
      result.runningModel = currentEngineModel || '';
    } catch (e) { console.error('LLM 杩愯鏃舵娴嬪け璐?', e.message); }
    return result;
  });

  // 鍚姩 llama 寮曟搸锛堝姞杞芥寚瀹氭ā鍨嬶級
  let engineProcess = null;
  async function startEngineInternal(modelFile) {
    try {
      // 寮烘潃鎵€鏈夋畫鐣?llama 杩涚▼锛氳鐩栧畨瑁呭悗鏃у疄渚嬶紙鏂囦欢宸茶鏇挎崲锛変細鍋囨椿/鍗?8080锛?
      // 瀵艰嚧 health 鎺㈡祴鎴愬姛浣嗗疄闄呰姹?ERR_CONNECTION_REFUSED銆?
      try { execSync('taskkill /IM llama-server.exe /F', { stdio: 'ignore' }); } catch (ke) {}
      await new Promise(r => setTimeout(r, 800));
      const engineDir = getEngineDir();
      if (!engineDir) return { success: false, error: '鏈壘鍒板唴缃紩鎿庯紝璇烽噸鏂板畨瑁?LabCode' };
      const serverExe = path.join(engineDir, 'llama-server.exe');
      if (!fs.existsSync(serverExe)) return { success: false, error: '寮曟搸鏂囦欢缂哄け: llama-server.exe' };

      // 閫夋ā鍨嬶細浼樺厛鎸囧畾锛屽惁鍒欏彇 models 鐩綍绗竴涓?
      let modelPath = '';
      const modelsDir = getModelsDir();
      if (modelFile) modelPath = path.join(modelsDir, modelFile);
      if (!fs.existsSync(modelPath)) {
        const models = scanLocalModels();
        if (models.length > 0) modelPath = path.join(modelsDir, models[0].file);
      }
      if (!fs.existsSync(modelPath)) return { success: false, error: '鏈壘鍒版ā鍨嬶紝璇峰厛鍦ㄦ彃浠跺競鍦哄畨瑁呭ぇ妯″瀷' };

      if (engineProcess) { try { engineProcess.kill(); } catch (e) {} engineProcess = null; }
      currentEngineModel = null;

      const { spawn } = require('child_process');
      engineProcess = spawn(serverExe, [
        '-m', modelPath,
        '--host', '127.0.0.1',
        '--port', '8080',
        '-ngl', '99',          // 鍏ㄥ眰 GPU锛堟棤鐙樉鑷姩鍥為€€ CPU锛?
        '-c', '16384',         // 涓婁笅鏂囷細16K锛屼负鎬濊€冩祦锛坮easoning锛? 姝ｆ枃棰勭暀绌洪棿锛?B 鍐呭瓨鍏呰冻锛?
        '--jinja'              // 浣跨敤 GGUF 鍐呭祵鑱婂ぉ妯℃澘锛圦wen 绛夛級
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      engineProcess.stdout.on('data', d => { const s = String(d); if (s.includes('server is listening') || s.includes('HTTP server')) console.log('[LLM寮曟搸] 鍚姩鎴愬姛'); });
      engineProcess.stderr.on('data', d => console.error('[LLM寮曟搸]', String(d).slice(0, 300)));
      engineProcess.on('exit', () => { engineProcess = null; currentEngineModel = null; });

      // 绛夊緟寮曟搸灏辩华锛堟渶澶?60s锛屽ぇ妯″瀷鍔犺浇闇€鏃堕棿锛?
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await isEngineRunning()) {
          currentEngineModel = path.basename(modelPath);
          return { success: true, model: path.basename(modelPath), url: 'http://127.0.0.1:8080/v1' };
        }
      }
      return { success: false, error: '寮曟搸鍚姩瓒呮椂锛堟ā鍨嬪姞杞界紦鎱㈡垨鏄惧瓨涓嶈冻锛? };
    } catch (e) {
      return { success: false, error: '鍚姩寮曟搸澶辫触: ' + (e.message || String(e)) };
    }
  }
  ipcMain.handle('system:startLLMEngine', async (_, opts) => startEngineInternal((opts || {}).modelFile));

  // 鍋滄 llama 寮曟搸
  ipcMain.handle('system:stopLLMEngine', async () => {
    try {
      try { execSync('taskkill /IM llama-server.exe /F', { stdio: 'ignore' }); } catch (ke) {}
      if (engineProcess) { engineProcess.kill(); engineProcess = null; }
      currentEngineModel = null;
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });

  // 妫€娴嬫湰鍦板ぇ妯″瀷杩愯鏃讹紙鍏煎鏃ц皟鐢細杩斿洖 ollama 瀛楁 + 鏂板紩鎿庡瓧娈碉級
  ipcMain.handle('system:checkLLMRuntimeLegacy', async () => {
    const result = { ollama: false, ollamaVersion: null, ollamaRunning: false, models: [] };
    try {
      const { execSync } = require('child_process');
      try {
        const ver = execSync('ollama --version', { encoding: 'utf8', timeout: 5000 });
        result.ollama = true;
        result.ollamaVersion = ver.trim();
      } catch (e) { /* ollama 鏈畨瑁?*/ }
      if (result.ollama) {
        try {
          const list = execSync('ollama list', { encoding: 'utf8', timeout: 5000 });
          result.ollamaRunning = true;
          const lines = list.trim().split('\n').slice(1);
          result.models = lines.map(l => {
            const parts = l.split(/\s+/);
            return { name: parts[0], id: parts[1] ? parts[1].substring(0, 12) : '', size: parts[2] || '' };
          }).filter(m => m.name);
        } catch (e) { /* ollama 鏈繍琛?*/ }
      }
    } catch (e) { console.error('LLM 杩愯鏃舵娴嬪け璐?', e.message); }
    return result;
  });

  // 浠ｇ悊璁剧疆
  ipcMain.handle('proxy:set', async (_, proxyConfig) => {
    try {
      if (proxyConfig.mode === 'manual' && proxyConfig.host) {
        await mainWindow.webContents.session.setProxy({
          proxyRules: `${proxyConfig.host}:${proxyConfig.port || 8080}`
        });
      } else if (proxyConfig.mode === 'system') {
        await mainWindow.webContents.session.setProxy({ mode: 'system' });
      } else {
        await mainWindow.webContents.session.setProxy({ mode: 'direct' });
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

// ============ 鑷姩鏇存柊 ============
function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('update:available', info);
    });

    autoUpdater.on('update-not-available', () => {
      mainWindow?.webContents.send('update:not-available');
    });

    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('update:progress', progress);
    });

    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('update:downloaded', info);
      // 强制更新：下载完 3 秒后自动重启安装
      setTimeout(() => autoUpdater.quitAndInstall(), 3000);
    });

    autoUpdater.on('error', (error) => {
      console.error('鑷姩鏇存柊閿欒:', error.message);
    });

    ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
    ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
    ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

        // 启动后 5 秒检查更新
    setTimeout(() => {
      if (!isDev) autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);

    // 每 1 小时定时检查
    setInterval(() => {
      if (!isDev) autoUpdater.checkForUpdates().catch(() => {});
    }, 60 * 60 * 1000);

  } catch (e) {
    console.warn('鑷姩鏇存柊妯″潡鍔犺浇澶辫触:', e.message);
  }
}

// ============ 搴旂敤鐢熷懡鍛ㄦ湡 ============
app.whenReady().then(() => {
  console.log('馃殌 LabCode 鍚姩涓?..');
  console.log('馃搧 鐢ㄦ埛鏁版嵁鐩綍:', USER_DATA_PATH);
  console.log('馃敡 寮€鍙戞ā寮?', isDev);

  createMenu();
  setupIPC();
  setupAutoUpdate();
  createMainWindow();

  // 首次启动自动安装 ESP32 工具链（异步，不阻塞 UI）
  ensureEsp32Toolchain();

  // 鍚姩宸查厤缃殑 MCP 鏈嶅姟鍣紙stdio锛?
  try {
    require('./mcp').getMcpService().startAll();
    console.log('馃З MCP 鏈嶅姟鍣ㄦ鏌ュ畬鎴?);
  } catch (e) {
    console.error('MCP 鍚姩澶辫触:', e.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  saveConfig(config);
  // 娓呯悊鎵€鏈夌粓绔?
  try {
    terminalService.destroyAll();
    console.log('鎵€鏈夌粓绔凡娓呯悊');
  } catch (e) {
    console.error('娓呯悊缁堢澶辫触:', e);
  }
  // 娓呯悊 MCP 鏈嶅姟鍣ㄨ繘绋?
  try {
    require('./mcp').getMcpService().stopAll();
    console.log('MCP 鏈嶅姟鍣ㄥ凡娓呯悊');
  } catch (e) {
    console.error('娓呯悊 MCP 澶辫触:', e);
  }
});

// 闃叉 GPU 杩涚▼宕╂簝
app.on('gpu-process-crashed', (event, killed) => {
  console.error('GPU 杩涚▼宕╂簝:', killed);
});
