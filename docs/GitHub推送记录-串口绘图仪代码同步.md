# GitHub 推送记录：串口监视器 + 绘图仪代码同步

> 日期：2026-09-10（周四）
> 仓库：`hulufeng/LabCode`（分支：main）
> 涉及工程：`D:\工作\LabCode\desktop-app`（纯 JS 版桌面端）

---

## 一、任务背景（对话上下文）

用户要求把本地桌面端**最新版 `renderer/js/app.js`（含串口监视器、串口绘图仪、AI 设置模态框、RealAIClient 完整智能体引擎）**推送同步到 GitHub 远端仓库 `hulufeng/LabCode`，并解决此前推送遇到的两类问题：

1. **网络通道问题**：git CLI 直连 `https://github.com` 的 443 端口被阻断（Recv failure / Could not connect），多次 fetch/push 失败；
2. **文件通道问题**：GitHub MCP 工具 `push_files` 只接受字符串内容，无法推送二进制文件（`resources/icon.ico`、`icon.png`），也无法承载 214KB 的大文件。

期间发现：**本地 git 仓库与远端出现分叉**——本地领先 2 个 commit（`8b01424`、`9897aa4`），远端领先 4 个 MCP 推送的 commit（`c056121`、`f13ddf1`、`104685d`、`fef70fc`），需要合并对齐后再推送。

---

## 二、环境诊断结论

| 检查项 | 结果 |
|---|---|
| git 可执行文件 | `D:\软件\Git\cmd\git.exe` |
| ssh 可执行文件 | `D:\软件\Git\usr\bin\ssh.exe` |
| 本地 SSH 密钥 | `C:\Users\Administrator\.ssh\id_ed25519`（已存在，有效） |
| SSH 认证测试 | `Hi hulufeng! You've successfully authenticated` ✅ |
| HTTPS 443 直连 | 阻断（Connection was reset）❌ |
| SSH 22 / ssh.github.com:443 | 均连通 ✅ |
| 浏览器 GitHub 登录态 | 未登录（Sign in / Sign up），网页通道不可用 ❌ |
| 系统代理 | 无（ProxyEnable=0），无可用代理端口 |

**结论**：SSH 是当前唯一可靠通道；本机已有有效 GitHub SSH 密钥，无需重新生成。

---

## 三、解决方案：SSH 通道 + git worktree 隔离推送

### 3.1 切换 remote 为 SSH 协议

```powershell
# 配置 git 使用 Git 自带 ssh（避免 PATH 中无 ssh 的问题）
git config core.sshCommand "D:/软件/Git/usr/bin/ssh.exe -o StrictHostKeyChecking=no"

# 将 remote 从 HTTPS 切换为 SSH
git remote set-url origin git@github.com:hulufeng/LabCode.git

# 验证：SSH fetch 成功
git fetch origin main
# => 2d3654f..fef70fc  main -> origin/main
```

### 3.2 确认分叉状态

```powershell
git log --oneline origin/main..HEAD    # 本地领先
git log --oneline HEAD..origin/main    # 远端领先
```

- 本地 HEAD：`9897aa4`（feat: 三大核心功能落地 + 品牌图标）
- 远端 main：`fef70fc`（feat: 渲染端样式…）
- 共同祖先：`2d3654f`
- 分叉原因：远端 4 个 commit 是此前通过 GitHub MCP `push_files` 分批推送的，与本地 git 历史是两条平行线

### 3.3 文件差异核对（本地 vs 远端）

对 `desktop-app` 下全部源码文件做字节级与归一化对比（Python 脚本，去除 CRLF/BOM 差异后比较）：

| 文件 | 本地 | 远端 | 结论 |
|---|---|---|---|
| `renderer/js/app.js` | 214,264B（5151 行） | 185,127B | **本地大幅更新**（805 增/53 删），含串口监视器、绘图仪、AI 设置、RealAIClient |
| `package.json` | 1,846B | 1,871B | 本地新增 `electronDist` 配置 |
| `main/index.js` | 25,662B | 26,448B | 仅 BOM/行尾差异，内容一致 |
| `main/preload.js` | 5,045B | 5,183B | 仅 BOM/行尾差异，内容一致 |
| `main/terminal.js` | 9,572B | 9,955B | 内容一致（行尾差异） |
| `renderer/index.html` | 51,932B | 52,685B | 内容一致（行尾差异） |
| `renderer/css/style.css` | 51,858B | 54,764B | 内容一致（行尾差异） |
| `renderer/icons/labcode-icons.svg` | 27,767B | 28,215B | 内容一致（行尾差异） |
| `renderer/js/terminal.js` | 13,642B | 14,127B | 内容一致（行尾差异） |
| `resources/icon.ico` | 107,475B | **不存在** | 需新增推送 |
| `resources/icon.png` | 74,924B | **不存在** | 需新增推送 |

