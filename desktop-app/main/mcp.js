// ============ LabCode MCP 客户端管理器 ============
// MCP（Model Context Protocol）stdio 接入：spawn MCP 服务器进程，
// JSON-RPC 2.0 over stdio（initialize → tools/list → tools/call）
// 服务器二进制/大文件不落地本地仓库，配置指向外部命令（如 npx github 包）

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 默认配置路径与 index.js 保持一致（通过 setConfigPath 注入）
let configPath = '';
let configGetter = null; // () => config 对象
let configSaver = null;  // (config) => bool

function initMcp({ getConfig, saveConfig }) {
  configGetter = getConfig;
  configSaver = saveConfig;
}

// 单例
let instance = null;

function getMcpService() {
  if (!instance) instance = new McpService();
  return instance;
}

class McpService {
  constructor() {
    this.servers = new Map(); // name -> { proc, status, tools, stderr, buffer, pending, startedAt }
    this.reqId = 0;
  }

  _config() {
    if (configGetter) return configGetter();
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch (e) {
      return { extra: { mcpServers: [] } };
    }
  }

  _save(cfg) {
    if (configSaver) return configSaver(cfg);
    try { fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf-8'); return true; }
    catch (e) { return false; }
  }

  _serverConfigs() {
    const cfg = this._config();
    return (cfg && cfg.extra && Array.isArray(cfg.extra.mcpServers)) ? cfg.extra.mcpServers : [];
  }

  // ---- 生命周期 ----
  startServer(serverCfg) {
    const name = serverCfg.name;
    if (!name || !serverCfg.command) return { ok: false, error: '缺少 name 或 command' };
    if (this.servers.has(name)) {
      const s = this.servers.get(name);
      return { ok: s.status === 'running', status: s.status, error: s.status === 'running' ? '已在运行' : undefined };
    }

    const args = Array.isArray(serverCfg.args) ? serverCfg.args : [];
    const env = Object.assign({}, process.env, serverCfg.env || {});
    let proc;
    try {
      proc = spawn(serverCfg.command, args, {
        env,
        cwd: serverCfg.cwd || undefined,
        shell: /^(npx|npm|node|python|python3)$/i.test(serverCfg.command) ? false : undefined,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (e) {
      return { ok: false, error: '启动失败: ' + e.message };
    }

    const entry = {
      proc, status: 'starting', tools: [], stderr: '',
      buffer: '', pending: new Map(), startedAt: Date.now()
    };
    this.servers.set(name, entry);

    proc.stdout.on('data', (chunk) => this._onData(name, chunk.toString()));
    proc.stderr.on('data', (chunk) => {
      entry.stderr = (entry.stderr + chunk.toString()).slice(-4000);
    });
    proc.on('error', (err) => {
      entry.status = 'error';
      entry.stderr = (entry.stderr + '\n' + err.message).slice(-4000);
    });
    proc.on('exit', (code, signal) => {
      entry.status = 'exited';
      entry.exitInfo = { code, signal };
      // 清掉所有 pending
      entry.pending.forEach((p) => p.reject(new Error('MCP 服务器进程已退出')));
      entry.pending.clear();
      // 延迟从 map 移除（保留状态供 UI 展示），标记 exitedAt
      entry.exitedAt = Date.now();
    });

    // 发送 initialize
    this._request(name, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'LabCode', version: '1.0.0' }
    }, 15000).then(() => {
      // 发 initialized 通知
      this._notify(name, 'notifications/initialized', {});
      entry.status = 'running';
      return this._request(name, 'tools/list', {}, 15000);
    }).then((res) => {
      entry.tools = (res && Array.isArray(res.tools)) ? res.tools : [];
      entry.status = 'running';
      return { ok: true, status: 'running', tools: entry.tools.length };
    }).catch((err) => {
      entry.status = 'error';
      entry.stderr = (entry.stderr + '\n' + err.message).slice(-4000);
      return { ok: false, status: 'error', error: err.message };
    });

    return { ok: true, status: 'starting' };
  }

  startAll() {
    const results = [];
    this._serverConfigs().forEach((cfg) => {
      results.push({ name: cfg.name, ...this.startServer(cfg) });
    });
    return results;
  }

  stopServer(name) {
    const s = this.servers.get(name);
    if (!s) return { ok: false, error: '未找到服务器' };
    try { s.proc.kill(); } catch (e) {}
    this.servers.delete(name);
    return { ok: true };
  }

  stopAll() {
    Array.from(this.servers.keys()).forEach((n) => this.stopServer(n));
  }

  // ---- 配置管理 ----
  listServers() {
    const cfgs = this._serverConfigs();
    return cfgs.map((c) => {
      const s = this.servers.get(c.name);
      return {
        name: c.name,
        command: c.command,
        args: c.args || [],
        status: s ? s.status : 'stopped',
        tools: s ? (s.tools || []).length : 0,
        stderr: s ? (s.stderr || '').slice(-500) : ''
      };
    });
  }

  addServer(serverCfg) {
    const cfg = this._config();
    if (!cfg.extra) cfg.extra = {};
    if (!Array.isArray(cfg.extra.mcpServers)) cfg.extra.mcpServers = [];
    if (cfg.extra.mcpServers.some((s) => s.name === serverCfg.name)) {
      return { ok: false, error: '同名服务器已存在' };
    }
    cfg.extra.mcpServers.push({
      name: serverCfg.name, command: serverCfg.command,
      args: serverCfg.args || [], env: serverCfg.env || {}, cwd: serverCfg.cwd || ''
    });
    if (!this._save(cfg)) return { ok: false, error: '保存配置失败' };
    return this.startServer(serverCfg);
  }

  removeServer(name) {
    this.stopServer(name);
    const cfg = this._config();
    if (cfg.extra && Array.isArray(cfg.extra.mcpServers)) {
      cfg.extra.mcpServers = cfg.extra.mcpServers.filter((s) => s.name !== name);
      return this._save(cfg);
    }
    return true;
  }

  listTools(name) {
    const s = this.servers.get(name);
    if (!s) return { ok: false, error: '服务器未启动' };
    if (s.status === 'running') return { ok: true, tools: s.tools };
    // 未运行则尝试启动后等待
    return { ok: false, error: '服务器状态: ' + s.status };
  }

  async callTool(serverName, toolName, args) {
    const res = await this._request(serverName, 'tools/call', { name: toolName, arguments: args || {} }, 120000);
    if (res && res.isError) {
      const text = this._extractText(res);
      return { ok: false, error: text || '工具执行返回错误' };
    }
    return { ok: true, text: this._extractText(res) };
  }

  _extractText(res) {
    if (!res) return '';
    if (Array.isArray(res.content)) {
      return res.content.map((c) => {
        if (c.type === 'text') return c.text || '';
        if (c.type === 'image') return '[图片] ' + (c.mimeType || '');
        return JSON.stringify(c);
      }).join('\n');
    }
    if (res.result !== undefined) return JSON.stringify(res.result);
    return JSON.stringify(res);
  }

  // ---- JSON-RPC 底层 ----
  _request(serverName, method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const s = this.servers.get(serverName);
      if (!s) return reject(new Error('MCP 服务器不存在: ' + serverName));
      if (s.status === 'exited') return reject(new Error('MCP 服务器已退出: ' + serverName));
      const id = ++this.reqId;
      const timer = setTimeout(() => {
        s.pending.delete(id);
        reject(new Error(method + ' 请求超时 (' + (timeoutMs / 1000) + 's)'));
      }, timeoutMs || 30000);
      s.pending.set(id, { resolve, reject, timer });
      this._write(s, { jsonrpc: '2.0', id, method, params });
    });
  }

  _notify(serverName, method, params) {
    const s = this.servers.get(serverName);
    if (!s) return;
    this._write(s, { jsonrpc: '2.0', method, params });
  }

  _write(s, obj) {
    try {
      s.proc.stdin.write(JSON.stringify(obj) + '\n');
    } catch (e) {
      s.status = 'error';
      s.stderr = (s.stderr + '\n' + e.message).slice(-4000);
    }
  }

  _onData(serverName, text) {
    const s = this.servers.get(serverName);
    if (!s) return;
    s.buffer += text;
    // 按行解析
    let idx;
    while ((idx = s.buffer.indexOf('\n')) >= 0) {
      const line = s.buffer.slice(0, idx).trim();
      s.buffer = s.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (e) { continue; }
      if (msg && msg.id !== undefined && s.pending.has(msg.id)) {
        const p = s.pending.get(msg.id);
        s.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.reject(new Error(msg.error.message || 'MCP 错误'));
        else p.resolve(msg.result !== undefined ? msg.result : msg);
      }
      // 服务端通知（tools/list_changed 等）忽略
    }
  }
}

module.exports = { getMcpService, initMcp };
