'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface CountdownTimerProps {
  durationSeconds: number;
  isRunning: boolean;
  onExpire: () => void;
  className?: string;
}

export function CountdownTimer({
  durationSeconds,
  isRunning,
  onExpire,
  className,
}: CountdownTimerProps) {
  const [remaining, setRemaining] = useState(durationSeconds);
  const startTimeRef = useRef<number | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const expiredRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!isRunning) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    if (!startTimeRef.current) {
      startTimeRef.current = Date.now();
    }
    expiredRef.current = false;

    const tick = () => {
      const elapsed = (Date.now() - (startTimeRef.current ?? Date.now())) / 1000;
      const r = Math.max(0, durationSeconds - elapsed);
      setRemaining(r);

      if (r <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpireRef.current();
        return;
      }

      if (r > 0) {
        animFrameRef.current = requestAnimationFrame(tick);
      }
    };

    animFrameRef.current = requestAnimationFrame(tick);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isRunning, durationSeconds]);

  const secs = Math.ceil(remaining);
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  const progress = remaining / durationSeconds;
  const isLow = secs <= 15;
  const isCritical = secs <= 5;

  // SVG circle progress
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex items-center gap-2 rounded-full px-2 py-1.5 backdrop-blur-sm',
        isCritical
          ? 'bg-red-500/20 text-red-300'
          : isLow
            ? 'bg-amber-500/15 text-amber-300'
            : 'bg-black/40 text-white',
        className
      )}
    >
      {/* Time display */}
      <span
        className={cn(
          'inline-block min-w-[2.5ch] font-mono text-sm font-semibold tabular-nums',
          isCritical && 'animate-pulse'
        )}
      >
        {minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`}
      </span>
    </motion.div>
  );
}
