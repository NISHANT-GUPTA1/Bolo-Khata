// Devanagari -> rough Roman, plus a "skeleton" form so रमेश, Ramesh and Rames all compare equal.

const V = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऑ': 'o' };
const M = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' };
const C = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l', 'क़': 'q', 'ख़': 'kh', 'ग़': 'g', 'ज़': 'z', 'ड़': 'r', 'ढ़': 'rh', 'फ़': 'f',
};
const NUKTA = '़';
const VIRAMA = '्';
const DIGITS = { '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9' };

export function devanagariToRoman(text) {
  const chars = [...text.normalize('NFC')];
  let out = '';
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (chars[i + 1] === NUKTA && C[ch + NUKTA]) {
      ch += NUKTA;
      i++;
    }
    if (DIGITS[ch]) out += DIGITS[ch];
    else if (V[ch]) out += V[ch];
    else if (C[ch]) {
      out += C[ch];
      const next = chars[i + 1];
      if (M[next]) {
        out += M[next];
        i++;
      } else if (next === VIRAMA) i++;
      else out += 'a'; // inherent vowel; trimmed at word end below
    } else if (ch === 'ं' || ch === 'ँ') out += 'n';
    else if (ch === 'ः') out += 'h';
    else if (ch === '।' || ch === '॥') out += '.';
    else out += ch;
  }
  // Schwa deletion at the end of a word (रमेश -> ramesha -> ramesh).
  return out.replace(/([bcdfghjklmnpqrstvwxyz])a\b/g, '$1');
}

const hasDevanagari = (s) => /[ऀ-ॿ]/.test(s);

export const toRoman = (s) => (hasDevanagari(s) ? devanagariToRoman(s) : s);

/** Spelling-insensitive key: "Raamesh", "Ramesh", "रमेश" all become "ramesh"-ish skeletons. */
export function skeleton(word) {
  return toRoman(word)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/aa+/g, 'a')
    .replace(/ee+|ii+|y(?=$)/g, 'i')
    .replace(/oo+|uu+/g, 'u')
    .replace(/w/g, 'v')
    .replace(/z/g, 'j')
    .replace(/ph/g, 'f')
    .replace(/sh/g, 's')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/h(?=[^aeiou]|$)/g, '');
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
