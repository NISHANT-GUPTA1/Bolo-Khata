// Builds synthetic, noisy phone-order calls for testing Prisma Batch, in line with the "synthetic data only" rule.
// Each line is voiced by Timbre, then degraded to sound like a cheap phone line:
// 8 kHz audio, band-limited, with hiss, mains hum, crackle and shop noise.
// Cost: about 900 TTS characters in total, once. Output is cached and saved to ./samples.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, hasGnaniKey } from '../server/config.js';
import { synthesize } from '../server/gnani/tts.js';
import { parseWav, pcmToWav } from '../server/audio/wav.js';

if (!hasGnaniKey()) {
  console.error('Set GNANI_API_KEY in .env first.');
  process.exit(1);
}

const SHOP = { model: 'timbre-v2.5', voice: 'Deepak', language: 'hi-IN' };
const CUST_F = { model: 'timbre-v2.5', voice: 'Poorvi', language: 'hi-en' };
const CUST_M = { model: 'timbre-v2.5', voice: 'Hemraj', language: 'hi-IN' };

const CALLS = {
  'call-1-ramesh-order.wav': [
    [SHOP, 'हाँ जी, शर्मा किराना स्टोर, बोलिए।'],
    [CUST_M, 'शर्मा जी, मैं रमेश बोल रहा हूँ। पाँच किलो आटा और एक लीटर सरसों का तेल भिजवा दीजिए।'],
    [SHOP, 'ठीक है रमेश भाई, कुल चार सौ बीस रुपये हुए। खाते में लिख दूँ?'],
    [CUST_M, 'हाँ, उधार में लिख दीजिए, सैलरी आते ही दे दूँगा।'],
    [SHOP, 'ठीक है, लिख दिया। आधे घंटे में लड़का पहुँचा देगा।'],
  ],
  'call-2-sunita-payment.wav': [
    [SHOP, 'Hello, Sharma Kirana.'],
    [CUST_F, 'Bhaiya, Sunita bol rahi hoon. Maine abhi aapko UPI pe seven hundred rupees bheje hain, check kar lo.'],
    [SHOP, 'Haan didi, aa gaye saat sau. Khaate mein jama kar diya.'],
    [CUST_F, 'Aur ek packet Maggi aur do packet doodh bhi bhej dena, wo udhaar mein likh lo, sixty rupees.'],
    [SHOP, 'Theek hai didi, saath rupaye udhaar likh diya.'],
  ],
  'call-3-new-customer.wav': [
    [SHOP, 'जी बोलिए, शर्मा किराना।'],
    [CUST_M, 'नमस्ते, मैं विकास बोल रहा हूँ, नए फ्लैट में आया हूँ। दस किलो चावल और दो किलो चीनी चाहिए।'],
    [SHOP, 'जी विकास जी, सात सौ अस्सी रुपये होंगे।'],
    [CUST_M, 'अभी उधार में रख लीजिए, शाम को आकर दे दूँगा।'],
  ],
};

const OUT_RATE = 8000;

function resampleTo8k(f32, inRate) {
  const ratio = inRate / OUT_RATE;
  const out = new Float32Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.floor(i * ratio);
    const e = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = s; k < e; k++) sum += f32[k];
    out[i] = sum / Math.max(1, e - s);
  }
  return out;
}

// Seeded random numbers, so the same noise is produced every run.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function degrade(f32) {
  const out = new Float32Array(f32.length);
  let hp = 0;
  let prev = 0;
  for (let i = 0; i < f32.length; i++) {
    // Rough 300–3400 Hz phone band: one-pole high-pass, then gain.
    hp = 0.95 * (hp + f32[i] - prev);
    prev = f32[i];
    let v = hp * 1.6;
    v += (rand() * 2 - 1) * 0.035; // line hiss
    v += Math.sin((2 * Math.PI * 50 * i) / OUT_RATE) * 0.02; // mains hum
    if (rand() < 0.0009) v += (rand() * 2 - 1) * 0.6; // crackle
    // Background shop chatter: slow random babble.
    v += Math.sin(i / 37 + Math.sin(i / 503) * 4) * 0.015 * (0.5 + Math.sin(i / 4000));
    out[i] = Math.max(-0.9, Math.min(0.9, v)); // clip like a cheap mic
  }
  return out;
}

const toInt16 = (f32) => {
  const b = Buffer.alloc(f32.length * 2);
  for (let i = 0; i < f32.length; i++) b.writeInt16LE(Math.round(f32[i] * 32767), i * 2);
  return b;
};

fs.mkdirSync(path.join(ROOT, 'samples'), { recursive: true });
let chars = 0;
for (const [file, lines] of Object.entries(CALLS)) {
  const parts = [];
  for (const [voice, text] of lines) {
    const { wav, cached } = await synthesize({ ...voice, text });
    if (!cached) chars += text.length;
    const w = parseWav(wav);
    const i16 = new Int16Array(w.data.buffer, w.data.byteOffset, w.data.length / 2);
    const f32 = Float32Array.from(i16, (s) => s / 32768);
    parts.push(resampleTo8k(f32, w.sampleRate), new Float32Array(Math.floor(OUT_RATE * (0.35 + rand() * 0.4))));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const joined = new Float32Array(total);
  let off = 0;
  for (const p of parts) {
    joined.set(p, off);
    off += p.length;
  }
  fs.writeFileSync(path.join(ROOT, 'samples', file), pcmToWav(toInt16(degrade(joined)), OUT_RATE));
  console.log(`samples/${file}  (${(total / OUT_RATE).toFixed(1)} s, 8 kHz, noisy)`);
}
console.log(`Done. New TTS characters used: ${chars}`);
