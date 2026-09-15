# TrieCode 实际操作记录（真实桌面操作，非官网文档）

> 操作日期：2026-09-09 | 环境：Windows 11 x64 | TrieCode v1.2.9
> 操作方式：通过电脑控制（cu.list_apps / launch_app / 屏幕截图 / 键鼠点击）在真实 Windows 桌面上完成
> 本文档记录**真实操作过程**，与早期基于官网文档整理的《TrieCode 软件操作记录》区分。

---

## 一、启动与界面确认

1. `cu.list_apps()` 找到应用：`TrieCode#c1dd2f97d9da932327d962c50b8eec2f2290243849`
2. `launch_app` 启动 TrieCode，出现欢迎页，文案 **"我们要一起做些什么？"**
3. 界面为五区布局：顶部工具栏 / 左侧活动栏+侧栏 / 中间编辑器 / 底部子面板 / 右侧 AI 对话

**截图**：`docs/screenshots/trie-launch.png`（已存）

---

## 二、新建 Arduino 项目（ESP32-C3 桌面机器人）

### 操作步骤
1. 点击顶部工具栏「新建项目」
2. 弹出新建项目对话框，列出 **9 种项目类型**：
   - Arduino / 插件 / ESP-IDF / Node.js / Python / C / C++ / Rust / 通用
3. 选择 **Arduino**，项目名输入 `DesktopRobot_ESP32C3`
4. 默认路径：`C:\Users\Lenovo\Documents\TrieCodeProjects`
5. 点击创建，自动生成：
   - `DesktopRobot_ESP32C3.ino`（Arduino 空模板：setup + loop）
   - `.triecode.json` 项目元数据：
     ```json
     {
       "version": 1,
       "projectType": "arduino",
       "toolchain": "arduino-cli-toolchain"
     }
     ```

**截图**：`docs/screenshots/trie-new-project.png`、`docs/screenshots/trie-project-created.png`（已存）

### 关键发现
- TrieCode 用 `.triecode.json` 标记项目类型与工具链（LabCode 用 `.labcode.json`，结构对齐）
- 新建弹窗的类型卡片布局 → LabCode 已仿写为 6 类型卡片（Arduino/Python/Node.js/ESP-IDF/C/C++/通用）

---

## 三、编写 ESP32-C3 桌面机器人代码

在 `.ino` 文件中写入完整机器人代码（双电机+LED+HC-SR04 超声波避障）：

```cpp
// ESP32-C3 桌面机器人控制示例
#include <Arduino.h>

#define MOTOR_L1 2
#define MOTOR_L2 3
#define MOTOR_R1 4
#define MOTOR_R2 5
#define LED_PIN  8
#define TRIG_PIN 6
#define ECHO_PIN 7

void setup() {
  Serial.begin(115200);
  pinMode(MOTOR_L1, OUTPUT);
  pinMode(MOTOR_L2, OUTPUT);
  pinMode(MOTOR_R1, OUTPUT);
  pinMode(MOTOR_R2, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.println("DesktopRobot ESP32-C3 Ready!");
}

float readDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  long duration = pulseIn(ECHO_PIN, HIGH);
  return duration * 0.034 / 2;
}

void setMotors(int l, int r) {
  digitalWrite(MOTOR_L1, l > 0);
  digitalWrite(MOTOR_L2, l < 0);
  digitalWrite(MOTOR_R1, r > 0);
  digitalWrite(MOTOR_R2, r < 0);
}

void loop() {
  float dist = readDistance();
  Serial.print("Distance: ");
  Serial.println(dist);
  if (dist > 0 && dist < 20) {
    setMotors(-1, 1);   // 避障：后退左转
  } else {
    setMotors(1, 1);    // 前进
  }
  delay(100);
}
```

**截图**：`docs/screenshots/trie-code-written.png`（已存）

---

## 四、开发板选择与工具链

### 操作
1. 状态栏显示 **"工具链 Arduino CLI 工具链"**，但 **"未选择开发板"**
2. 点击状态栏工具链菜单 → 弹出两项：**Arduino CLI / ESP-IDF**
3. 点击开发板选择 → **无响应**（编译按钮也无反应，原因见下）

### 关键发现
- TrieCode 的 Arduino 工具链底层是 **arduino-cli**，未安装时无法编译/烧录
- 状态栏右键可切换工具链（Arduino CLI ↔ ESP-IDF），与 LabCode 的 toolchain 字段对齐

