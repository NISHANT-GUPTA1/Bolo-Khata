import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(path.join(config.dataDir, 'khata.db'));

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  phone TEXT,
  language TEXT NOT NULL DEFAULT 'hi-IN',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  type TEXT NOT NULL CHECK (type IN ('credit','payment')),
  amount REAL NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  transcript TEXT,
  engine TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  service TEXT NOT NULL,
  api TEXT NOT NULL,
  model TEXT,
  units REAL NOT NULL,
  unit_type TEXT NOT NULL,
  ok INTEGER NOT NULL DEFAULT 1,
  note TEXT
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT,
  filename TEXT,
  status TEXT NOT NULL,
  transcript TEXT,
  segments TEXT,
  actions TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`);

const parseCustomer = (c) => c && { ...c, aliases: JSON.parse(c.aliases || '[]') };

export const Customers = {
  all() {
    return db.prepare(`
      SELECT c.*, COALESCE(SUM(CASE WHEN e.undone=0 AND e.type='credit' THEN e.amount
                                    WHEN e.undone=0 AND e.type='payment' THEN -e.amount END),0) AS balance,
             MAX(CASE WHEN e.undone=0 THEN e.created_at END) AS last_activity
      FROM customers c LEFT JOIN entries e ON e.customer_id=c.id
      GROUP BY c.id ORDER BY balance DESC, c.name`).all().map(parseCustomer);
  },
  get(id) {
    return parseCustomer(db.prepare('SELECT * FROM customers WHERE id=?').get(id));
  },
  create({ name, aliases = [], phone = null, language = 'hi-IN' }) {
    const r = db.prepare('INSERT INTO customers (name, aliases, phone, language) VALUES (?,?,?,?)')
      .run(name, JSON.stringify(aliases), phone, language);
    return this.get(Number(r.lastInsertRowid));
  },
  update(id, fields) {
    const c = this.get(id);
    if (!c) return null;
    const next = { ...c, ...fields };
    db.prepare('UPDATE customers SET name=?, aliases=?, phone=?, language=? WHERE id=?')
      .run(next.name, JSON.stringify(next.aliases || []), next.phone, next.language, id);
    return this.get(id);
  },
  balance(id) {
    return db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='credit' THEN amount ELSE -amount END),0) AS b
                       FROM entries WHERE customer_id=? AND undone=0`).get(id).b;
  },
};

export const Entries = {
  add({ customerId, type, amount, items = [], source = 'manual', transcript = null, engine = null }) {
    const r = db.prepare(`INSERT INTO entries (customer_id,type,amount,items,source,transcript,engine)
                          VALUES (?,?,?,?,?,?,?)`)
      .run(customerId, type, amount, JSON.stringify(items), source, transcript, engine);
    return this.get(Number(r.lastInsertRowid));
  },
  get(id) {
    const e = db.prepare(`SELECT e.*, c.name AS customer_name FROM entries e
                          JOIN customers c ON c.id=e.customer_id WHERE e.id=?`).get(id);
    return e && { ...e, items: JSON.parse(e.items) };
  },
  forCustomer(customerId) {
    return db.prepare('SELECT * FROM entries WHERE customer_id=? ORDER BY id DESC').all(customerId)
      .map((e) => ({ ...e, items: JSON.parse(e.items) }));
  },
  recent(limit = 30) {
    return db.prepare(`SELECT e.*, c.name AS customer_name FROM entries e
                       JOIN customers c ON c.id=e.customer_id ORDER BY e.id DESC LIMIT ?`).all(limit)
      .map((e) => ({ ...e, items: JSON.parse(e.items) }));
  },
  lastActive() {
    return db.prepare('SELECT id FROM entries WHERE undone=0 ORDER BY id DESC LIMIT 1').get();
  },
  setUndone(id, undone = 1) {
    db.prepare('UPDATE entries SET undone=? WHERE id=?').run(undone, id);
    return this.get(id);
  },
  today() {
    return db.prepare(`SELECT e.*, c.name AS customer_name FROM entries e JOIN customers c ON c.id=e.customer_id
                       WHERE e.undone=0 AND date(e.created_at)=date('now','localtime') ORDER BY e.id`).all()
      .map((e) => ({ ...e, items: JSON.parse(e.items) }));
  },
};

export const Settings = {
  get(key, fallback = null) {
    const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return r ? JSON.parse(r.value) : fallback;
  },
  set(key, value) {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  },
  shop() {
    return {
      shopName: this.get('shop_name', 'Sharma Kirana Store'),
      ownerName: this.get('owner_name', 'Sharma ji'),
      upiId: this.get('upi_id', 'sharmakirana@upi'),
      hasVoiceClone: Boolean(this.get('voice_embedding')),
    };
  },
};

export const Calls = {
  create(filename) {
    const r = db.prepare("INSERT INTO calls (filename,status) VALUES (?, 'UPLOADING')").run(filename);
    return Number(r.lastInsertRowid);
  },
  update(id, fields) {
    const keys = Object.keys(fields);
    db.prepare(`UPDATE calls SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`)
      .run(...keys.map((k) => (typeof fields[k] === 'object' && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k])), id);
  },
  all() {
    return db.prepare('SELECT * FROM calls ORDER BY id DESC LIMIT 20').all().map((c) => ({
      ...c,
      segments: c.segments ? JSON.parse(c.segments) : [],
      actions: c.actions ? JSON.parse(c.actions) : [],
    }));
  },
};
