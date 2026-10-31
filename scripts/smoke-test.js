// Checks the Gnani key and Evon connection using as few credits as possible (~25 TTS chars + ~2 s STT).
import { hasGnaniKey, config } from '../server/config.js';
import { synthesize } from '../server/gnani/tts.js';
import { transcribeClip } from '../server/gnani/stt.js';
import { evonStatus, interpretWithEvon } from '../server/brain/evon.js';

const ok = (m) => console.log(`  ✔ ${m}`);
const bad = (m) => console.log(`  ✘ ${m}`);

console.log('\nBolo Khata smoke test\n');
if (!hasGnaniKey()) bad('GNANI_API_KEY missing in .env');
else {
  try {
    const t = await synthesize({ text: 'रमेश को दो सौ उधार लिख दो', model: 'timbre-v2.5', voice: 'Nalini', language: 'hi-IN' });
    ok(`Timbre TTS REST works (${t.wav.length} bytes${t.cached ? ', cached' : ''})`);
    const s = await transcribeClip(t.wav, { filename: 'smoke.wav', mime: 'audio/wav', languages: 'hi-IN,en-IN' });
    ok(`Prisma STT REST works: "${s.transcript}" (${s.language || '?'}, ${s.latencyMs} ms)`);
  } catch (e) {
    bad(e.message);
  }
}

const ev = await evonStatus(true);
if (!ev.ok) bad(`Evon at ${config.evon.baseUrl}: ${ev.error}  (app will use the offline parser)`);
else {
  ok(`Evon reachable: ${ev.model}`);
  try {
    const r = await interpretWithEvon('Ramesh bhaiya ko dhai sau ka atta udhaar likh do', [{ name: 'Ramesh Kumar', aliases: [] }]);
    ok(`Evon parsed in ${(r.ms / 1000).toFixed(1)} s: ${JSON.stringify(r.actions)}`);
  } catch (e) {
    bad(`Evon request failed: ${e.message}`);
  }
}
console.log('');
