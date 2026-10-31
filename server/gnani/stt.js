// Gnani Prisma speech-to-text: REST (clips), realtime WebSocket (live mic) and Batch (call recordings).
import WebSocket from 'ws';
import { config } from '../config.js';
import { usage } from './usage.js';
import { estimateDuration } from '../audio/wav.js';

const auth = () => {
  if (!config.gnani.apiKey) throw new Error('GNANI_API_KEY is not set in .env');
  return { 'X-API-Key-ID': config.gnani.apiKey };
};

async function gnaniError(res) {
  const text = await res.text().catch(() => '');
  let msg = text;
  try {
    const j = JSON.parse(text);
    msg = j.error?.message || j.message || j.detail || text;
  } catch {}
  const err = new Error(`Gnani ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  err.status = res.status;
  return err;
}

// HTTP headers must be ASCII, so non-Latin keyterms are only sent on REST/Batch (form/JSON bodies).
const asciiOnly = (list) => list.filter((t) => /^[\x20-\x7e]+$/.test(t));

/** Prisma REST: one clip of up to 30 seconds. */
export async function transcribeClip(buffer, { filename = 'clip.wav', mime = 'audio/wav', languages, keyterms = [], topic } = {}) {
  const seconds = estimateDuration(buffer, mime);
  usage.ensure('stt_seconds', seconds);
  const form = new FormData();
  form.append('audio_file', new Blob([buffer], { type: mime }), filename);
  form.append('model', config.stt.model);
  form.append('language_code', languages || config.stt.languages);
  form.append('format', config.stt.format);
  if (keyterms.length) form.append('keyterms', JSON.stringify(keyterms.slice(0, 200)));
  if (topic) form.append('topic', topic.slice(0, 1600));

  const t0 = Date.now();
  const res = await fetch(`${config.gnani.http}/stt/v3`, { method: 'POST', headers: auth(), body: form });
  if (!res.ok) {
    usage.record({ service: 'prisma', api: 'rest', model: config.stt.model, units: 0, unitType: 'stt_seconds', ok: false });
    throw await gnaniError(res);
  }
  const body = await res.json();
  usage.record({ service: 'prisma', api: 'rest', model: config.stt.model, units: seconds, unitType: 'stt_seconds' });
  return {
    transcript: body.transcript || '',
    language: body.detected_language_code || null,
    latencyMs: Date.now() - t0,
    model: body.model || config.stt.model,
  };
}

/**
 * Prisma realtime WebSocket. Feed 16 kHz mono s16le PCM; events come back through onEvent.
 * Frames go upstream in exact 1,024-byte chunks, as the API requires.
 */
export function openRealtime({ languages, keyterms = [], topic, onEvent }) {
  usage.ensure('stt_seconds', 5);
  // The realtime endpoint takes exactly one locale in language_code; extra locales go in multi_lang_codes.
  const locales = (languages || config.stt.languages).split(',').map((s) => s.trim()).filter(Boolean);
  const headers = {
    'x-api-key-id': config.gnani.apiKey,
    model: config.stt.model,
    language_code: locales[0],
    ...(locales.length > 1 ? { multi_lang_codes: locales.join(',') } : {}),
    format: config.stt.format,
    'x-sample-rate': '16000',
    'x-idle-timeout-sec': '30',
    'x-min-silence-ms': '700',
  };
  const kt = asciiOnly(keyterms).slice(0, 200);
  if (kt.length) headers.keyterms = kt.join(',');
  if (topic && /^[\x20-\x7e]+$/.test(topic)) headers.topic = topic.slice(0, 1600);

  const ws = new WebSocket(`${config.gnani.ws}/stt/v3/stream`, { headers });
  let pending = Buffer.alloc(0);
  let queue = [];
  let open = false;
  let bytesSent = 0;
  let closed = false;

  const flushFrames = () => {
    while (pending.length >= 1024) {
      const frame = pending.subarray(0, 1024);
      pending = pending.subarray(1024);
      ws.send(frame);
      bytesSent += 1024;
    }
  };

  ws.on('open', () => {
    open = true;
    for (const q of queue) q();
    queue = [];
  });
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    try {
      onEvent(JSON.parse(raw.toString()));
    } catch {}
  });
  ws.on('unexpected-response', (_req, res) => {
    onEvent({ type: 'error', message: `Prisma realtime handshake failed (HTTP ${res.statusCode})` });
  });
  ws.on('error', (e) => onEvent({ type: 'error', message: e.message }));
  ws.on('close', () => {
    if (closed) return;
    closed = true;
    const seconds = bytesSent / 32000;
    if (seconds > 0) usage.record({ service: 'prisma', api: 'realtime-ws', model: config.stt.model, units: seconds, unitType: 'stt_seconds' });
    onEvent({ type: 'closed', seconds });
  });

  const whenOpen = (fn) => (open ? fn() : queue.push(fn));
  return {
    sendPcm(buf) {
      whenOpen(() => {
        pending = Buffer.concat([pending, buf]);
        flushFrames();
      });
    },
    commit() {
      whenOpen(() => {
        if (pending.length) {
          const last = Buffer.alloc(1024);
          pending.copy(last);
          pending = Buffer.alloc(0);
          ws.send(last);
          bytesSent += 1024;
        }
        ws.send(JSON.stringify({ type: 'commit' }));
      });
    },
    close() {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
    },
  };
}

/** Prisma Batch: diarized, denoised transcription of a longer recording (such as a phone order). */
export async function transcribeBatch(buffer, { filename, mime = 'audio/wav', languages, keyterms = [], topic, onStatus = () => {} }) {
  const seconds = estimateDuration(buffer, mime);
  usage.ensure('stt_seconds', seconds);
  // Verified against the live API: language_code is a comma-separated string, boost words go in
  // "keywords", and context is either topic(+keywords) or speaker_names, not both.
  const jobConfig = {
    model: config.stt.model,
    language_code: (languages || config.stt.languages).replace(/\s+/g, ''),
    mode: 'transcribe',
    with_diarization: true,
    num_speakers: 2,
    with_denoise: true,
  };
  if (config.stt.model === 'prisma-v3.0') {
    jobConfig.format = 'codemix';
    if (topic && topic.length >= 30) jobConfig.topic = topic.slice(0, 1600);
    if (keyterms.length) jobConfig.keywords = keyterms.slice(0, 200);
  }

  // The config part must be a plain form field; a Blob would be sent as a file and the API returns 500.
  const form = new FormData();
  form.append('config', JSON.stringify(jobConfig));
  form.append('files', new Blob([buffer], { type: mime }), filename);

  const base = `${config.gnani.http}/stt/v3/batch/jobs`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Batch endpoints are rate limited; back off on 429 instead of failing the whole job.
  const call = async (url, opts = {}) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { ...opts, headers: auth() });
      if (r.status !== 429 || attempt >= 8) return r;
      await sleep(Math.min(60000, 5000 * 2 ** attempt));
    }
  };
  let res = await call(base, { method: 'POST', body: form });
  if (!res.ok) throw await gnaniError(res);
  const { job_id: jobId } = await res.json();
  onStatus({ jobId, status: 'CREATED' });

  res = await call(`${base}/${jobId}/start`, { method: 'POST' });
  if (!res.ok) throw await gnaniError(res);
  onStatus({ jobId, status: 'STARTING' });

  const terminal = new Set(['COMPLETED', 'PARTIAL_FAILURE', 'FAILED', 'START_FAILED', 'CANCELLED']);
  let job;
  const deadline = Date.now() + 15 * 60 * 1000;
  do {
    await sleep(15000);
    res = await call(`${base}/${jobId}`);
    if (!res.ok) throw await gnaniError(res);
    job = await res.json();
    onStatus({ jobId, status: job.status, percent: job.percent });
  } while (!terminal.has(job.status) && Date.now() < deadline);

  if (job.status !== 'COMPLETED' && job.status !== 'PARTIAL_FAILURE') {
    throw new Error(`Batch job ${jobId} ended with status ${job.status}`);
  }

  res = await call(`${base}/${jobId}/files`);
  if (!res.ok) throw await gnaniError(res);
  const listing = await res.json();
  const files = listing.files || listing.data || listing.items || (Array.isArray(listing) ? listing : []);
  const file = files.find((f) => f.transcript_url);
  if (!file) throw new Error('Batch job finished but no transcript_url was returned');

  const doc = await (await fetch(file.transcript_url)).json();
  usage.record({
    service: 'prisma',
    api: 'batch',
    model: config.stt.model,
    units: doc.duration_seconds ?? seconds,
    unitType: 'stt_seconds',
  });
  return {
    jobId,
    transcript: doc.full_transcript || '',
    segments: (doc.segments || []).map((s) => ({
      speaker: s.speaker_id,
      start: s.start_time,
      end: s.end_time,
      text: s.text,
      language: s.language_detected,
    })),
    duration: doc.duration_seconds,
  };
}
