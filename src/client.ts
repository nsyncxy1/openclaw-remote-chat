import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class OpenClawClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string = '';
    private token: string = '';
    private sessionKey: string = 'main';
    private requestId: number = 0;
    private pendingRequests: Map<string, any> = new Map();
    private currentResponse: { runId: string; text: string } | null = null;

    async connect(url: string, token: string): Promise<void> {
        this.url = url;
        this.token = token;

        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(url);

                this.ws.on('open', () => {
                    console.log('WebSocket opened, sending connect handshake...');
                    this.sendConnectHandshake(token)
                        .then(() => {
                            console.log('Connected to OpenClaw Gateway');
                            this.emit('connected');
                            resolve();
                        })
                        .catch(reject);
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this.handleMessage(message);
                    } catch (error) {
                        console.error('Failed to parse message:', error);
                    }
                });

                this.ws.on('close', () => {
                    console.log('WebSocket disconnected');
                    this.emit('disconnected');
                });

                this.ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    this.emit('error', error);
                    reject(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    private async sendConnectHandshake(token: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const reqId = `connect-${Date.now()}`;
            
            const connectReq = {
                type: 'req',
                id: reqId,
                method: 'connect',
                params: {
                    minProtocol: 3,
                    maxProtocol: 3,
                    client: {
                        id: 'cli',
                        version: '0.1.0',
                        platform: 'vscode',
                        mode: 'cli'
                    },
                    auth: token ? { token } : undefined,
                    locale: 'en-US',
                    userAgent: 'openclaw-vscode/0.1.0'
                }
            };

            this.pendingRequests.set(reqId, { resolve, reject });
            this.ws?.send(JSON.stringify(connectReq));
            
            setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new Error('Connect handshake timeout'));
                }
            }, 10000);
        });
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        
        this.emit('disconnected');
    }

    sendMessage(text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.emit('error', new Error('Not connected'));
            return;
        }

        const reqId = `msg-${++this.requestId}`;
        const message = {
            type: 'req',
            id: reqId,
            method: 'agent',
            params: {
                message: text,
                sessionKey: this.sessionKey,
                idempotencyKey: `vscode-${Date.now()}-${Math.random().toString(36).substring(7)}`
            }
        };

        console.log('Sending message:', message);
        this.ws.send(JSON.stringify(message));
    }

    private handleMessage(message: any): void {
        console.log('Received message:', message);
        
        // Handle responses
        if (message.type === 'res' && message.id) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
                this.pendingRequests.delete(message.id);
                if (message.ok) {
                    pending.resolve(message.payload);
                } else {
                    const errorMsg = typeof message.error === 'object' 
                        ? JSON.stringify(message.error) 
                        : message.error;
                    pending.reject(new Error(errorMsg || 'Request failed'));
                }
            }
            return;
        }
        
        // Handle events
        if (message.type === 'event') {
            switch (message.event) {
                case 'connect.challenge':
                    // Ignore challenge (we're not signing)
                    break;
                case 'session.message':
                    if (message.payload) {
                        this.emit('message', {
                            id: message.payload.id || Date.now().toString(),
                            role: message.payload.role || 'assistant',
                            content: message.payload.content || message.payload.text || '',
                            timestamp: message.payload.timestamp || Date.now()
                        });
                    }
                    break;
                case 'agent':
                    console.log('Event: agent, payload:', JSON.stringify(message.payload).substring(0, 200));
                    // Agent streaming events - accumulate text
                    // Stream can be 'stdout' or 'assistant'
                    if (message.payload && (message.payload.stream === 'stdout' || message.payload.stream === 'assistant')) {
                        const data = message.payload.data;
                        const runId = message.payload.runId;
                        
                        console.log('Agent stream:', { stream: message.payload.stream, runId, hasText: !!data?.text, textLength: data?.text?.length });
                        
                        if (data && data.text) {
                            // Accumulate text
                            if (!this.currentResponse || this.currentResponse.runId !== runId) {
                                this.currentResponse = { runId, text: data.text };
                            } else {
                                this.currentResponse.text = data.text; // Use latest text (already accumulated by Gateway)
                            }
                            
                            // Emit streaming update
                            this.emit('stream', {
                                id: runId,
                                role: 'assistant',
                                content: this.currentResponse.text,
                                timestamp: message.payload.ts || Date.now()
                            });
                        }
                    } else if (message.payload && message.payload.stream === 'lifecycle') {
                        const data = message.payload.data;
                        const runId = message.payload.runId;
                        
                        // When lifecycle ends, emit the complete message
                        if (data && data.phase === 'end' && this.currentResponse && this.currentResponse.runId === runId) {
                            console.log('Emitting complete message:', this.currentResponse.text.substring(0, 100));
                            this.emit('message', {
                                id: runId,
                                role: 'assistant',
                                content: this.currentResponse.text,
                                timestamp: message.payload.ts || Date.now()
                            });
                            this.currentResponse = null;
                        }
                    }
                    break;
                default:
                    console.log('Event:', message.event);
            }
        }
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
