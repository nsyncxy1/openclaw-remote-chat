# OpenClaw Remote Chat

VS Code extension for remote chat with OpenClaw Gateway via WebSocket.

（2026.4.18）vscode插件连接的时候需要在openclaw web页面 的节点  Devices   列表中同意你的设备，然后在vscode插件中重新连接就可以了。。

## Features

- 🌐 **Remote Connection** - Connect to OpenClaw Gateway over WebSocket
- 💬 **Chat Interface** - Clean sidebar chat UI
- 🔐 **Token Auth** - Secure connection with gateway token
- ⚙️ **Easy Config** - Configure URL and token via UI
- 🔄 **Auto-Reconnect** - Automatic reconnection on disconnect

## Quick Start

1. **Install the extension**
2. **Configure connection**:
   - Click the ⚙️ Config button in the chat panel
   - Enter your Gateway WebSocket URL (e.g., `ws://your-server:18789`)
   - Enter your gateway token (optional)
3. **Connect**:
   - Click the "Connect" button
   - Start chatting!

## Configuration

Open VS Code settings and search for "OpenClaw":

- `openclaw.gatewayUrl` - Gateway WebSocket URL (default: `ws://localhost:18789`)
- `openclaw.gatewayToken` - Authentication token
- `openclaw.autoConnect` - Auto-connect on startup (default: `false`)

## Commands

- `OpenClaw: Connect to Gateway` - Connect to configured gateway
- `OpenClaw: Disconnect` - Disconnect from gateway
- `OpenClaw: Configure Connection` - Set URL and token

## Usage

### Local Gateway

```json
{
  "openclaw.gatewayUrl": "ws://localhost:18789",
  "openclaw.gatewayToken": ""
}
```

### Remote Gateway

```json
{
  "openclaw.gatewayUrl": "ws://your-server.com:18789",
  "openclaw.gatewayToken": "your-secret-token"
}
```

### Secure Connection (WSS)

```json
{
  "openclaw.gatewayUrl": "wss://your-server.com:18789",
  "openclaw.gatewayToken": "your-secret-token"
}
```

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Package
npm run package
```

## Requirements

- VS Code 1.80.0 or higher
- OpenClaw Gateway running with WebSocket support

## License

MIT
