import * as vscode from 'vscode';
import { OpenClawClient, Message } from './client';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private messages: Message[] = [];
    private isConnected: boolean = false;
    private readonly STORAGE_KEY = 'openclaw.messages';
    private webviewReady: boolean = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly client: OpenClawClient,
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel
    ) {
        this.log('ChatViewProvider constructor called');
        // Don't load messages here - load in resolveWebviewView instead
        // to ensure fresh data on each view restoration

        // Listen to client events
        this.client.on('connected', () => {
            this.log('Client connected event received');
            this.isConnected = true;
            this.updateStatus('connected');
        });

        this.client.on('disconnected', () => {
            this.isConnected = false;
            this.updateStatus('disconnected');
        });

        this.client.on('stream', (message: Message) => {
            // Streaming update - update existing message or create placeholder
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'stream',
                    message: message
                });
            }
        });

        this.client.on('message', (message: Message) => {
            this.messages.push(message);
            this.saveMessages(); // Persist to storage
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'message',
                    message: message
                });
            }
        });

        this.client.on('error', (error: Error) => {
            this.showError(error.message);
        });
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this.log('===== resolveWebviewView CALLED =====');
        this.log(`Context: ${JSON.stringify({ state: context.state, hasView: !!this._view })}`);
        
        this._view = webviewView;

        // Load persisted messages EVERY TIME the view is resolved
        const savedMessages = this.context.globalState.get<Message[]>(this.STORAGE_KEY);
        this.log(`Raw saved messages from storage: ${JSON.stringify(savedMessages)}`);
        
        if (savedMessages && Array.isArray(savedMessages)) {
            this.messages = savedMessages;
            this.log(`Loaded ${this.messages.length} messages from storage on view resolve`);
            this.log(`Message details: ${JSON.stringify(this.messages.map(m => ({
                id: m.id,
                role: m.role,
                contentLength: m.content.length,
                preview: m.content.substring(0, 50)
            })))}`);
        } else {
            this.log('No saved messages found in storage (or not an array)');
        }

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this.getHtml();

        this.log(`Webview resolved, current state: messageCount=${this.messages.length}, isConnected=${this.isConnected}`);
        this.log(`Messages: ${JSON.stringify(this.messages.map(m => ({ role: m.role, content: m.content.substring(0, 50) })))}`);

        // Restore messages and status when webview is shown
        // Use longer delay to ensure webview is fully loaded
        setTimeout(() => {
            this.log(`Restoring state after delay: messageCount=${this.messages.length}, isConnected=${this.isConnected}`);
            
            if (this.messages.length > 0) {
                this.log(`Sending ${this.messages.length} messages to webview`);
                this.messages.forEach((msg, index) => {
                    this.log(`Sending message ${index}: ${msg.role} ${msg.content.substring(0, 30)}`);
                    this._view?.webview.postMessage({
                        type: 'message',
                        message: msg
                    });
                });
            } else {
                this.log('No messages to restore');
            }
            
            // Check if we should be connected but aren't
            const config = vscode.workspace.getConfiguration('openclaw');
            const url = config.get<string>('gatewayUrl');
            if (url && !this.isConnected && this.messages.length > 0) {
                // Auto-reconnect if we had messages (meaning we were connected before)
                this.log('Auto-reconnecting...');
                vscode.commands.executeCommand('openclaw.connect');
            } else {
                this.updateStatus(this.isConnected ? 'connected' : 'disconnected');
            }
        }, 500); // Increased delay

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(data => {
            this.log(`Received message from webview: ${data.type}`);
            switch (data.type) {
                case 'webviewReady':
                    this.log('Webview ready signal received');
                    this.webviewReady = true;
                    // Resend messages if we have any
                    if (this.messages.length > 0) {
                        this.log(`Resending ${this.messages.length} messages after webview ready`);
                        this.messages.forEach((msg, index) => {
                            this.log(`Resending message ${index}: ${msg.role}`);
                            this._view?.webview.postMessage({
                                type: 'message',
                                message: msg
                            });
                        });
                    }
                    // Update status
                    this.updateStatus(this.isConnected ? 'connected' : 'disconnected');
                    break;
                case 'send':
                    this.handleSendMessage(data.text);
                    break;
                case 'connect':
                    vscode.commands.executeCommand('openclaw.connect');
                    break;
                case 'disconnect':
                    vscode.commands.executeCommand('openclaw.disconnect');
                    break;
                case 'configure':
                    vscode.commands.executeCommand('openclaw.configure');
                    break;
                case 'saveConfig':
                    this.handleSaveConfig(data.url, data.token);
                    break;
                case 'newSession':
                    this.log('newSession message received from webview');
                    this.handleNewSession();
                    break;
            }
        });
    }

    private handleSendMessage(text: string) {
        if (!text.trim()) {
            return;
        }

        // Add user message to UI
        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            timestamp: Date.now()
        };
        this.messages.push(userMessage);
        this.saveMessages(); // Persist to storage
        this._view?.webview.postMessage({
            type: 'message',
            message: userMessage
        });

        // Send to gateway
        this.client.sendMessage(text);
    }

    private async handleSaveConfig(url: string, token: string) {
        const config = vscode.workspace.getConfiguration('openclaw');
        await config.update('gatewayUrl', url, vscode.ConfigurationTarget.Global);
        await config.update('gatewayToken', token, vscode.ConfigurationTarget.Global);
        
        // Auto-connect after saving
        vscode.commands.executeCommand('openclaw.connect');
    }

    private handleNewSession() {
        this.log(`handleNewSession called - clearing ${this.messages.length} messages`);
        
        // Clear messages
        this.messages = [];
        this.saveMessages(); // Clear storage
        
        // Clear UI
        this._view?.webview.postMessage({
            type: 'clearMessages'
        });
        
        vscode.window.showInformationMessage('New session started');
    }

    private saveMessages() {
        // Log stack trace to see where this is called from
        const stack = new Error().stack;
        this.log(`saveMessages called from: ${stack?.split('\n')[2]?.trim()}`);
        this.log(`Saving ${this.messages.length} messages to storage`);
        this.context.globalState.update(this.STORAGE_KEY, this.messages);
    }

    private log(message: string) {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
        console.log('[ChatView]', message);
    }


    private updateStatus(status: string) {
        this._view?.webview.postMessage({
            type: 'status',
            status: status
        });
    }

    private showError(error: string) {
        this._view?.webview.postMessage({
            type: 'error',
            error: error
        });
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <title>OpenClaw Remote Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        #header {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        #tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tab {
            padding: 10px 20px;
            cursor: pointer;
            border-bottom: 2px solid transparent;
        }
        .tab.active {
            border-bottom-color: var(--vscode-focusBorder);
        }
        .tab-content {
            display: none;
            flex: 1;
            flex-direction: column;
        }
        .tab-content.active {
            display: flex;
        }
        #messages {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        .message {
            margin: 10px 0;
            padding: 8px;
            border-radius: 4px;
        }
        .message.user {
            background: var(--vscode-input-background);
            text-align: right;
        }
        .message.assistant {
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        .message h1, .message h2, .message h3 {
            margin: 8px 0 4px 0;
            font-weight: bold;
        }
        .message h1 { font-size: 18px; }
        .message h2 { font-size: 16px; }
        .message h3 { font-size: 14px; }
        .message code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 2px;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }
        .message pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }
        .message pre code {
            background: none;
            padding: 0;
        }
        .message ul {
            margin: 8px 0;
            padding-left: 20px;
        }
        .message li {
            margin: 4px 0;
        }
        .message a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        .message a:hover {
            text-decoration: underline;
        }
        .message strong {
            font-weight: bold;
        }
        .message em {
            font-style: italic;
        }
        #input-area {
            padding: 10px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
        }
        textarea {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            resize: none;
            min-height: 60px;
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            font-size: 13px;
            border-radius: 2px;
            min-width: 60px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.secondary-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        #config-content {
            padding: 20px;
            overflow-y: auto;
        }
        input {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px;
            margin: 8px 0;
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div id="header">
        <span id="status">● Disconnected</span>
    </div>
    
    <div id="tabs">
        <div class="tab active" data-tab="chat">💬 Chat</div>
        <div class="tab" data-tab="config">⚙️ Config</div>
    </div>
    
    <div id="chat-content" class="tab-content active">
        <div id="messages">
            <div class="empty-state">
                <h3>No messages yet</h3>
                <p>Configure your connection and start chatting!</p>
            </div>
        </div>
        <div id="input-area">
            <textarea id="input" placeholder="Type a message..."></textarea>
            <div style="display: flex; gap: 8px; align-self: flex-end;">
                <button type="button" id="new-session">New</button>
                <button type="button" id="send">Send</button>
            </div>
        </div>
    </div>
    
    <div id="config-content" class="tab-content">
        <h3>Gateway Connection</h3>
        <label>WebSocket URL</label>
        <input type="text" id="gateway-url" value="ws://localhost:18789" placeholder="ws://localhost:18789">
        
        <label>Token (optional)</label>
        <input type="password" id="gateway-token" placeholder="your-token">
        
        <button type="button" id="save-connect" style="margin-top: 10px;">Save & Connect</button>
        
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--vscode-panel-border);">
            <h4>Examples:</h4>
            <p>Local: ws://localhost:18789</p>
            <p>Remote: ws://192.168.1.100:18789</p>
            <p>Secure: wss://your-server.com:18789</p>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let messageCount = 0;
        let isConnected = false;
        
        // Initialize after a short delay to ensure DOM is ready
        setTimeout(function() {
            console.log('[Webview] Initializing...');
            
            // Notify extension that webview is ready
            vscode.postMessage({ type: 'webviewReady' });
            
            // Tab switching
            document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', function() {
                const targetTab = this.getAttribute('data-tab');
                
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                this.classList.add('active');
                
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(targetTab + '-content').classList.add('active');
            });
        });
        
        function sendMessage() {
            const input = document.getElementById('input');
            const text = input.value.trim();
            if (!text) return;
            
            if (!isConnected) {
                // Show error in UI instead of alert
                console.log('[Webview] Not connected');
                return;
            }
            
            vscode.postMessage({ type: 'send', text: text });
            input.value = '';
        }
        
        function saveAndConnect() {
            const url = document.getElementById('gateway-url').value.trim();
            const token = document.getElementById('gateway-token').value.trim();
            
            if (!url) {
                alert('URL is required');
                return;
            }
            
            if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
                alert('URL must start with ws:// or wss://');
                return;
            }
            
            vscode.setState({ gatewayUrl: url, gatewayToken: token });
            vscode.postMessage({ type: 'saveConfig', url: url, token: token });
        }
        
        
        function newSession() {
            console.log('[Webview] newSession function called');
            console.log('[Webview] Call stack:', new Error().stack);
            vscode.postMessage({ type: 'newSession' });
        }
        
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('[Webview] Received:', message.type, message);
            switch (message.type) {
                case 'stream':
                    updateStreamingMessage(message.message);
                    break;
                case 'message':
                    addMessage(message.message);
                    break;
                case 'status':
                    updateStatus(message.status);
                    break;
                case 'error':
                    alert('Error: ' + message.error);
                    break;
                case 'clearMessages':
                    clearMessages();
                    break;
            }
        });
        
        function clearMessages() {
            const messagesDiv = document.getElementById('messages');
            messagesDiv.innerHTML = '<div class="empty-state"><h3>New session started</h3><p>Start chatting!</p></div>';
            messageCount = 0;
        }
        
        function updateStreamingMessage(msg) {
            console.log('[Webview] Updating streaming message:', msg.id);
            const messagesDiv = document.getElementById('messages');
            
            // Find existing message by ID
            let existingDiv = document.getElementById('msg-' + msg.id);
            
            if (!existingDiv) {
                // Create new message div
                if (messageCount === 0) {
                    messagesDiv.innerHTML = '';
                }
                messageCount++;
                
                existingDiv = document.createElement('div');
                existingDiv.id = 'msg-' + msg.id;
                existingDiv.className = 'message ' + msg.role;
                
                const roleDiv = document.createElement('div');
                roleDiv.style.fontSize = '11px';
                roleDiv.style.fontWeight = 'bold';
                roleDiv.style.marginBottom = '4px';
                roleDiv.style.opacity = '0.7';
                roleDiv.textContent = 'OpenClaw';
                
                const contentDiv = document.createElement('div');
                contentDiv.className = 'message-content';
                contentDiv.style.whiteSpace = 'pre-wrap';
                
                existingDiv.appendChild(roleDiv);
                existingDiv.appendChild(contentDiv);
                messagesDiv.appendChild(existingDiv);
            }
            
            // Update content
            const contentDiv = existingDiv.querySelector('.message-content');
            if (contentDiv) {
                contentDiv.textContent = msg.content;
            }
            
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        
        function addMessage(msg) {
            console.log('[Webview] Adding message:', {
                id: msg.id,
                role: msg.role,
                contentLength: msg.content.length,
                preview: msg.content.substring(0, 50)
            });
            const messagesDiv = document.getElementById('messages');
            
            // Check if this message already exists (from streaming)
            let existingDiv = document.getElementById('msg-' + msg.id);
            
            if (existingDiv) {
                console.log('[Webview] Message already exists (from streaming), updating content');
                // Just update the content (final version)
                const contentDiv = existingDiv.querySelector('.message-content');
                if (contentDiv) {
                    contentDiv.textContent = msg.content;
                }
                return;
            }
            
            if (messageCount === 0) {
                console.log('[Webview] First message, clearing empty state');
                messagesDiv.innerHTML = '';
            }
            messageCount++;
            
            const div = document.createElement('div');
            div.id = 'msg-' + msg.id;
            div.className = 'message ' + msg.role;
            
            const roleDiv = document.createElement('div');
            roleDiv.style.fontSize = '11px';
            roleDiv.style.fontWeight = 'bold';
            roleDiv.style.marginBottom = '4px';
            roleDiv.style.opacity = '0.7';
            roleDiv.textContent = msg.role === 'user' ? 'You' : 'OpenClaw';
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.style.whiteSpace = 'pre-wrap';
            contentDiv.textContent = msg.content;
            
            div.appendChild(roleDiv);
            div.appendChild(contentDiv);
            messagesDiv.appendChild(div);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
            console.log('[Webview] Message added, total:', messageCount);
        }
        
        function updateStatus(status) {
            isConnected = status === 'connected';
            const statusEl = document.getElementById('status');
            
            statusEl.textContent = isConnected ? '● Connected' : '● Disconnected';
            statusEl.style.color = isConnected ? 'var(--vscode-testing-iconPassed)' : 'var(--vscode-descriptionForeground)';
            
            if (isConnected) {
                // Switch to chat tab
                document.querySelector('.tab[data-tab="chat"]').click();
            }
        }
        
        // Load saved config
        const state = vscode.getState() || {};
        if (state.gatewayUrl) {
            document.getElementById('gateway-url').value = state.gatewayUrl;
        }
        if (state.gatewayToken) {
            document.getElementById('gateway-token').value = state.gatewayToken;
        }
        
        // Enter to send
        document.getElementById('input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        
        // Button listeners
        document.getElementById('send').addEventListener('click', function() {
            console.log('[Webview] Send button clicked');
            sendMessage();
        });
        
        // Single click to clear chat
        document.getElementById('new-session').addEventListener('click', function() {
            console.log('[Webview] New Session button clicked');
            newSession();
        });
        
        document.getElementById('save-connect').addEventListener('click', function() {
            console.log('[Webview] Save & Connect button clicked');
            saveAndConnect();
        });
        
        console.log('[Webview] Initialized');
        }, 100); // Wait 100ms for DOM
    </script>
</body>
</html>`;
    }
}
