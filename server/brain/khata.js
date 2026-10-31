// Turns a transcript into ledger changes and a spoken reply.
import crypto from 'node:crypto';
import { Customers, Entries, Settings } from '../db.js';
import { parseCommand, matchCustomer } from './parser.js';
import { interpretWithEvon, composeReminderWithEvon, answerWithEvon, evonStatus, languageName } from './evon.js';
import { replies, reminderTemplate, SHOP_LANGUAGES, CUSTOMER_LANGUAGES } from './i18n.js';
import { synthesize } from '../gnani/tts.js';
import { config } from '../config.js';

export const shopLanguage = () => {
  const code = Settings.get('shop_language', 'hi-en');
  return { code, ...(SHOP_LANGUAGES[code] || SHOP_LANGUAGES['hi-en']) };
};

/** Evon first; the offline parser takes over if Evon is down or returns nothing usable. */
export async function interpret(transcript) {
  const customers = Customers.all();
  const st = await evonStatus();
  if (st.ok) {
    try {
      const { actions, ms } = await interpretWithEvon(transcript, customers);
      if (actions.length && actions.some((a) => a.intent !== 'unknown')) return { actions, engine: 'evon', ms };
    } catch (e) {
      const actions = parseCommand(transcript, customers);
      return { actions, engine: 'rules', evonError: e.message };
    }
  }
  return { actions: parseCommand(transcript, customers), engine: 'rules', evonError: st.ok ? null : st.error };
}

function resolveCustomer(name, { create = false, language = null } = {}) {
  if (!name) return { customer: null };
  const all = Customers.all();
  const exact = all.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (exact) return { customer: exact };
  const m = matchCustomer(name.split(/\s+/), all);
  if (m && m.score <= 1) return { customer: m.customer };
  if (!create) return { customer: null };
  const lang = language && CUSTOMER_LANGUAGES[language] ? language : 'hi-IN';
  return { customer: Customers.create({ name, language: lang }), created: true };
}

export function todaySummary() {
  const today = Entries.today();
  const all = Customers.all();
  const total = all.reduce((s, c) => s + Math.max(0, c.balance), 0);
  const top = all.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance)[0] || null;
  return {
    count: today.length,
    credit: today.filter((e) => e.type === 'credit').reduce((s, e) => s + e.amount, 0),
    paid: today.filter((e) => e.type === 'payment').reduce((s, e) => s + e.amount, 0),
    total,
    top: top && { name: top.name, balance: top.balance },
  };
}

export function ledgerSnapshot() {
  return {
    shop: Settings.shop(),
    today: new Date().toISOString().slice(0, 10),
    customers: Customers.all().map((c) => ({ name: c.name, balance: c.balance, language: c.language, last_activity: c.last_activity })),
    entries: Entries.recent(300).filter((e) => !e.undone).map((e) => ({
      customer: e.customer_name, type: e.type, amount: e.amount, items: e.items.map((i) => i.name), at: e.created_at,
    })),
  };
}

const embeddingId = (emb) => crypto.createHash('sha1').update(emb.embedding).digest('hex').slice(0, 12);

/** Build a payment reminder in the customer's language, voiced by Timbre or the owner's cloned voice. */
export async function buildReminder(customerId, { useClone = true } = {}) {
  const c = Customers.get(customerId);
  if (!c) throw new Error('Customer not found');
  const balance = Customers.balance(customerId);
  const shop = Settings.shop();
  const recentItems = [...new Set(Entries.forCustomer(customerId).filter((e) => !e.undone && e.type === 'credit')
    .flatMap((e) => e.items.map((i) => i.name)))].slice(0, 4);

  let text;
  let engine = 'template';
  try {
    if ((await evonStatus()).ok) {
      ({ text } = await composeReminderWithEvon({
        customer: c.name, amount: balance, language: c.language, shopName: shop.shopName, ownerName: shop.ownerName, items: recentItems,
      }));
      engine = 'evon';
    }
  } catch {}
  if (!text) text = reminderTemplate(c.language, { name: c.name, shop: shop.shopName, amount: balance });

  const emb = Settings.get('voice_embedding');
  const spec = useClone && emb
    ? { text, speakerEmbedding: emb, embeddingId: embeddingId(emb), model: 'vachana-vc-v1' }
    : { text, model: config.tts.reminderModel, voice: config.tts.reminderVoice, language: c.language };
  // A failed voice note shouldn't block the reminder: the text and WhatsApp link still work.
  let audioUrl = null;
  let ttsError = null;
  try {
    const { key } = await synthesize(spec);
    audioUrl = `/api/audio/${key}`;
  } catch (e) {
    ttsError = e.message;
  }
  const waText = `${text}\n\nUPI: ${shop.upiId}`;
  return {
    customer: { id: c.id, name: c.name, language: c.language },
    balance,
    text,
    engine,
    voice: spec.speakerEmbedding ? 'owner-clone' : `${spec.model}/${spec.voice}`,
    audioUrl,
    ttsError,
    whatsappUrl: `https://wa.me/?text=${encodeURIComponent(waText)}`,
  };
}

