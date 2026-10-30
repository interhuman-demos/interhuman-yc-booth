'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  PanelRight,
  PhoneOff,
  VideoOff,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AnnotatedTranscript } from '@/components/reflect/annotated-transcript';
import { PreJoinScreen } from '@/components/reflect/pre-join-screen';
import { SummaryScreen } from '@/components/reflect/summary-screen';
import { CountdownTimer } from '@/components/reflect/countdown-timer';
import { DebugPanel, useDebugLog } from '@/components/reflect/debug-panel';
import { Button } from '@/components/ui/button';
import { useGarrySession } from '@/hooks/useGarrySession';
import { useReflection } from '@/hooks/useReflection';
import { useStreamProxy } from '@/hooks/useStreamProxy';
import { INTERACTIVE_DURATION_S, SCENARIOS } from '@/lib/reflect-constants';
import type { ReflectPhase, WindowState } from '@/lib/reflect-types';
import { type RingingHandle, startRinging } from '@/lib/sounds';
import { stripFillerWords, stripWhisperHallucinations } from '@/lib/transcript-filter';
import { cn } from '@/lib/utils';

// ─── Self-view (user camera) ──────────────────────────────────────────────────

function SelfView({ stream, isMinimized }: { stream: MediaStream | null; isMinimized: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) el.play().catch(() => {});
  }, [stream]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        layout: { duration: 0.5, ease: [0.77, 0, 0.175, 1] },
        opacity: { duration: 0.3 },
      }}
      className={cn(
        'z-20 overflow-hidden bg-black',
        isMinimized
          ? 'pointer-events-none absolute right-6 bottom-6 rounded-xl border border-white/15 shadow-2xl'
          : 'absolute inset-0 rounded-none'
      )}
      style={isMinimized ? { width: 180, height: 135 } : undefined}
    >
      {stream ? (
        <video
          ref={videoRef}
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: 'scaleX(-1)' }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[oklch(0.13_0_0)]">
          <VideoOff className="size-5 text-white/40" />
        </div>
      )}
      {!isMinimized && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="absolute bottom-4 left-4"
        >
          <div className="flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 backdrop-blur-sm">
            <div className="size-1.5 rounded-full bg-emerald-400" />
            <span className="text-xs font-medium text-white/90">You</span>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

// ─── Garry Avatar video tile ──────────────────────────────────────────────────

function GarryAvatar({
  videoRef,
  audioRef,
  isSpeaking,
  isConnected,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isSpeaking: boolean;
  isConnected: boolean;
}) {
  return (
    <>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={false}
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Hidden audio element for Garry's voice */}
      <audio ref={audioRef} autoPlay />

    </>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function GarryReflectApp() {
  const [phase, setPhase] = useState<ReflectPhase>('idle');
  const phaseRef = useRef<ReflectPhase>('idle');
  const { entries, log } = useDebugLog();

  // ─── Scenario (always YC pitch) ────────────────────────────────────────────────
  const scenarioRef = useRef(SCENARIOS[0]);

  const setPhaseSync = useCallback(
    (p: ReflectPhase) => {
      phaseRef.current = p;
      setPhase(p);
      log('phase', `→ ${p}`);
    },
    [log]
  );

  const ringingRef = useRef<RingingHandle | null>(null);

  // ─── Avatar media refs ───────────────────────────────────────────────────────
  const avatarVideoRef = useRef<HTMLVideoElement>(null);
  const avatarAudioRef = useRef<HTMLAudioElement>(null);

  // ─── Hooks ───────────────────────────────────────────────────────────────────
  const garry = useGarrySession({ avatarVideoRef, avatarAudioRef, log });
  const proxy = useStreamProxy({ log });

  const reflection = useReflection({
    onDone: useCallback(() => setPhaseSync('done'), [setPhaseSync]),
    log,
  });

  // ─── Timer state ─────────────────────────────────────────────────────────────
  const [timerRunning, setTimerRunning] = useState(false);
  const timerExpiredRef = useRef(false);

  // ─── Summary snapshot ──────────────────────────────────────────────────────
  // Captured at hang-up time, because disconnect()/reset() clear the live data.
  const [summary, setSummary] = useState<{ verdict: string; windows: WindowState[] }>({
    verdict: '',
    windows: [],
  });

  const handleTimerExpire = useCallback(async () => {
    if (timerExpiredRef.current) return;
    timerExpiredRef.current = true;
    setTimerRunning(false);

    log('phase', 'Timer expired — transitioning to reflection');
    setPhaseSync('reflecting');

    proxy.stopRecording();

    // Wait briefly for last Whisper result
    log('reflect', 'Waiting 3s for final Whisper results…');
    await new Promise((r) => setTimeout(r, 3000));

    const rawTranscript = proxy.getTranscript();
    const signals = proxy.getAllSignals();
    // Strip Whisper artifacts and spoken fillers before sending to GPT and to the agent
    const transcript = stripFillerWords(stripWhisperHallucinations(rawTranscript));

    log('reflect', `Collected: ${transcript.length} chars (raw: ${rawTranscript.length}), ${signals.length} signals`);

    // Send timer-up to agent (triggers Garry's structured reflection)
    await garry.sendTimerUp(transcript, signals, scenarioRef.current.id);

    // Also generate the GPT text for the transcript panel
    setPhaseSync('feedback');
    await reflection.startReflection(
      transcript,
      signals,
      scenarioRef.current.reflectionSystemPrompt
    );
  }, [proxy, garry, reflection, scenarioRef, setPhaseSync, log]);

  // ─── Start call ──────────────────────────────────────────────────────────────
  const handleCallGarry = useCallback(async () => {
    const scenario = SCENARIOS[0];
    scenarioRef.current = scenario;
    setPhaseSync('greeting');
    timerExpiredRef.current = false;

    await proxy.requestCamera();
    proxy.preConnect();

    ringingRef.current = startRinging();

    try {
      await garry.connect(scenario.id);

      // Ringing continues until avatarReady triggers the transition below
    } catch (err) {
      ringingRef.current?.stop();
      ringingRef.current = null;
      log('garry', `Connection failed: ${err instanceof Error ? err.message : String(err)}`);
      setPhaseSync('idle');
    }
  }, [garry, proxy, setPhaseSync, log]);

  // Transition from greeting → interactive once LemonSlice avatar is ready
  useEffect(() => {
    if (phase !== 'greeting') return;

    const startInteractive = (reason: string) => {
      ringingRef.current?.stop();
      ringingRef.current = null;
      setPhaseSync('interactive');
      proxy.startRecording();
      setTimerRunning(true);
      log('phase', `Interactive phase started — 90s timer running (${reason})`);
    };

    if (garry.avatarReady) {
      startInteractive('avatar ready');
      return;
    }

    // Safety net: never let the ringing persist forever. If the avatar's
    // ready signal/track never arrives, proceed after a timeout so the user
    // isn't stuck listening to the ring.
    const timeout = setTimeout(() => startInteractive('ready timeout'), 15000);
    return () => clearTimeout(timeout);
  }, [phase, garry.avatarReady, proxy, setPhaseSync, log]);

  // ─── Hang up ─────────────────────────────────────────────────────────────────
  const handleHangUp = useCallback(async () => {
    setTimerRunning(false);
    proxy.stopRecording();
    await garry.disconnect();
    proxy.reset();
    reflection.reset();
    timerExpiredRef.current = false;
    setPhaseSync('idle');
  }, [garry, proxy, reflection, setPhaseSync]);

  // ─── Finish (from done) → show summary, keeping the collected data ────────────
  const handleFinishToSummary = useCallback(async () => {
    setTimerRunning(false);
    proxy.stopRecording();

    // Snapshot the verdict + signals BEFORE disconnecting, since disconnect()
    // and proxy.reset() clear the live data. Prefer Garry's spoken verdict,
    // fall back to the GPT reflection text.
    const verdict = (garry.reflectionText || reflection.reflectionText || '').trim();
    setSummary({ verdict, windows: proxy.windows });

    await garry.disconnect();
    setPhaseSync('summary');
  }, [garry, proxy, reflection, setPhaseSync]);

  // ─── Leave the summary screen → back to landing, clear everything ─────────────
  const handleExitSummary = useCallback(() => {
    proxy.reset();
    reflection.reset();
    timerExpiredRef.current = false;
    setPhaseSync('idle');
  }, [proxy, reflection, setPhaseSync]);

  const handleStartOver = useCallback(async () => {
    setTimerRunning(false);
    await garry.disconnect();
    proxy.reset();
    reflection.reset();
    timerExpiredRef.current = false;
    // Jump straight back into a new call instead of returning to idle
    await handleCallGarry();
  }, [garry, proxy, reflection, handleCallGarry]);

  // ─── UI state ────────────────────────────────────────────────────────────────
  const isConnected = garry.isConnected;
  const isSpeaking = garry.isSpeaking;
  const isInteractive = phase === 'interactive';
  const showTranscript = ['interactive', 'reflecting', 'feedback', 'done'].includes(phase);

  const [panelOpen, setPanelOpen] = useState(true);
  useEffect(() => {
    if (showTranscript && !panelOpen) setPanelOpen(true);
  }, [showTranscript]);

  const handleTogglePanel = useCallback(() => setPanelOpen((p) => !p), []);

  const phaseLabel: Partial<Record<ReflectPhase, string>> = {
    greeting: 'Calling the CEO of Y Combinator…',
    interactive: scenarioRef.current.recordingLabel,
    reflecting: 'Garry is reflecting…',
    feedback:
      garry.agentPhase === 'reflecting'
        ? 'Garry is delivering his verdict…'
        : 'Garry has spoken.',
    done: "Garry's verdict",
  };

  return (
    <main className="bg-background relative flex h-screen w-full">
      {/* ── Main content ── */}
      <div className="relative flex flex-1 flex-col items-center justify-center px-4">

        {/* ── Idle / Pre-join ── */}
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="absolute inset-0"
            >
              <PreJoinScreen onStart={handleCallGarry} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Summary (post hang-up) ── */}
        <AnimatePresence mode="wait">
          {phase === 'summary' && (
            <motion.div
              key="summary"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="bg-background absolute inset-0"
            >
              <SummaryScreen
                verdict={summary.verdict}
                windows={summary.windows}
                onTryAgain={handleStartOver}
                onDone={handleExitSummary}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Active Call ── */}
        <AnimatePresence>
          {phase !== 'idle' && phase !== 'summary' && (
            <motion.div
              key="call-layout"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 flex flex-col bg-black"
            >
              {/* User self-view */}
              <AnimatePresence>
                {proxy.localStream && (
                  <SelfView stream={proxy.localStream} isMinimized={isConnected} />
                )}
              </AnimatePresence>

              {/* Garry's avatar video — full bleed */}
              <motion.div
                initial={{ opacity: 0, scale: 0.96 }}
                animate={isConnected ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <GarryAvatar
                  videoRef={avatarVideoRef}
                  audioRef={avatarAudioRef}
                  isSpeaking={isSpeaking}
                  isConnected={isConnected}
                />
              </motion.div>

              {/* Top bar: phase label + panel toggle + timer */}
              <motion.div
                key={phase}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.3 }}
                className="relative z-30 flex items-center justify-between px-4 pt-5"
              >
      

                <div className="flex items-center justify-between w-full gap-2">
                  {/* 90s countdown timer */}
                  <AnimatePresence>
                    {isInteractive ? (
                      <CountdownTimer
                        durationSeconds={INTERACTIVE_DURATION_S}
                        isRunning={timerRunning}
                        onExpire={handleTimerExpire}
                      />
                    ) : <div className="opacity-0"></div>}
                  </AnimatePresence>

                  {showTranscript && (
                    <button
                      onClick={handleTogglePanel}
                      className="flex size-7 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm transition-colors hover:bg-black/80"
                      title={panelOpen ? 'Hide transcript' : 'Show transcript'}
                    >
                      <PanelRight className="size-3.5 text-white" />
                    </button>
                  )}
                </div>
              </motion.div>

              {/* Bottom controls */}
              <div className="relative z-30 mt-auto flex flex-col items-center gap-3 px-4 pb-6">

                {/* Error indicators */}
                {garry.error && (
                  <p className="text-center text-xs text-red-300">{garry.error}</p>
                )}
                {proxy.error && (
                  <p className="text-center text-xs text-red-300">{proxy.error}</p>
                )}

                {/* Control buttons */}
                <div className="flex items-center justify-center gap-3">
                  {/* Interactive phase controls */}
                  {phase === 'interactive' && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-3"
                    >
                      <motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}>
                        <Button
                          variant={proxy.isMuted ? 'destructive' : 'ghost'}
                          size="icon-lg"
                          pill
                          onClick={proxy.toggleMute}
                          title={proxy.isMuted ? 'Unmute' : 'Mute'}
                          className="bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm hover:bg-black/80"
                        >
                          <motion.span
                            animate={proxy.isMuted ? { rotate: -20, scale: 0.9 } : { rotate: 0, scale: 1 }}
                            transition={{ type: 'spring', duration: 0.3, bounce: 0.4 }}
                            className="flex"
                          >
                            {proxy.isMuted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                          </motion.span>
                        </Button>
                      </motion.div>

                      <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
                        <Button
                          variant="ghost"
                          onClick={handleTimerExpire}
                          className="bg-black/70 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm hover:bg-black/80"
                          pill
                          title="Finish pitch and get Garry's verdict"
                        >
                          I&apos;m Done
                        </Button>
                      </motion.div>

                      <motion.div whileHover={{ scale: 1.06, rotate: -8 }} whileTap={{ scale: 0.92 }}>
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          pill
                          onClick={handleHangUp}
                          className="bg-red-500/80 text-white hover:bg-red-500"
                          title="Hang up"
                        >
                          <PhoneOff className="size-4" />
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}

                  {/* Reflecting / feedback phase */}
                  {(phase === 'reflecting' || phase === 'feedback') && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <motion.div whileHover={{ scale: 1.06, rotate: -8 }} whileTap={{ scale: 0.92 }}>
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          pill
                          onClick={handleFinishToSummary}
                          className="bg-red-500/80 text-white hover:bg-red-500"
                          title="End call & see summary"
                        >
                          <PhoneOff className="size-4" />
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}

                  {/* Done phase */}
                  {phase === 'done' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                      className="flex flex-wrap items-center justify-center gap-3"
                    >
                      <Button
                        variant="ghost"
                        pill
                        onClick={handleStartOver}
                        className="w-40 border-white/20 bg-black/70 text-white backdrop-blur-sm hover:bg-black/80"
                      >
                        Try again
                      </Button>
                      <motion.div whileHover={{ scale: 1.06, rotate: -8 }} whileTap={{ scale: 0.92 }}>
                        <Button
                          variant="ghost"
                          size="icon-lg"
                          pill
                          onClick={handleFinishToSummary}
                          className="bg-red-500/80 text-white hover:bg-red-500"
                          title="End call & see summary"
                        >
                          <PhoneOff className="size-4" />
                        </Button>
                      </motion.div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Side panel (annotated transcript) ── */}
      <AnimatePresence>
        {showTranscript && panelOpen && (
          <AnnotatedTranscript
            key="transcript-panel"
            windows={proxy.windows}
            isRecording={isInteractive}
            onClose={handleTogglePanel}
          />
        )}
      </AnimatePresence>


    </main>
  );
}
