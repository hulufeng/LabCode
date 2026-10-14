/**
 * IPC contract checker for LabCode desktop-app.
 *
 * Verifies two contracts that static review cannot catch and that only blow up
 * at runtime (usually only when a specific UI action is performed):
 *
 *   1. CHANNEL contract - every channel the renderer invokes has an ipcMain
 *      handler registered in main/index.js.
 *   2. PRELOAD contract - every `window.LabCode.<ns>.<method>` used by the
 *      renderer actually exists on the object exposed by preload.js.
 *
 * The preload API is obtained by really loading preload.js with a stubbed
 * `electron` module (instead of regex-guessing), so the result is exact.
 *
 * Usage: node scripts/verify-ipc-contract.cjs
 * Exit code 0 = contracts satisfied, 1 = gaps found.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main', 'index.js');
const PRELOAD = path.join(ROOT, 'main', 'preload.js');
const RENDERER_DIR = path.join(ROOT, 'renderer', 'js');

// ---------- 1. load preload.js with a stubbed electron, capture the real API ----------
const invokedChannels = new Set();
let exposedApi = null;

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      contextBridge: {
        exposeInMainWorld: (name, api) => { exposedApi = api; }
      },
      ipcRenderer: {
        invoke: (channel) => { invokedChannels.add(channel); return Promise.resolve(); },
        on: () => {},
        removeListener: () => {}
      }
    };
  }
  return origLoad.apply(this, arguments);
};
try {
  require(PRELOAD);
} finally {
  Module._load = origLoad;
}

if (!exposedApi) {
  console.error('[FAIL] could not load preload.js / no API captured');
  process.exit(1);
}

// Walk the captured API and call every function so dynamic channels get recorded.
function walk(obj, prefix, out) {
  if (!obj || typeof obj !== 'object') return out;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    const full = prefix ? prefix + '.' + key : key;
    if (typeof val === 'function') {
      out.add(full);
      try { val('__probe__', '__probe__', '__probe__', '__probe__'); } catch (e) { /* ignore */ }
    } else if (val && typeof val === 'object') {
      walk(val, full, out);
    }
  }
  return out;
}
const preloadPaths = walk(exposedApi, '', new Set());
// remove artifacts produced by our own probe calls (generic ipc.invoke passthrough)
invokedChannels.delete('__probe__');

// ---------- 2. channels registered in main ----------
const mainSrc = fs.readFileSync(MAIN, 'utf-8');
const mainHandlers = new Set();
const reMain = /ipcMain\.(?:handle|on)\(\s*'([^']+)'/g;
let m;
while ((m = reMain.exec(mainSrc)) !== null) mainHandlers.add(m[1]);

// ---------- 3. channels / API paths used by the renderer ----------
const rendererFiles = fs.readdirSync(RENDERER_DIR)
  .filter(f => f.endsWith('.js'))
  .map(f => path.join(RENDERER_DIR, f));

const usedChannels = new Set();
const usedApiPaths = new Set();
const reInvoke = /invoke\(\s*'([^']+)'/g;
const reApi = /window\.LabCode\.(\w+)\.(\w+)/g;

for (const file of rendererFiles) {
  const src = fs.readFileSync(file, 'utf-8');
  let r;
  while ((r = reInvoke.exec(src)) !== null) usedChannels.add(r[1]);
  while ((r = reApi.exec(src)) !== null) usedApiPaths.add(r[1] + '.' + r[2]);
}
// preload itself also invokes channels
const preloadSrc = fs.readFileSync(PRELOAD, 'utf-8');
let p;
while ((p = reInvoke.exec(preloadSrc)) !== null) usedChannels.add(p[1]);
for (const c of invokedChannels) usedChannels.add(c);

// ---------- 4. diff ----------
const missingChannels = [...usedChannels].filter(c => !mainHandlers.has(c)).sort();
const missingApi = [...usedApiPaths].filter(a => !preloadPaths.has(a)).sort();
const dupHandlers = Object.entries(
  [...mainSrc.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)].map(x => x[1])
    .reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {})
).filter(([, n]) => n > 1).map(([c]) => c);

console.log('=== LabCode IPC contract ===');
console.log('main handlers        :', mainHandlers.size);
console.log('renderer channels    :', usedChannels.size);
console.log('preload API paths    :', preloadPaths.size);
console.log('renderer API paths   :', usedApiPaths.size);
console.log('\n[channels] invoked but NOT registered in main:');
console.log(missingChannels.length ? missingChannels.map(c => '  - ' + c).join('\n') : '  NONE');
console.log('\n[preload] used by renderer but NOT exposed:');
console.log(missingApi.length ? missingApi.map(c => '  - window.LabCode.' + c).join('\n') : '  NONE');
console.log('\n[main] duplicate handler registration:');
console.log(dupHandlers.length ? dupHandlers.map(c => '  - ' + c).join('\n') : '  NONE');

const ok = !missingChannels.length && !missingApi.length && !dupHandlers.length;
console.log('\n' + (ok ? '[PASS] IPC contracts satisfied.' : '[FAIL] contract gaps found.'));
process.exit(ok ? 0 : 1);
