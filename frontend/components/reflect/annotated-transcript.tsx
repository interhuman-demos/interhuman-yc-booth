'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useMeasure from 'react-use-measure';
import { Activity, FileText, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { Dialog } from '@base-ui/react/dialog';
import { SIGNAL_LABELS } from '@/lib/reflect-constants';
import type { Signal, WindowState } from '@/lib/reflect-types';
import { cn } from '@/lib/utils';

const WORD_STAGGER_MS = 40;
const signalSpring = { type: 'spring' as const, duration: 0.3, bounce: 0 };

const PANEL_WIDTH = 360;

export function AnnotatedTranscript({
  windows,
  isRecording,
  onClose,
  className,
}: {
  windows: WindowState[];
  isRecording?: boolean;
  onClose?: () => void;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const windowRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [selectedSignal, setSelectedSignal] = useState<Signal | null>(null);

  const recordingStartMs = useMemo(() => {
    const first = windows.find((w) => w.startMs > 0);
    return first?.startMs ?? 0;
  }, [windows[0]?.startMs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const windowCount = windows.filter((w) => w.transcriptText).length;
    if (windowCount > prevCountRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    prevCountRef.current = windowCount;
  }, [windows]);

  const hasContent = windows.some((w) => w.transcriptText || w.signals.length > 0);

  const [contentRef, bounds] = useMeasure();

  return (
    <motion.aside
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: PANEL_WIDTH, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ type: 'spring', duration: 0.5, bounce: 0 }}
      className={cn(
        'border-border/60 bg-card relative flex h-full shrink-0 flex-col overflow-hidden border-l',
        className
      )}
      style={{ willChange: 'width, opacity' }}
    >
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 12 }}
        transition={{ type: 'spring', duration: 0.4, bounce: 0, delay: 0.08 }}
        className="flex h-full flex-col"
        style={{ width: PANEL_WIDTH }}
      >
        {/* Header */}
        <div className="border-border/40 flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              Live transcript with social signals
            </p>
          </div>
        </div>

        {/* Empty state */}
        {!hasContent && !isRecording && (
          <div className="flex flex-1 items-center justify-center px-6">
            <p className="text-muted-foreground/60 text-center text-sm">
              Transcript will appear as you speak…
            </p>
          </div>
        )}

        {/* Scrollable content */}
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <MotionConfig transition={{ duration: 0.4, type: 'spring', bounce: 0 }}>
            <motion.div animate={{ height: bounds.height > 0 ? bounds.height : 'auto' }}>
              <div ref={contentRef}>
                <div className="space-y-2.5">
                  <AnimatePresence initial={false}>
                    {windows.map((w) => {
                      if (!w.transcriptText && w.signals.length === 0) return null;
                      return (
                        <TranscriptSegment
                          key={w.index}
                          windowIndex={w.index}
                          startMs={w.startMs - recordingStartMs}
                          endMs={w.endMs - recordingStartMs}
                          text={w.transcriptText}
                          signals={w.signals}
                          analyzing={w.transcriptStatus === 'pending' && !w.transcriptText}
                          onMount={(el) => windowRefs.current.set(w.index, el)}
                          onSignalClick={setSelectedSignal}
                        />
                      );
                    })}
                  </AnimatePresence>

                  {/* Listening indicator */}
                  <AnimatePresence>
                    {isRecording && (
                      <motion.div
                        key="listening"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.3 }}
                        className="flex items-center gap-2 px-2 py-1"
                      >
                        <motion.span
                          animate={{ backgroundPosition: '-200% 0' }}
                          className="bg-[linear-gradient(110deg,#6b6b6b,35%,#fff,50%,#6b6b6b,75%,#6b6b6b)] bg-[length:200%_100%] bg-clip-text text-xs font-medium text-transparent"
                          initial={{ backgroundPosition: '200% 0' }}
                          transition={{
                            repeat: Number.POSITIVE_INFINITY,
                            duration: 2.5,
                            ease: [0.4, 0, 0.2, 1],
                          }}
                        >
                          Thinking…
                        </motion.span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          </MotionConfig>
        </div>
      </motion.div>

      {/* Signal detail dialog */}
      <SignalDetailDialog signal={selectedSignal} onClose={() => setSelectedSignal(null)} />
    </motion.aside>
  );
}

