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
//     "skills": [ { "name":"...", "description":"...", "prompt":"..." } ],
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
              const projectPath = (window.LabCode && window.LabCode.state && window.LabCode.state.projectPath) || '';
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
              const projectPath = (window.LabCode && window.LabCode.state && window.LabCode.state.projectPath) || '';
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
              return 'Error: gRPC transport 尚未实现（插件 ' + id + '）。规划：插件自带 daemon，主进程拉起 grpc.Server，插件通过 grpc.Client 调用。';
            }
            if (transport === 'stdio') {
              return 'Error: stdio transport 尚未实现（插件 ' + id + '）。规划：spawn 子进程，按 JSON-RPC over stdio 通信。';
            }
            if (transport === 'mqtt') {
              return 'Error: MQTT transport 尚未实现（插件 ' + id + '）。规划：通过 EMQX/Mosquitto broker 桥接 IoT 设备。';
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
      PLUGIN_SKILLS.push({ name: s.name, description: s.description || '', prompt: s.prompt, pluginId: id });
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

// 暴露到 window 供 app.js 调用
window.PluginSystem = {
  registerInternalService,
  loadPluginManifest,
  loadPluginsFromDir,
  loadPluginsFromRemote,
  getToolDef: (name) => PLUGIN_TOOL_DEFS.find(t => t.name === name),
  allTools: () => PLUGIN_TOOL_DEFS.slice(),
  allSkills: () => PLUGIN_SKILLS.slice(),
  listPlugins: () => Array.from(PLUGIN_REGISTRY.values()),
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
