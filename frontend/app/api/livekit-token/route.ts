import { NextResponse } from 'next/server';
import { AccessToken, AgentDispatchClient, RoomServiceClient } from 'livekit-server-sdk';
import { randomUUID } from 'crypto';

export const revalidate = 0;

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? '';
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? '';

export async function POST(request: Request) {
  try {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return NextResponse.json(
        { error: 'Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET' },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const roomName: string = body.roomName ?? `garry-${randomUUID()}`;
    const identity: string = body.identity ?? `user-${randomUUID()}`;

    // Create the room first so the agent can be dispatched to it
    const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    await roomService.createRoom({ name: roomName, emptyTimeout: 300 });

    // Dispatch agent to room
    try {
      const dispatchClient = new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
      await dispatchClient.createDispatch(roomName, 'Interhuman YC Booth');
    } catch (dispatchErr) {
      console.warn('[livekit-token] agent dispatch failed (may auto-dispatch):', dispatchErr);
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      ttl: '10m',
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    const wsUrl = LIVEKIT_URL;

    return NextResponse.json(
      { token, roomName, identity, wsUrl },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[livekit-token] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
