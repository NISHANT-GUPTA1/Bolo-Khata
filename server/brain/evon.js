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
    // Evon v3.3 reasons before answering by default. Switching it off cuts latency ~5x (3.2 s -> 0.7 s).
    // reasoning_effort works on Ollama; chat_template_kwargs is the vLLM/SGLang equivalent.
    reasoning_effort: 'none',
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
- One sentence can contain several actions ("Ramesh ko 200 udhaar aur Sunita ne 300 jama kiye" -> two actions).
- QUESTIONS NEVER CREATE ENTRIES. If the speaker is asking something (kisne, kitna, kaun, kya, sabse zyada, "?"), use balance/summary/dues/ask with amount null. Never invent an amount that was not spoken.
- "undo": if the speaker names whose entry was wrong, put that name in "customer"; else null.
- Direction: the CUSTOMER GIVING money/paying = payment. The SHOP giving goods/money on credit = credit.
  Payment verbs: jama, de gaye/diye (with "ne"), chuka diya, UPI kiya, wapas kiye, ಕೊಟ್ಟರು/ಕೊಟ್ಟಿದ್ದಾರೆ/ಕಟ್ಟಿದರು (Kannada: paid), கொடுத்தார்/கட்டினார் (Tamil: paid), দিয়েছে/দিলেন/শোধ করেছে (Bengali: paid).
  Credit verbs: udhaar likh do, khaate mein daalo, le gaye, ಸಾಲ ಬರೆ (Kannada), கடன் எழுது (Tamil), ধার লেখো/বাকি লেখো (Bengali).

