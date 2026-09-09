// ============ LabCode Electron 主进程 ============
// 基于 TrieCode 源码逆向分析：窗口管理 / IPC / 自动更新 / 代理 / 会话存储

const { app, BrowserWindow, ipcMain, Menu, shell, dialog, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 终端服务
const { getTerminalService } = require('./terminal');
const terminalService = getTerminalService();

// 全局变量
let mainWindow = null;
let isDev = process.argv.includes('--dev');

// 用户数据目录
const USER_DATA_PATH = app.getPath('userData');
const CONFIG_PATH = path.join(USER_DATA_PATH, 'config.json');
const SESSIONS_PATH = path.join(USER_DATA_PATH, 'sessions');

// 确保目录存在
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
ensureDir(SESSIONS_PATH);

// ============ 配置存储 ============
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('加载配置失败:', e.message);
  }
  return getDefaultConfig();
}

function getDefaultConfig() {
  return {
    ai: {
      provider: 'deepseek',
      model: 'deepseek-v4',
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
      mcpServers: [],
      hooks: {}
    }
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('保存配置失败:', e.message);
    return false;
  }
}

let config = loadConfig();

// ============ 会话存储 ============
function loadSessions() {
  try {
    const files = fs.readdirSync(SESSIONS_PATH).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const content = JSON.parse(fs.readFileSync(path.join(SESSIONS_PATH, f), 'utf-8'));
      return { id: f.replace('.json', ''), ...content };
    }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch (e) {
    console.error('加载会话失败:', e.message);
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
    console.error('保存会话失败:', e.message);
    return false;
  }
}

