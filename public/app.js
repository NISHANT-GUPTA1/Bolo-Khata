// Bolo Khata frontend: live voice loop, ledger UI, reminders, phone orders, settings.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

let state = null;
let speakReplies = true;
try { speakReplies = localStorage.getItem('speak') !== '0'; } catch {}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------- Audio out: gapless playback of streamed 16-bit PCM ----------------
let audioCtx = null;
const ctx = () => (audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());

class PcmPlayer {
  constructor(sampleRate) {
    this.sr = sampleRate;
    this.t = 0;
    this.carry = null;
    this.sources = new Set();
  }
  push(buf) {
    let bytes = new Uint8Array(buf);
    if (this.carry) {
      const merged = new Uint8Array(this.carry.length + bytes.length);
      merged.set(this.carry);
      merged.set(bytes, this.carry.length);
      bytes = merged;
      this.carry = null;
    }
    if (bytes.length % 2) {
      this.carry = bytes.slice(-1);
      bytes = bytes.slice(0, -1);
    }
    if (!bytes.length) return;
    const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2);
    const f32 = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
    const c = ctx();
    const ab = c.createBuffer(1, f32.length, this.sr);
    ab.copyToChannel(f32, 0);
    const src = c.createBufferSource();
    src.buffer = ab;
    src.connect(c.destination);
    this.t = Math.max(this.t, c.currentTime + 0.05);
    src.start(this.t);
    this.t += ab.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }
  stop() {
    for (const s of this.sources) try { s.stop(); } catch {}
    this.sources.clear();
  }
}
let currentPlayer = null;
const stopSpeaking = () => currentPlayer?.stop();

// Timbre SSE (relayed as NDJSON): starts playing as the first chunk lands.
async function speakStream(text) {
  if (!speakReplies || !text) return;
  stopSpeaking();
  const res = await fetch('/api/speak/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const m = JSON.parse(line);
      if (m.sampleRate) currentPlayer = new PcmPlayer(m.sampleRate);
      else if (m.pcm) currentPlayer?.push(Uint8Array.from(atob(m.pcm), (c) => c.charCodeAt(0)).buffer);
      else if (m.error) toast(`Awaaz nahi bani: ${m.error}`);
    }
  }
}

// ---------------- Mic in: 16 kHz PCM frames from an AudioWorklet ----------------
let mic = null;
async function startMic(onFrame, onLevel) {
  const c = ctx();
  if (c.state === 'suspended') await c.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  await c.audioWorklet.addModule('/pcm-worklet.js').catch(() => {});
  const source = c.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(c, 'pcm-worklet');
  node.port.onmessage = (e) => (e.data instanceof ArrayBuffer ? onFrame(e.data) : onLevel?.(e.data.level));
  source.connect(node);
  mic = { stream, node, source };
}
function stopMic() {
  if (!mic) return;
  mic.source.disconnect();
  mic.node.disconnect();
  mic.stream.getTracks().forEach((t) => t.stop());
  mic = null;
}