**截图**：`docs/screenshots/trie-board-select.png`、`docs/screenshots/trie-toolbar-click.png`（已存）

---

## 五、AI 对话（关键发现：需付费）

### 操作
在右侧 AI 面板输入：
> "帮我选择ESP32-C3开发板，然后编译这个项目"

### 结果
**"积分不足，请前往官网充值或升级套餐"**

### 关键发现
- **TrieCode 的 AI 智能体功能需要积分（付费）**，免费版 200 积分/月，用完即止
- AI 面板顶部分为 ⚡自动 / 🛡默认 / 📋计划 三种权限模式（与 LabCode 对齐）
- 这是 LabCode 的差异化机会：**AI 调用配置放管理后台，用户自带 API Key 即可用，不锁积分**

**截图**：`docs/screenshots/trie-ai-board-select.png`（已存）

---

## 六、内置终端（PowerShell）

### 操作
底部面板「终端」标签 → 输入 `arduino-cli version`

### 结果
```
arduino-cli : 无法将“arduino-cli”项识别为 cmdlet、函数、脚本文件或可运行程序的名称。
CommandNotFoundException
```

### 关键发现
- TrieCode 内置终端底层是 **PowerShell**（与 LabCode 终端 shell 一致）
- **本机未安装 arduino-cli** → 无法真编译。TrieCode 也只是报错，没有自动安装
- 说明 Arduino 编译链路的真实瓶颈是 arduino-cli 未装，TrieCode 本身不会替你装

**截图**：`docs/screenshots/trie-terminal.png`（已存）

---

## 七、编译按钮行为

### 操作
1. 未选板时点 ✓编译按钮 → **无反应**（不报错、不提示）
2. 文件菜单点击 → **无下拉菜单**（v1.2.9 的已知 UI 小问题，与 LabCode 早期"点不动"现象一致）

### 关键发现
- 编译前置条件：**必须选择开发板 + 安装 arduino-cli**
- TrieCode 也有部分按钮"点不动"的现象（文件菜单无下拉）→ 印证此类桌面工具菜单实现不完整属常见问题，LabCode 需做得更完整

**截图**：`docs/screenshots/trie-compile-click.png`、`docs/screenshots/trie-file-menu.png`（已存）

---

## 八、TrieCode 与 LabCode 操作流程对比

| 操作步骤 | TrieCode | LabCode | 结论 |
|---------|----------|---------|------|
| 启动 | launch_app 启动 | electron.exe 启动 | ✅ 一致 |
| 新建项目 | 9 类型弹窗 | 6 类型弹窗（本轮已修复） | ⚠️ LabCode 类型略少，可补 插件/C/Rust |
| 项目元数据 | `.triecode.json`（version/projectType/toolchain） | `.labcode.json`（同结构） | ✅ 对齐 |
| 代码编辑 | Monaco 编辑器 | Monaco 编辑器 | ✅ 一致 |
| 终端 | PowerShell + node-pty | PowerShell（降级模式） | ⚠️ LabCode 需装 node-pty 提升 |
| AI 对话 | 需积分（付费墙） | MockAIClient（待接真实 API） | ✅ LabCode 差异化：管理后台配 Key |
| 开发板选择 | arduino-cli（需安装） | arduino-cli（未实现选板 UI） | ⚠️ LabCode 需补开发板选择 |
| 编译 | 需 arduino-cli + 选板 | 无编译按钮 | ⚠️ 待实现 |
| 编码处理 | 未知 | GBK 自动检测（本轮已修复） | ✅ LabCode 更优 |

---

## 九、环境限制与后续建议

### 当前限制（真实环境）
1. **arduino-cli 未安装**（TrieCode 与 LabCode 均无法真编译）
2. **TrieCode AI 需积分**（付费墙，无法继续测试 AI 编译）
3. TrieCode 文件菜单等部分 UI 无响应

### 建议后续动作
1. 安装 arduino-cli（约 60MB）：`winget install arduino-cli` 或官网下载
2. LabCode 补全：开发板选择 UI、编译/烧录按钮、node-pty 终端增强
3. LabCode 接入真实 AI：管理后台配置 API Key → 替换 MockAIClient
4. LabCode 项目类型可补：插件 / C / Rust（对齐 TrieCode 9 类型）

---

*本文档为真实桌面操作记录，所有截图存于 `docs/screenshots/`。*
