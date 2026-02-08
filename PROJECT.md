# OpenClaw Remote Chat Extension

一个支持远程连接 OpenClaw Gateway 的 VS Code 插件。

## ✨ 特性

- ✅ **远程连接** - 通过 WebSocket 连接到任何 OpenClaw Gateway
- ✅ **配置管理** - 可配置 Gateway URL 和认证令牌
- ✅ **聊天界面** - 清爽的侧边栏对话 UI
- ✅ **自动重连** - 断线后自动重连
- ✅ **安全连接** - 支持 WSS 加密连接
- ✅ **状态指示** - 实时显示连接状态

## 📁 项目结构

```
openclaw-remote-chat/
├── src/
│   ├── extension.ts      # 插件入口
│   ├── client.ts         # WebSocket 客户端
│   └── chatView.ts       # 聊天界面
├── resources/
│   └── icon.svg          # 插件图标
├── out/                  # 编译输出
├── package.json          # 插件配置
├── tsconfig.json         # TypeScript 配置
├── README.md             # 项目说明
├── USAGE.md              # 使用指南
└── build.sh              # 打包脚本
```

## 🚀 快速开始

### 开发模式

```bash
cd openclaw-remote-chat
npm install --include=dev
npm run compile
```

在 VS Code 中打开项目,按 `F5` 启动调试。

### 打包安装

```bash
./build.sh
```

会生成 `.vsix` 文件,然后在 VS Code 中:
1. 按 `F1`
2. 输入 `Extensions: Install from VSIX...`
3. 选择生成的 `.vsix` 文件

## 🔧 配置

在 VS Code 设置中:

```json
{
  "openclaw.gatewayUrl": "ws://your-server:18789",
  "openclaw.gatewayToken": "your-token",
  "openclaw.autoConnect": false
}
```

## 💬 使用

1. 点击侧边栏的 OpenClaw 图标
2. 点击 ⚙️ Config 配置连接
3. 点击 Connect 连接
4. 开始对话!

## 🌐 远程连接示例

### 本地 Gateway
```json
{
  "openclaw.gatewayUrl": "ws://localhost:18789"
}
```

### 远程服务器
```json
{
  "openclaw.gatewayUrl": "ws://192.168.1.100:18789",
  "openclaw.gatewayToken": "secret-token"
}
```

### 安全连接 (WSS)
```json
{
  "openclaw.gatewayUrl": "wss://openclaw.example.com:18789",
  "openclaw.gatewayToken": "secret-token"
}
```

## 🛠️ 技术栈

- **TypeScript** - 类型安全的开发
- **VS Code Extension API** - 插件框架
- **WebSocket (ws)** - 实时通信
- **Webview API** - 自定义 UI

## 📝 核心功能实现

### WebSocket 客户端 (client.ts)

- 连接管理
- 消息收发
- 自动重连
- 事件分发

### 聊天界面 (chatView.ts)

- Webview 渲染
- 消息显示
- 输入处理
- 状态更新

### 插件入口 (extension.ts)

- 命令注册
- 配置管理
- 生命周期管理

## 🔒 安全性

- 支持 Token 认证
- 支持 WSS 加密连接
- Token 存储在 VS Code 配置中
- 不在日志中暴露敏感信息

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request!

---

**Made with ❤️ for OpenClaw**