function deleteSession(id) {
  try {
    const filePath = path.join(SESSIONS_PATH, `${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    console.error('删除会话失败:', e.message);
    return false;
  }
}

// ============ 窗口管理 ============
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
      webSecurity: true
    }
  });

  // 加载渲染进程
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 显示窗口（ready-to-show 时最大化）
  mainWindow.once('ready-to-show', () => {
    if (windowConfig.maximized) mainWindow.maximize();
  });
  
  // 兜底：3秒后强制显示窗口（防止 ready-to-show 不触发）
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('兜底显示窗口');
      mainWindow.show();
    }
  }, 3000);

  // 窗口大小变化保存
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

  // 开发模式打开 DevTools
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
}

// ============ 菜单 ============
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '新建项目', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:new-project') },
        { label: '打开项目', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu:open-project') },
        { type: 'separator' },
        { label: '保存', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu:save') },
        { label: '另存为', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow?.webContents.send('menu:save-as') },
        { type: 'separator' },
        { role: 'quit', label: '退出' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        { label: '文档', click: () => shell.openExternal('https://www.LabCode.com/docs') },
        { label: '官网', click: () => shell.openExternal('https://www.LabCode.com') },
        { type: 'separator' },
        { label: '关于 LabCode', click: () => showAboutDialog() }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 LabCode',
    message: 'LabCode v1.0.0',
    detail: '通用 AI 软件开发智能体\n\n内置真正动手的 AI 智能体：读写代码、执行命令、运行测试、联网检索。\n\n© 2026 LabCode Team. All rights reserved.',
    buttons: ['确定']
  });
}

// ============ IPC 接口 ============
function setupIPC() {
  // 窗口控制
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
    return mainWindow?.isMaximized();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

  // 配置
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

  // 会话
  ipcMain.handle('sessions:list', () => loadSessions());
  ipcMain.handle('sessions:save', (_, session) => saveSession(session));
  ipcMain.handle('sessions:delete', (_, id) => deleteSession(id));

  // 文件操作
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: '所有文件', extensions: ['*'] },
        { name: '代码文件', extensions: ['js', 'ts', 'py', 'cpp', 'c', 'ino', 'rs', 'go', 'java'] }
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

  // 文件读写（带编码自动检测：UTF-8 BOM / 纯UTF-8 / GBK 回退）
  ipcMain.handle('fs:readFile', (_, filePath) => {
    try {
      const buf = fs.readFileSync(filePath);
      // 1) UTF-8 BOM 直接按 UTF-8
      if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        return { success: true, content: buf.toString('utf-8').replace(/^\uFEFF/, ''), encoding: 'utf-8' };
      }
      // 2) 尝试严格 UTF-8 解码（TextDecoder fatal 模式）
      try {
        const td = new TextDecoder('utf-8', { fatal: true });
        const content = td.decode(buf);
        // 无 BOM 但纯 ASCII/UTF-8 时直接返回
        return { success: true, content, encoding: 'utf-8' };
      } catch (utfErr) {
        // 3) UTF-8 解码失败 → GBK（覆盖中文 Windows 常见 GB2312/GBK 编码文件）
        const iconv = (() => {
          try { return require('iconv-lite'); } catch (e) { return null; }
        })();
        if (iconv) {
          return { success: true, content: iconv.decode(buf, 'gbk'), encoding: 'gbk' };
        }
        // 无 iconv-lite 时的回退：手动 GBK→UTF-8 表不现实，用 latin1 兜底
        return { success: true, content: buf.toString('utf-8'), encoding: 'utf-8(疑似GBK)' };
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

  // ============ 终端 IPC ============
  
  // 创建终端
  ipcMain.handle('terminal:create', (_, options = {}) => {
    try {
      const terminal = terminalService.createTerminal(options);
      
      // 监听终端数据输出，通过 webContents 发送到渲染进程
      terminalService.onData(terminal.id, (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:data:${terminal.id}`, data);
        }
      });
      
      // 监听终端退出
      terminalService.onExit(terminal.id, ({ exitCode, signal }) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`terminal:exit:${terminal.id}`, { exitCode, signal });
        }
      });
      
      return { success: true, terminal };
    } catch (e) {
      console.error('创建终端失败:', e);
      return { success: false, error: e.message };
    }
  });
  
  // 向终端写入数据
  ipcMain.handle('terminal:write', (_, id, data) => {
    try {
      terminalService.write(id, data);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 调整终端大小
  ipcMain.handle('terminal:resize', (_, id, cols, rows) => {
    try {
      terminalService.resize(id, cols, rows);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 获取终端缓冲区
  ipcMain.handle('terminal:getBuffer', (_, id) => {
    try {
      const buffer = terminalService.getBuffer(id);
      return { success: true, buffer };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 清除终端缓冲区
  ipcMain.handle('terminal:clearBuffer', (_, id) => {
    try {
      terminalService.clearBuffer(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 杀死终端
  ipcMain.handle('terminal:kill', (_, id) => {
    try {
      terminalService.kill(id);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 获取终端列表
  ipcMain.handle('terminal:list', () => {
    try {
      const terminals = terminalService.listTerminals();
      return { success: true, terminals };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  
  // 执行命令（一次性执行）
  ipcMain.handle('terminal:execute', async (_, command, cwd, timeout) => {
    try {
      const result = await terminalService.executeCommand(command, cwd, timeout);
      return result;
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // 外部链接
  ipcMain.handle('shell:openExternal', (_, url) => shell.openExternal(url));

  // 应用信息
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getPath', (_, name) => app.getPath(name));
  ipcMain.handle('app:getPlatform', () => process.platform);

  // 代理设置
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

// ============ 自动更新 ============
function setupAutoUpdate() {
  try {
    const { autoUpdater } = require('electron-updater');

    autoUpdater.autoDownload = false;
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

    autoUpdater.on('update-downloaded', () => {
      mainWindow?.webContents.send('update:downloaded');
    });

    autoUpdater.on('error', (error) => {
      console.error('自动更新错误:', error.message);
    });

    ipcMain.handle('update:check', () => autoUpdater.checkForUpdates());
    ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
    ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());

    // 启动后 5 秒检查更新
    setTimeout(() => {
      if (!isDev) autoUpdater.checkForUpdates().catch(() => {});
    }, 5000);

  } catch (e) {
    console.warn('自动更新模块加载失败:', e.message);
  }
}

// ============ 应用生命周期 ============
app.whenReady().then(() => {
  console.log('🚀 LabCode 启动中...');
  console.log('📁 用户数据目录:', USER_DATA_PATH);
  console.log('🔧 开发模式:', isDev);

  createMenu();
  setupIPC();
  setupAutoUpdate();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  saveConfig(config);
  // 清理所有终端
  try {
    terminalService.destroyAll();
    console.log('所有终端已清理');
  } catch (e) {
    console.error('清理终端失败:', e);
  }
});

// 防止 GPU 进程崩溃
app.on('gpu-process-crashed', (event, killed) => {
  console.error('GPU 进程崩溃:', killed);
});
