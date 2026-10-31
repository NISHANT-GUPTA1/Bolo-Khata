import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { WebSocketServer } from 'ws';
import { config, ROOT, hasGnaniKey } from './config.js';
import { Customers, Entries, Settings, Calls } from './db.js';
import { usage } from './gnani/usage.js';
import { transcribeClip, openRealtime } from './gnani/stt.js';
import { synthesize, streamSSE, streamWS, cachedWav, createVoiceEmbedding } from './gnani/tts.js';
import { evonStatus } from './brain/evon.js';
import { handleTranscript, execute, buildReminder, todaySummary, shopLanguage } from './brain/khata.js';
import { SHOP_LANGUAGES, CUSTOMER_LANGUAGES } from './brain/i18n.js';
import { processCall } from './calls.js';
import { ITEM_KEYTERMS } from './keyterms.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(`[${req.method} ${req.path}]`, e.message);
    res.status(e.code === 'BUDGET' ? 402 : e.status || 500).json({ error: e.message });
  });

const keyterms = () => [...Customers.all().flatMap((c) => [c.name, ...c.aliases]), ...ITEM_KEYTERMS];
const replyVoice = () => {
  const l = shopLanguage();
  return { model: l.model, voice: l.voice, language: l.ttsLang };
};

// ---------- State ----------
app.get('/api/state', wrap(async (_req, res) => {
  const evon = await evonStatus();
  res.json({
    shop: { ...Settings.shop(), language: shopLanguage().code },
    customers: Customers.all(),
    recent: Entries.recent(25),
    today: todaySummary(),
    gnani: { keySet: hasGnaniKey(), sttModel: config.stt.model, replyVoice: replyVoice(), reminderModel: config.tts.reminderModel },
    evon: { ok: evon.ok, error: evon.error, model: evon.model, baseUrl: config.evon.baseUrl },
    usage: usage.totals(),
    languages: { shop: Object.fromEntries(Object.entries(SHOP_LANGUAGES).map(([k, v]) => [k, v.label])), customer: CUSTOMER_LANGUAGES },
  });
}));

app.get('/api/usage', (_req, res) => res.json(usage.summary()));
app.get('/api/evon/status', wrap(async (_req, res) => res.json(await evonStatus(true))));

app.post('/api/settings', (req, res) => {
  const { shopName, ownerName, upiId, language } = req.body || {};
  if (shopName) Settings.set('shop_name', String(shopName).slice(0, 60));
  if (ownerName) Settings.set('owner_name', String(ownerName).slice(0, 40));
  if (upiId) Settings.set('upi_id', String(upiId).slice(0, 60));
  if (language && SHOP_LANGUAGES[language]) Settings.set('shop_language', language);
  res.json({ ok: true, shop: { ...Settings.shop(), language: shopLanguage().code } });
});

// ---------- Customers & entries ----------
app.get('/api/customers/:id', (req, res) => {
  const c = Customers.get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json({ ...c, balance: Customers.balance(c.id), entries: Entries.forCustomer(c.id) });
});
app.post('/api/customers', (req, res) => {
  const { name, language = 'hi-IN', aliases = [] } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  res.json(Customers.create({ name: name.trim(), language, aliases }));
});
app.patch('/api/customers/:id', (req, res) => {
  const { name, language, aliases } = req.body || {};
  const c = Customers.update(Number(req.params.id), {
    ...(name ? { name } : {}),
    ...(language && CUSTOMER_LANGUAGES[language] ? { language } : {}),
    ...(Array.isArray(aliases) ? { aliases } : {}),
  });
  if (!c) return res.status(404).json({ error: 'Not found' });
  res.json(c);
});
app.post('/api/entries', wrap(async (req, res) => {
  const { customerId, type, amount, note } = req.body || {};
  const c = Customers.get(Number(customerId));
  if (!c || !['credit', 'payment'].includes(type) || !(amount > 0)) return res.status(400).json({ error: 'Invalid entry' });
  const out = await execute([{ intent: type, customer: c.name, amount: Number(amount), items: note ? [{ name: note, qty: null }] : [] }], { source: 'manual', engine: 'manual' });
  res.json(out);
}));
app.post('/api/entries/:id/undo', (req, res) => res.json(Entries.setUndone(Number(req.params.id), 1)));
app.post('/api/entries/:id/redo', (req, res) => res.json(Entries.setUndone(Number(req.params.id), 0)));

