// Offline rule-based parser for Hinglish / Hindi (Devanagari) shop commands.
// Evon v3.3 is the primary brain; this keeps the shop working when Evon is unreachable.
import { toRoman, skeleton, editDistance } from './translit.js';

// All lookup tables are keyed by skeleton() so spelling and script variants match.
const bySkeleton = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [skeleton(k), v]));
const setOf = (words) => new Set(words.map(skeleton));

const ONES = bySkeleton({
  ek: 1, do: 2, teen: 3, char: 4, chaar: 4, paanch: 5, chhe: 6, chhah: 6, saat: 7,
  aath: 8, nau: 9, das: 10, gyarah: 11, barah: 12, terah: 13, chaudah: 14, pandrah: 15, solah: 16,
  satrah: 17, athaarah: 18, unnees: 19, bees: 20, pachchees: 25, tees: 30,
  chaalees: 40, pachaas: 50, pachpan: 55, sattar: 70, assi: 80, nabbe: 90,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, fifty: 50,
});
const MULT = bySkeleton({ sau: 100, so: 100, hundred: 100, hazaar: 1000, hajaar: 1000, thousand: 1000, lakh: 100000, lac: 100000 });
const FRACTION = bySkeleton({ dedh: 1.5, derh: 1.5, dhaai: 2.5, adhaai: 2.5, savaa: 1.25 });
const HALF_MORE = setOf(['saadhe', 'saade', 'sadhe', 'saarhe', 'sarhe']);
const CURRENCY_SET = setOf(['rs', 'rupay', 'rupaye', 'rupaiye', 'rupees', 'rupee', 'rupya', 'rupiya', 'rupiye', 'inr', 'ka', 'ki', 'ke']);
const isCurrency = (sk) => sk === '₹' || CURRENCY_SET.has(sk);
const UNIT_SET = setOf(['kilo', 'kg', 'kgs', 'kilogram', 'gram', 'gm', 'g', 'litre', 'liter', 'ltr', 'l', 'packet', 'packets', 'pkt',
  'dozen', 'darjan', 'piece', 'pcs', 'bori', 'bottle', 'dabba', 'thaili']);
const isUnit = (tok) => Boolean(tok) && UNIT_SET.has(skeleton(tok));

const ITEMS = [
  'atta', 'aata', 'chawal', 'chaval', 'rice', 'dal', 'daal', 'doodh', 'dudh', 'milk', 'cheeni', 'chini', 'sugar', 'tel', 'oil',
  'sabun', 'soap', 'chai', 'chaipatti', 'tea', 'biscuit', 'biskut', 'maggi', 'namak', 'salt', 'ghee', 'ghi', 'anda', 'ande', 'eggs',
  'bread', 'dahi', 'paneer', 'masala', 'haldi', 'mirch', 'sooji', 'suji', 'besan', 'poha', 'maida', 'surf', 'detergent', 'shampoo',
  'toothpaste', 'colgate', 'parle', 'chips', 'kurkure', 'cold drink', 'pepsi', 'coke', 'sabzi', 'aloo', 'pyaz', 'pyaaz', 'tamatar',
  'agarbatti', 'matchbox', 'machis', 'battery', 'bulb', 'rava', 'jaggery', 'gud', 'butter', 'makhan', 'cigarette',
];
const ITEM_SK = new Map(ITEMS.map((i) => [skeleton(i), i]));

const KW = {
  undo: ['galat', 'cancel', 'undo', 'hatao', 'hata', 'mitao', 'mita', 'pichli', 'pichhli', 'pichla', 'pichhla'],
  remind: ['yaad', 'remind', 'reminder', 'yaaddila', 'message', 'msg'],
  summary: ['aajkahisaab', 'summary', 'aajki', 'aajka', 'dinka', 'bikri', 'total', 'report'],
  dues: ['sabse', 'zyada', 'jyada', 'kiskis', 'kaunkaun', 'list', 'saare', 'sabka'],
  balance: ['kitna', 'kitne', 'kitni', 'balance', 'hisaab', 'hisab', 'batao', 'bata'],
  payment: ['jama', 'jamaa', 'chuka', 'chukaya', 'chukaaye', 'wapas', 'vapas', 'paid', 'payment', 'bhar', 'bhara', 'bhare',
    'mila', 'mile', 'received', 'aaye', 'aaya', 'diye', 'degaye', 'degayi', 'degaya', 'degya', 'dediye', 'upi', 'phonepe', 'gpay', 'paytm'],
  credit: ['udhaar', 'udhar', 'udhari', 'likh', 'likho', 'likhdo', 'likhna', 'likhlo', 'credit', 'khate', 'khaate', 'khata',
    'legaye', 'legayi', 'legaya', 'legya', 'liya', 'liye', 'saman', 'samaan', 'baki', 'baaki', 'chadha', 'chadhao', 'jodo', 'daalo', 'dalo'],
  addCustomer: ['nayagrahak', 'naya', 'newcustomer', 'grahak'],
};
const KW_SK = Object.fromEntries(Object.entries(KW).map(([k, v]) => [k, new Set(v.map(skeleton))]));

