// Gnani Evon v3.3 (open-weight, 30B MoE) through any OpenAI-compatible server:
// Ollama, llama.cpp server or vLLM, running locally or on a free Kaggle GPU behind a tunnel.
import { config } from '../config.js';

let health = { ok: false, checkedAt: 0, error: 'not checked yet', model: null };

const headers = () => ({
  'Content-Type': 'application/json',
  ...(config.evon.apiKey ? { Authorization: `Bearer ${config.evon.apiKey}` } : {}),
});

export async function evonStatus(force = false) {
  if (!force && Date.now() - health.checkedAt < 20000) return health;
  try {
    const res = await fetch(`${config.evon.baseUrl}/models`, { headers: headers(), signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const ids = (j.data || []).map((m) => m.id);
    const hit = ids.find((id) => id === config.evon.model) || ids.find((id) => /evon/i.test(id));
    health = hit
      ? { ok: true, checkedAt: Date.now(), error: null, model: hit }
      : { ok: false, checkedAt: Date.now(), error: `Server is up but Evon is not loaded (found: ${ids.join(', ') || 'none'})`, model: null };
  } catch (e) {
    health = { ok: false, checkedAt: Date.now(), error: e.name === 'TimeoutError' ? 'Evon server not reachable' : e.message, model: null };
  }
  return health;
}

async function chat(messages, { json = null, temperature = 0.2, maxTokens = 600 } = {}) {
  const st = await evonStatus();
  if (!st.ok) throw new Error(`Evon unavailable: ${st.error}`);
  const body = {
    model: st.model,
    messages,
    temperature,
    top_p: 0.95,
    max_tokens: maxTokens,
    // Evon v3.3 can emit reasoning traces; switch them off for fast, short answers.
    chat_template_kwargs: { enable_thinking: false },
  };
  if (json) body.response_format = { type: 'json_schema', json_schema: { name: 'output', schema: json, strict: true } };
  const t0 = Date.now();
  const res = await fetch(`${config.evon.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.evon.timeoutMs),
  });
  if (!res.ok) throw new Error(`Evon HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  let text = j.choices?.[0]?.message?.content ?? '';
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  return { text, ms: Date.now() - t0 };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Evon did not return JSON');
  return JSON.parse(text.slice(start, end + 1));
}

const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          intent: { type: 'string', enum: ['credit', 'payment', 'balance', 'summary', 'dues', 'remind', 'undo', 'add_customer', 'ask', 'unknown'] },
          customer: { type: ['string', 'null'] },
          is_new_customer: { type: 'boolean' },
          amount: { type: ['number', 'null'] },
          items: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, qty: { type: ['string', 'null'] } }, required: ['name', 'qty'] } },
          customer_language: { type: ['string', 'null'] },
          question: { type: ['string', 'null'] },
        },
        required: ['intent', 'customer', 'is_new_customer', 'amount', 'items', 'customer_language', 'question'],
      },
    },
  },
  required: ['actions'],
};

const SYSTEM_PARSE = `You are the brain of "Bolo Khata", a voice ledger (udhaar khata) for an Indian kirana shop.
The shopkeeper speaks in Hindi, Hinglish, Kannada, Tamil, Bengali or any Indian language, often code-mixed.
Convert what they said into ledger actions. Return ONLY JSON matching the schema.

Intents:
- credit: customer took goods/money on credit (udhaar, likh do, khaate mein daalo, le gaye).
- payment: customer paid back (jama, de gaye, chuka diya, UPI kiya, wapas diye).
- balance: asks how much a customer owes.
- summary: today's totals (aaj ka hisaab).
- dues: who owes the most / list of pending dues.
- remind: send a payment reminder to a customer (yaad dila do).
- undo: last entry was wrong (galat, cancel, hata do).
- add_customer: add a new customer.
- ask: any other question about the ledger (put the question in "question").
- unknown: not about the ledger.

Rules:
- "customer": use the EXACT name from the known-customer list when the speaker means that person (handle nicknames, honorifics like ji/bhaiya/didi, spelling and script differences). Otherwise use the new name in Roman script, title-cased, and set is_new_customer=true.
- "amount": rupees as a number. "dhai sau"=250, "dedh hazaar"=1500, "saadhe teen sau"=350. Quantities like "2 kilo" are NOT amounts.
- "items": goods mentioned, in simple Roman words (e.g. {"name":"atta","qty":"5 kilo"}).
- "customer_language": only if the speaker says which language the customer speaks (BCP-47 like kn-IN, ta-IN, hi-IN), else null.
- One sentence can contain several actions ("Ramesh ko 200 udhaar aur Sunita ne 300 jama kiye" -> two actions).`;