// ---------- Commands ----------
app.post('/api/command', wrap(async (req, res) => {
  res.json(await handleTranscript(String(req.body?.text || ''), { source: req.body?.source || 'typed' }));
}));

// Prisma REST: a recorded clip or an uploaded voice note (up to 30 s).
app.post('/api/stt/clip', upload.single('audio'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
  const stt = await transcribeClip(req.file.buffer, {
    filename: req.file.originalname || 'clip.wav',
    mime: req.file.mimetype || 'audio/wav',
    languages: shopLanguage().stt,
    keyterms: keyterms(),
    topic: 'Kirana shop owner dictating udhaar (credit) and payment entries for customers.',
  });
  const out = await handleTranscript(stt.transcript, { source: 'voice-note' });
  res.json({ stt, ...out });
}));

// ---------- Speech output ----------
app.get('/api/audio/:key', (req, res) => {
  const p = /^[a-f0-9]{40}$/.test(req.params.key) && cachedWav(req.params.key);
  if (!p) return res.status(404).end();
  res.type('audio/wav').sendFile(p);
});

// Timbre REST: returns a WAV URL (used for short replies when streaming isn't needed).
app.post('/api/speak', wrap(async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 600);
  if (!text) return res.status(400).json({ error: 'No text' });
  const { key, cached } = await synthesize({ text, ...replyVoice() });
  res.json({ audioUrl: `/api/audio/${key}`, cached });
}));

// Timbre SSE relayed as NDJSON of base64 PCM, so the browser can start playing immediately.
app.post('/api/speak/stream', async (req, res) => {
  const text = String(req.body?.text || '').slice(0, 1200);
  if (!text) return res.status(400).json({ error: 'No text' });
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
  res.write(`${JSON.stringify({ sampleRate: config.tts.sampleRate })}\n`);
  try {
    const { key, cached } = await streamSSE({ text, ...replyVoice() }, (pcm) => res.write(`${JSON.stringify({ pcm: pcm.toString('base64') })}\n`));
    res.end(`${JSON.stringify({ done: true, audioUrl: `/api/audio/${key}`, cached })}\n`);
  } catch (e) {
    res.end(`${JSON.stringify({ error: e.message })}\n`);
  }
});

// ---------- Reminders & voice clone ----------
app.post('/api/customers/:id/reminder', wrap(async (req, res) => {
  res.json(await buildReminder(Number(req.params.id), { useClone: req.body?.useClone !== false }));
}));

app.post('/api/voice-clone', upload.single('audio'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
  const emb = await createVoiceEmbedding(req.file.buffer, req.file.originalname || 'voice.wav', req.file.mimetype || 'audio/wav');
  Settings.set('voice_embedding', emb);
  res.json({ ok: true });
}));
app.delete('/api/voice-clone', (_req, res) => {
  Settings.set('voice_embedding', null);
  res.json({ ok: true });
});

// ---------- Phone-order recordings (Prisma Batch) ----------
app.get('/api/calls', (_req, res) => res.json(Calls.all()));
app.post('/api/calls', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });
  if (!hasGnaniKey()) return res.status(400).json({ error: 'GNANI_API_KEY is not set in .env' });
  const id = processCall(req.file.buffer, { filename: req.file.originalname || 'call.wav', mime: req.file.mimetype || 'audio/wav' });
  res.json({ id });
});
app.post('/api/calls/:id/apply', wrap(async (req, res) => {
  const call = Calls.all().find((c) => c.id === Number(req.params.id));
  if (!call || call.status !== 'READY') return res.status(400).json({ error: 'Call is not ready' });
  const pick = new Set((req.body?.indexes || []).map(Number));
  const actions = (call.actions.list || []).filter((_, i) => pick.has(i));
  const out = await execute(actions, { transcript: call.transcript, source: 'phone-call', engine: call.actions.engine });
  Calls.update(call.id, { status: 'APPLIED' });
  res.json(out);
}));

