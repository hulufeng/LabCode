// ============================================================
// 插件系统（对齐 TrieCode manifest 架构）
// ------------------------------------------------------------
// 一个插件 = 一个目录，目录里有 plugin.json：
//   {
//     "id": "my-plugin",
//     "name": "...",
//     "version": "0.1.0",
//     "description": "...",
//     "tools": [
//       {
//         "name": "greet",            // 实际注册名自动加 {id}_ 前缀，除非已带
//         "description": "...",
//         "parameters": { "type":"object","properties":{...}, "required":[...] },
//         "category": "query",         // query | modify | execute | delete
//         "transport": "internal",     // 第一阶段只支持 internal
//         "internal": { "service":"demo", "method":"greet" }
//       }
//     ],
//     "skills": [ { "name":"...", "description":"...", "prompt":"...", "metadata": { "keywords": ["..."] }, "references": ["..."] } ],
    // 技能遵循 Hermes SKILL.md 规范：frontmatter(name/description/metadata.keywords) + 可选 references（懒加载参考文档）
//     "projectTypes": [ ... ],
//     "views": [ ... ],
//     "dependencies": [ ... ]
//   }
//
// transport 路线图（对齐 TrieCode 7 通道）：
//   ✅ internal —— 调用宿主预注册的 service 函数（本阶段实现）
//   🔜 cli      —— spawn 外部命令，占位符 {argName}/{settings.x}/{projectPath}
//   🔜 http     —— REST fetch
//   🔜 mcp      —— MCP server stdio/websocket
//   🔜 grpc     —— 插件自带 daemon
//   🔜 stdio    —— JSON-RPC 子进程后端
//   🔜 mqtt     —— IoT 桥
// ============================================================

/**
 * 内置 service 注册表。插件 manifest 里写 internal:{service,method}，
 * 运行时在这里找到对应函数执行。宿主预注册：arduinoCli / terminal / demo 等。
 */
const INTERNAL_SERVICES = new Map();
function registerInternalService(name, methods) {
  INTERNAL_SERVICES.set(name, methods || {});
}

/**
 * 运行时工具注册表。BUILTIN 来自 app.js 硬编码；PLUGIN 来自 manifest。
 * getToolDef(name) / _buildToolDefs() 读这里。
 */
const PLUGIN_TOOL_DEFS = [];   // {name, description, parameters, category, execute}
const PLUGIN_REGISTRY = new Map(); // id -> manifest
const PLUGIN_SKILLS = [];        // {name, description, prompt, pluginId}
const PLUGIN_VIEWS = new Map();  // "pluginId:viewId" -> {pluginId,id,title,webviewUrl}

/**
 * 把 plugin.json 清单加载进运行时。
 * @param {object} manifest
 * @returns {loaded:{tools:number, skills:number, errors:string[]}}
 */
function loadPluginManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return { loaded: { tools: 0, skills: 0, errors: ['manifest 不是对象'] } };
  }
  const id = manifest.id;
  if (!id) {
    return { loaded: { tools: 0, skills: 0, errors: ['manifest 缺 id'] } };
  }
  // 幂等：先清掉同 id 旧工具
  for (let i = PLUGIN_TOOL_DEFS.length - 1; i >= 0; i--) {
    if (PLUGIN_TOOL_DEFS[i]._pluginId === id) PLUGIN_TOOL_DEFS.splice(i, 1);
  }
  for (let i = PLUGIN_SKILLS.length - 1; i >= 0; i--) {
    if (PLUGIN_SKILLS[i].pluginId === id) PLUGIN_SKILLS.splice(i, 1);
  }

  let toolCount = 0, skillCount = 0;

  // ---- tools ----
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  for (const t of tools) {
    try {
      // 工具名自动加 plugin_<id>_ 前缀，对齐 TrieCode
      const autoName = t.name && !t.name.startsWith('plugin_' + id + '_')
        ? `plugin_${id}_${t.name}`
        : (t.name || `plugin_${id}_tool`);

      const toolDef = {
        name: autoName,
        description: t.description || '',
        parameters: t.parameters || { type: 'object', properties: {} },
        category: t.category || 'query',
        _pluginId: id,
        execute: async (args) => {
          const a = args || {};
          const transport = t.transport || 'internal';
          try {
            if (transport === 'internal') {
              const svcName = t.internal && t.internal.service;
              const method = t.internal && t.internal.method;
              const svc = INTERNAL_SERVICES.get(svcName);
              if (!svc || typeof svc[method] !== 'function') {
                return `Error: 内部服务 ${svcName}.${method} 未注册`;
              }
              return await svc[method](a, t);
            }
            if (transport === 'cli') {
              // t.cli = { command: "arduino-cli core {core}", timeoutMs: 600000, cwd: "{projectPath}", resolve: "arduino-cli" }
              const cli = t.cli || {};
              let cmdTpl = cli.command || '';
              // resolve: 用宿主已有的路径解析器替换命令首段
              if (cli.resolve && window.LabCode && window.LabCode.toolchain) {
                try {
                  if (cli.resolve === 'arduino-cli' && window.LabCode.toolchain.getArduinoCliPath) {
                    const p = await window.LabCode.toolchain.getArduinoCliPath();
                    if (p && p.path) {
                      // 把命令首段（arduino-cli）替换成完整路径
                      cmdTpl = cmdTpl.replace(/^"arduino-cli"/, '"' + p.path + '"').replace(/^arduino-cli/, '"' + p.path + '"');
                    }
                  }
                } catch (e) { /* 解析失败就用原命令 */ }
              }
              // 模板替换：{argName} 来自参数，{projectPath} 来自当前工程
              const projectPath = (window.LabCodeUI && window.LabCodeUI.state && window.LabCodeUI.state.projectPath) || '';
              const ctx = Object.assign({}, a, { projectPath });
              const cmd = cmdTpl.replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m));
              if (!cmd) return 'Error: cli.command 未配置';
              // cli.envScript: 先 source 环境脚本（如 ESP-IDF export.ps1）再跑命令
              let finalCmd = cmd;
              if (cli.envScript) {
                const script = cli.envScript.replace(/\\/g, '/');
                if (/\.ps1$/i.test(script)) {
                  finalCmd = `powershell -NoProfile -ExecutionPolicy Bypass -Command "& '${script}'; ${cmd.replace(/"/g, '\\"')}"`;
                } else {
                  finalCmd = `source '${script}' && ${cmd}`;
                }
              }
              const exec = window.LabCode && window.LabCode.terminal && window.LabCode.terminal.execute;
              if (!exec) return 'Error: terminal.execute 不可用';
              const r = await exec(finalCmd, projectPath || undefined, cli.timeoutMs || 120000);
              if (r && r.success) {
                return (r.stdout || '') + (r.stderr ? '\n[stderr]\n' + r.stderr : '');
              }
              return `Error (exit ${r && r.exitCode}): ${r && r.stderr || r && r.error || 'unknown'}\n${r && r.stdout || ''}`;
            }
            if (transport === 'http') {
              const http = t.http || {};
              const urlTpl = http.url || '';
              const projectPath = (window.LabCodeUI && window.LabCodeUI.state && window.LabCodeUI.state.projectPath) || '';
              const ctx = Object.assign({}, a, { projectPath });
              const url = urlTpl.replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? encodeURIComponent(ctx[k]) : m));
              const method = (http.method || 'POST').toUpperCase();
              const opts = { method, headers: Object.assign({ 'Content-Type': 'application/json' }, http.headers || {}) };
              if (method !== 'GET') opts.body = JSON.stringify(a);
              const resp = await fetch(url, opts);
              const text = await resp.text();
              return text.length > 8000 ? text.slice(0, 8000) + '\n...[truncated]' : text;
            }
            if (transport === 'mcp') {
              const mcp = t.mcp || {};
              if (!window.LabCode || !window.LabCode.mcp || !window.LabCode.mcp.callTool) {
                return 'Error: MCP 桥不可用';
              }
              const r = await window.LabCode.mcp.callTool(mcp.server, mcp.tool, a);
              return typeof r === 'string' ? r : JSON.stringify(r);
            }
            if (transport === 'grpc') {
              // t.grpc = { protoPath, service, method, host, request, insecure, timeoutMs }
              // 由主进程加载 proto 并发起 unary 调用（需要 socket，渲染层做不了）
              const bridge = window.LabCode && window.LabCode.plugin;
              if (!bridge || !bridge.grpcCall) return 'Error: plugin bridge 不可用（grpc）';
              const g = t.grpc || {};
              const r = await bridge.grpcCall({
                protoPath: g.protoPath, service: g.service, method: g.method,
                host: g.host, request: Object.assign({}, g.request || {}, a),
                insecure: g.insecure !== false, timeoutMs: g.timeoutMs || 30000
              });
              if (!r || !r.success) return 'Error: grpc 调用失败: ' + ((r && r.error) || 'unknown');
              return typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
            }
            if (transport === 'stdio') {
              // t.stdio = { command, args, cwd, timeoutMs }；参数以 {argName} 模板注入 args
              const bridge = window.LabCode && window.LabCode.plugin;
              if (!bridge || !bridge.stdioCall) return 'Error: plugin bridge 不可用（stdio）';
              const sd = t.stdio || {};
              const projectPath = (window.LabCodeUI && window.LabCodeUI.state && window.LabCodeUI.state.projectPath) || '';
              const ctx = Object.assign({}, a, { projectPath });
              const args = Array.isArray(sd.args) ? sd.args.map(x => String(x).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m))) : [];
              const r = await bridge.stdioCall({
                command: sd.command, args,
                cwd: (sd.cwd || '').replace(/\{projectPath\}/g, projectPath) || undefined,
                request: a, timeoutMs: sd.timeoutMs || 30000
              });
              if (!r || !r.success) return 'Error: stdio 调用失败: ' + ((r && r.error) || 'unknown') + ((r && r.stderr) ? '\n' + r.stderr : '');
              if (r.result !== undefined) return typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
              return r.raw || '';
            }
            if (transport === 'mqtt') {
              // t.mqtt = { brokerUrl, topic, responseTopic, payload, qos, username, password, timeoutMs }
              const bridge = window.LabCode && window.LabCode.plugin;
              if (!bridge || !bridge.mqttCall) return 'Error: plugin bridge 不可用（mqtt）';
              const mq = t.mqtt || {};
              const projectPath = (window.LabCodeUI && window.LabCodeUI.state && window.LabCodeUI.state.projectPath) || '';
              const ctx = Object.assign({}, a, { projectPath });
              const fill = (s) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] != null ? String(ctx[k]) : m));
              const r = await bridge.mqttCall({
                brokerUrl: fill(mq.brokerUrl), topic: fill(mq.topic),
                responseTopic: mq.responseTopic ? fill(mq.responseTopic) : '',
                payload: Object.assign({}, mq.payload || {}, a),
                qos: mq.qos || 0, username: mq.username, password: mq.password,
                timeoutMs: mq.timeoutMs || 15000
              });
              if (!r || !r.success) return 'Error: mqtt 调用失败: ' + ((r && r.error) || 'unknown');
              if (r.published) return 'OK: 已发布到 ' + fill(mq.topic);
              if (r.result !== undefined) return typeof r.result === 'string' ? r.result : JSON.stringify(r.result);
              return r.raw || '';
            }
            return `Error: transport "${transport}" 尚未实现（插件 ${id}）`;
          } catch (e) {
            return `Error: 工具 ${autoName} 执行失败: ${e.message}`;
          }
        }
      };
      PLUGIN_TOOL_DEFS.push(toolDef);
      toolCount++;
    } catch (e) {
      errors.push(`tool ${t && t.name}: ${e.message}`);
    }
  }

  // ---- skills ----
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  for (const s of skills) {
    if (s && s.name && s.prompt) {
      PLUGIN_SKILLS.push({ name: s.name, description: s.description || '', prompt: s.prompt, pluginId: id, metadata: s.metadata || {} });
      skillCount++;
    }
  }

  PLUGIN_REGISTRY.set(id, {
    id,
    name: manifest.name || id,
    version: manifest.version || '0.0.0',
    description: manifest.description || '',
    category: manifest.category || 'plugin',
    tools: tools.map(t => ({ name: t.name, category: t.category })),
    skills: skills.map(s => s.name),
    projectTypes: manifest.projectTypes || [],
    views: Array.isArray(manifest.views) ? manifest.views : [],
    active: true
  });

  // 收集所有 views（去重）
  if (Array.isArray(manifest.views)) {
    for (const v of manifest.views) {
      if (v && v.id && v.webviewUrl) {
        PLUGIN_VIEWS.set(id + ':' + v.id, { pluginId: id, id: v.id, title: v.title || v.id, webviewUrl: v.webviewUrl });
      }
    }
  }

  return { loaded: { tools: toolCount, skills: skillCount, errors } };
}

