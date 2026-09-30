# Karaar AI architecture

```
Phone / laptop browser
   │  Next.js 16 (:3000): record · agreement · confirm · verify · worker · dashboard
   │  /api/* rewrite (one origin, so a phone on the same Wi-Fi just works)
   ▼
FastAPI (:8000) ── services ──────────────────────────── SQLite (backend/data/karaar.db)
   │   pipeline:  speech → normaliser → extractor → evidence check → ambiguity rules
   │   lifecycle: state machine → confirm tokens → SHA-256 seal → verify
   │   work:      UPI intent/confirm → milestones → completion → worker record
   │   disputes, analytics (k = 10), privacy (erasure, demo reset)
   ▼
DPI adapters (mock | real), every call written to audit_log with the provider name
```

## Agreement lifecycle (Step 5)

`DRAFT → SENT → CONFIRMED_BY_ONE → CONFIRMED_BY_BOTH → ADVANCE_PAID → IN_PROGRESS → COMPLETED`,
with `DISPUTED → RESOLVED | ESCALATED` from ADVANCE_PAID onward. Agreements without an advance
go straight from CONFIRMED_BY_BOTH to IN_PROGRESS. The machine is a pure class
(`services/state_machine.py`) tested on every pair of states; invalid moves return HTTP 409.

- Editing (answering a question) while SENT or CONFIRMED_BY_ONE resets both confirmations and
  returns to DRAFT; old confirm links stop working. "Kuch galat hai" does the same and turns the
  note into an open question.
- On the second "Haan, pakka" the record is sealed:
  `sha256(canonical_json({terms minus status/hash, audio_sha256, confirmations}))` with sorted
  keys and no spaces. `/verify/[id]` recomputes the same hash in the browser (pure-JS SHA-256,
  so it also works over plain HTTP on a phone).

## Extraction (Phase 2)

| Step | File | Notes |
| --- | --- | --- |
| Speech | `adapters/speech.py` | mock returns sample conversations 1–4; Whisper/Bhashini are stubs |
| Normaliser | `services/normalizer.py` | "aath hazaar", "8k", "saadhe teen", "saat-aath hazaar" (range); aaj/kal/parso, Hindi and English weekdays, "agle hafte", "5 tarikh" |
| Extractor | `adapters/llm.py` | mock = offline rule engine (`services/rule_extractor.py`); anthropic = Claude with structured output, 2 retries, falls back to rules |
| Evidence | `services/ambiguity.py` | any value whose quote is not in the transcript is dropped and becomes a question |
| Ambiguity | `services/ambiguity.py` | missing price/advance/dates/materials/scope, advance > price, finish before start, vague words (jaldi, thoda, sab kuch), ceiling for painting, delay terms |
| Answers | `services/answers.py` | typed answers are parsed per field and kept as evidence with source "answer" |

## Adapters

| Kind | Env var | Providers |
| --- | --- | --- |
| speech | `SPEECH_PROVIDER` | mock, whisper, bhashini |
| translate | `TRANSLATE_PROVIDER` | mock, bhashini, llm |
| llm (extraction) | `LLM_PROVIDER` | mock, anthropic |
| payment | `PAYMENT_PROVIDER` | mock, upi_intent |
| identity | `IDENTITY_PROVIDER` | mock, real |
| eshram | `ESHRAM_PROVIDER` | mock, real |
| notify | `NOTIFY_PROVIDER` | mock, twilio_whatsapp |
| digilocker | `DIGILOCKER_PROVIDER` | mock, real |
| edaakhil | `EDAAKHIL_PROVIDER` | mock |

An unknown provider stops the server at startup. A real provider without credentials returns
HTTP 503 with a plain message. The mock notifier writes to the `messages` table, which feeds
the phone preview (the endpoint is disabled when a real notifier is configured).

## Data (Step 6)

Tables: `agreements`, `parties`, `consents`, `confirmations`, `milestones`, `audit_log`,
`workers`, `share_links`, `messages`. Additions beyond Step 6: `agreements.audio_hash`
(part of the seal), `is_seed`, `completed_at`, `erased_at`; `parties.worker_id`, `done_at`;
`workers.owner_token` (the worker's private key to their record). New columns are added to
older databases on startup.

## Privacy rules in code

- Transcripts are returned once and never stored; only terms, evidence quotes and audio are.
- Phones: salted SHA-256 in `parties.phone_hash`, masked (`+91XXXXXX3210`) in the terms.
  A raw number given at send time (for a real WhatsApp send) must match the hash and is not kept.
- Aadhaar numbers pass through the identity adapter in memory only.
- Worker records open only with the owner key or an unexpired share link (7 days).
- Analytics return aggregates; any group under 10 is sent as `null` with `suppressed: true`.
- Erasure clears names, phone hashes, quotes, message bodies and audio, sets `erased_at`
  (which retires the fingerprint), and keeps trade, district, price and status for the counts.
- `audit_log` has no foreign key, so the trail survives erasure.
