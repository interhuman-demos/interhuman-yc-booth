'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type LocalParticipant,
} from 'livekit-client';
import type { AgentMessage, TimerUpMessage, Signal } from '@/lib/reflect-types';

type GarryStatus = 'idle' | 'connecting' | 'connected' | 'speaking' | 'reflecting' | 'error';

type DebugLogFn = (
  category: 'proxy' | 'transcript' | 'signal' | 'reflect' | 'garry' | 'phase',
  message: string
) => void;

interface UseGarrySessionOptions {
  avatarVideoRef: React.RefObject<HTMLVideoElement | null>;
  avatarAudioRef: React.RefObject<HTMLAudioElement | null>;
  log?: DebugLogFn;
}

function isGarryIdentity(identity?: string): boolean {
  return Boolean(
    identity?.startsWith('garry') ||
      identity?.includes('lemonslice') ||
      identity?.includes('avatar') ||
      identity?.includes('agent')
  );
}

export function useGarrySession({ avatarVideoRef, avatarAudioRef, log }: UseGarrySessionOptions) {
  const [status, setStatus] = useState<GarryStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [agentPhase, setAgentPhase] = useState<'interactive' | 'reflecting' | 'done'>('interactive');
  const [reflectionText, setReflectionText] = useState('');
  const [avatarReady, setAvatarReady] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const roomNameRef = useRef<string>('');

  const setStatusLog = useCallback((s: GarryStatus) => {
    setStatus(s);
    log?.('garry', `status → ${s}`);
  }, [log]);

  // Attach remote track to a media element
  const attachTrack = useCallback((track: RemoteTrack, participant?: RemoteParticipant) => {
    log?.('garry', `Remote ${track.kind} track from ${participant?.identity ?? 'unknown'}`);
    if (track.kind === Track.Kind.Video && avatarVideoRef.current) {
      track.attach(avatarVideoRef.current);
      avatarVideoRef.current.play().catch(() => {});
      log?.('garry', 'Avatar video track attached');
      // Fallback readiness signal: if the avatar's video track is subscribed,
      // the avatar is live even if the 'bot_ready' data message never arrives.
      if (isGarryIdentity(participant?.identity)) {
        setAvatarReady(true);
      }
    } else if (track.kind === Track.Kind.Audio && avatarAudioRef.current) {
      track.attach(avatarAudioRef.current);
      avatarAudioRef.current.play().catch(() => {});
      log?.('garry', 'Avatar audio track attached');
    }
  }, [avatarVideoRef, avatarAudioRef, log]);

  // Connect to LiveKit room
  const connect = useCallback(async (scenarioId: string): Promise<string> => {
    setStatusLog('connecting');
    setError(null);
    setReflectionText('');

    try {
      const res = await fetch('/api/livekit-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: `user-${Date.now()}` }),
      });

      if (!res.ok) throw new Error('Failed to get LiveKit token');
      const { token, roomName, wsUrl } = await res.json();
      roomNameRef.current = roomName;

      const room = new Room({
        videoCaptureDefaults: { resolution: VideoPresets.h720 },
        audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true },
      });
      roomRef.current = room;

      // Subscribe to remote tracks (Garry's video + audio from LemonSlice)
      room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
        log?.('garry', `Participant joined: ${participant.identity} (tracks: ${participant.trackPublications.size})`);
      });

      room.on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        log?.('garry', `Track published: ${pub.kind}/${pub.source} from ${participant.identity} (subscribed: ${pub.isSubscribed})`);
      });

      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
        log?.('garry', `Track subscribed: ${track.kind}/${pub.source} from ${participant.identity}`);
        attachTrack(track, participant);
      });

      // Listen for data messages from the agent
      room.on(RoomEvent.DataReceived, (payload: Uint8Array, _participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          log?.('garry', `Data received [topic=${topic ?? 'none'}]: ${msg.type ?? JSON.stringify(msg).slice(0, 80)}`);

          // LemonSlice bot_ready signal
          if (topic === 'lemonslice' && msg.type === 'bot_ready') {
            log?.('garry', `LemonSlice avatar ready! session_id=${msg.session_id}`);
            setAvatarReady(true);
            return;
          }

          if (msg.type === 'garry.phase-change') {
            setAgentPhase(msg.phase);
            log?.('garry', `Agent phase → ${msg.phase}`);
            if (msg.phase === 'reflecting') setStatusLog('reflecting');
            if (msg.phase === 'done') setStatusLog('connected');
          } else if (msg.type === 'garry.speech-chunk') {
            setReflectionText((prev) => prev + msg.text);
            if (msg.isFinal) log?.('garry', 'Agent reflection speech complete');
          }
        } catch {
          // non-JSON data ignored
        }
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const garryIsSpeaking = speakers.some((s) => isGarryIdentity(s.identity));
        setStatus(garryIsSpeaking ? 'speaking' : 'connected');
      });

      room.on(RoomEvent.Disconnected, () => {
        log?.('garry', 'Room disconnected');
        setStatusLog('idle');
      });

      await room.connect(wsUrl, token);
      setStatusLog('connected');

      log?.('garry', `Connected to room: ${roomName}`);

      await room.localParticipant.setMicrophoneEnabled(true);
      log?.('garry', 'Published mic to LiveKit room');

      room.remoteParticipants.forEach((participant) => {
        log?.('garry', `Existing participant: ${participant.identity}`);
        participant.trackPublications.forEach((publication) => {
          const track = publication.track;
          if (track) attachTrack(track, participant);
        });
      });

      // Tell agent which scenario to use via data channel
      const scenarioMsg = JSON.stringify({ type: 'garry.scenario', scenarioId });
      await room.localParticipant.publishData(
        new TextEncoder().encode(scenarioMsg),
        { reliable: true }
      );

      return roomName;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      setError(msg);
      setStatusLog('error');
      throw err;
    }
  }, [attachTrack, setStatusLog, log]);

  // Send time-up message with accumulated transcript+signals
  const sendTimerUp = useCallback(async (transcript: string, signals: Signal[], scenarioId: string) => {
    const room = roomRef.current;
    if (!room || room.state !== 'connected') {
      log?.('garry', 'Cannot send timer-up: room not connected');
      return;
    }

    const msg: TimerUpMessage = {
      type: 'garry.timer-up',
      transcript,
      signals,
      scenarioId,
    };

    log?.('garry', `Sending timer-up: ${transcript.length} chars, ${signals.length} signals`);

    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify(msg)),
      { reliable: true }
    );
  }, [log]);

  const disconnect = useCallback(async () => {
    const room = roomRef.current;
    if (room) {
      await room.disconnect();
      roomRef.current = null;
    }
    setStatus('idle');
    setReflectionText('');
    setAgentPhase('interactive');
    setAvatarReady(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  const isConnected = status !== 'idle' && status !== 'connecting' && status !== 'error';
  const isSpeaking = status === 'speaking';
  const isReflecting = status === 'reflecting';

  return {
    status,
    error,
    agentPhase,
    reflectionText,
    avatarReady,
    isConnected,
    isSpeaking,
    isReflecting,
    connect,
    disconnect,
    sendTimerUp,
    roomName: roomNameRef.current,
  };
}
