// Local credit guard. Gnani's dashboard (app.gnani.ai/voice) is the source of truth for
// credits; this meter tracks what the app itself spends and refuses calls past set limits.
import { db } from '../db.js';
import { config } from '../config.js';

const totals = () => {
  const rows = db.prepare(`SELECT unit_type, SUM(units) AS total, COUNT(*) AS calls
                           FROM usage WHERE ok=1 GROUP BY unit_type`).all();
  const t = { stt_seconds: 0, tts_chars: 0, voice_clones: 0, calls: 0 };
  for (const r of rows) {
    t[r.unit_type] = Number(r.total.toFixed(2));
    t.calls += r.calls;
  }
  return t;
};

export class BudgetError extends Error {
  constructor(msg) {
    super(msg);
    this.code = 'BUDGET';
  }
}

export const usage = {
  totals,
  record({ service, api, model, units, unitType, ok = true, note = null }) {
    db.prepare('INSERT INTO usage (service,api,model,units,unit_type,ok,note) VALUES (?,?,?,?,?,?,?)')
      .run(service, api, model ?? null, units, unitType, ok ? 1 : 0, note);
  },
  ensure(unitType, upcoming = 0) {
    const t = totals();
    const limits = {
      stt_seconds: config.budget.sttSeconds,
      tts_chars: config.budget.ttsChars,
      voice_clones: config.budget.voiceClones,
    };
    if (t[unitType] + upcoming > limits[unitType]) {
      throw new BudgetError(`Local budget for ${unitType} reached (${t[unitType]} / ${limits[unitType]}). Raise it in .env if you have credits left.`);
    }
  },
  summary() {
    const t = totals();
    return {
      totals: t,
      limits: {
        stt_seconds: config.budget.sttSeconds,
        tts_chars: config.budget.ttsChars,
        voice_clones: config.budget.voiceClones,
      },
      byApi: db.prepare(`SELECT service, api, model, unit_type, ROUND(SUM(units),2) AS units, COUNT(*) AS calls
                         FROM usage WHERE ok=1 GROUP BY service, api, model, unit_type ORDER BY service, api`).all(),
      recent: db.prepare('SELECT * FROM usage ORDER BY id DESC LIMIT 15').all(),
    };
  },
};
