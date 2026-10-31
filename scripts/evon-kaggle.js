// npm run evon
// Starts Gnani Evon v3.3 on a free Kaggle GPU (T4 x2) and wires its URL into .env.
// Nothing ML-related runs on this machine: the notebook runs on Kaggle and reports back through a
// private, randomly named ntfy.sh channel. Needs the Kaggle CLI logged in (python -m kaggle).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../server/config.js';

const kaggle = (...args) => execFileSync('python', ['-m', 'kaggle', ...args], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });

const whoami = () => {
  const creds = path.join(os.homedir(), '.kaggle', 'kaggle.json');
  if (process.env.KAGGLE_USERNAME) return process.env.KAGGLE_USERNAME;
  if (fs.existsSync(creds)) return JSON.parse(fs.readFileSync(creds, 'utf8')).username;
  // Newer CLI logins: take the owner from the user's own kernel list.
  const line = kaggle('kernels', 'list', '--mine', '--page-size', '1').split('\n').find((l) => l.includes('/'));
  if (!line) throw new Error('Could not detect your Kaggle username. Set KAGGLE_USERNAME and retry.');
  return line.trim().split('/')[0];
};

const user = whoami();
const topic = `bolokhata-${crypto.randomBytes(10).toString('hex')}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bolo-evon-'));
const nb = fs.readFileSync(path.join(ROOT, 'evon', 'kaggle_evon_auto.ipynb'), 'utf8').replaceAll('__NTFY_TOPIC__', topic);
fs.writeFileSync(path.join(dir, 'bolo-khata-evon.ipynb'), nb);
fs.writeFileSync(path.join(dir, 'kernel-metadata.json'), JSON.stringify({
  id: `${user}/bolo-khata-evon`, title: 'bolo-khata-evon', code_file: 'bolo-khata-evon.ipynb', language: 'python',
  kernel_type: 'notebook', is_private: true, enable_gpu: true, enable_internet: true, machine_shape: 'NvidiaTeslaT4',
  dataset_sources: [], competition_sources: [], kernel_sources: [], model_sources: [],
}, null, 2));

console.log(`Pushing notebook to Kaggle as ${user}/bolo-khata-evon (GPU T4 x2)…`);
console.log(kaggle('kernels', 'push', '-p', dir).trim());
console.log('Waiting for Evon to download (~5 min) and load onto the GPUs (~4 min)…');

const seen = new Set();
const deadline = Date.now() + 30 * 60 * 1000;
let url = null;
while (!url && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 20000));
  const res = await fetch(`https://ntfy.sh/${topic}/json?poll=1&since=all`).catch(() => null);
  if (!res?.ok) continue;
  for (const line of (await res.text()).split('\n').filter(Boolean)) {
    const m = JSON.parse(line);
    if (!m.message || seen.has(m.id)) continue;
    seen.add(m.id);
    const msg = m.message.split('\n')[0].slice(0, 160);
    console.log(`  · ${msg}`);
    if (/warm-failed/.test(msg)) throw new Error('Evon failed to load on Kaggle. Check the notebook log on kaggle.com.');
    const hit = m.message.match(/^URL (https:\/\/\S+) MODEL (\S+)/);
    if (hit && hit[1] !== 'None/v1') url = { base: hit[1], model: hit[2] };
  }
}
if (!url) throw new Error('Timed out waiting for Evon. Check https://www.kaggle.com/code/' + user + '/bolo-khata-evon');

const envPath = path.join(ROOT, '.env');
let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8').replace(/^﻿/, '') : '';
const set = (k, v) => {
  env = new RegExp(`^${k}=.*$`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`;
};
set('EVON_BASE_URL', url.base);
set('EVON_MODEL', url.model);
fs.writeFileSync(envPath, env);
console.log(`\n✔ Evon is live: ${url.base}\n  .env updated. Restart the app (npm start) to use it. The Kaggle session lasts up to 12 hours.`);