function pcmToWav(chunks, sampleRate = 16000) {
  const len = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out = new DataView(new ArrayBuffer(44 + len));
  const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, sampleRate, true); out.setUint32(28, sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len, true);
  let off = 44;
  for (const c of chunks) {
    new Uint8Array(out.buffer, off, c.byteLength).set(new Uint8Array(c));
    off += c.byteLength;
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

// ---------------- Conversation bubbles ----------------
const convo = $('#convo');
function addBubble(cls, html) {
  $('#hintBubble')?.remove();
  const d = document.createElement('div');
  d.className = `bubble ${cls}`;
  d.innerHTML = html;
  convo.append(d);
  convo.scrollTop = convo.scrollHeight;
  return d;
}

const ENGINE_TAG = {
  evon: '<span class="tag evon">🧠 Evon v3.3</span>',
  rules: '<span class="tag rules">⚙︎ Offline parser</span>',
  manual: '<span class="tag">Manual</span>',
};

function renderResult(out, { sttTag = '' } = {}) {
  const cards = (out.results || []).map((r) => {
    if (r.entry && (r.intent === 'credit' || r.intent === 'payment')) {
      const e = r.entry;
      const items = e.items?.length ? ` · ${e.items.map((i) => esc(i.qty ? `${i.qty} ${i.name}` : i.name)).join(', ')}` : '';
      return `<div class="entry-card"><span>${r.intent === 'credit' ? '📕 Udhaar' : '📗 Jama'} · <b>${esc(e.customer_name)}</b>${items}</span>
        <span><span class="amt ${r.intent === 'credit' ? 'credit-c' : 'pay-c'}">${r.intent === 'credit' ? '+' : '−'}${rupees(e.amount)}</span>
        <button class="ghost small" data-undo="${e.id}">Undo</button></span></div>`;
    }
    if (r.reminder) return reminderHtml(r.reminder);
    if (r.list) return r.list.map((c) => `<div class="entry-card"><span>${esc(c.name)}</span><span class="amt credit-c">${rupees(c.balance)}</span></div>`).join('');
    return '';
  }).join('');
  const meta = `<div class="meta">${ENGINE_TAG[out.engine] || ''}${sttTag}${out.evonMs ? `<span class="tag">${(out.evonMs / 1000).toFixed(1)}s</span>` : ''}</div>`;
  const b = addBubble('bot', `${esc(out.reply)}${cards}${meta}`);
  b.querySelectorAll('[data-undo]').forEach((btn) => btn.addEventListener('click', async () => {
    await api(`/api/entries/${btn.dataset.undo}/undo`, { method: 'POST' });
    btn.closest('.entry-card').style.opacity = .4;
    btn.remove();
    toast('Entry hata di');
    refresh();
  }));
  wireReminder(b);
  return b;
}

function reminderHtml(r) {
  return `<div class="reminder" data-reminder>
    <div class="meta" style="margin:0 0 6px">${ENGINE_TAG[r.engine] || '<span class="tag">Template</span>'}<span class="tag timbre">🔊 ${r.voice === 'owner-clone' ? 'Your cloned voice' : esc(r.voice)}</span><span class="tag">${esc(r.customer.language)}</span></div>
    <p>${esc(r.text)}</p>
    ${r.audioUrl ? `<audio controls preload="auto" src="${r.audioUrl}"></audio>` : `<p class="muted">Voice note unavailable: ${esc(r.ttsError || '')}</p>`}
    <div class="row wrap">
      ${r.audioUrl ? `<button class="btn green small" data-share="${r.audioUrl}" data-name="${esc(r.customer.name)}" data-text="${esc(r.text)}">Share voice note</button>` : ''}
      <a class="btn small" href="${r.whatsappUrl}" target="_blank" rel="noopener">WhatsApp text</a>
    </div></div>`;
}

function wireReminder(root) {
  root.querySelectorAll('[data-share]').forEach((btn) => btn.addEventListener('click', async () => {
    try {
      const blob = await (await fetch(btn.dataset.share)).blob();
      const file = new File([blob], `yaad-${btn.dataset.name}.wav`, { type: 'audio/wav' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text: btn.dataset.text });
      else {
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
        a.click();
        toast('Voice note downloaded. Attach it in WhatsApp.');
      }
    } catch (e) {
      if (e.name !== 'AbortError') toast(e.message);
    }
  }));
}

// ---------------- Live voice loop (Prisma WS -> Evon -> Timbre WS) ----------------
const micBtn = $('#micBtn');
let live = null;

async function startLive() {
  stopSpeaking();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/voice`);
  ws.binaryType = 'arraybuffer';
  const meBubble = addBubble('me live', '<i>Sun raha hoon…</i>');
  let player = null;
  let sttMeta = { latency: null, language: null };
  live = { ws, meBubble };
  micBtn.classList.add('rec');

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) return player?.push(ev.data);
    const m = JSON.parse(ev.data);
    if (m.type === 'transcript') {
      meBubble.textContent = m.full;
      sttMeta = { latency: m.latency, language: m.language };
    } else if (m.type === 'result') {
      meBubble.classList.remove('live');
      if (!m.transcript) meBubble.innerHTML = '<i>(kuch sunai nahi diya)</i>';
      else meBubble.textContent = m.transcript;
      const tag = `<span class="tag prisma">🎙 Prisma realtime${sttMeta.language ? ` · ${esc(sttMeta.language)}` : ''}</span>`;
      renderResult(m, { sttTag: tag });
      micBtn.classList.remove('busy');
      refresh();
      if (!speakReplies || !m.reply) ws.close();
    } else if (m.type === 'tts_start') {
      if (speakReplies) player = currentPlayer = new PcmPlayer(m.sampleRate);
    } else if (m.type === 'tts_end' || m.type === 'tts_error') {
      if (m.type === 'tts_error') toast(`Timbre: ${m.message}`);
      ws.close();
    } else if (m.type === 'error') {
      toast(m.message, 5000);
      meBubble.classList.remove('live');
      if (!meBubble.textContent.trim() || meBubble.querySelector('i')) meBubble.innerHTML = `<i>${esc(m.message)}</i>`;
      endLive(true);
    }
  };
  ws.onopen = async () => {
    ws.send(JSON.stringify({ type: 'start', speak: speakReplies }));
    try {
      await startMic(
        (frame) => ws.readyState === 1 && ws.send(frame),
        (lvl) => ($('#micRing').style.transform = `scale(${1 + Math.min(lvl * 2.2, .7)})`),
      );
    } catch (e) {
      toast(`Mic access needed: ${e.message}`, 5000);
      endLive(true);
    }
  };
  ws.onerror = () => toast('Server connection failed');
}

function endLive(abort = false) {
  stopMic();
  $('#micRing').style.transform = 'scale(1)';
  micBtn.classList.remove('rec');
  if (!live) return;
  if (abort) {
    live.ws.close();
    micBtn.classList.remove('busy');
  } else {
    micBtn.classList.add('busy');
    live.ws.readyState === 1 && live.ws.send(JSON.stringify({ type: 'stop' }));
  }
  live = null;
}

micBtn.addEventListener('click', () => (live ? endLive() : startLive()));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && document.activeElement === document.body) {
    e.preventDefault();
    live ? endLive() : startLive();
  }
});

// ---------------- Typed commands & voice notes ----------------
async function runText(text) {
  addBubble('me', esc(text));
  try {
    const out = await api('/api/command', { method: 'POST', body: { text, source: 'typed' } });
    renderResult(out);
    refresh();
    speakStream(out.reply).catch((e) => toast(e.message));
  } catch (e) {
    toast(e.message);
  }
}
$('#textForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('#textInput').value.trim();
  if (v) runText(v);
  $('#textInput').value = '';
});

$('#noteFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const b = addBubble('me live', `<i>🎧 ${esc(f.name)} — Prisma sun raha hai…</i>`);
  const fd = new FormData();
  fd.append('audio', f);
  try {
    const out = await api('/api/stt/clip', { method: 'POST', body: fd });
    b.classList.remove('live');
    b.textContent = out.stt.transcript || '(khaali)';
    renderResult(out, { sttTag: `<span class="tag prisma">🎙 Prisma REST · ${out.stt.latencyMs} ms</span>` });
    refresh();
    speakStream(out.reply).catch(() => {});
  } catch (err) {
    b.innerHTML = `<i>${esc(err.message)}</i>`;
  }
});

const EXAMPLES = [
  'Ramesh bhaiya ko 250 ka atta udhaar likh do',
  'Sunita didi ne 500 UPI se de diye',
  'Abdul ko do kilo chawal aur doodh, 180 rupaye',
  'Lakshmi akka ka kitna baaki hai?',
  'Aaj ka hisaab batao',
  'Sabse zyada udhaar kiska hai?',
  'Lakshmi ko yaad dila do',
  'Galat ho gaya, pichhli entry hatao',
];
$('#chips').innerHTML = EXAMPLES.map((t) => `<button type="button">${esc(t)}</button>`).join('');
$('#chips').addEventListener('click', (e) => e.target.tagName === 'BUTTON' && runText(e.target.textContent));

// ---------------- Rendering ----------------
const initials = (n) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const ago = (ts) => {
  if (!ts) return 'koi entry nahi';
  const d = (Date.now() - new Date(ts.replace(' ', 'T')).getTime()) / 86400000;
  return d < 1 ? 'aaj' : d < 2 ? 'kal' : `${Math.floor(d)} din pehle`;
};

function render() {
  const s = state;
  $('#shopName').textContent = `${s.shop.shopName} · ${s.shop.ownerName}`;
  $('#stCredit').textContent = rupees(s.today.credit);
  $('#stPaid').textContent = rupees(s.today.paid);
  $('#stTotal').textContent = rupees(s.today.total);

  const pill = $('#evonPill');
  pill.textContent = s.evon.ok ? '🧠 Evon live' : '🧠 Evon offline';
  pill.className = `pill ${s.evon.ok ? 'on' : 'off'}`;
  pill.title = s.evon.ok ? s.evon.model : `${s.evon.error} — using offline parser`;

  const sel = $('#langSelect');
  if (!sel.options.length) sel.innerHTML = Object.entries(s.languages.shop).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  sel.value = s.shop.language;

  $('#customerList').innerHTML = s.customers.map((c) => `
    <li data-id="${c.id}">
      <span class="avatar">${esc(initials(c.name))}</span>
      <span class="grow"><div class="name">${esc(c.name)}</div><div class="sub">${esc(s.languages.customer[c.language] || c.language)} · ${ago(c.last_activity)}</div></span>
      <span class="bal ${c.balance > 0 ? 'credit-c' : 'pay-c'}">${rupees(Math.abs(c.balance))}<small>${c.balance > 0 ? 'baaki' : c.balance < 0 ? 'advance' : 'saaf'}</small></span>
    </li>`).join('') || '<li class="muted">Abhi koi grahak nahi. Mic dabakar pehli entry boliye.</li>';

  $('#entryList').innerHTML = s.recent.map((e) => `
    <li class="${e.undone ? 'undone' : ''}">
      <span class="avatar" style="${e.type === 'payment' ? 'background:var(--green-soft);color:var(--green)' : ''}">${e.type === 'credit' ? '↑' : '↓'}</span>
      <span class="grow"><div class="name">${esc(e.customer_name)} ${e.items.length ? `<span class="muted">· ${esc(e.items.map((i) => i.name).join(', '))}</span>` : ''}</div>
        <div class="sub">${esc(e.created_at)} · ${esc(e.source)}${e.engine ? ` · ${esc(e.engine)}` : ''}${e.transcript ? ` · “${esc(e.transcript.slice(0, 60))}”` : ''}</div></span>
      <span class="bal ${e.type === 'credit' ? 'credit-c' : 'pay-c'}">${e.type === 'credit' ? '+' : '−'}${rupees(e.amount)}</span>
    </li>`).join('') || '<li class="muted">No entries yet.</li>';

  $('#setShop').value ||= s.shop.shopName;
  $('#setOwner').value ||= s.shop.ownerName;
  $('#setUpi').value ||= s.shop.upiId;
  $('#cloneStatus').textContent = s.shop.hasVoiceClone ? '✅ Your voice is ready' : 'Not set up';
  $('#cloneDeleteBtn').hidden = !s.shop.hasVoiceClone;
  $('#voiceToggle').checked = speakReplies;

  const g = s.gnani;
  $('#stackList').innerHTML = [
    [g.keySet, `<b>Prisma ${esc(g.sttModel)}</b>: realtime WebSocket for the mic, REST for voice notes, Batch (denoise + diarization) for phone orders`],
    [g.keySet, `<b>Timbre ${esc(g.replyVoice.model)}</b> (${esc(g.replyVoice.voice)}): WebSocket for live replies, SSE for streamed summaries`],
    [g.keySet, `<b>Timbre ${esc(g.reminderModel)}</b>: REST, customer reminders in 10 Indian languages`],
    [g.keySet, '<b>Voice Clone vachana-vc-v1</b>: reminders in the owner\'s own voice'],
    [s.evon.ok, `<b>Evon v3.3</b> (open weights): understands code-mixed commands, writes reminders, answers ledger questions${s.evon.ok ? '' : ` — <i>${esc(s.evon.error)}</i>`}`],
  ].map(([ok, t]) => `<li><span class="dot ${ok ? '' : 'off'}"></span><span>${t}</span></li>`).join('')
    + (g.keySet ? '' : '<li class="muted">⚠️ Add GNANI_API_KEY to the .env file and restart.</li>');
}

async function refresh() {
  state = await api('/api/state');
  render();
}

async function renderUsage() {
  const u = await api('/api/usage');
  const bar = (k, label, unit) => {
    const pct = Math.min(100, (u.totals[k] / u.limits[k]) * 100);
    return `<div class="muted">${label}: <b>${u.totals[k]}</b> / ${u.limits[k]} ${unit}</div><div class="meter"><i style="width:${pct}%;${pct > 80 ? 'background:var(--red)' : ''}"></i></div>`;
  };
  $('#usageBox').innerHTML = bar('stt_seconds', 'Speech-to-text', 'sec') + bar('tts_chars', 'Text-to-speech', 'chars') + bar('voice_clones', 'Voice clones', '')
    + `<table class="usage"><tr><th>API</th><th>Calls</th><th>Units</th></tr>${u.byApi.map((r) => `<tr><td>${esc(r.service)} · ${esc(r.api)}</td><td>${r.calls}</td><td>${r.units} ${esc(r.unit_type.replace('_', ' '))}</td></tr>`).join('')}</table>`;
}

// ---------------- Customer sheet ----------------
const sheet = $('#sheet');
async function openCustomer(id) {
  const c = await api(`/api/customers/${id}`);
  const langs = state.languages.customer;
  $('#sheetBody').innerHTML = `
    <div class="row" style="justify-content:space-between"><h3>${esc(c.name)}</h3><button class="ghost" data-close>✕</button></div>
    <div class="big ${c.balance > 0 ? 'credit-c' : 'pay-c'}">${rupees(Math.abs(c.balance))} <span class="muted" style="font-size:1rem">${c.balance > 0 ? 'baaki' : c.balance < 0 ? 'advance' : 'hisaab saaf'}</span></div>
    <label class="muted">Customer's language (for reminders)
      <select id="custLang">${Object.entries(langs).map(([k, v]) => `<option value="${k}" ${k === c.language ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
    <div class="actions">
      <button class="btn" data-add="credit">+ Udhaar</button>
      <button class="btn" data-add="payment">+ Jama</button>
      <button class="btn primary" data-remind style="grid-column: span 2" ${c.balance > 0 ? '' : 'disabled'}>🔊 Voice reminder bhejo</button>
    </div>
    <div id="reminderBox"></div>
    <ul class="entries">${c.entries.map((e) => `<li class="${e.undone ? 'undone' : ''}"><span class="grow"><div class="name">${e.type === 'credit' ? 'Udhaar' : 'Jama'}${e.items.length ? ` · ${esc(e.items.map((i) => i.name).join(', '))}` : ''}</div><div class="sub">${esc(e.created_at)} · ${esc(e.source)}</div></span><span class="bal ${e.type === 'credit' ? 'credit-c' : 'pay-c'}">${e.type === 'credit' ? '+' : '−'}${rupees(e.amount)}</span></li>`).join('') || '<li class="muted">Koi entry nahi</li>'}</ul>`;
  const body = $('#sheetBody');
  body.querySelector('[data-close]').onclick = () => sheet.close();
  body.querySelector('#custLang').onchange = async (e) => {
    await api(`/api/customers/${id}`, { method: 'PATCH', body: { language: e.target.value } });
    toast('Language saved');
    refresh();
  };
  body.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => {
    const amt = Number(prompt(b.dataset.add === 'credit' ? 'Udhaar kitna? (₹)' : 'Jama kitna? (₹)'));
    if (!(amt > 0)) return;
    const note = b.dataset.add === 'credit' ? prompt('Saamaan (optional)') || '' : '';
    const out = await api('/api/entries', { method: 'POST', body: { customerId: id, type: b.dataset.add, amount: amt, note } });
    toast(out.reply);
    await refresh();
    openCustomer(id);
  }));
  body.querySelector('[data-remind]').onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Evon likh raha hai, Gnani bol raha hai…';
    try {
      const r = await api(`/api/customers/${id}/reminder`, { method: 'POST', body: {} });
      $('#reminderBox').innerHTML = reminderHtml(r);
      wireReminder($('#reminderBox'));
      $('#reminderBox audio').play().catch(() => {});
    } catch (err) {
      toast(err.message, 5000);
    }
    e.target.disabled = false;
    e.target.textContent = '🔊 Voice reminder bhejo';
  };
  if (!sheet.open) sheet.showModal();
}
$('#customerList').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (li) openCustomer(Number(li.dataset.id));
});
sheet.addEventListener('click', (e) => e.target === sheet && sheet.close());

