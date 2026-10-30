let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

export type RingingHandle = { stop: () => void };

export function startRinging(): RingingHandle {
  try {
    const ctx = getAudioContext();
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);

    // High-pass filter to keep it "crisp" and mobile-friendly
    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = 'highpass';
    hpFilter.frequency.value = 400;
    masterGain.connect(hpFilter);
    hpFilter.connect(ctx.destination);

    let stopped = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    /**
     * Creates a percussive "chime" note
     * @param freq - Base frequency (e.g., 880 for A5)
     * @param startTime - When to play
     */
    function playChime(freq: number, startTime: number) {
      const duration = 0.4;
      // We use three oscillators to create a "glassy" additive tone
      const oscs = [1, 2, 4.01].map((ratio) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq * ratio, startTime);

        // Percussive Envelope
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(ratio === 1 ? 0.6 : 0.2, startTime + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        osc.connect(gain);
        gain.connect(masterGain);
        return osc;
      });
      oscs.forEach((o) => {
        o.start(startTime);
        o.stop(startTime + duration);
      });
    }

    function ring() {
      if (stopped) return;
      const t = ctx.currentTime;

      // The FaceTime "Gallop" (Frequencies roughly G5 and C6)
      const high = 146.5; // C6
      const mid = 783.99; // G5

      // Pattern timing in seconds
      playChime(mid, t);
      playChime(high, t + 0.12);
      playChime(high, t + 0.24);
      playChime(mid, t + 0.48);
      playChime(high, t + 0.6);

      // Loop every 2 seconds
      timeoutId = setTimeout(ring, 2000);
    }

    ring();

    return {
      stop() {
        stopped = true;
        if (timeoutId) clearTimeout(timeoutId);
        masterGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
        setTimeout(() => {
          try {
            ctx.close();
          } catch {}
        }, 600);
      },
    };
  } catch {
    return { stop() {} };
  }
}

export const sounds = {
  click: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.008, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 50);
      }
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 4000 + Math.random() * 1000;
      filter.Q.value = 3;

      const gain = ctx.createGain();
      gain.gain.value = 0.5 + Math.random() * 0.15;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
    } catch {}
  },

  pop: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, t);
      osc.frequency.exponentialRampToValueAtTime(150, t + 0.04);

      gain.gain.setValueAtTime(0.35, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.05);
    } catch {}
  },

  toggle: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.012, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 80);
      }
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2500;
      filter.Q.value = 4;

      const gain = ctx.createGain();
      gain.gain.value = 0.4;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, t);
      osc.frequency.exponentialRampToValueAtTime(400, t + 0.03);
      oscGain.gain.setValueAtTime(0.15, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.04);
    } catch {}
  },

  tick: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.004, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 20);
      }
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 3000;

      const gain = ctx.createGain();
      gain.gain.value = 0.3;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
    } catch {}
  },

  whoosh: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const env = Math.sin((i / data.length) * Math.PI);
        data[i] = (Math.random() * 2 - 1) * env;
      }
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(4000, t);
      filter.frequency.exponentialRampToValueAtTime(1500, t + 0.08);
      filter.Q.value = 1;

      const gain = ctx.createGain();
      gain.gain.value = 0.15;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);
    } catch {}
  },

  success: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const notes = [523.25, 659.25, 783.99];
      const spacing = 0.08;

      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc2.type = 'sine';
        osc2.frequency.value = freq * 2;

        filter.type = 'lowpass';
        filter.frequency.value = 3000;

        const start = t + i * spacing;
        const duration = 0.15;

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);

        osc.connect(gain);
        osc2.connect(gain);
        gain.connect(filter);
        filter.connect(ctx.destination);

        osc.start(start);
        osc2.start(start);
        osc.stop(start + duration);
        osc2.stop(start + duration);
      });

      const shimmer = ctx.createOscillator();
      const shimmerGain = ctx.createGain();
      shimmer.type = 'sine';
      shimmer.frequency.value = 1046.5;
      shimmerGain.gain.setValueAtTime(0, t + 0.24);
      shimmerGain.gain.linearRampToValueAtTime(0.15, t + 0.26);
      shimmerGain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(ctx.destination);
      shimmer.start(t + 0.24);
      shimmer.stop(t + 0.45);
    } catch {}
  },

  confirm: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.015, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / 100);
      }
      noise.buffer = buf;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 2000;
      filter.Q.value = 2;

      const gain = ctx.createGain();
      gain.gain.value = 0.4;

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(60, t + 0.05);
      oscGain.gain.setValueAtTime(0.25, t);
      oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    } catch {}
  },

  error: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();
      const distortion = ctx.createWaveShaper();

      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) {
        const x = i / 128 - 1;
        curve[i] = Math.tanh(x * 2);
      }
      distortion.curve = curve;

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(180, t);
      osc1.frequency.exponentialRampToValueAtTime(80, t + 0.25);

      osc2.type = 'square';
      osc2.frequency.setValueAtTime(190, t);
      osc2.frequency.exponentialRampToValueAtTime(85, t + 0.25);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02);
      gain.gain.setValueAtTime(0.3, t + 0.08);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 800;

      osc1.connect(distortion);
      osc2.connect(distortion);
      distortion.connect(gain);
      gain.connect(filter);
      filter.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.3);
      osc2.stop(t + 0.3);
    } catch {}
  },

  hangup: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      // Two descending tones — low, heavy, final
      const tones = [
        { freq: 480, endFreq: 220, start: 0, duration: 0.18 },
        { freq: 300, endFreq: 120, start: 0.14, duration: 0.22 },
      ];

      tones.forEach(({ freq, endFreq, start, duration }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + start);
        osc.frequency.exponentialRampToValueAtTime(endFreq, t + start + duration);

        filter.type = 'lowpass';
        filter.frequency.value = 600;

        const s = t + start;
        gain.gain.setValueAtTime(0, s);
        gain.gain.linearRampToValueAtTime(0.35, s + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, s + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(s);
        osc.stop(s + duration);
      });
    } catch {}
  },

  warning: () => {
    try {
      const ctx = getAudioContext();
      const t = ctx.currentTime;

      [0, 0.15].forEach((delay, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'triangle';

        osc.frequency.value = i === 0 ? 880 : 698.46;

        filter.type = 'bandpass';
        filter.frequency.value = 1200;
        filter.Q.value = 1;

        const start = t + delay;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.3, start + 0.01);
        gain.gain.setValueAtTime(0.3, start + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.12);
      });
    } catch {}
  },
};
