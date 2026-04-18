import * as vscode from 'vscode';
import * as path from 'path';
import { OpenClawClient } from './client';
import { ChatViewProvider } from './chatView';

let client: OpenClawClient | undefined;
let chatProvider: ChatViewProvider | undefined;
let outputChannel: vscode.OutputChannel;

const DEVICE_TOKEN_SECRET_KEY = 'openclaw.deviceToken';

export async function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('OpenClaw Remote Chat');
    outputChannel.appendLine('===== Extension Activated =====');
    outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
    outputChannel.show(); // Show the output channel

    console.log('OpenClaw Remote Chat extension activated');

    // Initialize client
    outputChannel.appendLine('Initializing OpenClaw client...');
    client = new OpenClawClient();

    // Ensure the global storage directory exists (required for device.json).
    try {
        await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    } catch (err) {
        outputChannel.appendLine(`Warning: could not create globalStorage dir: ${err}`);
    }

    // Provision a persistent Ed25519 device identity. The gateway requires a
    // signed `device` field on `connect`; without it scopes are stripped and
    // chat.send fails with "missing scope: operator.write".
    const identityPath = path.join(context.globalStorageUri.fsPath, 'device-identity.json');
    outputChannel.appendLine(`Using device identity file: ${identityPath}`);
    client.setIdentityPath(identityPath);

    // Load a previously issued device token (if any) so reconnects are silent.
    try {
        const cachedDeviceToken = await context.secrets.get(DEVICE_TOKEN_SECRET_KEY);
        if (cachedDeviceToken) {
            client.setDeviceToken(cachedDeviceToken);
            outputChannel.appendLine('Loaded cached device token from SecretStorage');
        }
    } catch (err) {
        outputChannel.appendLine(`Warning: failed to read device token: ${err}`);
    }

    // Persist any newly issued device token so it survives restarts.
    client.on('deviceTokenIssued', async (token: string) => {
        try {
            await context.secrets.store(DEVICE_TOKEN_SECRET_KEY, token);
            outputChannel.appendLine('Stored new device token in SecretStorage');
        } catch (err) {
            outputChannel.appendLine(`Warning: failed to store device token: ${err}`);
        }
    });

    // Register chat view
    outputChannel.appendLine('Registering chat view provider...');
    chatProvider = new ChatViewProvider(context.extensionUri, client, context, outputChannel);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('openclawChat', chatProvider)
    );
    outputChannel.appendLine('Chat view provider registered successfully');

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.connect', async () => {
            const config = vscode.workspace.getConfiguration('openclaw');
            const url = config.get<string>('gatewayUrl') || 'ws://localhost:18789';
            const token = config.get<string>('gatewayToken') || '';

            try {
                await client?.connect(url, token);
                vscode.window.showInformationMessage('Connected to OpenClaw Gateway');
            } catch (error) {
                vscode.window.showErrorMessage(`Connection failed: ${error}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.disconnect', () => {
            client?.disconnect();
            vscode.window.showInformationMessage('Disconnected from OpenClaw Gateway');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.configure', async () => {
            const config = vscode.workspace.getConfiguration('openclaw');

            const url = await vscode.window.showInputBox({
                prompt: 'Gateway WebSocket URL',
                value: config.get<string>('gatewayUrl') || 'ws://localhost:18789',
                placeHolder: 'ws://your-gateway:18789'
            });

            if (url) {
                await config.update('gatewayUrl', url, vscode.ConfigurationTarget.Global);
            }

            const token = await vscode.window.showInputBox({
                prompt: 'Gateway Token (optional)',
                value: config.get<string>('gatewayToken') || '',
                password: true,
                placeHolder: 'your-gateway-token'
            });

            if (token !== undefined) {
                await config.update('gatewayToken', token, vscode.ConfigurationTarget.Global);
            }

            vscode.window.showInformationMessage('Configuration saved');
        })
    );

    // Reset the cached device identity + device token (useful if the gateway
    // was re-provisioned and your old pairing is no longer valid).
    context.subscriptions.push(
        vscode.commands.registerCommand('openclaw.resetDeviceIdentity', async () => {
            try {
                await context.secrets.delete(DEVICE_TOKEN_SECRET_KEY);
                const fs = await import('fs');
                if (fs.existsSync(identityPath)) {
                    fs.unlinkSync(identityPath);
                }
                client?.setDeviceToken(null);
                client?.setIdentityPath(identityPath);
                vscode.window.showInformationMessage('OpenClaw device identity reset. Please reconnect.');
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to reset identity: ${err}`);
            }
        })
    );

    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('openclaw');
    if (config.get<boolean>('autoConnect')) {
        vscode.commands.executeCommand('openclaw.connect');
    }
}

export function deactivate() {
    client?.disconnect();
}