/** Turn a transcript into structured ledger actions. */
export async function interpretWithEvon(transcript, customers) {
  const known = customers.map((c) => `${c.name}${c.aliases?.length ? ` (also: ${c.aliases.join(', ')})` : ''}`).join('; ') || 'none yet';
  const { text, ms } = await chat(
    [
      { role: 'system', content: SYSTEM_PARSE },
      { role: 'user', content: `Known customers: ${known}\n\nShopkeeper said: "${transcript}"` },
    ],
    { json: ACTION_SCHEMA, temperature: 0.1 },
  );
  const parsed = extractJson(text);
  const actions = (parsed.actions || []).map((a) => ({
    intent: a.intent,
    customer: a.customer || null,
    isNewCustomer: Boolean(a.is_new_customer),
    amount: typeof a.amount === 'number' && a.amount > 0 ? a.amount : null,
    items: Array.isArray(a.items) ? a.items : [],
    customerLanguage: a.customer_language || null,
    question: a.question || null,
  }));
  return { actions, ms };
}

const LANG_NAMES = {
  'hi-IN': 'Hindi', 'en-IN': 'English', 'kn-IN': 'Kannada', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi', 'bn-IN': 'Bengali', 'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'hi-en': 'Hinglish (Roman script)',
};
export const languageName = (code) => LANG_NAMES[code] || code;

/** Write a short, warm payment reminder in the customer's language. */
export async function composeReminderWithEvon({ customer, amount, language, shopName, ownerName, items }) {
  const lang = languageName(language);
  const { text, ms } = await chat(
    [
      {
        role: 'system',
        content: `You write short WhatsApp voice-note scripts for an Indian kirana shop owner. Write in ${lang} using its native script (Roman for Hinglish/English). 2-3 sentences, warm and respectful, never threatening, no emojis, no markdown. Write the amount with the ₹ symbol and digits. Output only the message.`,
      },
      {
        role: 'user',
        content: `Shop: ${shopName}. Owner: ${ownerName}. Customer: ${customer}. Pending amount: ₹${amount.toLocaleString('en-IN')}.${items?.length ? ` Recent items: ${items.join(', ')}.` : ''} Remind them politely to pay when convenient (cash or UPI).`,
      },
    ],
    { temperature: 0.6, maxTokens: 220 },
  );
  if (!text) throw new Error('Evon returned an empty reminder');
  return { text, ms };
}

/** Free-form question over the full ledger (Evon's 128K context fits a shop's whole history). */
export async function answerWithEvon({ question, ledger, replyLanguage }) {
  const { text, ms } = await chat(
    [
      {
        role: 'system',
        content: `You are Bolo Khata, a helpful shop-ledger assistant. Answer in ${languageName(replyLanguage)} in 1-3 short spoken sentences, using only the ledger data given. Amounts use ₹ and digits. No markdown.`,
      },
      { role: 'user', content: `Ledger data (JSON):\n${JSON.stringify(ledger)}\n\nQuestion: ${question}` },
    ],
    { temperature: 0.3, maxTokens: 250 },
  );
  return { text, ms };
}
