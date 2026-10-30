'use client';

import { useMemo } from 'react';
import { SIGNAL_LABELS } from '@/lib/reflect-constants';
import type { WindowState } from '@/lib/reflect-types';
import { cn } from '@/lib/utils';

const SIGNAL_COLORS: Record<string, string> = {
  agreement: 'oklch(0.55 0.15 145)',
  confidence: 'oklch(0.55 0.15 240)',
  confusion: 'oklch(0.60 0.13 75)',
  disagreement: 'oklch(0.52 0.18 25)',
  disengagement: 'oklch(0.52 0.04 250)',
  engagement: 'oklch(0.55 0.18 295)',
  frustration: 'oklch(0.58 0.16 45)',
  hesitation: 'oklch(0.62 0.13 90)',
  interest: 'oklch(0.55 0.15 215)',
  skepticism: 'oklch(0.52 0.04 270)',
  stress: 'oklch(0.52 0.18 10)',
  uncertainty: 'oklch(0.55 0.15 310)',
};

function opacityFor(probability?: string): number {
  if (probability === 'high') return 1;
  if (probability === 'medium') return 0.6;
  return 0.3;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface TimelineBar {
  start: number;
  end: number;
  hasEnd: boolean;
  probability?: string;
  rationale?: string;
}

interface TimelineRow {
  type: string;
  label: string;
  color: string;
  bars: TimelineBar[];
}

// Signals often arrive without an explicit `end` (only `signal.detected` with a
// start is stored). Draw those as a short fixed-width marker instead of
// stretching them across the whole timeline.
const DEFAULT_MARKER_S = 2;

export function SignalTimeline({
  windows,
  className,
}: {
  windows: WindowState[];
  className?: string;
}) {
  const { rows, duration } = useMemo(() => {
    const byType = new Map<string, TimelineRow>();
    let maxTime = 0;

    // Total recording length (relative seconds), used as a floor for the axis.
    const firstStartMs = windows.find((w) => w.startMs > 0)?.startMs ?? 0;
    const lastEndMs = windows.reduce((m, w) => Math.max(m, w.endMs), 0);
    const recordingLengthS = firstStartMs > 0 ? (lastEndMs - firstStartMs) / 1000 : 0;

    for (const w of windows) {
      for (const s of w.signals) {
        // `s.start`/`s.end` are already seconds since the recording started.
        if (s.start == null) continue;
        const start = Math.max(0, s.start);
        const hasEnd = s.end != null && s.end > start;
        const end = hasEnd ? s.end! : start + DEFAULT_MARKER_S;
        maxTime = Math.max(maxTime, end);

        let row = byType.get(s.type);
        if (!row) {
          row = {
            type: s.type,
            label: SIGNAL_LABELS[s.type]?.label ?? s.type,
            color: SIGNAL_COLORS[s.type] ?? 'oklch(0.60 0.04 0)',
            bars: [],
          };
          byType.set(s.type, row);
        }
        row.bars.push({
          start,
          end,
          hasEnd,
          probability: s.probability,
          rationale: s.rationale,
        });
      }
    }

    const sortedRows = [...byType.values()].sort((a, b) => a.label.localeCompare(b.label));
    return {
      rows: sortedRows,
      duration: Math.max(maxTime, recordingLengthS, 1),
    };
  }, [windows]);

  if (rows.length === 0) {
    return (
      <div className={cn('text-muted-foreground/60 text-center text-sm', className)}>
        No signals detected during the pitch.
      </div>
    );
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * duration);

  return (
    <div className={cn('w-full', className)}>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.type} className="flex items-center gap-3">
            <div className="text-muted-foreground w-24 shrink-0 truncate text-right font-mono text-[10px] tracking-wide uppercase">
              {row.label}
            </div>
            <div className="bg-muted/30 relative h-5 flex-1 overflow-hidden rounded">
              {row.bars.map((bar, i) => {
                const left = Math.min(100, (bar.start / duration) * 100);
                const rawWidth = ((bar.end - bar.start) / duration) * 100;
                const width = Math.min(100 - left, Math.max(2, rawWidth));
                return (
                  <div
                    key={i}
                    className="absolute inset-y-0.5 rounded-sm"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor: row.color,
                      opacity: opacityFor(bar.probability),
                    }}
                    title={`${row.label} · ${
                      bar.hasEnd
                        ? `${formatTime(bar.start)}–${formatTime(bar.end)}`
                        : `at ${formatTime(bar.start)}`
                    }${bar.rationale ? `\n${bar.rationale}` : ''}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Time axis */}
      <div className="mt-2 flex items-center gap-3">
        <div className="w-24 shrink-0" />
        <div className="text-muted-foreground/60 flex flex-1 justify-between font-mono text-[10px] tabular-nums">
          {ticks.map((t, i) => (
            <span key={i}>{formatTime(t)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
