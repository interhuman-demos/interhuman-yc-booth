'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MIN_SEGMENT_BYTES, REFLECT_WINDOW_MS } from '@/lib/reflect-constants';
import type { Signal, SignalEvent, TranscriptEvent, WindowState } from '@/lib/reflect-types';

type ProxyStatus = 'idle' | 'connecting' | 'connected' | 'recording' | 'stopped' | 'error';

type DebugLogFn = (
  category: 'proxy' | 'transcript' | 'signal' | 'reflect' | 'garry' | 'phase',
  message: string
) => void;

interface UseStreamProxyOptions {
  /** Debug logger injected from parent */
  log?: DebugLogFn;
}

export function useStreamProxy({ log }: UseStreamProxyOptions = {}) {
  const [status, setStatus] = useState<ProxyStatus>('idle');
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);

  // Keep a ref that always has the latest windows — avoids stale closures
  const windowsRef = useRef<WindowState[]>([]);
  windowsRef.current = windows;

  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const initSegmentRef = useRef<ArrayBuffer | null>(null);
  const windowIndexRef = useRef(0);
  const isRecordingRef = useRef(false);
  const isMutedRef = useRef(false);

  // Utility: update a window by index
  const patchWindow = useCallback((index: number, patch: Partial<WindowState>) => {
    setWindows((prev) => prev.map((w) => (w.index === index ? { ...w, ...patch } : w)));
  }, []);

  const connectProxy = useCallback(async (): Promise<WebSocket> => {
    // Get a session token from our web app API route
    const res = await fetch('/api/demo/stream/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        consent: { cameraMic: true, termsAccepted: true },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to create stream session');
    }

    const session = await res.json();
    const ws = new WebSocket(session.wsUrl, session.token);

    return new Promise((resolve, reject) => {
      ws.onopen = () => {
        wsRef.current = ws;
        setStatus('connected');
        log?.('proxy', 'WebSocket connected to stream proxy');
        resolve(ws);
      };
      ws.onerror = () => {
        log?.('proxy', 'WebSocket connection error');
        reject(new Error('WebSocket connection failed'));
      };
      ws.onclose = () => {
        if (isRecordingRef.current) {
          setStatus('error');
          setError('Proxy connection closed unexpectedly');
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'demo.transcript.updated') {
            const e = data as TranscriptEvent;
            log?.(
              'transcript',
              `↓ Window ${e.index}: "${e.text.slice(0, 60)}${e.text.length > 60 ? '…' : ''}"`
            );
            patchWindow(e.index, {
              transcriptText: e.text,
              transcriptStatus: 'ok',
            });
          } else if (data.type === 'demo.signal.detected') {
            const e = data as SignalEvent;
            log?.(
              'signal',
              `↓ Window ${e.index}: ${e.signal.type} (confidence: ${e.signal.probability ?? 'n/a'})`
            );
            setWindows((prev) =>
              prev.map((w) =>
                w.index === e.index
                  ? { ...w, signals: [...w.signals, e.signal], signalStatus: 'ok' }
                  : w
              )
            );
          }
        } catch {
          // non-JSON frames ignored
        }
      };
    });
  }, [patchWindow, log]);

  const requestCamera = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: true,
    });
    streamRef.current = stream;
    setLocalStream(stream);
    log?.('proxy', 'Camera acquired');
    return stream;
  }, [log]);

  const preConnect = useCallback(async () => {
    try {
      setStatus('connecting');
      await connectProxy();
    } catch (proxyErr) {
      console.warn('[useStreamProxy] Proxy pre-connect failed:', proxyErr);
      setError('Stream proxy unavailable — recording without signal analysis');
    }
  }, [connectProxy]);

  const startRecording = useCallback(async () => {
    setError(null);

    try {
      // Use the already-acquired stream, or request one now as a fallback
      let stream = streamRef.current;
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: true,
        });
        streamRef.current = stream;
        setLocalStream(stream);
      }

      // Use pre-connected WebSocket if available, otherwise connect now
      let ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        try {
          ws = await connectProxy();
        } catch (proxyErr) {
          console.warn('[useStreamProxy] Proxy unavailable, recording without analysis:', proxyErr);
          setError('Stream proxy unavailable — recording without signal analysis');
        }
      }

      // Use video/webm so both video + audio go to Interhuman and Whisper
      const mimeType =
        [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm',
          'audio/webm;codecs=opus',
        ].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      initSegmentRef.current = null;
      isRecordingRef.current = true;

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size < MIN_SEGMENT_BYTES) {
          log?.('proxy', `⚠ Chunk too small (${event.data?.size ?? 0}B) — skipped`);
          return;
        }
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          log?.('proxy', `⚠ WebSocket not open — chunk dropped`);
          return;
        }
        if (isMutedRef.current) return;

        const buf = await event.data.arrayBuffer();

        let payload: ArrayBuffer;
        if (!initSegmentRef.current) {
          // First chunk: extract the EBML init segment (header + tracks, before the
          // first Cluster element). The Cluster element ID is 0x1F43B675.
          const bytes = new Uint8Array(buf);
          let clusterOffset = -1;
          for (let i = 0; i < bytes.length - 3; i++) {
            if (
              bytes[i] === 0x1f &&
              bytes[i + 1] === 0x43 &&
              bytes[i + 2] === 0xb6 &&
              bytes[i + 3] === 0x75
            ) {
              clusterOffset = i;
              break;
            }
          }
          if (clusterOffset > 0) {
            initSegmentRef.current = buf.slice(0, clusterOffset);
          }
          // First chunk is already self-contained — send as-is
          payload = buf;
        } else {
          // Subsequent chunks: prepend just the init segment (header) so Whisper/Interhuman
          // can decode them independently.
          const init = new Uint8Array(initSegmentRef.current);
          const chunk = new Uint8Array(buf);
          const combined = new Uint8Array(init.byteLength + chunk.byteLength);
          combined.set(init, 0);
          combined.set(chunk, init.byteLength);
          payload = combined.buffer;
        }

        const idx = windowIndexRef.current++;
        const nowMs = Date.now();

        setWindows((prev) => [
          ...prev,
          {
            index: idx,
            startMs: nowMs - REFLECT_WINDOW_MS,
            endMs: nowMs,
            transcriptText: undefined,
            signals: [],
            transcriptStatus: 'pending',
            signalStatus: 'pending',
          },
        ]);

        ws.send(payload);
        log?.(
          'proxy',
          `\u2191 Window ${idx} sent to Interhuman (${(payload.byteLength / 1024).toFixed(0)}KB)`
        );
      };

      recorder.start(REFLECT_WINDOW_MS);
      setStatus('recording');
      log?.('proxy', `Recording started — ${REFLECT_WINDOW_MS}ms windows`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording';
      setError(msg);
      setStatus('error');
    }
  }, [connectProxy, log]);

  const stopRecording = useCallback(() => {
    isRecordingRef.current = false;
    log?.('proxy', 'Recording stopped — flushing final chunk');

    const recorder = recorderRef.current;
    const ws = wsRef.current;

    if (recorder && recorder.state !== 'inactive') {
      // Flush whatever has been recorded so far as a final chunk
      recorder.requestData();
      // Give ondataavailable time to fire, then clean up
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setLocalStream(null);
        // Send flush AFTER the final chunk has been sent over the WS
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'demo.flush' }));
          setTimeout(() => ws.close(), 10_000);
        }
      }, 300);
    } else {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setLocalStream(null);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'demo.flush' }));
        setTimeout(() => ws.close(), 10_000);
      }
    }

    setStatus('stopped');
  }, [log]);

  // Build a flat transcript string for the /api/reflect call — reads from ref for freshness
  const getTranscript = useCallback((): string => {
    return windowsRef.current
      .filter((w) => w.transcriptText)
      .map((w) => w.transcriptText!)
      .join(' ');
  }, []);

  // Inject a typed message into the transcript as a synthetic window
  const injectText = useCallback((text: string) => {
    const idx = windowIndexRef.current++;
    const nowMs = Date.now();
    setWindows((prev) => [
      ...prev,
      {
        index: idx,
        startMs: nowMs,
        endMs: nowMs,
        transcriptText: text,
        signals: [],
        transcriptStatus: 'ok',
        signalStatus: 'ok',
      },
    ]);
  }, []);

  // Collect all signals across all windows — reads from ref for freshness
  const getAllSignals = useCallback((): Signal[] => {
    return windowsRef.current.flatMap((w) => w.signals);
  }, []);

  // Reset for a fresh session
  const reset = useCallback(() => {
    setWindows([]);
    setStatus('idle');
    setError(null);
    setLocalStream(null);
    windowIndexRef.current = 0;
    initSegmentRef.current = null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
    };
  }, []);

  // Mute/unmute the audio tracks on the recording stream
  const [isMuted, setIsMuted] = useState(false);
  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const audioTracks = stream.getAudioTracks();
    const newMuted = !isMutedRef.current;
    audioTracks.forEach((t) => {
      t.enabled = !newMuted;
    });
    isMutedRef.current = newMuted;
    setIsMuted(newMuted);
  }, []);

  return {
    status,
    windows,
    error,
    localStream,
    isMuted,
    toggleMute,
    requestCamera,
    preConnect,
    startRecording,
    stopRecording,
    injectText,
    getTranscript,
    getAllSignals,
    reset,
  };
}
