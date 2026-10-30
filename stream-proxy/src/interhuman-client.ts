import WebSocket from 'ws';

const API_BASE = process.env.API_PLATFORM_BASE_URL ?? 'https://api.interhuman.ai';
const INTERHUMAN_API_KEY = process.env.INTERHUMAN_API_KEY ?? '';

const UPSTREAM_WS_URL = API_BASE.replace(/^https?:/, (p) =>
  p === 'https:' ? 'wss:' : 'ws:'
) + '/v1/stream/analyze';

export type InterhumanEvent =
  | { type: 'signal.detected'; correlation_id: string; data: { signal_type: string; start: number; end: number; probability: string; rationale: string } }
  | { type: 'engagement.updated'; data: unknown }
  | { type: 'session.ready'; data: unknown }
  | { type: 'error'; data: unknown }
  | { type: string; [k: string]: unknown };

export interface InterhumanClient {
  send(bytes: Buffer): void;
  close(): void;
  onEvent: ((event: InterhumanEvent) => void) | null;
  onClose: (() => void) | null;
  isReady: boolean;
}

export function createInterhumanClient(): Promise<InterhumanClient> {
  return new Promise((resolve, reject) => {
    if (!INTERHUMAN_API_KEY) {
      return reject(new Error('INTERHUMAN_API_KEY is not set'));
    }

    const ws = new WebSocket(UPSTREAM_WS_URL, {
      headers: { Authorization: `Bearer ${INTERHUMAN_API_KEY}` },
      perMessageDeflate: false,
    });

    const client: InterhumanClient = {
      isReady: false,
      onEvent: null,
      onClose: null,
      send(bytes: Buffer) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(bytes);
        }
      },
      close() {
        ws.close();
      },
    };

    ws.once('open', () => {
      client.isReady = true;
      resolve(client);
    });

    ws.once('error', (err) => {
      if (!client.isReady) reject(err);
    });

    ws.on('message', (data) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const event: InterhumanEvent = JSON.parse(text);
        console.log(`[interhuman] event: ${event.type}`, JSON.stringify(event).slice(0, 200));
        client.onEvent?.(event);
      } catch {
        // non-JSON ignored
      }
    });

    ws.on('close', () => {
      client.isReady = false;
      client.onClose?.();
    });
  });
}