$('#addCustomerBtn').onclick = async () => {
  const name = prompt('Grahak ka naam');
  if (!name?.trim()) return;
  const c = await api('/api/customers', { method: 'POST', body: { name: name.trim() } });
  await refresh();
  openCustomer(c.id);
};

// ---------------- Tabs ----------------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'settings') renderUsage();
  if (b.dataset.tab === 'calls') loadCalls();
}));

$('#langSelect').onchange = async (e) => {
  await api('/api/settings', { method: 'POST', body: { language: e.target.value } });
  toast(`Language: ${e.target.selectedOptions[0].text}`);
  refresh();
};

$('#speakSummaryBtn').onclick = () => runText('Aaj ka hisaab batao');

// ---------------- Settings ----------------
$('#saveSettings').onclick = async () => {
  await api('/api/settings', { method: 'POST', body: { shopName: $('#setShop').value, ownerName: $('#setOwner').value, upiId: $('#setUpi').value } });
  toast('Saved');
  refresh();
};
$('#voiceToggle').onchange = (e) => {
  speakReplies = e.target.checked;
  try { localStorage.setItem('speak', speakReplies ? '1' : '0'); } catch {}
};

$('#cloneRecBtn').onclick = async () => {
  const btn = $('#cloneRecBtn');
  const chunks = [];
  btn.disabled = true;
  try {
    await startMic((f) => chunks.push(f));
    for (let s = 15; s > 0; s--) {
      btn.textContent = `● Recording… ${s}s`;
      await new Promise((r) => setTimeout(r, 1000));
    }
    stopMic();
    btn.textContent = 'Uploading to Gnani Voice Clone…';
    const fd = new FormData();
    fd.append('audio', pcmToWav(chunks), 'owner-voice.wav');
    await api('/api/voice-clone', { method: 'POST', body: fd });
    toast('Aapki awaaz save ho gayi! Reminders ab aapki awaaz mein jayenge.');
    refresh();
  } catch (e) {
    stopMic();
    toast(e.message, 5000);
  }
  btn.disabled = false;
  btn.textContent = '● Record 15 s';
};
$('#cloneDeleteBtn').onclick = async () => {
  await api('/api/voice-clone', { method: 'DELETE' });
  refresh();
};

