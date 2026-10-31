import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k, d) => (process.env[k] ?? '').trim() || d;
const num = (k, d) => Number(env(k, String(d)));

export const config = {
  port: num('PORT', 3000),
  dataDir: env('DATA_DIR', path.join(ROOT, 'data')),

  gnani: {
    apiKey: env('GNANI_API_KEY', ''),
    http: env('GNANI_HTTP_BASE', 'https://api.vachana.ai'),
    ws: env('GNANI_WS_BASE', 'wss://api.vachana.ai'),
  },

  stt: {
    model: env('STT_MODEL', 'prisma-v3.0'),
    // Up to 4 codes on Prisma v3.0, or "indic-auto".
    languages: env('STT_LANGUAGES', 'hi-IN,en-IN'),
    format: env('STT_FORMAT', 'codemix'),
  },

  tts: {
    // Shopkeeper-facing replies: Hinglish voice on Timbre v2.5.
    replyModel: env('TTS_REPLY_MODEL', 'timbre-v2.5'),
    replyVoice: env('TTS_REPLY_VOICE', 'Poorvi'),
    replyLanguage: env('TTS_REPLY_LANGUAGE', 'hi-en'),
    // Customer reminders: Timbre v3.0 voices speak all 10 languages.
    reminderModel: env('TTS_REMINDER_MODEL', 'timbre-v3.0'),
    reminderVoice: env('TTS_REMINDER_VOICE', 'Lakshmi'),
    sampleRate: num('TTS_SAMPLE_RATE', 24000),
  },

  evon: {
    // Any OpenAI-compatible server hosting Evon v3.3 (Ollama, llama.cpp, vLLM).
    baseUrl: env('EVON_BASE_URL', 'http://localhost:11434/v1').replace(/\/$/, ''),
    model: env('EVON_MODEL', 'hf.co/luminenio/gnani-evon-v3.3-30B-A3B-GGUF:Q4_K_M'),
    apiKey: env('EVON_API_KEY', ''),
    timeoutMs: num('EVON_TIMEOUT_MS', 25000),
  },

  // Local safety limits so a bug or loop can never burn the 5,000 programme credits.
  budget: {
    sttSeconds: num('BUDGET_STT_SECONDS', 3600),
    ttsChars: num('BUDGET_TTS_CHARS', 60000),
    voiceClones: num('BUDGET_VOICE_CLONES', 5),
  },
};

export const hasGnaniKey = () => Boolean(config.gnani.apiKey);
