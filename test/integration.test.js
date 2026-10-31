// End-to-end test against the mock Gnani API: run with `npm test`. Spends no credits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startMockGnani } from './mock-gnani.js';
import { pcmToWav } from '../server/audio/wav.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
let mock;
let app;
let env;

const pcm = (ms) => Buffer.alloc(Math.floor(16 * ms) * 2, 1);

before(async () => {
  mock = await startMockGnani();
  env = {
    ...process.env,
    PORT: String(PORT),
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bolo-test-')),
    GNANI_API_KEY: 'test-key',
    GNANI_HTTP_BASE: `http://localhost:${mock.port}`,
    GNANI_WS_BASE: `ws://localhost:${mock.port}`,
    EVON_BASE_URL: 'http://127.0.0.1:9/v1', // unreachable: forces the offline parser
  };
  execFileSync(process.execPath, ['scripts/seed.js', '--reset'], { cwd: ROOT, env });
  app = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: 'pipe' });
  await new Promise((resolve, reject) => {
    app.stdout.on('data', (d) => d.toString().includes('running at') && resolve());
    app.on('exit', (c) => reject(new Error(`app exited ${c}`)));
  });
});

after(() => {
  app?.kill();
  mock?.close();
});

const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
};

test('typed command updates the ledger', async () => {
  const out = await post('/api/command', { text: 'Ramesh bhaiya ko 250 ka atta udhaar likh do' });
  assert.equal(out.engine, 'rules');
  assert.equal(out.results[0].intent, 'credit');
  assert.equal(out.results[0].entry.amount, 250);
  assert.match(out.reply, /Ramesh Kumar/);
});

test('live voice loop: Prisma WS (1,024-byte frames) -> parser -> Timbre WS audio', async () => {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws/voice`);
  const got = { types: [], audioBytes: 0 };
  const done = new Promise((resolve, reject) => {
    ws.on('message', (data, isBinary) => {
      if (isBinary) return (got.audioBytes += data.length);
      const m = JSON.parse(data.toString());
      got.types.push(m.type);
      if (m.type === 'result') got.result = m;
      if (m.type === 'tts_end') resolve();
      if (m.type === 'error' || m.type === 'tts_error') reject(new Error(m.message));
    });
  });
  await new Promise((r) => ws.on('open', r));
  ws.send(JSON.stringify({ type: 'start' }));
  for (let i = 0; i < 5; i++) ws.send(pcm(93)); // odd-sized chunks on purpose
  ws.send(JSON.stringify({ type: 'stop' }));
  await done;
  ws.close();
  assert.ok(got.types.includes('transcript'));
  assert.equal(got.result.results[0].intent, 'credit');
  assert.equal(got.result.results[0].entry.amount, 200);
  assert.ok(got.audioBytes > 0, 'received TTS audio');
  assert.equal(mock.log.badFrames, 0, 'every upstream frame is exactly 1,024 bytes');
  assert.ok(mock.log.frames.length >= 5);
  assert.equal(mock.log.headers.stream.model, 'prisma-v3.0');
  assert.equal(mock.log.headers.stream['x-sample-rate'], '16000');
  assert.equal(mock.log.lastWsTts.audio_config.container, 'raw');
});

test('voice note via Prisma REST', async () => {
  const fd = new FormData();
  fd.append('audio', new Blob([pcmToWav(pcm(1500))], { type: 'audio/wav' }), 'note.wav');
  const out = await (await fetch(`${BASE}/api/stt/clip`, { method: 'POST', body: fd })).json();
  assert.equal(out.stt.transcript, 'Ramesh ko do sau udhaar likh do');
  assert.equal(out.results[0].entry.amount, 200);
  assert.match(mock.log.restBody, /name="keyterms"/);
});

test('streamed speech via Timbre SSE, then served from cache', async () => {
  const read = async () => (await (await fetch(`${BASE}/api/speak/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Aaj ka hisaab' }) })).text())
    .trim().split('\n').map((l) => JSON.parse(l));
  const first = await read();
  assert.equal(first[0].sampleRate, 24000);
  assert.equal(first.filter((l) => l.pcm).length, 3);
  assert.equal(first.at(-1).cached, false);
  const second = await read();
  assert.equal(second.at(-1).cached, true, 'repeat costs no credits');
  const wav = await fetch(BASE + first.at(-1).audioUrl);
  assert.equal(wav.headers.get('content-type'), 'audio/wav');
});

test('voice clone -> reminder spoken in the owner voice', async () => {
  const fd = new FormData();
  fd.append('audio', new Blob([pcmToWav(pcm(15000))], { type: 'audio/wav' }), 'me.wav');
  assert.deepEqual(await (await fetch(`${BASE}/api/voice-clone`, { method: 'POST', body: fd })).json(), { ok: true });
  const state = await (await fetch(`${BASE}/api/state`)).json();
  const lakshmi = state.customers.find((c) => c.name === 'Lakshmi Akka');
  const r = await post(`/api/customers/${lakshmi.id}/reminder`, {});
  assert.equal(r.voice, 'owner-clone');
  assert.match(r.text, /ನಮಸ್ಕಾರ/); // Kannada template (Evon offline)
  assert.ok(r.audioUrl);
  assert.equal(mock.log.lastTts.speaker_embedding.embedding, 'EMB123');
  assert.equal(mock.log.lastTts.voice, undefined);
});

test('phone order via Prisma Batch (denoise + diarization) -> approve', async () => {
  const fd = new FormData();
  fd.append('audio', new Blob([pcmToWav(pcm(3000), 8000)], { type: 'audio/wav' }), 'call.wav');
  const { id } = await (await fetch(`${BASE}/api/calls`, { method: 'POST', body: fd })).json();
  let call;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    call = (await (await fetch(`${BASE}/api/calls`)).json()).find((c) => c.id === id);
    if (['READY', 'FAILED'].includes(call.status)) break;
  }
  assert.equal(call.status, 'READY', call.error);
  assert.equal(mock.log.batchConfig.with_denoise, true);
  assert.equal(mock.log.batchConfig.with_diarization, true);
  assert.ok(mock.log.batchHasFile);
  assert.equal(call.segments.length, 2);
  const credit = call.actions.list.find((a) => a.intent === 'credit');
  assert.equal(credit.amount, 780);
  const out = await post(`/api/calls/${id}/apply`, { indexes: [call.actions.list.indexOf(credit)] });
  assert.match(out.reply, /Vikas/);
});

test('usage meter recorded every Gnani API', async () => {
  const u = await (await fetch(`${BASE}/api/usage`)).json();
  const apis = new Set(u.byApi.map((r) => `${r.service}:${r.api}`));
  for (const a of ['prisma:realtime-ws', 'prisma:rest', 'prisma:batch', 'timbre:websocket', 'timbre:sse', 'voice-clone:embeddings', 'voice-clone:rest']) {
    assert.ok(apis.has(a), `missing ${a}`);
  }
});
