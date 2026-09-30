/**
 * Speech recognition in Hindi returns Devanagari ("अठारह हज़ार एडवांस"). The extractor and the number
 * normalizer read romanized Hinglish, so the words they understand are mapped word by word.
 * Everything else is left as it was: nothing is guessed, unknown words just don't match a rule.
 * The stored transcript keeps the original script; only the extraction input is mapped.
 */

const DIGITS = "०१२३४५६७८९";

const WORDS: Record<string, string> = {
  // numbers
  एक: "ek", दो: "do", तीन: "teen", चार: "char", पांच: "paanch", पाँच: "paanch", छह: "chhah", छः: "chhah", सात: "saat",
  आठ: "aath", नौ: "nau", दस: "das", ग्यारह: "gyarah", बारह: "barah", तेरह: "terah", चौदह: "chaudah", पंद्रह: "pandrah",
  पन्द्रह: "pandrah", सोलह: "solah", सत्रह: "satrah", अठारह: "atharah", उन्नीस: "unnis", बीस: "bees", पच्चीस: "pachees",
  तीस: "tees", चालीस: "chalees", पचास: "pachaas", साठ: "saath", सत्तर: "sattar", अस्सी: "assi", नब्बे: "nabbe",
  डेढ़: "dedh", डेढ: "dedh", ढाई: "dhai", साढ़े: "saadhe", साढे: "saadhe", सवा: "sava", पौने: "paune",
  सौ: "sau", हज़ार: "hazaar", हजार: "hazaar", लाख: "lakh",
  रुपये: "rupaye", रुपए: "rupaye", रुपया: "rupaye", रूपये: "rupaye", दिन: "din", दिनों: "din",
  // work and scope
  पेंट: "paint", पुताई: "putai", रंग: "rang", नल: "nal", पाइप: "pipe", लीक: "leak", टंकी: "tanki", बिजली: "bijli",
  वायरिंग: "wiring", स्विच: "switch", पंखा: "fan", दरवाज़ा: "darwaza", दरवाजा: "darwaza", दरवाज़े: "darwaze", दरवाजे: "darwaze",
  लकड़ी: "lakdi", अलमारी: "almari", सफाई: "safai", सफ़ाई: "safai", झाड़ू: "jhadu", पोछा: "pocha", बर्तन: "bartan",
  बेडरूम: "bedroom", हॉल: "hall", हाल: "hall", ड्राइंग: "drawing", रूम: "room", किचन: "kitchen", रसोई: "rasoi",
  बाथरूम: "bathroom", टॉयलेट: "toilet", बालकनी: "balcony", छत: "chhat", सीलिंग: "ceiling", गेट: "gate", ग्रिल: "grill",
  // money and terms
  एडवांस: "advance", पहले: "pehle", दे: "de", अभी: "abhi", पूरा: "poora", पूरे: "poora", कुल: "kul", टोटल: "total",
  रेट: "rate", पड़ेगा: "padega", सामान: "samaan", मटेरियल: "material", आप: "aap", आपका: "aapka", आपको: "aapko",
  मैं: "main", मेरा: "mera", हम: "hum", शामिल: "shamil", यूपीआई: "upi", कैश: "cash", नकद: "nakad", नक़द: "nakad",
  बाकी: "baaki", बाक़ी: "baaki", बैलेंस: "balance", काम: "kaam", के: "ke", का: "ka", की: "ki", बाद: "baad", ख़त्म: "khatam",
  खत्म: "khatam", होने: "hone", पर: "par", में: "mein", हो: "ho", अगले: "agle", हफ्ते: "hafte", हफ़्ते: "hafte",
  जल्दी: "jaldi", कुछ: "kuch", नहीं: "nahi", मत: "mat", कम: "kam", और: "aur", एक्स्ट्रा: "extra", लगेगा: "lagega",
  लगेंगे: "lagenge", हां: "haan", हाँ: "haan", पक्का: "pakka", ठीक: "theek", है: "hai",
};

export function hasDevanagari(text: string): boolean {
  return /[ऀ-ॿ]/.test(text);
}

/** Map Devanagari digits and the extractor's vocabulary to Hinglish; leave other words untouched. */
export function toHinglish(text: string): string {
  if (!hasDevanagari(text)) return text;
  const digits = text.replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)));
  return digits
    .split(/(\s+)/)
    .map((token) => {
      const m = token.match(/^([^ऀ-ॿ\w₹]*)(.*?)([।॥,.?!]*)$/u);
      if (!m) return token;
      const [, pre, word, post] = m;
      return WORDS[word] ? `${pre}${WORDS[word]}${post.replace(/[।॥]/g, ".")}` : token.replace(/[।॥]/g, ".");
    })
    .join("");
}
