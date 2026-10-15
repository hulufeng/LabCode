# 交接书：打包态自动更新强制重启导致窗口消失

日期：2026-10-15
分支：main（原定 `feat/tricode-align-agent-fixes` 分支已不存在，本次直接提交到 main）
提交：`d0e947a` fix(desktop-app): 修复打包态自动更新强制重启导致窗口消失

## 现象
- 只在 dev 模式（`electron . --dev`）验证时一切正常；但打包态 exe（`win-unpacked/LabCode.exe`，不带 `--dev`）启动后主窗口表现为 `0×0`、`IsWindowVisible=False`、不可见。
- 用同一个打包 exe 但加 `--dev` 启动，窗口却正常（`1403×902`、`Visible=True`）。

## 根因
- `main/index.js` 的 `setupAutoUpdate()` 中，`autoUpdater` 仅在 `!isDev`（即纯打包态）时才 `checkForUpdates()`。
- 更新服务器 `https://bluebubai.work/updates` 上已有 `1.1.3` 版本，本地打包为 `1.0.0`。
- 打包态启动 5 秒后检测到 `1.1.3 > 1.0.0`，`autoDownload=true` 触发后台下载；下载完成后 `update-downloaded` 事件里执行 `setTimeout(() => autoUpdater.quitAndInstall(), 3000)` **静默强制重启**应用，主窗口被销毁 → 表现为 `0×0`。
- dev 模式跳过 `checkForUpdates`，因此这条路径从未在开发验证中被覆盖——这正是“开发方式有问题”的真实体现。

## 修复
1. `main/index.js` `setupAutoUpdate`：移除下载完成后的 `setTimeout(quitAndInstall, 3000)` 强制重启，仅 `webContents.send('update:downloaded', info)` 通知渲染端。
2. 新增环境变量开关 `AUTO_UPDATE_DISABLED`（值为 `'1'` 或 `'true'`）：测试/自测旧版本时跳过自动检查（初始 5 秒定时器 + 每小时间隔），手动 `update:check` 也返回 `{ disabled: true }`。
3. 渲染端 `renderer/js/app.js`：新增更新提示 UI，监听 `update:available`（"New version X found, downloading…"）与 `update:downloaded`（"Update downloaded. Restart to install." + **Restart & Install** 按钮），按钮调用 preload 已暴露的 `window.LabCode.update.install()` → 主进程 `update:install` handler → `autoUpdater.quitAndInstall()`。
   - preload 已暴露 `ipc.on`（含 `allowedChannels`: `update:available / update:not-available / update:progress / update:downloaded`）与 `update.install`，**无需改动 preload**。

## 验证
- `node --check` 检查 `app.js` 语法通过。
- `npm run build:win` 重新打包成功。
- 设 `AUTO_UPDATE_DISABLED=1` 启动纯打包态 exe（不带 `--dev`）：窗口正常 `1403×902`、`Visible=True`（此前不禁用时为 `0×0`）。
- 渲染端 toast 的端到端验证（真实联网下载 156MB 更新包并点击安装）建议在发布环境联网完成，或 DevTools 手动触发事件。

## 教训：开发方式盲区
只在 dev 模式验证会漏掉所有“打包态专属路径”：
- `isDev` 分支跳过的逻辑（如 `autoUpdater`）。
- asar 内路径解析（`loadFile` / `preload` / 原生模块 `node-pty` 加载）。
- `resources/` 等资源路径。

正确流程：`dev` 跑通 → `npm run build:win` → 跑 `win-unpacked/LabCode.exe`（不带 `--dev`）→ 确认窗口 / Monaco / 终端 / 插件市场均正常 → 才敢发布。测试期用 `AUTO_UPDATE_DISABLED=1` 避免被服务器新版本拉走。

## 待办 / 遗留
- 进 main：此前讨论过将 desktop-app 改动并入 main，但 main 分支实际即承载 desktop-app（与早期记忆“main 是不同 TS 项目”不符，且 `feat/tricode-align-agent-fixes` 分支已不存在）。当前改动已直接在 main 提交，无需额外并入。
- 渲染端更新 toast 的真实端到端验证（下载 1.1.3 并点击安装）需在发布 / 联网环境完成。
- 自动更新发布流程：确认 `bluebubai.work/updates` 上 `1.1.3` 的来源与发布权限，避免旧版本自测时被强制拉新。
