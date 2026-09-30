/** The 22 scheduled languages of India, plus English and Hinglish. Speech + translation via Bhashini in live mode. */
export const LANGUAGES = [
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "hinglish", name: "Hinglish", native: "Hinglish" },
  { code: "en", name: "English", native: "English" },
  { code: "as", name: "Assamese", native: "অসমীয়া" },
  { code: "bn", name: "Bengali", native: "বাংলা" },
  { code: "brx", name: "Bodo", native: "बड़ो" },
  { code: "doi", name: "Dogri", native: "डोगरी" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ks", name: "Kashmiri", native: "कॉशुर" },
  { code: "kok", name: "Konkani", native: "कोंकणी" },
  { code: "mai", name: "Maithili", native: "मैथिली" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "mni", name: "Manipuri", native: "মৈতৈলোন্" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "ne", name: "Nepali", native: "नेपाली" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्" },
  { code: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ" },
  { code: "sd", name: "Sindhi", native: "سنڌي" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "ur", name: "Urdu", native: "اردو" },
] as const;

export function langName(code: string): string {
  const l = LANGUAGES.find((x) => x.code === code);
  return l ? `${l.native}${l.native !== l.name ? ` · ${l.name}` : ""}` : code;
}

/** Summaries render natively in Hindi and English in the prototype; other languages route through Bhashini. */
export function summaryLang(code: string): "hi" | "en" {
  return code === "en" ? "en" : "hi";
}
