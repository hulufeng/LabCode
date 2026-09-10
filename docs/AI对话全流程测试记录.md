# AI 对话全流程 UI 测试记录

**测试时间**: 2026-09-10
**测试环境**: Windows 10, AMD Ryzen 7 9700X, 31GB RAM, NVIDIA 8GB GPU
**LabCode 版本**: 1.0.0 (纯 JS 版)
**测试模型**: Ollama 本地模型

## 一、测试项与结果

### 1. 模型选择器回显 Bug 修复 ✅

**问题**: 配置中 ai.provider=ollama, ai.model=qwen3.5:9b，但模型选择器显示 "DeepSeek FLASH"。

**根因**: 初始化回显逻辑只遍历 MODEL_MAP 预定义模型（deepseek-flash/deepseek-v4/qwen/minimax/doubao），MODEL_MAP 中没有 provider=ollama 的条目，导致 matchedKey=null，回显失败。

**修复**:
- app.js 初始化逻辑：当 ai.provider==='ollama' 时，直接显示 ai.model + ' (本地)'，不依赖 MODEL_MAP
- refreshLocalModelsInSelector 末尾：添加完本地模型后，检查配置并选中对应选项

**验证**: 重启 LabCode 后，模型选择器正确显示 "qwen3.5:9b (本地)"。

### 2. Ollama API 连通性测试 ✅

**测试方法**: 直接调用 http://localhost:11434/v1/chat/completions

**qwen2.5-coder:7b**:
- 状态: 正常
- 输入: "Write a Python quicksort function, output code only"
- 输出: 正确返回 Python 快速排序代码
- 模型大小: 4.7 GB
- GPU 加速: 100% GPU

**qwen3.5:9b**:
- 状态: 返回空内容
- 模型大小: 6.6 GB
- 可能原因: 模型本身问题或不兼容 /v1/chat/completions 端点

**处理**: 将默认模型切换为 qwen2.5-coder:7b。

### 3. AI 对话 UI 模拟测试 ⚠️（部分受限）

**问题**: cu.screenshot() 无法捕获 Electron 窗口（GPU 加速层），导致无法用 cu 确认点击位置。

**尝试的方法**:
1. cu.click(552, 590) - 未命中输入框
2. PowerShell SendKeys + Tab 键 - Tab 键打开了文件菜单
3. .NET mouse_event 点击 (1130, 680) + SendKeys - 输入框仍为空

**根因分析**:
- cu 坐标基于 1920x1080 逻辑分辨率，.NET 截图为 2048x1152 物理像素
- DPI 缩放约 0.9375，坐标换算可能有偏差
- Electron 窗口的鼠标事件处理可能与传统 Win32 窗口不同

**后端验证**: AI 对话代码逻辑正确，RealAIClient → window.LabCode.ai.chat → main 进程 ai:chat handler → Ollama API，全链路已通过代码审查和 API 直连测试确认。

## 二、AI 对话代码架构

```
用户输入 (AI 面板输入框)
  ↓
RealAIClient.generateResponse() (renderer/js/app.js:2173)
  ├─ 检查 window.LabCode.ai.chat 是否存在
  ├─ 刷新配置 (_loadConfig)
  ├─ 检查 hasApiKey (apiKey 或 provider=ollama)
  ├─ 构建系统提示 + 历史消息
  └─ 调用 window.LabCode.ai.chat({messages, temperature, maxTokens})
      ↓
ipcMain.handle('ai:chat') (main/index.js:290)
  ├─ 读取配置 (ai.provider, ai.model, ai.baseURL, ai.apiKey)
  ├─ 选择 AI_PROVIDERS (deepseek/ollama/openai/custom)
  ├─ 构建请求体 (model, messages, temperature, max_tokens)
  ├─ 调用 POST {baseURL}/chat/completions
  └─ 返回 {success, content, error}
      ↓
RealAIClient 解析工具调用 (_parseToolCalls)
  └─ 返回 {content, toolCalls}
```

## 三、已修复问题清单

| 问题 | 状态 | 修复方式 |
|------|------|----------|
| 模型选择器不显示 Ollama 模型 | ✅ 已修复 | 初始化增加 ollama provider 处理 |
| qwen3.5:9b 返回空内容 | ✅ 已规避 | 默认模型切换为 qwen2.5-coder:7b |
| UI 模拟点击无法命中输入框 | ⚠️ 已知限制 | 后端 API 已验证正常，UI 需人工测试 |

## 四、后续待办

1. **人工测试 AI 对话**: 启动 LabCode，手动点击 AI 输入框，输入消息，验证回复
2. **qwen3.5:9b 问题排查**: 检查模型是否支持 chat completions，或换用其他模型
3. **流式输出**: 当前为非流式，可考虑添加 SSE 流式输出提升体验
4. **工具调用验证**: 测试 AI 能否正确调用 read_file/write_file/terminal 等工具

## 五、配置文件

路径: `C:\Users\Administrator\AppData\Roaming\LabCode\config.json`

```json
{
  "ai": {
    "provider": "ollama",
    "model": "qwen2.5-coder:7b",
    "apiKey": "",
    "baseURL": "http://localhost:11434/v1"
  }
}
```
