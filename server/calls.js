// Phone-order recordings: Prisma Batch (denoise + diarization) -> Evon -> actions the shopkeeper approves.
import { Calls, Customers } from './db.js';
import { transcribeBatch } from './gnani/stt.js';
import { interpret, shopLanguage } from './brain/khata.js';
import { ITEM_KEYTERMS } from './keyterms.js';

export function processCall(buffer, { filename, mime }) {
  const id = Calls.create(filename);
  (async () => {
    try {
      const names = Customers.all().map((c) => c.name);
      const res = await transcribeBatch(buffer, {
        filename,
        mime,
        languages: shopLanguage().stt,
        keyterms: [...names, ...ITEM_KEYTERMS],
        topic: 'Phone call between a kirana shop owner and a customer about groceries bought on credit (udhaar) and payments.',
        onStatus: ({ jobId, status }) => Calls.update(id, { job_id: jobId, status }),
      });
      const dialog = res.segments.length
        ? res.segments.map((s) => `Speaker ${s.speaker}: ${s.text}`).join('\n')
        : res.transcript;
      const it = await interpret(`[Phone call transcript]\n${dialog}`);
      const actions = it.actions.filter((a) => ['credit', 'payment', 'add_customer'].includes(a.intent));
      Calls.update(id, { status: 'READY', transcript: res.transcript, segments: res.segments, actions: { engine: it.engine, list: actions } });
    } catch (e) {
      Calls.update(id, { status: 'FAILED', error: e.message });
    }
  })();
  return id;
}