/**
 * 从目录加载所有插件：扫描 pluginsRoot 下每个子目录的 plugin.json
 * @param {string} pluginsRoot
 * @param {(path:string)=>Promise<string>} readFileAsync
 */
async function loadPluginsFromDir(pluginsRoot) {
  const fsApi = (typeof window !== 'undefined' && window.LabCode && window.LabCode.fs) || null;
  const results = { loaded: [], errors: [] };
  if (!fsApi) { results.errors.push('window.LabCode.fs 不可用'); return results; }
  let files = [];
  try {
    const exists = await fsApi.exists(pluginsRoot);
    if (!exists) return results;
    const r = await fsApi.listDir(pluginsRoot);
    files = (r && r.success && Array.isArray(r.files)) ? r.files : [];
  } catch (e) { results.errors.push('读插件目录失败: ' + e.message); return results; }

  for (const entry of files) {
    if (!entry || !entry.isDirectory) continue;
    const name = entry.name;
    if (!name || name.startsWith('.')) continue;
    const sep = pluginsRoot.includes('/') ? '/' : '\\';
    const manifestPath = pluginsRoot.replace(/[\\\/]$/, '') + sep + name + sep + 'plugin.json';
    try {
      const rr = await fsApi.readFile(manifestPath);
      if (!rr || !rr.success) throw new Error(rr && rr.error ? rr.error : 'read failed');
      const manifest = JSON.parse(rr.content);
      const r2 = loadPluginManifest(manifest);
      results.loaded.push({ id: manifest.id || name, ...r2.loaded });
    } catch (e) {
      results.errors.push(`${name}: ${e.message}`);
    }
  }
  return results;
}