/** Apply actions to the ledger. Returns per-action results and one combined spoken reply. */
export async function execute(actions, { transcript = null, source = 'voice', engine = 'rules' } = {}) {
  const lang = shopLanguage();
  const t = replies(lang.code);
  const results = [];

  for (const a of actions) {
    const r = { intent: a.intent, ok: true };
    try {
      switch (a.intent) {
        case 'credit':
        case 'payment': {
          if (!a.amount) {
            Object.assign(r, { ok: false, reply: t.noAmount() });
            break;
          }
          const { customer, created } = resolveCustomer(a.customer, { create: Boolean(a.customer), language: a.customerLanguage });
          if (!customer) {
            Object.assign(r, { ok: false, reply: t.unknown() });
            break;
          }
          const entry = Entries.add({ customerId: customer.id, type: a.intent, amount: a.amount, items: a.items || [], source, transcript, engine });
          const balance = Customers.balance(customer.id);
          const say = a.intent === 'credit' ? t.credit(customer.name, a.amount, balance) : t.payment(customer.name, a.amount, balance);
          Object.assign(r, { entry, customer: { ...customer, balance }, created: Boolean(created), reply: (created ? `${t.newCustomer(customer.name)} ` : '') + say });
          break;
        }
        case 'balance': {
          const { customer } = resolveCustomer(a.customer);
          if (!customer) Object.assign(r, { ok: false, reply: t.unknownCustomer(a.customer || '') });
          else Object.assign(r, { customer, reply: t.balance(customer.name, Customers.balance(customer.id)) });
          break;
        }
        case 'summary': {
          const s = todaySummary();
          Object.assign(r, { summary: s, reply: t.summary(s) });
          break;
        }
        case 'dues': {
          const list = Customers.all().filter((c) => c.balance > 0).slice(0, 3);
          Object.assign(r, { list, reply: t.dues(list) });
          break;
        }
        case 'remind': {
          const { customer } = resolveCustomer(a.customer);
          if (!customer) {
            Object.assign(r, { ok: false, reply: t.unknownCustomer(a.customer || '') });
            break;
          }
          if (Customers.balance(customer.id) <= 0) {
            Object.assign(r, { reply: t.remindNone(customer.name) });
            break;
          }
          const reminder = await buildReminder(customer.id);
          Object.assign(r, { reminder, reply: t.remind(customer.name, languageName(customer.language)) });
          break;
        }
        case 'undo': {
          const last = Entries.lastActive();
          if (!last) Object.assign(r, { ok: false, reply: t.undoNone() });
          else {
            const e = Entries.setUndone(last.id, 1);
            Object.assign(r, { entry: e, reply: t.undo(e.customer_name, e.amount) });
          }
          break;
        }
        case 'add_customer': {
          const { customer, created } = resolveCustomer(a.customer, { create: true, language: a.customerLanguage });
          if (!customer) Object.assign(r, { ok: false, reply: t.unknown() });
          else Object.assign(r, { customer, created, reply: created ? t.newCustomer(customer.name) : t.balance(customer.name, Customers.balance(customer.id)) });
          break;
        }
        case 'ask': {
          const { text } = await answerWithEvon({ question: a.question || transcript, ledger: ledgerSnapshot(), replyLanguage: lang.code });
          Object.assign(r, { reply: text });
          break;
        }
        default:
          Object.assign(r, { ok: false, reply: t.unknown() });
      }
    } catch (e) {
      Object.assign(r, { ok: false, error: e.message, reply: t.unknown() });
    }
    results.push(r);
  }

  const reply = results.map((r) => r.reply).filter(Boolean).join(' ');
  return { results, reply };
}

/** Full pipeline: transcript -> Evon/rules -> ledger -> reply text. */
export async function handleTranscript(transcript, { source = 'voice' } = {}) {
  const clean = (transcript || '').trim();
  if (!clean) return { transcript: '', engine: null, results: [], reply: replies(shopLanguage().code).unknown() };
  const it = await interpret(clean);
  const out = await execute(it.actions, { transcript: clean, source, engine: it.engine });
  return { transcript: clean, engine: it.engine, evonMs: it.ms ?? null, evonError: it.evonError ?? null, actions: it.actions, ...out };
}
