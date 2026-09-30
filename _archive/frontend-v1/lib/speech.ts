/** Browser text-to-speech (the offline fallback for Bhashini TTS). */

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function speak(
  text: string,
  lang: "hi" | "en",
  onEnd?: () => void,
): void {
  if (!canSpeak()) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang === "hi" ? "hi-IN" : "en-IN";
  const voice = synth
    .getVoices()
    .find((v) =>
      v.lang.toLowerCase().startsWith(lang === "hi" ? "hi" : "en-in"),
    );
  if (voice) utter.voice = voice;
  utter.rate = lang === "hi" ? 0.9 : 1;
  utter.onend = () => onEnd?.();
  utter.onerror = () => onEnd?.();
  synth.speak(utter);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

export const CONSENT_NOTICE = {
  hi: "यह बातचीत रिकॉर्ड की जाएगी ताकि आपके समझौते का पक्का रिकॉर्ड बन सके। रिकॉर्डिंग सिर्फ़ इसी काम के लिए इस्तेमाल होगी।",
  en: "This conversation will be recorded to make a confirmed record of your agreement. The recording is used only for this.",
};
