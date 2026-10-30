import { NextResponse } from 'next/server';
import { createHmac, randomUUID } from 'crypto';

const TOKEN_TTL_SECONDS = 300;

export const revalidate = 0;

function getTokenSecret(): string {
  const secret = process.env.DEMO_STREAM_PROXY_TOKEN_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('DEMO_STREAM_PROXY_TOKEN_SECRET is not configured');
  }
  return secret;
}

function mintToken(sessionId: string, visitorId: string): string {
  const secret = getTokenSecret();
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ sessionId, visitorId, exp: now + TOKEN_TTL_SECONDS }),
    'utf8',
  ).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function POST() {
  try {
    const proxyUrl = process.env.DEMO_STREAM_PROXY_URL;
    if (!proxyUrl) {
      const msg = 'Missing environment variable: DEMO_STREAM_PROXY_URL';
      console.error('[stream/session]', msg);
      return NextResponse.json({ error: msg }, { status: 500 });
    }

    const sessionId = randomUUID();
    const visitorId = randomUUID();
    const token = mintToken(sessionId, visitorId);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();

    return NextResponse.json(
      { sessionId, wsUrl: proxyUrl, token, expiresAt },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[stream/session] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