### 3.4 隔离推送（不改本地源码，不改本地分支历史）

采用 `git worktree` 在独立目录基于 `origin/main` 检出临时分支，将本地最新文件复制进去后提交推送：

```powershell
# 创建隔离 worktree（基于远端最新 main）
git worktree add "D:\工作\LabCode\_push_tmp" origin/main -b tmp-sync

# 复制本地最新文件到 worktree（不改本地工作区）
Copy-Item "desktop-app\renderer\js\app.js"  "$tmp\renderer\js\app.js"
Copy-Item "desktop-app\package.json"        "$tmp\package.json"
Copy-Item "desktop-app\main\index.js"       "$tmp\main\index.js"
Copy-Item "desktop-app\main\preload.js"     "$tmp\main\preload.js"
Copy-Item "desktop-app\resources\icon.ico"  "$tmp\resources\icon.ico"   # 新建目录
Copy-Item "desktop-app\resources\icon.png"  "$tmp\resources\icon.png"

# 暂存并提交（resources 被 .gitignore 的 */ 规则忽略，需 -f 强制添加）
git add desktop-app/main/index.js desktop-app/main/preload.js desktop-app/package.json desktop-app/renderer/js/app.js
git add -f desktop-app/resources/icon.ico desktop-app/resources/icon.png
git commit -m "feat: 同步本地最新代码-串口监视器/绘图仪/AI设置/RealAIClient + 品牌图标资源"

# 推送：临时分支 -> 远端 main
git push origin tmp-sync:main
# => fef70fc..ada88fd  tmp-sync -> main
```

---

## 四、推送结果

### 4.1 本次提交内容（`ada88fd`，808 增 / 55 删）

| 文件 | 变更 |
|---|---|
| `desktop-app/renderer/js/app.js` | 更新为本地最新版（214,264B），含串口监视器、绘图仪、AI 设置模态框、RealAIClient、完整智能体引擎 |
| `desktop-app/package.json` | 新增 `electronDist: node_modules/electron/dist` |
| `desktop-app/main/index.js` | 同步本地最新 |
| `desktop-app/main/preload.js` | 同步本地最新 |
| `desktop-app/resources/icon.ico` | 新增（107,475B，品牌图标） |
| `desktop-app/resources/icon.png` | 新增（74,924B，品牌图标） |

### 4.2 验证结果（全部通过）

1. `git fetch origin main` → `origin/main` 已更新到 `ada88fd` ✅
2. 远端 app.js 与本地逐字节内容一致（归一化对比 equal，214,264B）✅
3. `git ls-tree origin/main desktop-app/resources/` → icon.ico、icon.png 均在远端 ✅
4. 临时 worktree 已清理（`_push_tmp` 已删除）✅

### 4.3 推送后的分支状态

- 远端 `origin/main` = `ada88fd`（本次推送）
- 本地 `main` 分支仍为 `9897aa4`（未改动本地历史）

---

## 五、遗留说明与后续建议

1. **本地 main 与远端仍是两条线**：本地 `9897aa4`/`8b01424` 与远端 `ada88fd` 内容重叠但 commit 历史未合并。如需本地分支跟进远端，可执行 `git pull --rebase origin main`（会改动本地历史，需用户确认后操作）。
2. **后续推送通道**：SSH 已打通，任何文件（含二进制）均可直接 `git push`，不再受 443 阻断与 MCP 字符串限制。
3. **`.gitignore` 注意**：`*/` 规则会忽略新目录下文件，推送新增目录文件时需 `git add -f`。
4. **模型选择器遗留缺陷**（未修复，涉及源码改动需用户同意）：UI 下拉模型选项仅改显示文本，未映射到设置弹窗真实 provider/model 配置。
5. **侵权字样待改**（涉及源码改动需用户同意）：app.js 中仍有 `TrieCode Clone v2` 日志与 `user@triecode` 提示符。