function TranscriptSegment({
  windowIndex,
  startMs,
  endMs,
  text,
  signals,
  analyzing,
  onMount,
  onSignalClick,
}: {
  windowIndex: number;
  startMs: number;
  endMs: number;
  text?: string;
  signals: Signal[];
  analyzing: boolean;
  onMount?: (el: HTMLDivElement | null) => void;
  onSignalClick?: (signal: Signal) => void;
}) {
  const shouldReduceMotion = useReducedMotion();

  const topRationale = !text
    ? signals
        .filter((s) => s.rationale?.trim())
        .sort((a, b) => {
          const order: Record<string, number> = { high: 3, medium: 2, low: 1 };
          return (order[b.probability ?? ''] ?? 0) - (order[a.probability ?? ''] ?? 0);
        })[0]
        ?.rationale?.trim()
    : undefined;

  return (
    <motion.div
      ref={onMount}
      layout="position"
      initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5"
    >
      <span className="text-muted-foreground/60 font-mono text-[10px] tabular-nums">
        {formatTime(startMs)}–{formatTime(endMs)}
      </span>
      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1">
        {text && <StreamingText text={text} windowIndex={windowIndex} />}
        {!text && topRationale && (
          <p className="text-muted-foreground w-full text-sm italic">{topRationale}</p>
        )}
        <AnimatePresence>
          {signals.map((signal, i) => (
            <InlineSignalBadge
              key={`${signal.type}-${signal.start}-${i}`}
              signal={signal}
              index={i}
              onClick={() => onSignalClick?.(signal)}
            />
          ))}
        </AnimatePresence>
        {analyzing && !text && !topRationale && (
          <span className="text-muted-foreground animate-pulse text-sm">Analyzing…</span>
        )}
      </div>
    </motion.div>
  );
}

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function StreamingText({ text, windowIndex }: { text: string; windowIndex: number }) {
  const shouldReduceMotion = useReducedMotion();
  const words = useMemo(() => text.split(/(\s+)/), [text]);
  const prevWordCountRef = useRef(0);
  const baseDelay = prevWordCountRef.current;

  useEffect(() => {
    prevWordCountRef.current = words.length;
  }, [words.length]);

  if (shouldReduceMotion) {
    return <span className="text-foreground/90 text-sm leading-relaxed">{text}</span>;
  }

  return (
    <span className="text-foreground/90 text-sm leading-relaxed">
      {words.map((word, i) => {
        const isNew = i >= baseDelay;
        if (!word.trim()) return word;
        return (
          <motion.span
            key={`${windowIndex}-${i}`}
            initial={isNew ? { opacity: 0, filter: 'blur(4px)' } : false}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            transition={{
              duration: 0.2,
              delay: isNew ? (i - baseDelay) * (WORD_STAGGER_MS / 1000) : 0,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
          >
            {word}
          </motion.span>
        );
      })}
    </span>
  );
}

function barCount(probability?: string): number {
  if (probability === 'high') return 3;
  if (probability === 'medium') return 2;
  return 1;
}

function InlineSignalBadge({
  signal,
  index,
  onClick,
}: {
  signal: Signal;
  index: number;
  onClick?: () => void;
}) {
  const shouldReduceMotion = useReducedMotion();
  const meta = SIGNAL_LABELS[signal.type];

  const colorMap: Record<string, string> = {
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
  const color = colorMap[signal.type] ?? 'oklch(0.60 0.04 0)';
  const label = meta?.label ?? signal.type;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.8, filter: 'blur(2px)' }}
      transition={{ ...signalSpring, delay: index * 0.08 }}
      className="inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] leading-tight tracking-wide uppercase transition-opacity will-change-transform hover:opacity-80 active:scale-[0.96]"
      style={{
        backgroundColor: `color-mix(in oklch, ${color} 10%, transparent)`,
        color,
        border: `1px solid color-mix(in oklch, ${color} 30%, transparent)`,
      }}
      title={signal.rationale ? 'Click for details' : undefined}
    >
      <span className="inline-flex h-[10px] shrink-0 items-end gap-[1.5px]" aria-hidden>
        {[1, 2, 3].map((level) => (
          <span
            key={level}
            className="w-[3px] rounded-[1px]"
            style={{
              height: `${level * 3 + 1}px`,
              backgroundColor:
                level <= barCount(signal.probability)
                  ? color
                  : `color-mix(in oklch, ${color} 25%, transparent)`,
            }}
          />
        ))}
      </span>
      {label}
    </motion.button>
  );
}

