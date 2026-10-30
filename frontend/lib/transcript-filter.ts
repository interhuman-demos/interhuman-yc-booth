/** Common spoken fillers stripped for the text-only comparison path. */
const FILLER_PATTERNS = [
  /\b(?:um+|uh+|uhm+|erm+|ah+|eh+|hmm+)\b/gi,
  /\b(?:like)\b(?=\s|,|\.|$)/gi,
  /\byou know\b/gi,
  /\bi mean\b/gi,
  /\bsort of\b/gi,
  /\bkind of\b/gi,
  /\bbasically\b/gi,
  /\bactually\b/gi,
  /\bwell\b(?=,|\s)/gi,
];

/** Whisper hallucinates these when it hits silence/noise at recording end. */
const WHISPER_HALLUCINATION_PATTERNS = [
  /if you have any questions or comments.*$/i,
  /thanks for watching.*$/i,
  /thank you for watching.*$/i,
  /subscribe to (?:our|the|my).*$/i,
  /don't forget to (?:like|subscribe|comment).*$/i,
  /see you (?:in the next|next time|later).*$/i,
  /©.*$/i,
  /\btranscript\s+\w+\s*\w*\s*$/i,
  /\bsystem\s*you\s*$/i,
  /\bsubtitles\s+by\b.*$/i,
];

/** Strip known Whisper hallucinations (YouTube outro artifacts). */
export function stripWhisperHallucinations(transcript: string): string {
  let cleaned = transcript;
  for (const pattern of WHISPER_HALLUCINATION_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.replace(/\s{2,}/g, ' ').trim();
}

export function stripFillerWords(transcript: string): string {
  let cleaned = transcript;
  for (const pattern of FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
}
