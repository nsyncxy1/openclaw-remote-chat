import WebSocket from 'ws';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

// -----------------------------------------------------------------------------
// Device identity & connect-signature helpers
//
// These mirror openclaw/openclaw/src/infra/device-identity.ts and
// src/gateway/device-auth.ts so the gateway can verify our connect frame.
// Without a valid device signature the gateway accepts the socket but
// strips scopes, which is why chat.send returned
// {"code":"INVALID_REQUEST","message":"missing scope: operator.write"}.
// -----------------------------------------------------------------------------

// 12-byte ASN.1 prefix in front of a raw Ed25519 public key when exported as SPKI DER.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

// Must stay in sync with src/gateway/protocol/client-info.ts on the server.
const CLIENT_ID_GATEWAY_CLIENT = 'gateway-client';
const CLIENT_MODE_BACKEND = 'backend';

const SIGN_PAYLOAD_VERSION = 'v3';
const CLIENT_VERSION = '0.1.3';

interface StoredDeviceIdentity {
    version: 1;
    deviceId: string;
    publicKeyPem: string;
    privateKeyPem: string;
    createdAtMs: number;
}

function base64UrlEncode(buf: Buffer): string {
    return buf
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
    const key = crypto.createPublicKey(publicKeyPem);
    const spki = key.export({ type: 'spki', format: 'der' }) as Buffer;
    if (
        spki.length === ED25519_SPKI_PREFIX.length + 32 &&
        spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
    ) {
        return spki.subarray(ED25519_SPKI_PREFIX.length);
    }
    return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
    return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function fingerprintPublicKey(publicKeyPem: string): string {
    return crypto.createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex');
}

function signDevicePayload(privateKeyPem: string, payload: string): string {
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), key);
    return base64UrlEncode(sig);
}