const STOP = new Set(['ko', 'ne', 'ka', 'ki', 'ke', 'se', 'ji', 'bhai', 'bhaiya', 'bhaiyya', 'didi', 'aunty', 'uncle', 'sahab', 'saab',
  'aur', 'and', 'ab', 'abhi', 'aaj', 'kal', 'mein', 'me', 'main', 'hai', 'hain', 'tha', 'the', 'kar', 'karo', 'kardo', 'kr', 'do', 'de',
  'dena', 'diya', 'dijiye', 'please', 'plz', 'ek', 'wala', 'wali', 'wale', 'gaye', 'gayi', 'gaya', 'liye', 'liya', 'rupaye', 'rupees',
  'rs', 'ka', 'kya', 'naam', 'mera', 'humara', 'unka', 'iska', 'uska', 'total', 'sab', 'sabka', 'naya', 'grahak', 'add', 'jodo', 'customer', 'new']
  .map(skeleton));

const tokenize = (text) =>
  toRoman(text)
    .replace(/\[[^\]]*\]|speaker\s*\w+\s*:/gi, ' ')
    .replace(/[₹]/g, ' ₹ ')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[.,!?;:|।"'()\-/]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** Find a money amount. Prefers numbers next to currency words; ignores "2 kilo"-style quantities. */
export function findAmount(tokens) {
  const sk = tokens.map((t) => skeleton(t));
  const candidates = [];
  for (let i = 0; i < tokens.length; i++) {
    let value = null;
    let end = i;
    const raw = tokens[i].replace(/^₹/, '');
    if (/^\d+(\.\d+)?$/.test(raw)) {
      value = Number(raw);
      if (MULT[sk[i + 1]]) {
        value *= MULT[sk[i + 1]];
        end = i + 1;
      }
    } else if (FRACTION[sk[i]] && MULT[sk[i + 1]]) {
      value = FRACTION[sk[i]] * MULT[sk[i + 1]];
      end = i + 1;
    } else if (HALF_MORE.has(sk[i]) && (ONES[sk[i + 1]] || /^\d+$/.test(tokens[i + 1] || '')) && MULT[sk[i + 2]]) {
      const n = ONES[sk[i + 1]] ?? Number(tokens[i + 1]);
      value = (n + 0.5) * MULT[sk[i + 2]];
      end = i + 2;
    } else if (ONES[sk[i]] !== undefined && (MULT[sk[i + 1]] || isCurrency(sk[i + 1] || ''))) {
      value = ONES[sk[i]] * (MULT[sk[i + 1]] || 1);
      end = MULT[sk[i + 1]] ? i + 1 : i;
    }
    if (value === null) continue;
    // Compound tails: "do sau pachaas" = 250, "1 hazaar 200" = 1200.
    if (MULT[sk[end]] && value >= 100) {
      const tail = tokens[end + 1];
      if (tail && /^\d+$/.test(tail) && Number(tail) < MULT[sk[end]]) {
        value += Number(tail);
        end += 1;
      } else if (ONES[sk[end + 1]] !== undefined && !MULT[sk[end + 2]]) {
        value += ONES[sk[end + 1]];
        end += 1;
      }
    }
    const next = sk[end + 1] || '';
    const prev = sk[i - 1] || '';
    if (isUnit(tokens[end + 1])) {
      i = end;
      continue; // a quantity, not money
    }
    const score = (isCurrency(next) || tokens[i - 1] === '₹' || tokens[i].startsWith('₹') || prev === 'rs' ? 2 : 0) + (value >= 10 ? 1 : 0);
    candidates.push({ value, score, index: i });
    i = end;
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return candidates[0].value;
}

function findItems(tokens) {
  const items = [];
  for (let i = 0; i < tokens.length; i++) {
    const name = ITEM_SK.get(skeleton(tokens[i]));
    if (!name) continue;
    let qty = null;
    const a = tokens[i - 2];
    const b = tokens[i - 1];
    if (b && isUnit(b) && a) qty = `${/^\d/.test(a) ? a : ONES[skeleton(a)] ?? a} ${b.toLowerCase()}`;
    else if (b && /^\d+$/.test(b)) qty = b;
    items.push({ name, qty });
  }
  return items;
}

/** Match a spoken name against known customers (any script, small spelling slips allowed). */
export function matchCustomer(tokens, customers) {
  let best = null;
  for (const c of customers) {
    const keys = [c.name, ...(c.aliases || [])].map((n) => n.split(/\s+/).map(skeleton));
    for (const key of keys) {
      for (let i = 0; i <= tokens.length - key.length; i++) {
        let dist = 0;
        for (let k = 0; k < key.length; k++) {
          const t = skeleton(tokens[i + k]);
          const allow = key[k].length >= 5 ? 2 : key[k].length >= 3 ? 1 : 0;
          const d = editDistance(t, key[k]);
          dist += d > allow ? 99 : d;
        }
        // Also accept a first-name-only mention of a multi-word name.
        const first = editDistance(skeleton(tokens[i]), key[0]);
        const firstOk = key.length > 1 && key[0].length >= 3 && first <= (key[0].length >= 5 ? 1 : 0);
        const score = dist < 99 ? dist : firstOk ? first + 0.5 : 99;
        if (score < 99 && (!best || score < best.score)) best = { customer: c, score, index: i };
      }
    }
  }
  return best;
}

const SELF_INTRO = setOf(['main', 'mai', 'mein', 'hum', 'this', 'i', 'am', 'myself']);

function guessNewName(tokens, loose = false) {
  // Phone calls: "Main Vikas bol raha hoon" / "Myself Vikas".
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!SELF_INTRO.has(skeleton(tokens[i]))) continue;
    const w = tokens[i + 1];
    const ws = skeleton(w);
    if (ws.length >= 3 && !STOP.has(ws) && !SELF_INTRO.has(ws) && !/\d/.test(w) && !ITEM_SK.has(ws)
      && !Object.values(KW_SK).some((set) => set.has(ws))) return titleCase([w]);
  }
  for (let i = 1; i < tokens.length; i++) {
    const s = skeleton(tokens[i]);
    if (['ko', 'ne', 'ka', 'ki', 'ke', 'se'].includes(s)) {
      const parts = [];
      for (let j = i - 1; j >= 0 && parts.length < 2; j--) {
        const w = tokens[j];
        const ws = skeleton(w);
        if (STOP.has(ws) || /\d/.test(w) || Object.values(KW_SK).some((set) => set.has(ws)) || ITEM_SK.has(ws)) break;
        parts.unshift(w);
      }
      if (parts.length) return titleCase(parts);
    }
  }
  if (loose) {
    // "naya grahak Pooja jodo": take the first word that is not a keyword or filler.
    const name = tokens.filter((w) => {
      const ws = skeleton(w);
      return ws && !STOP.has(ws) && !/\d/.test(w) && !ITEM_SK.has(ws) && !Object.values(KW_SK).some((set) => set.has(ws));
    });
    if (name.length) return titleCase(name.slice(0, 2));
  }
  return null;
}

