# Bolo Khata: bolkar udhaar likhiye 🗣️📒

**A voice-first credit ledger (udhaar khata) for India's 1.3 crore kirana stores, built entirely on Gnani AI's sovereign speech and language models.**

The shopkeeper talks the way they already talk:

> “Ramesh bhaiya ko dhai sau ka atta udhaar likh do, aur Sunita didi ne 500 UPI se de diye.”

Bolo Khata writes both entries, reads back the new balances in a natural Hinglish voice, and later sends Ramesh a polite payment reminder **in his own language, spoken in the shopkeeper's own cloned voice**.

Built for the **Great Indian AI Internship Challenge** by Gnani AI.

---

## The problem

Most kirana shops still run credit on a paper notebook (*bahi-khata*). Entries get written in a hurry at the counter, totals are wrong, pages get lost, and asking a regular customer for money is awkward, so dues pile up. Ledger apps exist, but they need typing in English on a small screen with one hand while serving a queue.

**Voice is the natural interface:** shopkeepers already *say* every entry aloud. They say it code-mixed, in a noisy shop, with Indian names and amounts like *dhai sau* and *dedh hazaar*. That is exactly what Gnani's models are trained for.

## Who it's for

- **Kirana and small-shop owners** (primary users) in Tier 2/3 towns, often more comfortable speaking than typing
- **Their customers**, who get respectful reminders in their own language (Kannada, Tamil, Bengali, Hindi, Marathi and 5 more) instead of an awkward conversation

## What it does

| Feature | How it works |
|---|---|
| 🎙️ **Speak an entry** | Tap the mic and say it in Hinglish, Hindi, Kannada, Tamil, Bengali or English. Live captions appear as you speak. |
| 🧠 **Understands real shop talk** | Code-mixing, nicknames (“Ramesh bhaiya” → Ramesh Kumar), Hindi number words (*dhai sau* = ₹250), several entries in one sentence, items with quantities. |
| 🔊 **Talks back** | Confirms every entry with the new balance in a natural voice, starting within a fraction of a second (streamed). |
| ↩️ **Undo by voice** | “Galat ho gaya, hatao.” |
| 📊 **Aaj ka hisaab** | The day's credit, payments, total dues and biggest debtor, spoken aloud. |
| 💬 **Ask anything** | “Is hafte sabse zyada udhaar kisne liya?” answered from the full ledger. |
| 📲 **Voice reminders in the customer's language** | A warm reminder written for each customer in their language and voiced as a shareable WhatsApp voice note. |
| 🪞 **In the owner's own voice** | Record 15 seconds once; reminders then sound like the shopkeeper, not a robot. |
| ☎️ **Phone orders** | Upload a noisy phone-call recording. It's cleaned up, split by speaker, and the orders are pulled out for one-tap approval. |

## Gnani AI technology used (all of it)

| Gnani model / API | Where it's used in Bolo Khata |
|---|---|
| **Prisma v3.0 STT: Realtime WebSocket** | Live mic → captions while speaking. `codemix` format, `hi-IN,en-IN` (or Kannada/Tamil/Bengali), customer names and grocery terms boosted with `keyterms`, shop-context `topic`. Audio streamed as 16 kHz PCM in exact 1,024-byte frames. |
| **Prisma v3.0 STT: REST** | Uploaded WhatsApp-style voice notes (≤30 s). |
| **Prisma v3.0 STT: Batch** | Phone-order recordings with **`with_denoise`** and **`with_diarization`** (shopkeeper vs customer), on 8 kHz noisy telephone audio, with a shop `topic` and boosted `keywords`. |
| **Timbre v2.5 TTS: WebSocket** | Lowest-latency spoken confirmations in the live voice loop (Hinglish voice *Poorvi*, `hi-en`; Saanvi for Kannada, Vedika for Tamil, Kirra for Bengali). |
| **Timbre v2.5 TTS: SSE** | Streamed daily summaries and answers; playback starts on the first chunk. |
| **Timbre v3.0 TTS: REST** | Customer reminders in any of 10 Indian languages with one voice. |
| **Voice Clone (`vachana-vc-v1`)**: embeddings + synthesis | Reminders spoken in the shopkeeper's own voice. |
| **Evon v3.3 (30B MoE, open weights)** | The brain. It turns code-mixed transcripts into structured ledger actions (JSON-schema constrained), writes culturally appropriate reminders in the customer's language, and answers free-form questions over the whole ledger using its 128K context. Self-hosted from the Hugging Face weights. |

An offline rule-based parser (Hinglish + Devanagari, Indian number words) keeps the shop running if the Evon server is unreachable. Every reply shows which engine handled it.

## Architecture