// ─── Signal Detail Dialog ────────────────────────────────────────────────────

const PROBABILITY_LABELS: Record<string, { text: string; bars: number }> = {
  high: { text: 'High confidence', bars: 3 },
  medium: { text: 'Medium confidence', bars: 2 },
  low: { text: 'Low confidence', bars: 1 },
};

function SignalDetailDialog({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  const meta = signal ? SIGNAL_LABELS[signal.type] : null;
  const prob = signal?.probability ? PROBABILITY_LABELS[signal.probability] : null;

  const colorMap: Record<string, string> = {
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
  const color = signal ? (colorMap[signal.type] ?? 'oklch(0.60 0.04 0)') : '';

  return (
    <Dialog.Root
      open={!!signal}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 4 }}
            transition={{ type: 'spring', duration: 0.35, bounce: 0 }}
            className="border-border/60 bg-card w-full max-w-sm rounded-2xl border p-0 shadow-xl"
          >
            {signal && (
              <>
                {/* Header */}
                <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-0">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex size-8 items-center justify-center rounded-lg"
                      style={{ backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}
                    >
                      <Activity className="size-4" style={{ color }} />
                    </div>
                    <div>
                      <Dialog.Title className="text-foreground text-sm font-semibold">
                        {meta?.label ?? signal.type}
                      </Dialog.Title>
                      {prob && (
                        <p className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                          <span className="inline-flex h-[8px] items-end gap-[1.5px]" aria-hidden>
                            {[1, 2, 3].map((level) => (
                              <span
                                key={level}
                                className="w-[2.5px] rounded-[1px]"
                                style={{
                                  height: `${level * 2.5 + 1}px`,
                                  backgroundColor:
                                    level <= prob.bars
                                      ? color
                                      : `color-mix(in oklch, ${color} 25%, transparent)`,
                                }}
                              />
                            ))}
                          </span>
                          {prob.text}
                        </p>
                      )}
                    </div>
                  </div>
                  <Dialog.Close className="text-muted-foreground/60 hover:bg-muted hover:text-foreground relative flex size-7 items-center justify-center rounded-lg transition-colors before:absolute before:inset-[-4px] before:content-['']">
                    <X className="size-3.5" />
                  </Dialog.Close>
                </div>

                {/* Content */}
                <div className="space-y-3 px-5 pt-4 pb-5">
                  {signal.rationale && (
                    <div>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
                        Rationale
                      </p>
                      <p className="text-foreground/90 text-sm leading-relaxed">
                        {signal.rationale}
                      </p>
                    </div>
                  )}

                  {(signal.start != null || signal.end != null) && (
                    <div>
                      <p className="text-muted-foreground mb-1.5 text-xs font-medium tracking-wide uppercase">
                        Timeframe
                      </p>
                      <p className="text-foreground/70 font-mono text-sm tabular-nums">
                        {signal.start != null && formatTime(signal.start * 1000)}
                        {signal.start != null && signal.end != null && ' – '}
                        {signal.end != null && formatTime(signal.end * 1000)}
                      </p>
                    </div>
                  )}

                  {!signal.rationale && !signal.start && !signal.end && (
                    <p className="text-muted-foreground text-sm italic">
                      No additional details available for this signal.
                    </p>
                  )}
                </div>
              </>
            )}
          </motion.div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