// Sample synthetic calls generated by scripts/make-synthetic-calls.js
app.get('/api/samples', (_req, res) => {
  const dir = path.join(ROOT, 'samples');
  res.json(fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.(wav|mp3)$/.test(f)) : []);
});
app.use('/samples', express.static(path.join(ROOT, 'samples')));

// ---------- Live voice loop over WebSocket ----------
// Browser mic (16 kHz PCM) -> Prisma realtime STT -> Evon -> ledger -> Timbre WebSocket TTS -> browser speaker.
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/voice' });

wss.on('connection', (client) => {
  let stt = null;
  let segments = [];
  let finished = false;
  let stopped = false;
  let speak = true;
  const send = (obj) => client.readyState === 1 && client.send(JSON.stringify(obj));

  const finalize = async () => {
    if (finished) return;
    finished = true;
    const transcript = segments.join(' ').replace(/\s+/g, ' ').trim();
    stt?.close();
    try {
      const out = await handleTranscript(transcript, { source: 'voice-live' });
      send({ type: 'result', ...out });
      if (out.reply && speak) {
        send({ type: 'tts_start', sampleRate: config.tts.sampleRate });
        try {
          const { key } = await streamWS({ text: out.reply, ...replyVoice() }, (pcm) => client.readyState === 1 && client.send(pcm));
          send({ type: 'tts_end', audioUrl: `/api/audio/${key}` });
        } catch (e) {
          send({ type: 'tts_error', message: e.message });
        }
      }
    } catch (e) {
      send({ type: 'error', message: e.message });
    }
  };

  client.on('message', (data, isBinary) => {
    if (isBinary) return stt?.sendPcm(Buffer.from(data));
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'start') {
      speak = msg.speak !== false;
      if (!hasGnaniKey()) return send({ type: 'error', message: 'GNANI_API_KEY is not set in .env' });
      segments = [];
      finished = false;
      stopped = false;
      try {
        stt = openRealtime({
          languages: shopLanguage().stt,
          keyterms: keyterms(),
          topic: 'Kirana shop owner dictating udhaar and payment entries',
          onEvent: (ev) => {
            if (ev.type === 'connected') send({ type: 'ready' });
            else if (ev.type === 'speech_start') send({ type: 'speech_start' });
            else if (ev.type === 'transcript' && ev.text) {
              segments.push(ev.text);
              send({ type: 'transcript', text: ev.text, full: segments.join(' '), language: ev.detected_language_code, latency: ev.latency });
              // The last segment after "stop" means we have everything.
              if (stopped) setTimeout(finalize, 250);
            } else if (ev.type === 'error') send({ type: 'error', message: ev.message });
            else if (ev.type === 'closed' && stopped) finalize();
          },
        });
      } catch (e) {
        send({ type: 'error', message: e.message });
      }
    } else if (msg.type === 'stop') {
      stopped = true;
      stt?.commit();
      // Safety net in case Prisma sends nothing more after the commit.
      setTimeout(finalize, 2500);
    }
  });
  client.on('close', () => stt?.close());
});

server.listen(config.port, () => {
  console.log(`\n  Bolo Khata running at http://localhost:${config.port}`);
  console.log(`  Gnani API key: ${hasGnaniKey() ? 'set' : 'MISSING (add GNANI_API_KEY to .env)'}`);
  evonStatus(true).then((s) => console.log(`  Evon v3.3: ${s.ok ? `connected (${s.model})` : `offline - ${s.error} (rule parser will be used)`}\n`));
});
