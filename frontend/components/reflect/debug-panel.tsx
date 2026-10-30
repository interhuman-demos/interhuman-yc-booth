'use client';

import { useCallback, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface DebugEntry {
  id: number;
  timestamp: string;
  category: 'proxy' | 'transcript' | 'signal' | 'reflect' | 'garry' | 'phase';
  message: string;
}

let _id = 0;

export function useDebugLog() {
  const [entries, setEntries] = useState<DebugEntry[]>([]);

  const log = useCallback((category: DebugEntry['category'], message: string) => {
    const entry: DebugEntry = {
      id: ++_id,
      timestamp: new Date().toLocaleTimeString('en-GB', {
        hour12: false,
        fractionalSecondDigits: 1,
      }),
      category,
      message,
    };
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[debug:${category}] ${message}`);
    }
    setEntries((prev) => [...prev.slice(-50), entry]);
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  return { entries, log, clear };
}

const CATEGORY_COLORS: Record<DebugEntry['category'], string> = {
  proxy: 'text-blue-400',
  transcript: 'text-emerald-400',
  signal: 'text-violet-400',
  reflect: 'text-amber-400',
  garry: 'text-pink-400',
  phase: 'text-zinc-400',
};

const DIRECTION_ICON: Record<DebugEntry['category'], string> = {
  proxy: '\u2191', // ↑ sending to proxy
  transcript: '\u2193', // ↓ coming back from Whisper
  signal: '\u2193', // ↓ coming back from Interhuman
  reflect: '\u2194', // ↔ internal processing
  garry: '\u2195', // ↕ bidirectional with Garry/LiveKit
  phase: '\u2022', // bullet for state changes
};

interface DebugPanelProps {
  entries: DebugEntry[];
  className?: string;
}

export function DebugPanel({ entries, className }: DebugPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Scroll after each new entry
  if (entries.length > 0) {
    setTimeout(scrollToBottom, 50);
  }

  if (entries.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'border-border/50 overflow-hidden rounded-lg border bg-black/95 font-mono text-[11px] shadow-2xl backdrop-blur-sm',
        className
      )}
    >
      <div className="border-border/30 flex items-center justify-between border-b px-3 py-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-zinc-500 uppercase">
          Debug
        </span>
        <div className="flex gap-3 text-[10px] text-zinc-600">
          <span className={CATEGORY_COLORS.proxy}>proxy</span>
          <span className={CATEGORY_COLORS.transcript}>transcript</span>
          <span className={CATEGORY_COLORS.signal}>signal</span>
          <span className={CATEGORY_COLORS.garry}>garry</span>
        </div>
      </div>
      <div ref={scrollRef} className="max-h-[70vh] space-y-0.5 overflow-y-auto px-3 py-2">
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-2 leading-tight"
            >
              <span className="shrink-0 text-zinc-600">{entry.timestamp}</span>
              <span className={cn('shrink-0', CATEGORY_COLORS[entry.category])}>
                {DIRECTION_ICON[entry.category]}
              </span>
              <span className={cn('w-16 shrink-0', CATEGORY_COLORS[entry.category])}>
                [{entry.category}]
              </span>
              <span className="break-all text-zinc-300">{entry.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