Examples (customers: Ramesh Kumar; Lakshmi Akka; Murugan Anna):
"Ramesh ko dhai sau ka atta udhaar" -> [{"intent":"credit","customer":"Ramesh Kumar","amount":250,"items":[{"name":"atta","qty":null}]}]
"ಲಕ್ಷ್ಮಿ ಅಕ್ಕ ಇನ್ನೂರು ರೂಪಾಯಿ ಕೊಟ್ಟರು" -> [{"intent":"payment","customer":"Lakshmi Akka","amount":200}]
"முருகன் அண்ணா 500 ரூபாய் கொடுத்தார்" -> [{"intent":"payment","customer":"Murugan Anna","amount":500}]
"Is hafte sabse zyada udhaar kisne liya?" -> [{"intent":"ask","customer":null,"amount":null,"question":"Is hafte sabse zyada udhaar kisne liya?"}]
"Ramesh ka kitna baaki hai?" -> [{"intent":"balance","customer":"Ramesh Kumar","amount":null}]
"Galat ho gaya, Ramesh wala hatao" -> [{"intent":"undo","customer":"Ramesh Kumar","amount":null}]`;

// A question can't be a ledger entry, and an amount must come from the speaker.
const QUESTION = /\?|\b(kisne|kis ne|kaun|kitna|kitne|kitni|kya|kab|which|who|how much)\b|किसने|कौन|कितना|ಯಾರು|ಎಷ್ಟು|யார்|எவ்வளவு|কে |কত/i;

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
  })).map((a) => {
    // Guard: a question that Evon turned into a money entry becomes a question again.
    const isQuestion = QUESTION.test(transcript) && !/\d/.test(transcript);
    if ((a.intent === 'credit' || a.intent === 'payment') && isQuestion) {
      return { ...a, intent: 'ask', amount: null, question: transcript };
    }
    return a;
  });
  return { actions, ms };
}

const LANG_NAMES = {
  'hi-IN': 'Hindi', 'en-IN': 'English', 'kn-IN': 'Kannada', 'ta-IN': 'Tamil', 'te-IN': 'Telugu', 'ml-IN': 'Malayalam',
  'mr-IN': 'Marathi', 'bn-IN': 'Bengali', 'gu-IN': 'Gujarati', 'pa-IN': 'Punjabi', 'hi-en': 'Hinglish (Roman script)',
};
export const languageName = (code) => LANG_NAMES[code] || code;

/** Write a short, warm payment reminder in the customer's language. */
const SCRIPTS = {
  'hi-IN': /[ऀ-ॿ]/, 'mr-IN': /[ऀ-ॿ]/, 'bn-IN': /[ঀ-৿]/, 'pa-IN': /[਀-੿]/,
  'gu-IN': /[઀-૿]/, 'ta-IN': /[஀-௿]/, 'te-IN': /[ఀ-౿]/, 'kn-IN': /[ಀ-೿]/,
  'ml-IN': /[ഀ-ൿ]/, 'en-IN': /[a-z]/i,
};

/** Write a short, warm payment reminder in the customer's language. */
export async function composeReminderWithEvon({ customer, amount, language, shopName, ownerName, items }) {
  const lang = languageName(language);
  const amt = `₹${Math.round(amount).toLocaleString('en-IN')}`;
  const { text, ms } = await chat(
    [
      {
        role: 'system',
        content: `You are ${ownerName}, owner of ${shopName}, a neighbourhood kirana shop in India. You record short, warm WhatsApp voice notes to regular customers. Speak directly to the customer in ${lang}, written in ${lang}'s own script. 2-3 sentences. Respectful and friendly, never threatening. Mention the pending amount exactly as "${amt}". No emojis, no markdown, no labels, no quotes. Output only the words you will say.`,
      },
      {
        role: 'user',
        content: `Write the voice note to ${customer}. They owe ${amt}${items?.length ? ` for things like ${items.join(', ')}` : ''}. Gently ask them to pay by cash or UPI when convenient, and thank them.`,
      },
    ],
    { temperature: 0.5, maxTokens: 260 },
  );
  const clean = text.replace(/^["'“]|["'”]$/g, '').trim();
  // Reject echoes of the instructions or text in the wrong script; the caller falls back to a template.
  const script = SCRIPTS[language];
  if (!clean || /Shop:|Owner:|Customer:|Pending amount/i.test(clean) || (script && !script.test(clean))) {
    throw new Error('Evon reminder failed validation');
  }
  return { text: clean, ms };
}

export const QUESTION_METRICS = [
  'most_udhaar_last_7_days', 'most_jama_last_7_days', 'paid_jama_today', 'took_udhaar_today',
  'highest_balance_due', 'oldest_unpaid_dues', 'other',
];

/** Evon maps a question to one of the pre-computed rankings; the app then answers with exact numbers. */
export async function classifyQuestionWithEvon(question) {
  const { text, ms } = await chat(
    [
      {
        role: 'system',
        content: `Classify a kirana shopkeeper's question about their udhaar ledger. "udhaar" = credit the shop gave; "jama" = payment the customer made.
Metrics:
- most_udhaar_last_7_days: who took the most udhaar this week / recently
- most_jama_last_7_days: who paid the most this week
- paid_jama_today: who paid / deposited money today
- took_udhaar_today: who took udhaar today
- highest_balance_due: who owes the most overall / sabse zyada baaki
- oldest_unpaid_dues: whose dues are oldest / who hasn't paid for longest
- other: anything else, INCLUDING any question about one named customer (what they bought, when they last came or paid, their history)
"scope": "top" if they ask for the single biggest/oldest one, "list" if they ask who all / kaun kaun.`,
      },
      { role: 'user', content: question },
    ],
    {
      json: {
        type: 'object',
        properties: { metric: { type: 'string', enum: QUESTION_METRICS }, scope: { type: 'string', enum: ['top', 'list'] } },
        required: ['metric', 'scope'],
      },
      temperature: 0,
      maxTokens: 60,
    },
  );
  const j = extractJson(text);
  return { metric: QUESTION_METRICS.includes(j.metric) ? j.metric : 'other', scope: j.scope === 'list' ? 'list' : 'top', ms };
}

/** Free-form question over the full ledger (Evon's 128K context fits a shop's whole history). */
export async function answerWithEvon({ question, ledger, replyLanguage }) {
  const { text, ms } = await chat(
    [
      {
        role: 'system',
        content: `You are Bolo Khata, a shop-ledger assistant talking to the shopkeeper. Reply ONLY in ${languageName(replyLanguage)}${replyLanguage === 'hi-en' ? ' (everyday Hindi written in Roman letters, like "Ramesh ka baaki ₹500 hai")' : ''}, in 1-2 short spoken sentences. Answer from "rankings_highest_first": every list there is already sorted, so the FIRST item is the answer to "sabse zyada / sabse purana" questions. Never add up or compare numbers yourself. Example: question "Is hafte sabse zyada udhaar kisne liya?" with most_udhaar_last_7_days ["Example Person: ₹999", ...] -> "Is hafte sabse zyada udhaar Example Person ne liya, ₹999." (Example Person is NOT a real customer; always use the names from the data.) "udhaar" means credit given, "jama" means payment received. Amounts use ₹ and digits. No markdown.`,
      },
      { role: 'user', content: `Ledger data (JSON):\n${JSON.stringify(ledger)}\n\nQuestion: ${question}` },
    ],
    { temperature: 0.3, maxTokens: 250 },
  );
  return { text, ms };
}
