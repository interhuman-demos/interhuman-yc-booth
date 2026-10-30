import * as crypto from 'crypto';

function getSecret(): string {
  return process.env.DEMO_STREAM_PROXY_TOKEN_SECRET ?? '';
}

interface TokenPayload {
  sessionId: string;
  iat: number; // issued-at unix seconds
  exp: number; // expiry unix seconds
}

/** Encode a payload to base64url (no padding). */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Mint a short-lived token: "base64url(payload).signature" */
export function mintToken(sessionId: string, ttlSeconds = 300): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = { sessionId, iat: now, exp: now + ttlSeconds };
  const encoded = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

/**
 * Verify a token. Returns the payload on success, throws on failure.
 * Token format: "base64url(payload).hmac"
 */
export function verifyToken(token: string): TokenPayload {
  const secret = getSecret();
  if (!secret) throw new Error('Token secret not configured');

  const dot = token.lastIndexOf('.');
  if (dot === -1) throw new Error('Invalid token format');

  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  // Constant-time comparison
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    throw new Error('Token signature mismatch');
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
  } catch {
    throw new Error('Token payload unreadable');
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.exp) throw new Error('Token expired');

  return payload;
}
