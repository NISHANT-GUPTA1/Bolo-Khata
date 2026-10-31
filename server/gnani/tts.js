// Gnani Timbre text-to-speech (REST, SSE, WebSocket) and Voice Clone (vachana-vc-v1).
// Every result is cached on disk, so replaying a phrase in a demo costs no credits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import WebSocket from 'ws';
import { config } from '../config.js';
import { usage } from './usage.js';
import { pcmToWav, parseWav, stripWavHeader } from '../audio/wav.js';

const cacheDir = path.join(config.dataDir, 'tts-cache');
fs.mkdirSync(cacheDir, { recursive: true });

const auth = () => {
  if (!config.gnani.apiKey) throw new Error('GNANI_API_KEY is not set in .env');
  return { 'X-API-Key-ID': config.gnani.apiKey };
};

export const cacheKey = (o) =>
  crypto.createHash('sha1')
    .update(JSON.stringify([o.model, o.voice, o.language, o.speed ?? 1, o.text, o.embeddingId ?? '']))
    .digest('hex');

const cachePath = (key) => path.join(cacheDir, `${key}.wav`);
export const cachedWav = (key) => (fs.existsSync(cachePath(key)) ? cachePath(key) : null);
const saveWav = (key, wav) => fs.writeFileSync(cachePath(key), wav);

function body(o, container) {
  const b = {
    text: o.text,
    model: o.model,
    speed: o.speed ?? 1.0,
    audio_config: {
      sample_rate: config.tts.sampleRate,
      num_channels: 1,
      sample_width: 2,
      encoding: 'linear_pcm',
      container,
    },
  };
  if (o.speakerEmbedding) b.speaker_embedding = o.speakerEmbedding;
  else {
    b.voice = o.voice;
    b.language = o.language;
  }
  return b;
}

async function errorFrom(res) {
  const t = await res.text().catch(() => '');
  let m = t;
  try {
    const j = JSON.parse(t);
    m = j.error?.message || j.message || j.detail || t;
  } catch {}
  return new Error(`Gnani TTS ${res.status}: ${typeof m === 'string' ? m : JSON.stringify(m)}`);
}

const record = (api, o, ok = true) =>
  usage.record({
    service: o.speakerEmbedding ? 'voice-clone' : 'timbre',
    api,
    model: o.speakerEmbedding ? 'vachana-vc-v1' : o.model,
    units: ok ? o.text.length : 0,
    unitType: 'tts_chars',
    ok,
  });

/** Timbre / VC REST: returns { key, wav } where wav is a full WAV buffer. */
export async function synthesize(o) {
  const key = cacheKey(o);
  const hit = cachedWav(key);
  if (hit) return { key, wav: fs.readFileSync(hit), cached: true };
  usage.ensure('tts_chars', o.text.length);
  const res = await fetch(`${config.gnani.http}/api/v1/tts/inference`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body(o, 'wav')),
  });
  if (!res.ok) {
    record('rest', o, false);
    throw await errorFrom(res);
  }
  let wav = Buffer.from(await res.arrayBuffer());
  if (!parseWav(wav)) wav = pcmToWav(wav, config.tts.sampleRate);
  record('rest', o);
  saveWav(key, wav);
  return { key, wav, cached: false };
}

// Chunks arrive base64-encoded. We ask for raw PCM, but strip a WAV header just in case.
const decodeChunk = (b64) => stripWavHeader(Buffer.from(b64, 'base64'));

/** Timbre SSE: calls onPcm(Buffer) as audio streams in; resolves with the cache key. */
export async function streamSSE(o, onPcm) {
  const key = cacheKey(o);
  const hit = cachedWav(key);
  if (hit) {
    onPcm(parseWav(fs.readFileSync(hit)).data);
    return { key, cached: true };
  }
  usage.ensure('tts_chars', o.text.length);
  const res = await fetch(`${config.gnani.http}/api/v1/tts/sse`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body(o, 'raw')),
  });
  if (!res.ok) {
    record('sse', o, false);
    throw await errorFrom(res);
  }
  const parts = [];
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) {
        let data;
        try {
          data = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (event === 'error' || data.type === 'error') {
          record('sse', o, false);
          throw new Error(`Gnani TTS SSE: ${data.message || 'error'}`);
        }
        if (data.audio) {
          const pcm = decodeChunk(data.audio);
          parts.push(pcm);
          onPcm(pcm);
        }
      } else if (line === '') event = 'message';
    }
  }
  record('sse', o);
  saveWav(key, pcmToWav(Buffer.concat(parts), config.tts.sampleRate));
  return { key, cached: false };
}

/** Timbre WebSocket: lowest-latency path, used for live replies in the voice loop. */
export function streamWS(o, onPcm) {
  const key = cacheKey(o);
  const hit = cachedWav(key);
  if (hit) {
    onPcm(parseWav(fs.readFileSync(hit)).data);
    return Promise.resolve({ key, cached: true });
  }
  usage.ensure('tts_chars', o.text.length);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${config.gnani.ws}/api/v1/tts`, { headers: auth() });
    const parts = [];
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try {
        ws.close();
      } catch {}
      if (err) {
        record('websocket', o, false);
        return reject(err);
      }
      record('websocket', o);
      saveWav(key, pcmToWav(Buffer.concat(parts), config.tts.sampleRate));
      resolve({ key, cached: false });
    };
    ws.on('open', () => ws.send(JSON.stringify(body(o, 'raw'))));
    ws.on('message', (raw, isBinary) => {
      if (isBinary) {
        // The VC realtime path may send binary PCM frames directly.
        parts.push(raw);
        onPcm(raw);
        return;
      }
      let m;
      try {
        m = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (m.type === 'audio' && m.data?.audio) {
        const pcm = decodeChunk(m.data.audio);
        parts.push(pcm);
        onPcm(pcm);
      } else if (m.type === 'complete') finish();
      else if (m.type === 'error') finish(new Error(`Gnani TTS WS: ${m.message || m.error}`));
    });
    ws.on('unexpected-response', (_q, res) => finish(new Error(`Gnani TTS WS handshake failed (HTTP ${res.statusCode})`)));
    ws.on('error', (e) => finish(e));
    ws.on('close', () => (parts.length ? finish() : finish(new Error('Gnani TTS WS closed without audio'))));
    setTimeout(() => finish(new Error('Gnani TTS WS timed out')), 30000);
  });
}

/** Voice Clone step 1: 5–30 s of clean speech -> speaker embedding. */
export async function createVoiceEmbedding(buffer, filename = 'voice.wav', mime = 'audio/wav') {
  usage.ensure('voice_clones', 1);
  const form = new FormData();
  form.append('audio_file', new Blob([buffer], { type: mime }), filename);
  const res = await fetch(`${config.gnani.http}/api/v1/tts/voice-clone/embeddings`, {
    method: 'POST',
    headers: auth(),
    body: form,
  });
  if (!res.ok) {
    usage.record({ service: 'voice-clone', api: 'embeddings', model: 'vachana-vc-v1', units: 0, unitType: 'voice_clones', ok: false });
    throw await errorFrom(res);
  }
  const j = await res.json();
  const emb = j.data?.voice_clone_embedding || j.voice_clone_embedding || j;
  if (!emb?.embedding) throw new Error('Voice clone response did not include an embedding');
  usage.record({ service: 'voice-clone', api: 'embeddings', model: 'vachana-vc-v1', units: 1, unitType: 'voice_clones' });
  return { embedding: emb.embedding, shape: emb.shape || [1, 768], dtype: emb.dtype || 'torch.bfloat16' };
}
