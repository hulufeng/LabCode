# 完整伪终端（node-pty）安装记录

> 日期：2026-09-10
> 目标：LabCode 桌面端底部终端从"降级模式"恢复为完整伪终端（node-pty）

## 一、问题

- 底部终端状态栏一直显示"降级模式"：`main/terminal.js` 已完整实现 node-pty 集成（`require('node-pty')` 成功走真 PTY，失败回退 child_process），但 node-pty 从未真正安装。
- 降级模式无 TTY 语义：无法运行需要交互输入的命令（如 `npm init`、Python REPL、vim），命令输出有缓冲差异。

## 二、环境探测

| 项 | 状态 |
| --- | --- |
| Node | v22.23.2 |
| npm | 10.9.8 |
| Python | 3.14.7 |
| node-gyp | v13.0.2 |
| VS Build Tools / MSVC / Windows SDK | ❌ 全部缺失（无 vswhere、无 cl.exe、无 SDK Include） |
| Electron | 28.3.3（ABI 124） |

## 三、预编译方案排查（全部不可行）

| 方案 | 结果 |
| --- | --- |
| `node-pty-prebuilt-multiarch@0.10.1-pre.5` | ❌ 无 win32-x64 prebuild，最高 ABI 108 < 124 |
| `@homebridge/node-pty-prebuilt-multiarch@0.14.1` | ❌ 只有 linux prebuilds，无 win32 |
| `node-pty-prebuilt@0.7.6` | ❌ 过老 fork，无 win32 Electron 预编译 |

结论：Windows 下 node-pty 无可用预编译二进制，必须本地编译。

## 四、正路方案（执行中）

1. 下载 VS Build Tools 2022 安装器（4.3MB，aka.ms 官方源）✅
2. 静默安装 C++ 工作负载（`Microsoft.VisualStudio.Workload.VCTools --includeRecommended`，约 2-4GB，20-40 分钟）→ 进行中
3. `npm install node-pty@latest`（官方 0.11.x，支持 Windows ConPTY）
4. `npx @electron/rebuild -f -w node-pty`（编译匹配 Electron 28 / ABI 124）
5. 打包（确认原生模块 asarUnpack）+ 启动实测终端状态

## 五、已清理的无效依赖

卸载了 3 个不适用包：`node-pty-prebuilt-multiarch`、`@homebridge/node-pty-prebuilt-multiarch`、`node-pty-prebuilt`（均已从 package.json / node_modules 移除）。

## 六、验收标准

- 启动 LabCode 后终端状态栏不再显示"降级模式"
- 终端可执行 `dir`、`echo`、交互式命令（如 `npm init` 能出现提问），有真实 TTY 行为