// Mirror of normalizeDeviceMetadataForAuth in
// src/gateway/device-metadata-normalization.ts: trim + ASCII-only lowercasing.
function normalizeDeviceMetadataForAuth(value: string | null | undefined): string {
    if (typeof value !== 'string') {
        return '';
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

function buildDeviceAuthPayloadV3(params: {
    deviceId: string;
    clientId: string;
    clientMode: string;
    role: string;
    scopes: string[];
    signedAtMs: number;
    token?: string | null;
    nonce: string;
    platform?: string | null;
    deviceFamily?: string | null;
}): string {
    return [
        SIGN_PAYLOAD_VERSION,
        params.deviceId,
        params.clientId,
        params.clientMode,
        params.role,
        params.scopes.join(','),
        String(params.signedAtMs),
        params.token ?? '',
        params.nonce,
        normalizeDeviceMetadataForAuth(params.platform),
        normalizeDeviceMetadataForAuth(params.deviceFamily),
    ].join('|');
}

function loadOrCreateDeviceIdentity(filePath: string): StoredDeviceIdentity {
    try {
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<StoredDeviceIdentity>;
            if (
                parsed &&
                parsed.version === 1 &&
                typeof parsed.deviceId === 'string' &&
                typeof parsed.publicKeyPem === 'string' &&
                typeof parsed.privateKeyPem === 'string' &&
                typeof parsed.createdAtMs === 'number'
            ) {
                const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
                // Self-heal if the stored deviceId doesn't match the public key.
                return {
                    version: 1,
                    deviceId: derivedId || parsed.deviceId,
                    publicKeyPem: parsed.publicKeyPem,
                    privateKeyPem: parsed.privateKeyPem,
                    createdAtMs: parsed.createdAtMs,
                };
            }
        }
    } catch {
        // fall through to regenerate
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const identity: StoredDeviceIdentity = {
        version: 1,
        deviceId: fingerprintPublicKey(publicKeyPem),
        publicKeyPem,
        privateKeyPem,
        createdAtMs: Date.now(),
    };

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
        try {
            fs.chmodSync(filePath, 0o600);
        } catch {
            // best-effort on platforms that don't support chmod (Windows)
        }
    } catch (err) {
        console.warn('[OpenClaw] Failed to persist device identity:', err);
    }

    return identity;
}

// -----------------------------------------------------------------------------
// OpenClawClient
// -----------------------------------------------------------------------------

export class OpenClawClient extends EventEmitter {
    private ws: WebSocket | null = null;
    private url: string = '';
    private token: string = '';
    private deviceToken: string | null = null;
    private sessionKey: string = 'main';
    private requestId: number = 0;
    private pendingRequests: Map<string, { resolve: (payload: any) => void; reject: (error: Error) => void }> = new Map();
    private currentResponse: { runId: string; text: string } | null = null;
    private activeRunId: string | null = null;
    private identity: StoredDeviceIdentity | null = null;
    private identityPath: string = '';
    private connectNonce: string | null = null;
    private connectSent: boolean = false;

    /**
     * Point the client at the file used to persist the Ed25519 device identity
     * (generated on first use). The extension should call this before
     * {@link connect} using a path inside `context.globalStorageUri`.
     */
    setIdentityPath(filePath: string): void {
        this.identityPath = filePath;
        try {
            this.identity = loadOrCreateDeviceIdentity(filePath);
            console.log('[OpenClaw] device identity ready:', this.identity.deviceId);
        } catch (err) {
            console.error('[OpenClaw] Failed to initialize device identity:', err);
            this.identity = null;
        }
    }

    /**
     * Provide a previously-issued `deviceToken` (from helloOk.auth.deviceToken).
     * When set, it's preferred over the shared gateway token on reconnect.
     */
    setDeviceToken(token: string | null | undefined): void {
        this.deviceToken = typeof token === 'string' && token.length > 0 ? token : null;
    }

    async connect(url: string, token: string): Promise<void> {
        this.url = url;
        this.token = token;

        if (!this.identity) {
            throw new Error('Device identity not initialized. Call setIdentityPath() first.');
        }

        this.connectNonce = null;
        this.connectSent = false;

        return new Promise((resolve, reject) => {
            let settled = false;
            const settle = (err?: Error) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            };

            try {
                this.ws = new WebSocket(url);

                this.ws.on('open', () => {
                    console.log('[OpenClaw] WebSocket opened, waiting for connect.challenge...');
                    // If the challenge already arrived before `open` fires, send now.
                    if (this.connectNonce && !this.connectSent && this.ws?.readyState === WebSocket.OPEN) {
                        this.sendConnectHandshake()
                            .then(() => {
                                this.emit('connected');
                                settle();
                            })
                            .catch((err) => settle(err instanceof Error ? err : new Error(String(err))));
                    }
                });

                this.ws.on('message', (data: WebSocket.Data) => {
                    let parsed: any;
                    try {
                        parsed = JSON.parse(data.toString());
                    } catch (err) {
                        console.error('[OpenClaw] Failed to parse message:', err);
                        return;
                    }

                    // Intercept connect.challenge so we can sign and send our connect frame.
                    if (
                        parsed?.type === 'event' &&
                        parsed?.event === 'connect.challenge'
                    ) {
                        const nonce = parsed?.payload?.nonce;
                        if (typeof nonce === 'string' && nonce.trim().length > 0) {
                            this.connectNonce = nonce.trim();
                            console.log('[OpenClaw] Received connect.challenge, signing handshake...');
                            if (!this.connectSent && this.ws?.readyState === WebSocket.OPEN) {
                                this.sendConnectHandshake()
                                    .then(() => {
                                        this.emit('connected');
                                        settle();
                                    })
                                    .catch((err) => settle(err instanceof Error ? err : new Error(String(err))));
                            }
                        } else {
                            const err = new Error('connect.challenge missing nonce');
                            this.emit('error', err);
                            settle(err);
                        }
                        return;
                    }

                    this.handleMessage(parsed);
                });

                this.ws.on('close', (code, reason) => {
                    const reasonText = reason?.toString?.() ?? '';
                    console.log('[OpenClaw] WebSocket disconnected:', code, reasonText);
                    this.emit('disconnected');
                    if (!settled) {
                        settle(new Error(`gateway closed (${code}): ${reasonText}`));
                    }
                });

                this.ws.on('error', (error) => {
                    console.error('[OpenClaw] WebSocket error:', error);
                    this.emit('error', error);
                    settle(error instanceof Error ? error : new Error(String(error)));
                });
            } catch (err) {
                settle(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private async sendConnectHandshake(): Promise<void> {
        if (!this.identity) {
            throw new Error('device identity not initialized');
        }
        if (!this.connectNonce) {
            throw new Error('no connect challenge nonce available');
        }
        if (this.connectSent) {
            return;
        }
        this.connectSent = true;

        const role = 'operator';
        const scopes = ['operator.read', 'operator.write'];
        const signedAtMs = Date.now();
        const clientId = CLIENT_ID_GATEWAY_CLIENT;
        const clientMode = CLIENT_MODE_BACKEND;
        const platform = process.platform;

        // Prefer the persisted device token over the shared gateway token.
        const sharedToken = this.token && this.token.length > 0 ? this.token : undefined;
        const resolvedDeviceToken = this.deviceToken && this.deviceToken.length > 0 ? this.deviceToken : undefined;

        // selectConnectAuth on the server sets
        //   authToken = explicitGatewayToken ?? resolvedDeviceToken
        // and uses it as the `signatureToken`.
        const authToken = sharedToken ?? resolvedDeviceToken;
        const signatureToken = authToken ?? '';

        const signPayload = buildDeviceAuthPayloadV3({
            deviceId: this.identity.deviceId,
            clientId,
            clientMode,
            role,
            scopes,
            signedAtMs,
            token: signatureToken,
            nonce: this.connectNonce,
            platform,
        });

        const signature = signDevicePayload(this.identity.privateKeyPem, signPayload);
        const publicKeyBase64Url = publicKeyRawBase64UrlFromPem(this.identity.publicKeyPem);

        const auth: Record<string, string> = {};
        if (authToken) {
            auth.token = authToken;
        }
        if (resolvedDeviceToken) {
            auth.deviceToken = resolvedDeviceToken;
        }

        const reqId = `connect-${Date.now()}`;
        const connectReq = {
            type: 'req',
            id: reqId,
            method: 'connect',
            params: {
                minProtocol: 3,
                maxProtocol: 3,
                client: {
                    id: clientId,
                    version: CLIENT_VERSION,
                    platform,
                    mode: clientMode,
                },
                role,
                scopes,
                caps: [],
                commands: [],
                permissions: {},
                auth: Object.keys(auth).length > 0 ? auth : undefined,
                device: {
                    id: this.identity.deviceId,
                    publicKey: publicKeyBase64Url,
                    signature,
                    signedAt: signedAtMs,
                    nonce: this.connectNonce,
                },
                locale: 'zh-CN',
                userAgent: 'openclaw-vscode/' + CLIENT_VERSION,
            },
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(reqId, {
                resolve: (payload: any) => {
                    // Persist the freshly issued device token so future
                    // reconnects can skip the shared-token path.
                    const issuedDeviceToken = payload?.auth?.deviceToken;
                    if (typeof issuedDeviceToken === 'string' && issuedDeviceToken.length > 0) {
                        this.deviceToken = issuedDeviceToken;
                        this.emit('deviceTokenIssued', issuedDeviceToken);
                    }
                    const grantedScopes = payload?.auth?.scopes;
                    console.log('[OpenClaw] connect ok, granted scopes:', grantedScopes);
                    resolve();
                },
                reject,
            });

            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                this.pendingRequests.delete(reqId);
                reject(new Error('WebSocket is not open'));
                return;
            }

            console.log('[OpenClaw] Sending signed connect frame (deviceId=' + this.identity!.deviceId.slice(0, 12) + '...)');
            this.ws.send(JSON.stringify(connectReq));

            setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new Error('Connect handshake timeout'));
                }
            }, 15000);
        });
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.removeAllListeners();
            try {
                this.ws.close();
            } catch {
                // ignore
            }
            this.ws = null;
        }

        this.connectNonce = null;
        this.connectSent = false;
        this.emit('disconnected');
    }

    sendMessage(text: string): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.emit('error', new Error('Not connected'));
            return;
        }

        const reqId = `msg-${++this.requestId}`;
        const idempotencyKey = `vscode-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
        const message = {
            type: 'req',
            id: reqId,
            method: 'chat.send',
            params: {
                sessionKey: this.sessionKey,
                message: text,
                idempotencyKey
            }
        };

        this.currentResponse = null;
        this.activeRunId = null;

        this.pendingRequests.set(reqId, {
            resolve: (payload: any) => {
                this.activeRunId = payload?.runId || null;
                console.log('[OpenClaw] chat.send ack:', payload);
            },
            reject: (error: Error) => {
                this.emit('error', error);
            }
        });

        console.log('[OpenClaw] Sending message:', message);
        this.ws.send(JSON.stringify(message));
    }

    private handleMessage(message: any): void {
        console.log('[OpenClaw] Received message:', message);

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

        if (message.type === 'event') {
            switch (message.event) {
                case 'connect.challenge':
                    // Handled in connect() above, ignore duplicates here.
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
                case 'chat': {
                    const payload = message.payload || {};
                    const runId = payload.runId || payload.id || this.activeRunId || Date.now().toString();
                    const data = payload.data || {};
                    const eventText = data.text || payload.text || '';
                    const stream = payload.stream;

                    console.log('[OpenClaw] Event: chat, payload:', JSON.stringify(payload).substring(0, 400));

                    if ((stream === 'assistant' || stream === 'stdout') && eventText) {
                        if (!this.currentResponse || this.currentResponse.runId !== runId) {
                            this.currentResponse = { runId, text: eventText };
                        } else {
                            this.currentResponse.text = eventText;
                        }

                        this.emit('stream', {
                            id: runId,
                            role: 'assistant',
                            content: this.currentResponse.text,
                            timestamp: payload.ts || Date.now()
                        });
                        break;
                    }

                    if (stream === 'lifecycle') {
                        if (data.phase === 'end' && this.currentResponse && this.currentResponse.runId === runId) {
                            this.emit('message', {
                                id: runId,
                                role: 'assistant',
                                content: this.currentResponse.text,
                                timestamp: payload.ts || Date.now()
                            });
                            this.currentResponse = null;
                            this.activeRunId = null;
                        }
                        break;
                    }

                    if (payload.role === 'assistant' && eventText) {
                        this.emit('message', {
                            id: runId,
                            role: 'assistant',
                            content: eventText,
                            timestamp: payload.ts || Date.now()
                        });
                    }
                    break;
                }
                case 'agent': {
                    const payload = message.payload || {};
                    const data = payload.data || {};
                    const runId = payload.runId || this.activeRunId || Date.now().toString();

                    console.log('[OpenClaw] Event: agent, payload:', JSON.stringify(payload).substring(0, 400));

                    if ((payload.stream === 'stdout' || payload.stream === 'assistant') && data.text) {
                        if (!this.currentResponse || this.currentResponse.runId !== runId) {
                            this.currentResponse = { runId, text: data.text };
                        } else {
                            this.currentResponse.text = data.text;
                        }

                        this.emit('stream', {
                            id: runId,
                            role: 'assistant',
                            content: this.currentResponse.text,
                            timestamp: payload.ts || Date.now()
                        });
                    } else if (payload.stream === 'lifecycle' && data.phase === 'end' && this.currentResponse && this.currentResponse.runId === runId) {
                        this.emit('message', {
                            id: runId,
                            role: 'assistant',
                            content: this.currentResponse.text,
                            timestamp: payload.ts || Date.now()
                        });
                        this.currentResponse = null;
                        this.activeRunId = null;
                    }
                    break;
                }
                default:
                    console.log('[OpenClaw] Event:', message.event);
            }
        }
    }

    isConnected(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }
}
