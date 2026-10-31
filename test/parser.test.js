import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../server/brain/parser.js';

const customers = [
  { name: 'Ramesh Kumar', aliases: ['रमेश'] },
  { name: 'Sunita Devi', aliases: [] },
  { name: 'Abdul Rahman', aliases: ['Abdul'] },
  { name: 'Lakshmi Akka', aliases: ['Lakshmi'] },
];
const one = (t) => parseCommand(t, customers)[0];

const cases = [
  ['Ramesh bhaiya ko 250 ka atta udhaar likh do', { intent: 'credit', customer: 'Ramesh Kumar', amount: 250 }],
  ['रमेश को ढाई सौ का आटा उधार लिख दो', { intent: 'credit', customer: 'Ramesh Kumar', amount: 250 }],
  ['सुनीता ने 500 रुपये जमा किए', { intent: 'payment', customer: 'Sunita Devi', amount: 500 }],
  ['Sunita ne 500 de diye', { intent: 'payment', customer: 'Sunita Devi', amount: 500 }],
  ['Abdul ko do kilo chawal 120 rupaye udhaar', { intent: 'credit', customer: 'Abdul Rahman', amount: 120 }],
  ['Raamesh ne UPI se 1,200 bhare', { intent: 'payment', customer: 'Ramesh Kumar', amount: 1200 }],
  ['Suresh ko dedh hazaar ka saman likho', { intent: 'credit', customer: 'Suresh', amount: 1500 }],
  ['रमेश जी को साढ़े तीन सौ का सामान लिखो', { intent: 'credit', customer: 'Ramesh Kumar', amount: 350 }],
  ['Ramesh ka kitna baaki hai', { intent: 'balance', customer: 'Ramesh Kumar' }],
  ['aaj ka hisaab batao', { intent: 'summary' }],
  ['sabse zyada udhaar kiska hai', { intent: 'dues' }],
  ['galat ho gaya cancel karo', { intent: 'undo' }],
  ['Lakshmi ko yaad dila do', { intent: 'remind', customer: 'Lakshmi Akka' }],
  ['naya grahak Pooja jodo', { intent: 'add_customer', customer: 'Pooja' }],
];

for (const [text, expected] of cases) {
  test(text, () => {
    const got = one(text);
    for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${k} for "${text}"`);
  });
}

test('two actions in one sentence', () => {
  const a = parseCommand('Ramesh ko 200 udhaar aur Sunita ne 300 jama kiye', customers);
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((x) => [x.intent, x.customer, x.amount]), [['credit', 'Ramesh Kumar', 200], ['payment', 'Sunita Devi', 300]]);
});

test('quantities are not mistaken for money', () => {
  assert.equal(one('Abdul ko 5 kilo atta, 200 rupaye').amount, 200);
});

test('phone call: "aaya hoon" and "de doonga" do not turn udhaar into a payment', () => {
  const a = one('मैं विकास बोल रहा हूँ, नए फ्लैट में आया हूँ, दस किलो chawal, सात सौ अस्सी रुपये होंगे, अभी udhaar में रख लीजिए, शाम को आकर दे दूँगा');
  assert.equal(a.intent, 'credit');
  assert.equal(a.amount, 780);
});
