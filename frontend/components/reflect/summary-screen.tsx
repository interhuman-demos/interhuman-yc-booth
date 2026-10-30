'use client';

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { SignalTimeline } from '@/components/reflect/signal-timeline';
import { Button } from '@/components/ui/button';
import { SIGNAL_LABELS } from '@/lib/reflect-constants';
import type { WindowState } from '@/lib/reflect-types';

function firstSentences(text: string, count: number): string {
  const parts = text.trim().match(/[^.!?]+[.!?]+/g);
  if (!parts) return text.trim();
  return parts.slice(0, count).join(' ').trim();
}

export function SummaryScreen({
  verdict,
  windows,
  onTryAgain,
  onDone,
}: {
  verdict: string;
  windows: WindowState[];
  onTryAgain: () => void;
  onDone: () => void;
}) {
  const stats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of windows) {
      for (const s of w.signals) counts.set(s.type, (counts.get(s.type) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total,
      topLabel: top ? (SIGNAL_LABELS[top[0]]?.label ?? top[0]) : null,
    };
  }, [windows]);

  const recap = firstSentences(verdict, 2);

  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="w-full max-w-2xl"
      >
        <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
          Interview recap
        </p>

        {/* Short verdict */}
        <h1 className="text-foreground text-xl leading-snug font-semibold">
          {recap || 'That’s a wrap.'}
        </h1>

        {/* Quick stats */}
        <div className="text-muted-foreground mt-3 flex flex-wrap gap-4 text-sm">
          <span>
            <span className="text-foreground font-semibold tabular-nums">{stats.total}</span>{' '}
            signals detected
          </span>
          {stats.topLabel && (
            <span>
              Most frequent:{' '}
              <span className="text-foreground font-semibold">{stats.topLabel}</span>
            </span>
          )}
        </div>

        {/* Signal timeline */}
        <div className="border-border/60 bg-card mt-6 rounded-2xl border p-5 shadow-sm">
          <p className="text-muted-foreground mb-4 text-xs font-medium tracking-wide uppercase">
            Signal timeline
          </p>
          <SignalTimeline windows={windows} />
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center gap-3 w-full justify-end">
          <Button pill variant="outline" onClick={onTryAgain}>
            Try again
          </Button>
          <Button pill variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
