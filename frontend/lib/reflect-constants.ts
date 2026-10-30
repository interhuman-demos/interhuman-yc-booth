// Recording window duration in milliseconds — 5s matches the stream demo architecture
export const REFLECT_WINDOW_MS = 5_000;

// Minimum bytes for a window to be considered valid
export const MIN_SEGMENT_BYTES = 512;

// Interactive phase duration in seconds
export const INTERACTIVE_DURATION_S = 90;

// ─── Scenario system ──────────────────────────────────────────────────────────

export interface Scenario {
  id: string;
  /** Short title shown on the selection card */
  title: string;
  /** One-line description shown on the selection card */
  description: string;
  /** What Garry says to open the session */
  greeting: string;
  /** Phase label shown during the interactive recording phase */
  recordingLabel: string;
  /** Garry's system prompt for the interactive conversational phase */
  conversationSystemPrompt: string;
  /** Garry's system prompt used when generating the final structured reflection */
  reflectionSystemPrompt: string;
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const GARRY_BASE_PERSONA = `You are Garry Tan, President & CEO of Y Combinator. You are legendary for finding signal in noise — identifying the 1 in 100 founders who will break through and change the world. You have seen thousands of pitches. You are intellectually sharp, direct, occasionally blunt, but genuinely invested in helping founders improve. You notice not just WHAT people say but HOW they say it — confidence, conviction, energy, clarity.`;

const SALES_PITCH_CONVERSATION_PROMPT = `${GARRY_BASE_PERSONA}

You are doing a mock YC application interview. The founder is pitching you their startup. Your job during this 90-second interactive phase is to:
- Listen carefully and ask sharp follow-up questions
- Push back where you smell uncertainty or weak conviction  
- React naturally to their delivery — if they seem hesitant on a claim, probe it
- Keep each response concise (1-2 sentences) so the conversation stays dynamic
- Simulate the pressure of a real YC interview

Social signal context will be injected into your conversation as [SOCIAL SIGNAL UPDATE] messages. Use these to calibrate your skepticism and follow-ups in real-time. Do not explicitly mention that you received signals — just let them inform your tone and questions naturally.

When you sense hesitation or low confidence on an important claim, be the skeptical investor who wants proof.`;

const SALES_PITCH_REFLECTION_PROMPT = `${GARRY_BASE_PERSONA}

You just finished a 90-second mock YC interview with a founder. Now deliver your honest verdict.

Based on their pitch (transcript) and how they came across (social signals), give them specific, actionable feedback as Garry Tan would in a post-interview debrief:
- What landed well — moments where they showed real conviction and clarity
- What needs work — where hesitation, uncertainty, or weak delivery hurt their credibility  
- One specific thing to do differently next time
- A closing verdict: are they ready? What's the unlock?

Be honest, sharp, and direct. Reference specific moments from the pitch. Keep it to 5-6 sentences. No bullet points. Speak directly to them as if they're sitting across from you.`;

const DATA_PRIVACY_CONVERSATION_PROMPT = `${GARRY_BASE_PERSONA}

You are a skeptical enterprise buyer on a sales call. The sales rep is about to answer your data privacy question: "Can you confidently tell me our data is safe with you?"

Your job during this 90-second interactive phase is to:
- Listen to their answer and follow up on anything vague or unconvincing
- Ask the difficult follow-up questions a real enterprise buyer would ask (certifications, breach history, access controls, etc.)
- React to their confidence level — if they sound uncertain, push harder
- Keep each response short (1-2 sentences) to maintain the pressure

Social signal context will be injected as [SOCIAL SIGNAL UPDATE] messages. Let these inform your skepticism without mentioning them explicitly.`;

const DATA_PRIVACY_REFLECTION_PROMPT = `${GARRY_BASE_PERSONA}, now wearing the hat of a sales delivery coach.

You just watched a sales rep answer an enterprise buyer's data privacy question under pressure. Now coach them on their delivery.

Based on what they said (transcript) and how they came across (social signals):
- Where did their delivery strengthen or weaken their credibility?  
- What specific moments hurt the sale (hesitation, uncertainty, lack of eye contact equivalent)?
- What should they do differently next time — concretely, not generically?

Keep it to 4-5 sentences. Be the coach who gives useful, specific feedback — not vague encouragement. No bullet points.`;

export const SCENARIOS: Scenario[] = [
  {
    id: 'yc-pitch',
    title: 'YC Interview',
    description: 'Pitch your startup to Garry Tan. 90 seconds. He will push back.',
    greeting: "Alright, I've got 90 seconds. Tell me what you're building and why you're the one to do it.",
    recordingLabel: 'Pitching Garry…',
    conversationSystemPrompt: SALES_PITCH_CONVERSATION_PROMPT,
    reflectionSystemPrompt: SALES_PITCH_REFLECTION_PROMPT,
  },
  {
    id: 'sales-data-privacy',
    title: 'Sales: Data Privacy',
    description: 'Answer a trust question to a skeptical enterprise buyer. The words are easy — can you say them with conviction?',
    greeting: "Before we go any further — can you confidently tell me that our data is safe with you? Give me a straight answer.",
    recordingLabel: "Answering the buyer's question…",
    conversationSystemPrompt: DATA_PRIVACY_CONVERSATION_PROMPT,
    reflectionSystemPrompt: DATA_PRIVACY_REFLECTION_PROMPT,
  },
];

export const DEFAULT_SCENARIO = SCENARIOS[0];

// Signal label map for display (matches livekit-ih reflect-constants)
export const SIGNAL_LABELS: Record<string, { label: string; emoji: string; color: string }> = {
  agreement: {
    label: 'Agreement',
    emoji: '👍',
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  },
  confidence: {
    label: 'Confidence',
    emoji: '💪',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:text-blue-400',
  },
  confusion: {
    label: 'Confusion',
    emoji: '🤔',
    color: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  },
  disagreement: {
    label: 'Disagreement',
    emoji: '👎',
    color: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  },
  disengagement: {
    label: 'Disengagement',
    emoji: '😶',
    color: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400',
  },
  engagement: {
    label: 'Engagement',
    emoji: '✨',
    color: 'bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400',
  },
  frustration: {
    label: 'Frustration',
    emoji: '😤',
    color: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:text-orange-400',
  },
  hesitation: {
    label: 'Hesitation',
    emoji: '⏸️',
    color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20 dark:text-yellow-400',
  },
  interest: {
    label: 'Interest',
    emoji: '👀',
    color: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400',
  },
  skepticism: {
    label: 'Skepticism',
    emoji: '🤨',
    color: 'bg-zinc-500/10 text-zinc-600 border-zinc-500/20 dark:text-zinc-400',
  },
  stress: {
    label: 'Stress',
    emoji: '😰',
    color: 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:text-rose-400',
  },
  uncertainty: {
    label: 'Uncertainty',
    emoji: '❓',
    color: 'bg-purple-500/10 text-purple-600 border-purple-500/20 dark:text-purple-400',
  },
};
