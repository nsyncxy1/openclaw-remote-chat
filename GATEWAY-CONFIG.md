# OpenClaw Gateway 配置修改指南

## 允许 VS Code 扩展连接

在你的 OpenClaw 配置文件中 (通常是 `~/.openclaw/openclaw.json` 或 `/etc/openclaw/openclaw.json`),添加:

```json
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": [
        "vscode-webview://*"
      ]
    }
  }
}
```

或者允许所有来源 (仅用于开发/测试):

```json
{
  "gateway": {
    "controlUi": {
      "allowedOrigins": ["*"]
    }
  }
}
```

## 重启 Gateway

修改配置后重启 Gateway:

```bash
openclaw gateway restart
```

或者如果是 daemon 模式:

```bash
openclaw gateway stop
openclaw gateway start
```

## 验证配置

```bash
openclaw status
```

查看配置是否生效。
