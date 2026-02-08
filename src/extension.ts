import * as vscode from 'vscode';
import { OpenClawClient } from './client';
import { ChatViewProvider } from './chatView';

let client: OpenClawClient | undefined;
let chatProvider: ChatViewProvider | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    // Create output channel for logging
    outputChannel = vscode.window.createOutputChannel('OpenClaw Remote Chat');
    outputChannel.appendLine('===== Extension Activated =====');
    outputChannel.appendLine(`Time: ${new Date().toISOString()}`);
    outputChannel.show(); // Show the output channel
    
    console.log('OpenClaw Remote Chat extension activated');

    // Initialize client
    outputChannel.appendLine('Initializing OpenClaw client...');
    client = new OpenClawClient();

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

    // Auto-connect if enabled
    const config = vscode.workspace.getConfiguration('openclaw');
    if (config.get<boolean>('autoConnect')) {
        vscode.commands.executeCommand('openclaw.connect');
    }
}

export function deactivate() {
    client?.disconnect();
}
