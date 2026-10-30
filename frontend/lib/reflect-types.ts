export type ReflectPhase =
  | 'idle'
  | 'greeting'
  | 'interactive'
  | 'reflecting'
  | 'feedback'
  | 'done'
  | 'summary';

export interface Signal {
  type: string;
  start?: number;
  end?: number;
  probability?: string;
  rationale?: string;
}

export interface WindowState {
  index: number;
  startMs: number;
  endMs: number;
  transcriptText?: string;
  signals: Signal[];
  transcriptStatus: 'pending' | 'ok' | 'failed';
  signalStatus: 'pending' | 'ok' | 'failed';
}

export interface TranscriptEvent {
  type: 'demo.transcript.updated';
  sessionId: string;
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  provider: string;
}

export interface SignalEvent {
  type: 'demo.signal.detected';
  sessionId: string;
  index: number;
  signal: Signal;
}

export type ProxyEvent = TranscriptEvent | SignalEvent | { type: string };

// LiveKit data channel message types (frontend <-> agent)
export interface TimerUpMessage {
  type: 'garry.timer-up';
  transcript: string;
  signals: Signal[];
  scenarioId: string;
}

export interface AgentPhaseMessage {
  type: 'garry.phase-change';
  phase: 'interactive' | 'reflecting' | 'done';
}

export interface AgentSpeechMessage {
  type: 'garry.speech-chunk';
  text: string;
  isFinal: boolean;
}

export type AgentMessage = AgentPhaseMessage | AgentSpeechMessage;
