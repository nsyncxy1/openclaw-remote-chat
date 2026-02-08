# OpenClaw Remote Chat - 使用指南

## 📦 安装

### 方法 1: 从源码安装

1. 打开 VS Code
2. 按 `F1` 打开命令面板
3. 输入 `Extensions: Install from VSIX...`
4. 选择打包好的 `.vsix` 文件

### 方法 2: 开发模式

1. 克隆或复制 `openclaw-remote-chat` 文件夹
2. 在 VS Code 中打开该文件夹
3. 按 `F5` 启动调试模式
4. 会打开一个新的 VS Code 窗口,插件已加载

## 🚀 快速开始

### 1. 配置连接

点击侧边栏的 OpenClaw 图标,然后:

- 点击 **⚙️ Config** 按钮
- 输入 Gateway WebSocket URL:
  - 本地: `ws://localhost:18789`
  - 远程: `ws://your-server.com:18789`
  - 安全连接: `wss://your-server.com:18789`
- 输入 Gateway Token (如果需要)

### 2. 连接

点击 **Connect** 按钮,状态会变成 `● Connected`

### 3. 开始对话

在输入框输入消息,按 `Enter` 发送 (Shift+Enter 换行)

## ⚙️ 配置选项

在 VS Code 设置中搜索 "OpenClaw":

```json
{
  // Gateway WebSocket 地址
  "openclaw.gatewayUrl": "ws://localhost:18789",
  
  // 认证令牌 (可选)
  "openclaw.gatewayToken": "",
  
  // 启动时自动连接
  "openclaw.autoConnect": false
}
```

## 🔧 命令

按 `F1` 或 `Ctrl+Shift+P` 打开命令面板:

- `OpenClaw: Connect to Gateway` - 连接到 Gateway
- `OpenClaw: Disconnect` - 断开连接
- `OpenClaw: Configure Connection` - 配置连接参数

## 🌐 远程连接示例

### 连接到远程服务器

```json
{
  "openclaw.gatewayUrl": "ws://192.168.1.100:18789",
  "openclaw.gatewayToken": "your-secret-token"
}
```

### 通过 HTTPS/WSS 安全连接

```json
{
  "openclaw.gatewayUrl": "wss://openclaw.example.com:18789",
  "openclaw.gatewayToken": "your-secret-token"
}
```

### 通过 SSH 隧道连接

如果你的 Gateway 在防火墙后面:

```bash
# 在本地建立 SSH 隧道
ssh -L 18789:localhost:18789 user@remote-server
```

然后在 VS Code 中连接到 `ws://localhost:18789`

## 🎨 界面说明

- **状态指示器**: 显示连接状态 (绿色=已连接, 红色=断开)
- **Config 按钮**: 快速配置连接参数
- **Connect/Disconnect**: 连接/断开按钮
- **消息区域**: 显示对话历史
- **输入框**: 输入消息 (Enter 发送, Shift+Enter 换行)

## 🔒 安全建议

1. **使用 WSS** - 生产环境建议使用加密连接
2. **保护 Token** - 不要在公开的配置文件中暴露 token
3. **防火墙** - 限制 Gateway 端口的访问权限
4. **定期更新** - 保持 OpenClaw 和插件最新版本

## 🐛 故障排除

### 连接失败

1. 检查 Gateway 是否运行: `openclaw gateway status`
2. 检查 URL 是否正确 (注意 `ws://` 或 `wss://`)
3. 检查防火墙是否允许连接
4. 查看 VS Code 输出面板的错误信息

### 消息发送失败

1. 确认连接状态为 "Connected"
2. 检查 Gateway 日志
3. 尝试重新连接

### 自动重连

插件会在断开连接后自动尝试重连 (每 5 秒一次)

## 📝 开发

### 编译

```bash
cd openclaw-remote-chat
npm install
npm run compile
```

### 打包

```bash
npm install -g @vscode/vsce
vsce package
```

会生成 `openclaw-remote-chat-0.1.0.vsix` 文件

### 调试

1. 在 VS Code 中打开项目
2. 按 `F5` 启动调试
3. 在新窗口中测试插件

## 📄 许可证

MIT License

---

**享受远程 OpenClaw 对话吧! 🎉**