/**
 * 从远程市场拉插件 manifest（GitHub raw）。
 * 不存本地，启动时按需 fetch。
 * @param {string} marketURL  如 https://raw.githubusercontent.com/hulufeng/labcode-plugins/main
 */
async function loadPluginsFromRemote(marketURL) {
  const results = { loaded: [], errors: [] };
  if (!marketURL) return results;
  const base = marketURL.replace(/\/$/, '');
  try {
    const idxResp = await fetch(base + '/index.json');
    if (!idxResp.ok) throw new Error('HTTP ' + idxResp.status);
    const idx = await idxResp.json();
    const ids = (idx && Array.isArray(idx.plugins)) ? idx.plugins : [];
    for (const id of ids) {
      try {
        const r = await fetch(base + '/' + id + '/plugin.json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const manifest = await r.json();
        const r2 = loadPluginManifest(manifest);
        results.loaded.push({ id, ...r2.loaded });
      } catch (e) {
        results.errors.push(id + ': ' + e.message);
      }
    }
  } catch (e) {
    results.errors.push('拉市场索引失败: ' + e.message);
  }
  return results;
}

// ============================================================
// 安装 / 卸载 / 启用禁用（真落盘，重启后仍生效）
// ------------------------------------------------------------
// 插件根目录：<userData>/plugins/<id>/plugin.json
// 启用禁用状态：config.pluginStates.disabled[]（字符串数组）
// ============================================================
const PLUGIN_DISABLED = new Set();
let PLUGIN_ROOT_CACHE = '';

async function getPluginsRoot() {
  if (PLUGIN_ROOT_CACHE) return PLUGIN_ROOT_CACHE;
  try {
    if (window.LabCode && window.LabCode.app && window.LabCode.app.getPath) {
      const userData = await window.LabCode.app.getPath('userData');
      if (userData) {
        PLUGIN_ROOT_CACHE = String(userData).replace(/[\\\/]+$/, '') + '/plugins';
        return PLUGIN_ROOT_CACHE;
      }
    }
  } catch (e) { /* 忽略 */ }
  return '';
}

function joinPath(a, b) {
  const sep = String(a).includes('/') ? '/' : '\\';
  return String(a).replace(/[\\\/]+$/, '') + sep + String(b).replace(/^[\\\/]+/, '');
}

/** 从 config 读取禁用列表（启动时调用一次） */
async function loadPluginStates() {
  try {
    const cfg = await window.LabCode?.config?.get?.() || {};
    const disabled = cfg?.pluginStates?.disabled;
    PLUGIN_DISABLED.clear();
    if (Array.isArray(disabled)) disabled.forEach(id => PLUGIN_DISABLED.add(String(id)));
    return Array.from(PLUGIN_DISABLED);
  } catch (e) { return []; }
}

async function savePluginStates() {
  try {
    await window.LabCode?.config?.set?.('pluginStates', { disabled: Array.from(PLUGIN_DISABLED) });
    return true;
  } catch (e) { return false; }
}

/** 递归拷贝目录（跳过 node_modules / .git / 隐藏目录） */
async function copyDir(fsApi, src, dst) {
  const r = await fsApi.listDir(src);
  const files = (r && r.success && Array.isArray(r.files)) ? r.files : [];
  await fsApi.mkdir(dst);
  let n = 0;
  for (const f of files) {
    if (!f || !f.name || f.name.startsWith('.')) continue;
    if (f.name === 'node_modules' || f.name === '.git') continue;
    const s = joinPath(src, f.name);
    const d = joinPath(dst, f.name);
    if (f.isDirectory) {
      n += await copyDir(fsApi, s, d);
    } else {
      const cr = await fsApi.copyFile(s, d);
      if (cr && cr.success) n++;
    }
  }
  return n;
}

/**
 * 安装本地插件目录：把 srcDir 拷进插件目录并立即注册。
 * @param {string} srcDir 含 plugin.json 的目录
 * @returns {Promise<{success:boolean, id?:string, tools?:number, error?:string}>}
 */
async function installFromDir(srcDir) {
  const fsApi = (typeof window !== 'undefined' && window.LabCode && window.LabCode.fs) || null;
  if (!fsApi) return { success: false, error: 'window.LabCode.fs 不可用' };
  if (!srcDir) return { success: false, error: '缺插件目录路径' };
  try {
    const manifestPath = joinPath(srcDir, 'plugin.json');
    const exists = await fsApi.exists(manifestPath);
    if (!exists) return { success: false, error: '目录内没有 plugin.json: ' + manifestPath };
    const rr = await fsApi.readFile(manifestPath);
    if (!rr || !rr.success) return { success: false, error: '读 plugin.json 失败: ' + (rr && rr.error) };
    let manifest;
    try {
      manifest = JSON.parse(rr.content);
    } catch (e) {
      return { success: false, error: 'plugin.json 不是合法 JSON: ' + e.message };
    }
    if (!manifest || !manifest.id) return { success: false, error: 'plugin.json 缺 id' };
    const root = await getPluginsRoot();
    if (!root) return { success: false, error: '拿不到插件目录（userData）' };
    const dst = joinPath(root, String(manifest.id));
    const copied = await copyDir(fsApi, srcDir, dst);
    if (!copied) return { success: false, error: '没有拷贝到任何文件' };
    const r2 = loadPluginManifest(manifest);
    return { success: true, id: manifest.id, name: manifest.name || manifest.id, path: dst, tools: r2.loaded.tools, skills: r2.loaded.skills, errors: r2.loaded.errors };
  } catch (e) {
    return { success: false, error: '安装失败: ' + e.message };
  }
}

/**
 * 直接用 manifest 对象安装（内置插件走这条：写成 plugin.json 落盘后注册）
 * @param {object} manifest
 */
async function installManifest(manifest) {
  const fsApi = (typeof window !== 'undefined' && window.LabCode && window.LabCode.fs) || null;
  if (!fsApi) return { success: false, error: 'window.LabCode.fs 不可用' };
  if (!manifest || !manifest.id) return { success: false, error: 'manifest 缺 id' };
  try {
    const root = await getPluginsRoot();
    if (!root) return { success: false, error: '拿不到插件目录（userData）' };
    const dir = joinPath(root, String(manifest.id));
    await fsApi.mkdir(dir);
    const wr = await fsApi.writeFile(joinPath(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
    if (wr && wr.success === false) return { success: false, error: '写 plugin.json 失败: ' + (wr.error || '') };
    const r2 = loadPluginManifest(manifest);
    return { success: true, id: manifest.id, name: manifest.name || manifest.id, path: dir, tools: r2.loaded.tools, skills: r2.loaded.skills };
  } catch (e) {
    return { success: false, error: '安装失败: ' + e.message };
  }
}

/** 卸载：删目录 + 从运行时注销工具/skills/views */
async function uninstall(id) {
  const fsApi = (typeof window !== 'undefined' && window.LabCode && window.LabCode.fs) || null;
  // 1) 运行时注销
  for (let i = PLUGIN_TOOL_DEFS.length - 1; i >= 0; i--) {
    if (PLUGIN_TOOL_DEFS[i]._pluginId === id) PLUGIN_TOOL_DEFS.splice(i, 1);
  }
  for (let i = PLUGIN_SKILLS.length - 1; i >= 0; i--) {
    if (PLUGIN_SKILLS[i].pluginId === id) PLUGIN_SKILLS.splice(i, 1);
  }
  for (const k of Array.from(PLUGIN_VIEWS.keys())) {
    if (k.startsWith(id + ':')) PLUGIN_VIEWS.delete(k);
  }
  PLUGIN_REGISTRY.delete(id);
  PLUGIN_DISABLED.delete(id);
  await savePluginStates();
  // 2) 删目录（deleteFile 对目录是递归删）
  if (fsApi) {
    try {
      const root = await getPluginsRoot();
      if (root) {
        const dir = joinPath(root, String(id));
        const ex = await fsApi.exists(dir);
        if (ex) await fsApi.deleteFile(dir);
      }
    } catch (e) { /* 删目录失败不影响运行时卸载 */ }
  }
  return { success: true, id };
}

/** 启用 / 禁用（禁用后工具不再注入给 AI，但插件仍在磁盘上） */
async function setActive(id, active) {
  if (!id) return { success: false, error: '缺 id' };
  if (active) PLUGIN_DISABLED.delete(id); else PLUGIN_DISABLED.add(id);
  await savePluginStates();
  return { success: true, id, active: !!active };
}

function isActive(id) {
  return !PLUGIN_DISABLED.has(id);
}

// 暴露到 window 供 app.js 调用
window.PluginSystem = {
  registerInternalService,
  loadPluginManifest,
  loadPluginsFromDir,
  loadPluginsFromRemote,
  // ---- 安装 / 卸载 / 启用禁用 ----
  getPluginsRoot,
  getViews: () => Array.from(PLUGIN_VIEWS.values()),
  installFromDir,
  installManifest,
  uninstall,
  setActive,
  isActive,
  loadPluginStates,
  // 禁用的插件：工具/技能不再注入给 AI（listPlugins 里仍可见，active=false）
  getToolDef: (name) => {
    const t = PLUGIN_TOOL_DEFS.find(x => x.name === name);
    if (!t) return undefined;
    return PLUGIN_DISABLED.has(t._pluginId) ? undefined : t;
  },
  allTools: () => PLUGIN_TOOL_DEFS.filter(t => !PLUGIN_DISABLED.has(t._pluginId)),
  allSkills: () => PLUGIN_SKILLS.filter(s => !PLUGIN_DISABLED.has(s.pluginId)),
  listPlugins: () => Array.from(PLUGIN_REGISTRY.values()).map(p => Object.assign({}, p, { active: !PLUGIN_DISABLED.has(p.id) })),
  listViews: () => Array.from(PLUGIN_VIEWS.values()),
  getView: (key) => PLUGIN_VIEWS.get(key),
  // 2026-09-15 对齐 TrieCode settings：插件声明 settings 项 → UI 自动渲染
  getSettings: (pluginId) => {
    const p = PLUGIN_REGISTRY.get(pluginId);
    return p?.settings || [];
  },
  getSetting: async (pluginId, key) => {
    try {
      const cfg = await window.LabCode?.config?.get?.() || {};
      return cfg?.pluginSettings?.[pluginId]?.[key];
    } catch (e) { return undefined; }
  },
  setSetting: async (pluginId, key, value) => {
    try {
      await window.LabCode?.config?.set?.('pluginSettings.' + pluginId + '.' + key, value);
      return true;
    } catch (e) { return false; }
  }
};