const titleCase = (parts) => parts.map((p) => p[0].toUpperCase() + p.slice(1).toLowerCase()).join(' ');

const has = (sks, set) => sks.some((s) => set.has(s));
const hasPhrase = (joined, set) => [...set].some((k) => k.length > 4 && joined.includes(k));

function parseOne(text, customers, carry = {}) {
  const tokens = tokenize(text);
  const sks = tokens.map(skeleton);
  const joined = sks.join('');
  const amount = findAmount(tokens);
  const match = matchCustomer(tokens, customers);
  const wantsNew = has(sks, KW_SK.addCustomer);
  const customer = match?.customer.name || guessNewName(tokens, wantsNew) || carry.customer || null;
  const isNew = !match && Boolean(customer) && customer !== carry.customer;
  const items = findItems(tokens);
  const neBeforeGive = /\bne\b.*\b(diye|diya|de gaye|de gayi|de diye|bhare|chukaye)\b/i.test(toRoman(text));

  const base = { customer, isNewCustomer: isNew, amount, items };
  if (has(sks, KW_SK.undo)) return { intent: 'undo' };
  if (has(sks, KW_SK.remind) && customer) return { intent: 'remind', customer };
  if (has(sks, KW_SK.addCustomer) && customer && !amount) return { intent: 'add_customer', customer, isNewCustomer: !match };
  if (amount) {
    if (has(sks, KW_SK.payment) || neBeforeGive) return { intent: 'payment', ...base };
    if (has(sks, KW_SK.credit) || items.length || customer) return { intent: 'credit', ...base };
  }
  if (!amount && customer && has(sks, KW_SK.balance) && !isNew) return { intent: 'balance', customer };
  if (hasPhrase(joined, KW_SK.summary) || (has(sks, KW_SK.summary) && !customer)) return { intent: 'summary' };
  if (has(sks, KW_SK.dues) || (has(sks, KW_SK.balance) && !customer)) return { intent: 'dues' };
  if (customer && !isNew && !amount) return { intent: 'balance', customer };
  return { intent: 'unknown' };
}

/** Parse a transcript into one or more ledger actions. */
export function parseCommand(text, customers) {
  // Split on "aur"/"and" and on commas that are not thousands separators (1,200).
  const parts = toRoman(text).split(/\s+(?:aur|and|phir|fir)\s+|(?<!\d),\s*|,(?!\d)\s*|;\s*/i).filter((p) => p && p.trim());
  const actions = [];
  let carry = {};
  if (parts.length > 1) {
    for (const p of parts) {
      const a = parseOne(p, customers, carry);
      if (a.customer) carry = { customer: a.customer };
      actions.push(a);
    }
    const real = actions.filter((a) => a.intent !== 'unknown');
    // Only trust a split when it produced more than one real action.
    if (real.filter((a) => a.amount).length > 1) return real;
  }
  return [parseOne(text, customers)];
}
