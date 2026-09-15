# LabCode

本地优先的 AI 编码桌面端。说需求，AI 读你的项目、改文件、跑编译烧录。

## 下载

[Windows v1.0.0](https://github.com/hulufeng/LabCode/releases/download/v1.0.0/LabCode-Setup-1.0.0.exe)（约 146 MB）

## 特性

- 直接读写项目文件，编辑器实时刷新
- 跑命令、跑测试，报错自动回读修复
- 内置 Arduino / ESP32 工具链：选板、装库、编译、烧录、串口监视
- 插件系统：任何 CLI 工具写个 manifest 即可被 AI 调用
- 本地 Qwen3.5-9B 模型推理，数据不出本机
- 支持接云端 OpenAI 兼容 API

## 开发

```
cd desktop-app
npm install
npm start
```

## 许可证

个人免费使用。
