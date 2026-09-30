# Demo script (about 2 minutes)

Before going on stage: `npm run dev`, run `npm run demo:check` (must print `Demo check passed 3/3`),
then open http://localhost:3000/deals and tap **Reset demo**. The top bar should say
**Live · DPI simulated**: the app is wired to the backend and every government/AI service is a
local mock, so Wi-Fi is not needed.

| Moment | What to do | What judges see |
| --- | --- | --- |
| Hook | "Raise your hand if you've paid an advance to a worker and had a dispute later." | Landing page: Bolo. Pakka Karo. |
| Live deal | `/new` → **Fill demo** → **Use demo conversation** (or tap the mic and talk). | Both consents ticked; "Transcribing… Reading the deal". |
| Magic moment | Review page. | "6 things weren't said clearly": *Ceiling painting not discussed*, *Is the advance part of the total?*, … Resolve each with one tap. |
| Confirmation | **Send for confirmation** → **Send on WhatsApp** for both → **हाँ, पक्का** / **Haan, pakka**. | Hindi summary for the worker, English for the hirer; "Pakka ho gaya." |
| Trust proof | **Verify integrity**, then **Try to tamper with it** → type 12000 → **Re-hash**. | "Matches. Record is untouched." then "Completely different hash." |
| Pay and govern | **Advance paid** under the UPI QR → **Trust profile** → **Dashboard**. | Verified job history; wages, delay hotspots, dispute reasons (synthetic). |

## If something goes wrong

- **Microphone blocked**: use **Use demo conversation** or **Type it instead**.
- **Anything odd**: Agreements → **Reset demo**, then start again.
- **Printable evidence**: sealed page → **Dispute-ready record (PDF)** → Print / Save as PDF.
