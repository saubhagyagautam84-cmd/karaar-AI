"""Sample conversations (Appendix A3). The mock speech adapter returns these."""

SAMPLES: dict[int, dict[str, str]] = {
    1: {
        "title": "Painter: clear deal",
        "text": (
            "Client: Bhaiya do bedroom paint karne hain, sirf deewarein.\n"
            "Worker: Do coat lagayenge, aath hazaar lagega. Paint aap laa dena.\n"
            "Client: Theek hai, aath hazaar final. Advance kitna?\n"
            "Worker: Do hazaar de dijiye. Parso se shuru, Tuesday tak khatam.\n"
            "Client: Done. Furniture main hata dungi."
        ),
    },
    2: {
        "title": "Plumber: messy deal",
        "text": (
            "Client: Kitchen ka sink aur bathroom ka tap theek karna hai.\n"
            "Worker: Saat-aath hazaar ho jayega, dekhte hain.\n"
            "Client: Itna? Thoda kam karo.\n"
            "Worker: Chalo dekh lenge. Jaldi kar dunga.\n"
            "Client: Theek hai, kal aa jao."
        ),
    },
    3: {
        "title": "Carpenter: English, price settled",
        "text": (
            "Client: I need a carpenter to fix three cupboard doors and one bed.\n"
            "Worker: Three doors and bed, 4500 rupees, I bring hinges and screws.\n"
            "Client: Make it 4000.\n"
            "Worker: Okay 4200 final, work done this Saturday.\n"
            "Client: Deal, 4200. I'll pay 1000 now."
        ),
    },
    4: {
        "title": "Painter: ceiling not discussed (live demo)",
        "text": (
            "Client: Bhaiya do bedroom paint karne hain.\n"
            "Worker: Do coat lagayenge, aath hazaar lagega. Paint aap laa dena.\n"
            "Client: Theek hai, aath hazaar final. Advance kitna?\n"
            "Worker: Do hazaar de dijiye. Parso se shuru, Tuesday tak khatam.\n"
            "Client: Done. Furniture main hata dungi."
        ),
    },
    5: {
        "title": "Painter: whole house (frontend demo)",
        "text": (
            "Client: Ramesh bhai, poore ghar ki putai karni hai — do bedroom, hall aur kitchen.\n"
            "Worker: Theek hai didi. Deewaron pe do coat lagaunga, primer ke saath.\n"
            "Client: Kitne ka padega poora kaam?\n"
            "Worker: Poora kaam athaarah hazaar mein ho jayega.\n"
            "Client: Thoda kam karo... chalo, athaarah hazaar theek hai. Advance kitna chahiye?\n"
            "Worker: Paanch hazaar advance de dijiye, saaman lana hai.\n"
            "Client: Theek hai. Kab tak khatam hoga?\n"
            "Worker: Chhe din lagenge, agle hafte tak ho jayega.\n"
            "Client: Bhai, pakka?\n"
            "Worker: Haan didi, pakka!"
        ),
    },
}
