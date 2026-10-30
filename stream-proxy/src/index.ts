import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env FIRST — before any other modules read process.env
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyToken } from './token';
import { createProxySession, enqueueSegment, destroySession, type ProxySession } from './session-manager';

const PORT = parseInt(process.env.PORT ?? '8787', 10);

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

// ─── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({
  noServer: true,
  // Echo the client's sub-protocol back — browsers reject upgrades without this
  handleProtocols(protocols) {
    return protocols.values().next().value ?? false;
  },
});

const activeSessions = new Map<string, ProxySession>();

wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage, sessionId: string) => {
  console.log(`[ws] session ${sessionId} connected`);

  const session = await createProxySession(sessionId, ws);
  activeSessions.set(sessionId, session);

  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (isBinary) {
      enqueueSegment(session, Buffer.isBuffer(data) ? data : Buffer.from(data));
    } else {
      // JSON control frames (e.g. demo.flush)
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'demo.flush') {
          console.log(`[session ${sessionId}] flush received`);
        }
      } catch { /* ignore */ }
    }
  });

  ws.on('close', () => {
    console.log(`[ws] session ${sessionId} disconnected`);
    destroySession(session);
    activeSessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[ws] session ${sessionId} error:`, err.message);
  });
});

// ─── Upgrade handler ──────────────────────────────────────────────────────────

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname !== '/v1/demo/stream') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  // Token comes from the Sec-WebSocket-Protocol header (browser limitation)
  const protocols = req.headers['sec-websocket-protocol'] ?? '';
  const token = Array.isArray(protocols) ? protocols[0] : protocols.split(',')[0].trim();

  let sessionId: string;
  try {
    const payload = verifyToken(token);
    sessionId = payload.sessionId;
  } catch (err) {
    console.warn('[ws] rejected connection — invalid token:', (err as Error).message);
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, sessionId);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`Stream proxy listening on port ${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}/v1/demo/stream`);
  console.log(`  Health:    http://localhost:${PORT}/healthz`);
});
