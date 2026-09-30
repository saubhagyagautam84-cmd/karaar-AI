# Karaar AI

**Bolo. Pakka Karo.** Verifiable, voice-first agreements for Bharat's informal workforce,
built on India's Digital Public Infrastructure (Track 1: AI for DPI & Governance).

Two people talk through a job ("aath hazaar, do coat, Tuesday tak"). Karaar AI turns the
conversation into structured terms, flags anything unclear instead of guessing, sends each
person a summary in their own language, and once both say "Haan, pakka" seals a
tamper-evident record. Payments go by UPI, completed jobs build the worker's own verified
history, and labour departments see anonymised wage and delay trends.

> Karaar AI makes a confirmed record of your agreement. It is not a legal contract.

## Setup in 5 commands

Needs Node 20+ and Python 3.11.

```bash
cd karaar-ai
npm run setup        # Python venv + backend deps + frontend deps + frontend/.env.local (once)
npm run seed         # synthetic data for the old analytics API (the dashboard seeds itself)
npm run dev          # app on :3000, API on :8000
npm run demo:check   # the 2-minute demo through the app's API proxy, 3 times in a row
```

Then open http://localhost:3000. The badge in the top bar says **Live · DPI simulated**:
the frontend (built to the Karaar AI Frontend Build Spec, Next.js 15 + Tailwind 3) is wired to
the FastAPI backend, and every government/AI service behind it runs as a deterministic mock,
so everything still works with Wi-Fi off.

| Mode | How | What happens |
| --- | --- | --- |
| **Live** (default after setup) | `frontend/.env.local`: `NEXT_PUBLIC_API_URL=/backend` | Transcription, extraction, WhatsApp, seal checks, UPI and the dashboard run on the backend; agreements are stored server-side |
| Browser-only demo | leave `NEXT_PUBLIC_API_URL` empty | Everything simulated in the browser, agreements in `localStorage`; no backend needed |

`/backend/*` is proxied to FastAPI by Next (`next.config.mjs`), so a phone on the same Wi-Fi
can open `http://<laptop-ip>:3000` and use the whole app.

| Command | What it does |
| --- | --- |
| `npm test` | Backend tests (318: state machine, extraction, sealing, privacy, analytics, the /v1 contract) |
| `npm run build` | Production build of the frontend (type-checked) |
| `KARAAR_RELOAD=1 npm run dev` | Auto-reload the API while developing |

## The demo (about 2 minutes)

1. `/new` → **Fill demo** → **Use demo conversation** (or tap the mic and talk).
2. Review shows 6 gaps, e.g. *Ceiling painting not discussed*, *Is the advance part of the total?*. Resolve them.
3. **Send for confirmation** → send both WhatsApp summaries (Hindi for the worker, English for the hirer) → both reply **Haan, pakka**. The server re-checks the SHA-256 seal before storing it.
4. Sealed page → **Verify integrity** (checked in the browser and against the server's copy), then **Try to tamper**.
5. Pay the advance via the UPI QR → open **Trust profile** and **Dashboard** (the new job is counted, anonymously).

**Reset demo** on the Agreements page clears the server's agreements and restores Ramesh's
seeded history. See [docs/demo_script.md](docs/demo_script.md) for the spoken script.

## How the two halves fit

| Frontend (`lib/api.ts`) | Backend (`backend/app/v1/`) |
| --- | --- |
| `transcribe` | `POST /v1/transcribe`: speech adapter (Bhashini / Whisper / mock) → segments |
| `extract` | `POST /v1/extract`: terms + the same 6 deterministic ambiguity rules as the browser |
| `sendSummary` | `POST /v1/notify/whatsapp`: WhatsApp adapter (Twilio / mock); number used once, never stored |
| `persistSeal` | `POST /v1/agreements/:id/seal`: re-computes the SHA-256 seal, refuses a mismatch |
| store `save` | `PUT /v1/agreements/:id`: raw phones replaced by masked + hash; sealed terms frozen (409) |
| `confirmPayment` | `GET /v1/payments/:ref`: UPI adapter confirms advance / balance |
| Verify integrity | `GET /v1/agreements/:id/verify`: server re-hashes its stored copy |
| Dashboard | `GET /v1/analytics`: k-anonymised (groups < 10 hidden), synthetic rows + real sealed agreements |
| Reset demo | `POST /v1/demo/reset` (only when `DEMO_MODE=true`) |

Browser and server compute byte-identical seals (canonical JSON, sorted keys, SHA-256);
`npm run demo:check` proves it on every run by sealing with the frontend's own `lib/hash.ts`.

## What is where

```
frontend/   Next.js 15 App Router + Tailwind 3, per the frontend build spec
  app/            / (landing) and (app)/: new, deals, deals/[id], review, confirm, record, profile, dashboard
  components/     AppShell, Recorder, Transcript, WhatsAppPreview, HashPanel, PaymentPanel, charts, ui
  lib/            api (demo vs live), store (server sync), extract, numbers, hash, summary, dashboard-data
backend/    FastAPI + Pydantic v2 + SQLite
  app/v1/         the frontend's API: extraction port, seal, store, analytics, synthetic dashboard data
  app/adapters/   Bhashini/Whisper, translation, UPI, Aadhaar, e-Shram, WhatsApp, DigiLocker, e-Daakhil, LLM
  app/…           the earlier /api (state machine, confirm links, dispute PDF, worker records), still tested
seed/       generate_seed.py (synthetic data for the earlier /api analytics)
scripts/    setup, dev, test, seed, demo-check
docs/       architecture.md, demo_script.md
_archive/   frontend-v1: the previous UI, kept for reference (safe to delete)
```

## Switching on real services

Copy `backend/.env.example` to `backend/.env` and change one `*_PROVIDER` line. Real
adapters that need approval or keys (Bhashini, Aadhaar e-KYC, e-Shram, DigiLocker, Twilio)
are stubs that return a clear "not configured" error, so nothing fails silently.

- **Claude for extraction**: `pip install -r backend/requirements-llm.txt`, set
  `LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. It uses the same prompt
  (`backend/app/prompts/extract.txt`), structured output validated by Pydantic, 2 retries,
  and falls back to the offline rule engine if the call fails. This is a paid service.
- **UPI**: `PAYMENT_PROVIDER=upi_intent` makes real `upi://pay` links; confirming payment
  needs a payment aggregator webhook (stubbed).

## Privacy by design (DPDP Act 2023 principles)

- Recording starts only after both people consent; consent times are stored.
- Phone numbers are stored as salted hashes and shown masked; Aadhaar numbers are never stored.
- The transcript is shown once and not kept; only the terms, supporting quotes and audio are.
- The worker's history is private; they share it with a link that expires in 7 days.
- The dashboard sees aggregates only; any group under 10 agreements is suppressed.
- "Delete my data" removes names, numbers, quotes and audio, and keeps anonymised counts.
