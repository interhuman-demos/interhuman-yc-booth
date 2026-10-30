'use client';

import { useCallback, useRef, useState } from 'react';
import type { Signal } from '@/lib/reflect-types';

type ReflectionStatus = 'idle' | 'loading' | 'streaming' | 'done' | 'error';

type DebugLogFn = (
  category: 'proxy' | 'transcript' | 'signal' | 'reflect' | 'garry' | 'phase',
  message: string
) => void;

interface UseReflectionOptions {
  onChunk?: (fullText: string) => void;
  onDone?: () => void;
  log?: DebugLogFn;
}

export function useReflection({ onChunk, onDone, log }: UseReflectionOptions = {}) {
  const [status, setStatus] = useState<ReflectionStatus>('idle');
  const [reflectionText, setReflectionText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startReflection = useCallback(
    async (
      transcript: string,
      signals: Signal[],
      systemPrompt: string
    ) => {
      setStatus('loading');
      setError(null);
      setReflectionText('');

      abortRef.current = new AbortController();

      try {
        log?.(
          'reflect',
          `Calling /api/reflect with ${transcript.length} chars, ${signals.length} signals`
        );
        const res = await fetch('/api/reflect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, signals, systemPrompt }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          log?.('reflect', `API error: ${res.status}`);
          throw new Error(`Reflection API error: ${res.status}`);
        }

        if (!res.body) throw new Error('No response body');

        setStatus('streaming');
        log?.('reflect', 'Streaming reflection from GPT');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') break;
            try {
              const { text } = JSON.parse(payload) as { text: string };
              if (text) {
                accumulated += text;
                setReflectionText(accumulated);
                onChunk?.(accumulated);
              }
            } catch {
              // Malformed SSE line — skip
            }
          }
        }

        setStatus('done');
        log?.('reflect', 'Reflection complete');
        onDone?.();
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'Reflection failed';
        setError(msg);
        setStatus('error');
      }
    },
    [onChunk, onDone, log]
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setStatus('idle');
    setReflectionText('');
    setError(null);
  }, []);

  return { status, reflectionText, error, startReflection, cancel, reset };
}
