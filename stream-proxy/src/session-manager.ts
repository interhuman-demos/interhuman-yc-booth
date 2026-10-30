import WebSocket from 'ws';
import { createInterhumanClient, type InterhumanClient } from './interhuman-client';
import { transcribeBuffer } from './transcription';

const MAX_SESSION_BYTES = parseInt(process.env.DEMO_MAX_SESSION_BYTES ?? '0', 10) || 32 * 1024 * 1024;
const MIN_WINDOW_BYTES = 512;

interface WindowRecord {
  index: number;
  startMs: number;
}

export interface ProxySession {
  sessionId: string;
  browserWs: WebSocket;
  interhumanClient: InterhumanClient | null;
  windowIndex: number;
  totalBytes: number;
  segmentQueue: Promise<void>;
}

/** Send a JSON message to the browser WebSocket if it is still open. */
function sendToBrowser(session: ProxySession, data: unknown): void {
  if (session.browserWs.readyState === WebSocket.OPEN) {
    session.browserWs.send(JSON.stringify(data));
  }
}

/** Handle one binary window: fan out to Interhuman + Whisper independently. */
async function handleBinarySegment(session: ProxySession, bytes: Buffer): Promise<void> {
  if (bytes.length < MIN_WINDOW_BYTES) {
    console.log(`[session ${session.sessionId}] window dropped — too small (${bytes.length} bytes)`);
    return;
  }

  session.totalBytes += bytes.length;
  if (session.totalBytes > MAX_SESSION_BYTES) {
    sendToBrowser(session, { type: 'demo.connection.closed', reason: 'byte_limit_exceeded' });
    session.browserWs.close();
    return;
  }

  const index = session.windowIndex++;
  const startMs = Date.now();
  const win: WindowRecord = { index, startMs };

  console.log(`[session ${session.sessionId}] window ${index} received — ${bytes.length} bytes`);

  sendToBrowser(session, {
    type: 'demo.window.status',
    sessionId: session.sessionId,
    index,
    captureStatus: 'analyzing',
  });

  // Fan out — do NOT await both; they are independent pipelines
  fanOutToInterhuman(session, bytes, index);
  fanOutToWhisper(session, bytes, win);
}

function fanOutToInterhuman(session: ProxySession, bytes: Buffer, index: number): void {
  if (!session.interhumanClient?.isReady) {
    console.log(`[session ${session.sessionId}] window ${index} — Interhuman not ready, skipping`);
    return;
  }
  console.log(`[session ${session.sessionId}] window ${index} — sending ${bytes.length} bytes to Interhuman`);
  session.interhumanClient.send(bytes);
}

async function fanOutToWhisper(session: ProxySession, bytes: Buffer, win: WindowRecord): Promise<void> {
  const text = await transcribeBuffer(bytes, win.index, session.sessionId);

  if (!text) {
    console.log(`[session ${session.sessionId}] window ${win.index} — no transcript`);
    return;
  }

  console.log(`[session ${session.sessionId}] window ${win.index} — transcript: "${text}"`);

  sendToBrowser(session, {
    type: 'demo.transcript.updated',
    sessionId: session.sessionId,
    index: win.index,
    startMs: win.startMs,
    endMs: Date.now(),
    text,
    provider: 'openai',
  });
}

/** Create and initialise a proxy session for a newly connected browser WebSocket. */
export async function createProxySession(
  sessionId: string,
  browserWs: WebSocket
): Promise<ProxySession> {
  const session: ProxySession = {
    sessionId,
    browserWs,
    interhumanClient: null,
    windowIndex: 0,
    totalBytes: 0,
    segmentQueue: Promise.resolve(),
  };

  // Connect upstream — non-fatal if it fails (signals just won't arrive)
  createInterhumanClient()
    .then((client) => {
      session.interhumanClient = client;

      client.onEvent = (event) => {
        if (event.type === 'signal.detected') {
          const data = event.data as {
            signal_type: string;
            start: number;
            end: number;
            probability: string;
            rationale: string;
          };

          const windowSeconds = 5;
          const index = Math.max(0, Math.floor(data.start / windowSeconds));

          console.log(
            `[session ${sessionId}] signal: ${data.signal_type} at ${data.start}s–${data.end}s → window ${index}`
          );

          sendToBrowser(session, {
            type: 'demo.signal.detected',
            sessionId,
            index,
            signal: {
              type: data.signal_type,
              start: data.start,
              end: data.end,
              probability: data.probability,
              rationale: data.rationale,
            },
          });
        }
        // Forward all raw Interhuman events for debugging
        sendToBrowser(session, event);
      };

      client.onClose = () => {
        console.log(`[session ${sessionId}] Interhuman upstream closed`);
      };

      sendToBrowser(session, { type: 'demo.connection.established', sessionId });
      console.log(`[session ${sessionId}] Interhuman upstream ready`);
    })
    .catch((err) => {
      console.error(`[session ${sessionId}] Interhuman upstream failed:`, err.message);
      sendToBrowser(session, { type: 'demo.connection.established', sessionId });
    });

  return session;
}

/** Enqueue a binary segment for ordered processing. */
export function enqueueSegment(session: ProxySession, bytes: Buffer): void {
  session.segmentQueue = session.segmentQueue.then(() =>
    handleBinarySegment(session, bytes)
  );
}

/** Clean up a session. */
export function destroySession(session: ProxySession): void {
  session.interhumanClient?.close();
}