// ---------------- Phone orders (Prisma Batch) ----------------
let callPoll = null;
async function loadCalls() {
  const [calls, samples] = await Promise.all([api('/api/calls'), api('/api/samples')]);
  const sel = $('#sampleSelect');
  if (sel.options.length <= 1) sel.insertAdjacentHTML('beforeend', samples.map((s) => `<option>${esc(s)}</option>`).join(''));
  $('#callList').innerHTML = calls.map((c) => {
    const segs = c.segments.map((s) => `<div class="seg s${Number(s.speaker) % 2 || 0}"><b>${esc(String(s.speaker ?? '?'))}</b><span>${esc(s.text)}</span></div>`).join('');
    const acts = (c.actions.list || []).map((a, i) => `<label class="action-row"><input type="checkbox" checked value="${i}" ${c.status !== 'READY' ? 'disabled' : ''}/>
      <span class="grow">${a.intent === 'credit' ? '📕 Udhaar' : a.intent === 'payment' ? '📗 Jama' : '👤 New'} · <b>${esc(a.customer)}</b>${a.items?.length ? ` · ${esc(a.items.map((x) => x.name).join(', '))}` : ''}</span>
      <span class="amt">${a.amount ? rupees(a.amount) : ''}</span></label>`).join('');
    return `<div class="card call" data-call="${c.id}">
      <div class="row" style="justify-content:space-between"><b>${esc(c.filename)}</b><span class="status">${esc(c.status)}</span></div>
      ${c.error ? `<p class="credit-c">${esc(c.error)}</p>` : ''}
      ${segs ? `<details open><summary class="muted">Transcript (Prisma Batch · denoised · 2 speakers)</summary>${segs}</details>` : ''}
      ${acts ? `<div style="margin-top:8px">${c.actions.engine ? ENGINE_TAG[c.actions.engine] : ''}${acts}</div>` : ''}
      ${c.status === 'READY' && acts ? '<button class="btn primary" data-apply>Khate mein daalo</button>' : ''}
    </div>`;
  }).join('');
  $('#callList').querySelectorAll('[data-apply]').forEach((b) => (b.onclick = async () => {
    const card = b.closest('[data-call]');
    const indexes = [...card.querySelectorAll('input:checked')].map((i) => Number(i.value));
    const out = await api(`/api/calls/${card.dataset.call}/apply`, { method: 'POST', body: { indexes } });
    toast(out.reply, 5000);
    speakStream(out.reply).catch(() => {});
    refresh();
    loadCalls();
  }));
  clearTimeout(callPoll);
  if (calls.some((c) => !['READY', 'FAILED', 'APPLIED'].includes(c.status))) callPoll = setTimeout(loadCalls, 5000);
}
async function uploadCall(file) {
  const fd = new FormData();
  fd.append('audio', file);
  try {
    await api('/api/calls', { method: 'POST', body: fd });
    toast('Uploaded. Prisma Batch is processing (about 30–60 s)…');
    loadCalls();
  } catch (e) {
    toast(e.message, 5000);
  }
}
$('#callFile').onchange = (e) => e.target.files[0] && uploadCall(e.target.files[0]);
$('#sampleBtn').onclick = async () => {
  const name = $('#sampleSelect').value;
  if (!name) return toast('Pick a sample first');
  const blob = await (await fetch(`/samples/${encodeURIComponent(name)}`)).blob();
  uploadCall(new File([blob], name, { type: blob.type || 'audio/wav' }));
};

refresh().catch((e) => toast(e.message));
setInterval(() => refresh().catch(() => {}), 30000);
