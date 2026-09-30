/**
 * Minimal typing for the browser's (prefixed) Web Speech recognition API. Chrome sends the audio
 * to Google's service and Edge to Microsoft's; Firefox has no recognition, so callers fall back to typing.
 */
export interface RecognitionAlternative {
  transcript: string;
}
export interface RecognitionResult {
  isFinal: boolean;
  0: RecognitionAlternative;
}
export interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
export interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
export type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
