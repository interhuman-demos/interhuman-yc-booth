'use client';

import { useEffect, useRef } from 'react';
import { DITHER_DATA } from './dither-data';

export const DitherAnimation = ({ className, color }: { className?: string; color?: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resolvedColor = color
      ? color
      : getComputedStyle(document.documentElement).getPropertyValue('--color-foreground').trim();

    const S: Record<number, number> = { 1: 0.28, 2: 0.52, 3: 0.88 };
    const d = Uint8Array.from(atob(DITHER_DATA), (c) => c.charCodeAt(0));
    let o = 0;
    const r8 = () => d[o++];
    const r16 = () => {
      const v = d[o] | (d[o + 1] << 8);
      o += 2;
      return v;
    };

    o += 2;
    r8();
    const W = r16();
    const H = r16();
    const cs = r8();
    const gap = r8() / 10;
    const fps = r8();
    const fc = r16();
    const ps = r16();

    const pal: [number, number, number][] = [];
    for (let i = 0; i < ps; i++) pal.push([r8(), r8(), r8()]);

    const cols = Math.floor(W / cs);
    const cc = cols * Math.floor(H / cs);
    const frames: Uint16Array[] = [];
    let prev = new Uint16Array(cc);

    for (let f = 0; f < fc; f++) {
      const g = new Uint16Array(cc);
      if (f === 0) {
        for (let i = 0; i < cc; i++) g[i] = (r8() << 8) | r8();
      } else {
        g.set(prev);
        const n = r16();
        for (let i = 0; i < n; i++) {
          const ci = r16();
          g[ci] = (r8() << 8) | r8();
        }
      }
      frames.push(g);
      prev = g;
    }

    canvas.width = W;
    canvas.height = H;
    const cx = canvas.getContext('2d');
    if (!cx) return;

    let fi = 0;
    const ec = cs - gap;

    function draw() {
      if (!cx) return;
      cx.clearRect(0, 0, W, H);
      const g = frames[fi];
      for (let i = 0; i < cc; i++) {
        const p = g[i];
        if (!p) continue;
        const sz = (p >> 8) & 3;
        const ci = p & 255;
        if (!sz) continue;
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * cs + cs / 2;
        const y = row * cs + cs / 2;
        const r = (ec / 2) * S[sz];
        cx.fillStyle = resolvedColor || `rgb(${pal[ci]})`;
        cx.beginPath();
        cx.arc(x, y, r, 0, 6.283);
        cx.fill();
      }
      fi = (fi + 1) % fc;
    }

    const interval = setInterval(draw, 1000 / fps);
    return () => clearInterval(interval);
  }, [color]);

  return <canvas ref={canvasRef} className={className} />;
};
