# Submission kit

## Form fields

**Project title:** Bolo Khata: a voice udhaar ledger for kirana stores

**Problem being solved:**
Kirana shops run customer credit (udhaar) on paper notebooks. Entries are rushed, totals go wrong, and asking regulars for money is awkward, so dues pile up. Existing apps need typing in English, which doesn't work at a busy counter. Bolo Khata lets the shopkeeper simply say the entry in Hinglish, Hindi, Kannada, Tamil or Bengali. It records it, speaks back the balance, and sends each customer a polite voice reminder in their own language, in the shopkeeper's own voice.

**Intended users:**
Kirana and small-shop owners (especially in Tier 2/3 towns) who are more comfortable speaking than typing, and their customers, who receive reminders in their own language.

**Gnani AI models / APIs used:**
- Prisma v3.0 STT: Realtime WebSocket (live mic, codemix, keyterms), REST (voice notes), Batch with denoise and diarization (noisy phone-order calls)
- Timbre v2.5 TTS: WebSocket (live replies), SSE (streamed summaries)
- Timbre v3.0 TTS: REST (reminders in 10 Indian languages)
- Voice Clone vachana-vc-v1: embeddings and synthesis (reminders in the owner's voice)
- Evon v3.3 (open weights, self-hosted): understanding code-mixed commands as structured JSON, writing reminders, ledger Q&A

**Member contribution:**
Nishant Gupta (solo): product design, full-stack development, Gnani API integration, Evon self-hosting, demo.

---

## 60-second demo script

Record the phone screen (or a browser at phone width) with the shop-noise ambience left in.

| Time | On screen | Say / show |
|---|---|---|
| 0–5 s | Paper khata, then the phone | *“Har kirana dukaan ki ek hi problem: udhaar ka hisaab.”* |
| 5–15 s | Tap mic, speak | **“Ramesh bhaiya ko dhai sau ka atta udhaar likh do, aur Sunita didi ne 500 UPI se de diye.”** Live captions, two entry cards, the voice replies with balances. Point at the **Prisma** and **Evon** badges. |
| 15–22 s | Tap mic | **“Galat ho gaya, Ramesh wala hatao.”** The entry is struck off. |
| 22–30 s | Switch language to ಕನ್ನಡ | Speak one Kannada entry (Main Character award) and hear the Kannada reply. |
| 30–42 s | Open Lakshmi Akka → *Voice reminder bhejo* | Evon writes a Kannada reminder that plays **in the shopkeeper's cloned voice**. Tap *Share voice note* (WhatsApp sheet). |
| 42–52 s | Phone orders tab → noisy sample call | Play 2 s of the crackly call, then show the clean, speaker-separated transcript and the extracted order → *Khate mein daalo*. |
| 52–60 s | Back to the home stats | *“Aaj ka hisaab sunao”* plays the summary. End card: **Bolo Khata, built on Gnani Prisma · Timbre · Voice Clone · Evon.** #GnaniAI |

Tips: do a full rehearsal first, since every phrase is cached and retakes cost no credits. Keep Evon live on Kaggle while recording.

---

## LinkedIn / X post (draft)

> 🗣️📒 **Bolo Khata: bolkar udhaar likhiye**
>
> India's kirana stores still run credit on a paper notebook. I built a voice khata that lets a shopkeeper just *say* it, in Hinglish, Hindi, Kannada, Tamil or Bengali:
>
> “Ramesh bhaiya ko dhai sau ka atta udhaar likh do” ✅ written, balance spoken back.
>
> 🔹 Live speech-to-text on @Gnani AI **Prisma v3.0** (code-mixed, live captions)
> 🔹 Understanding by **Evon v3.3**, Gnani's open-weight 30B model (self-hosted)
> 🔹 Replies and reminders in natural Indian voices with **Timbre**
> 🔹 Customer reminders **in the shopkeeper's own cloned voice**, in the customer's language
> 🔹 Noisy phone orders → clean, speaker-separated transcripts → ledger entries
>
> Built for the Great Indian AI Internship Challenge. Would love your feedback: which language should it learn next? 👇
>
> #GreatIndianAIInternshipChallenge #GnaniAI #VoiceAI #Kirana #BuildForBharat

(Tag the official Gnani AI page and attach the 60-second video natively, not as a link.)
