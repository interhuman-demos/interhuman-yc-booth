import OpenAI from 'openai';
import { toFile } from 'openai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

let openai: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!OPENAI_API_KEY) {
    console.error('[transcription] OPENAI_API_KEY is not set — transcription disabled');
    return null;
  }
  if (!openai) openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openai;
}

/** Minimum text length to consider a transcription real (filter out hallucinations). */
const MIN_TEXT_LENGTH = 3;

/** Known Whisper hallucinations on silence. */
const HALLUCINATIONS = new Set([
  'thanks for watching.', 'thank you for watching.',
  'please subscribe!!', 'please subscribe!', 'please subscribe.',
  'like and subscribe.', 'like and subscribe!',
  'subscribe to my channel.', 'subscribe to my channel!',
   '.', '...',
  'see you in the next video.', 'see you next time.'
]);

/**
 * Derive a Whisper-compatible filename + MIME type from what the browser sent.
 * Whisper identifies the codec from the filename extension, not the MIME header.
 */
function audioFileParams(bytes: Buffer): { filename: string; type: string } {
  // Detect WebM by EBML magic bytes: 0x1A 0x45 0xDF 0xA3
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return { filename: 'audio.webm', type: 'audio/webm' };
  }
  // Detect OGG by "OggS" magic
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
    return { filename: 'audio.ogg', type: 'audio/ogg' };
  }
  // Detect MP4/M4A by 'ftyp' box at offset 4
  if (bytes.length > 8 && bytes.slice(4, 8).toString('ascii') === 'ftyp') {
    return { filename: 'audio.mp4', type: 'audio/mp4' };
  }
  // Default — treat as webm and let Whisper figure it out
  return { filename: 'audio.webm', type: 'audio/webm' };
}

/**
 * Transcribe an audio buffer using OpenAI Whisper.
 * Returns null if the API key is missing, the audio is silent, or transcription fails.
 */
export async function transcribeBuffer(
  audioBytes: Buffer,
  windowIndex: number,
  sessionId: string
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const { filename, type } = audioFileParams(audioBytes);
  console.log(
    `[transcription] session=${sessionId} window=${windowIndex} bytes=${audioBytes.length} format=${filename}`
  );

  try {
    const file = await toFile(audioBytes, filename, { type });

    const response = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'text',
      language: 'en',
    });

    const raw = typeof response === 'string' ? response.trim() : '';
    console.log(
      `[transcription] session=${sessionId} window=${windowIndex} raw="${raw}"`
    );

    if (raw.length < MIN_TEXT_LENGTH) {
      console.log(`[transcription] session=${sessionId} window=${windowIndex} filtered (too short)`);
      return null;
    }

    if (HALLUCINATIONS.has(raw.toLowerCase())) {
      console.log(`[transcription] session=${sessionId} window=${windowIndex} filtered (hallucination)`);
      return null;
    }

    return raw;
  } catch (err) {
    console.error(
      `[transcription] session=${sessionId} window=${windowIndex} Whisper error:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
