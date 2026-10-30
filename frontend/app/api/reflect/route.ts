import OpenAI from 'openai';
import { z } from 'zod';
import { stripFillerWords, stripWhisperHallucinations } from '@/lib/transcript-filter';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const REFLECT_MODEL = process.env.OPENAI_REFLECT_MODEL ?? 'gpt-4o';

export const revalidate = 0;

const signalSchema = z.object({
  type: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  probability: z.string().optional(),
  rationale: z.string().optional(),
});

const requestSchema = z.object({
  transcript: z.string(),
  signals: z.array(signalSchema).default([]),
  systemPrompt: z.string().optional(),
});

function buildUserMessage(transcript: string, signals: z.infer<typeof signalSchema>[]): string {
  const signalLines =
    signals.length > 0
      ? signals
          .map((s) => {
            const start = typeof s.start === 'number' ? `${s.start.toFixed(1)}s` : '?';
            const end = typeof s.end === 'number' ? `${s.end.toFixed(1)}s` : '?';
            return `- ${s.type} at ${start}–${end} (${s.probability ?? 'detected'}): ${s.rationale ?? ''}`;
          })
          .join('\n')
      : '(no delivery cues detected)';

  const signalTypeList =
    signals.length > 0 ? [...new Set(signals.map((s) => s.type))].join(', ') : 'none';

  return `What the person said:\n${transcript}\n\nDelivery observations from video and audio analysis:\n${signalLines}\n\nIMPORTANT: These are real measured behavioral cues. Only reference signals that were actually detected (listed above). Do NOT invent or infer signals that are not listed. The detected signal types are: ${signalTypeList}.`;
}

function createFallbackStream(message: string): Response {
  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: message })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = requestSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.flatten() }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const rawTranscript = parsed.data.transcript;
    const { signals: allSignals, systemPrompt } = parsed.data;

    // Strip Whisper hallucinations (YouTube outros etc.) and spoken fillers before sending to GPT
    const transcript = stripFillerWords(stripWhisperHallucinations(rawTranscript));

    if (!transcript.trim()) {
      return createFallbackStream(
        "I could hear you were there, but I couldn't quite catch the words. Want to try again?"
      );
    }

    const highConfidenceSignals = allSignals.filter((s) => s.probability === 'high');
    const NEGATIVE_TYPES = new Set([
      'stress', 'hesitation', 'uncertainty', 'confusion', 'frustration', 'disagreement', 'skepticism',
    ]);
    const hasNegatives = highConfidenceSignals.some((s) => NEGATIVE_TYPES.has(s.type));
    const signals = hasNegatives
      ? highConfidenceSignals.filter((s) => NEGATIVE_TYPES.has(s.type) || s.type === 'confidence')
      : highConfidenceSignals;

    const userMessage = buildUserMessage(transcript, signals);
    const resolvedSystemPrompt = systemPrompt ?? 'You are a sharp, direct executive coach. Give specific, actionable feedback in 4-5 sentences.';

    const stream = await openai.chat.completions.create({
      model: REFLECT_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: resolvedSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
      max_completion_tokens: 350,
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const text = chunk.choices[0]?.delta?.content ?? '';
            if (text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (err) {
          console.error('Reflection stream error:', err);
          controller.error(err);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Reflect API error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