```
 Browser (mobile web app)                      Bolo Khata server (Node.js)                    Gnani AI
 ─────────────────────────                     ───────────────────────────                    ────────
 Mic → AudioWorklet (16 kHz PCM) ──ws──▶ /ws/voice ──1,024-byte frames──▶ Prisma v3.0 realtime WS
                                                 ◀────── transcript ─────
                                         Evon v3.3 ◀── transcript + customer list (JSON schema)
                                         SQLite ledger ◀── actions (credit / payment / undo / …)
 Speaker ◀──── streamed PCM ───────────── reply text ───────────────────▶ Timbre v2.5 WebSocket
 Voice-note upload ─────────────────────▶ /api/stt/clip ────────────────▶ Prisma REST
 Phone-call upload ─────────────────────▶ /api/calls ───────────────────▶ Prisma Batch (denoise + diarize) → Evon
 Daily summary ◀──── NDJSON PCM ────────── /api/speak/stream ───────────▶ Timbre SSE
 Reminder (audio + WhatsApp) ◀─────────── /api/customers/:id/reminder ──▶ Evon → Voice Clone / Timbre v3.0 REST
```

## Staying within the 5,000 programme credits

- **Disk cache for all speech output**: a repeated phrase (or a demo retake) is free.
- **Typed commands and example chips** don't touch speech-to-text at all.
- **A local budget guard** (`BUDGET_*` in `.env`) refuses calls past a set limit, so a bug or loop can't drain credits. The Settings tab shows usage per API.
- **Speech-to-text only streams while the mic is on**, and the WebSocket closes as soon as you stop.
- **A "speak replies" toggle** turns off voice output while testing.
- **Evon is self-hosted** (open weights), so it costs no Gnani credits.

## Run it

Requirements: Node.js 22.13+ (no other system dependencies; SQLite is built into Node).

```bash
npm install
cp .env.example .env        # then paste your GNANI_API_KEY
npm run seed                # synthetic demo customers
npm run smoke               # checks the key with ~25 TTS chars + 2 s of STT
npm start                   # http://localhost:3000
```

Optional:

```bash
npm run calls   # creates 3 synthetic noisy 8 kHz phone-order calls in ./samples (~900 TTS chars, one time)
npm test        # 23 tests, including a full end-to-end run against a mock Gnani API (no credits used)
```

### Running Evon v3.3

Evon is open-weight (30B MoE, about 3.5B active per token) and isn't on the API platform yet. It needs a GPU:

**One command (free Kaggle GPU; nothing runs on your machine):**

```bash
npm run evon   # needs the Kaggle CLI logged in
```

This pushes [`evon/kaggle_evon_auto.ipynb`](evon/kaggle_evon_auto.ipynb) to Kaggle on **GPU T4 x2**. It serves `gnani-evon-v3.3` (GGUF Q4_K_M, 100% on GPU) through Ollama with a Cloudflare tunnel, waits about 10 minutes for the model to load, and writes the URL into `.env`. Restart the app and the header badge turns green: **🧠 Evon live**. With thinking turned off (`reasoning_effort: none`), a reply takes about 2 seconds.

Manual alternative: open [`evon/kaggle_evon_server.ipynb`](evon/kaggle_evon_server.ipynb) in Kaggle and Run All.

Any OpenAI-compatible server works: vLLM on an A100/H100 with the official BF16 weights (`gnani/gnani-evon-v3.3-30B-A3B`), llama.cpp, or Ollama on a local GPU.

## Privacy and data

- **Synthetic data only.** All customers, amounts and phone calls are made up. The phone calls are generated with Timbre and then degraded to sound like a phone line.
- **No real phone numbers are stored.** WhatsApp links open the share sheet without a number.
- **The ledger stays on the shop's own machine** (SQLite). Evon can run on the shop's own infrastructure, in the spirit of Gnani's sovereign AI stack.

## Project layout

```
server/
  index.js            HTTP routes + live voice WebSocket loop
  gnani/stt.js        Prisma realtime WS, REST, Batch
  gnani/tts.js        Timbre REST, SSE, WebSocket + Voice Clone, with disk cache
  gnani/usage.js      Credit meter and budget guard
  brain/evon.js       Evon v3.3 client: parsing, reminders, Q&A
  brain/parser.js     Offline Hinglish/Devanagari parser (fallback)
  brain/khata.js      Turns actions into ledger updates and spoken replies
  brain/i18n.js       Replies in 6 shop languages, reminders in 10
public/               Mobile web app (no build step)
evon/                 Kaggle notebook to self-host Evon
scripts/              Seed data, synthetic noisy calls, smoke test
test/                 Parser tests + end-to-end tests against a mock Gnani API
```

## Team

**Nishant Gupta**: product, full-stack build, Gnani API integration, Evon hosting.

MIT licence.
