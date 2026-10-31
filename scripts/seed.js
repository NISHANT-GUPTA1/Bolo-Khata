// Loads synthetic demo data (no real people, phone numbers or IDs). Run: npm run seed
import { db, Customers, Entries, Settings } from '../server/db.js';

const reset = process.argv.includes('--reset') || process.argv.includes('-r');
if (reset) db.exec('DELETE FROM entries; DELETE FROM customers; DELETE FROM calls;');
if (Customers.all().length && !reset) {
  console.log('Data already present. Use "npm run seed -- --reset" to start over.');
  process.exit(0);
}

Settings.set('shop_name', 'Sharma Kirana Store');
Settings.set('owner_name', 'Sharma ji');
Settings.set('upi_id', 'sharmakirana@upi');

const people = [
  { name: 'Ramesh Kumar', aliases: ['Ramesh', 'रमेश', 'Ramesh bhaiya'], language: 'hi-IN' },
  { name: 'Sunita Devi', aliases: ['Sunita', 'सुनीता', 'Sunita didi'], language: 'hi-IN' },
  { name: 'Abdul Rahman', aliases: ['Abdul', 'अब्दुल'], language: 'hi-IN' },
  { name: 'Lakshmi Akka', aliases: ['Lakshmi', 'ಲಕ್ಷ್ಮಿ', 'लक्ष्मी'], language: 'kn-IN' },
  { name: 'Murugan Anna', aliases: ['Murugan', 'முருகன்', 'मुरुगन'], language: 'ta-IN' },
  { name: 'Subhash Dada', aliases: ['Subhash', 'সুভাষ', 'सुभाष'], language: 'bn-IN' },
  { name: 'Pooja Patil', aliases: ['Pooja', 'पूजा'], language: 'mr-IN' },
];
const ids = Object.fromEntries(people.map((p) => [p.name, Customers.create(p).id]));

const history = [
  // [customer, type, amount, items, daysAgo]
  ['Ramesh Kumar', 'credit', 640, [{ name: 'atta', qty: '10 kilo' }, { name: 'cheeni', qty: '2 kilo' }], 9],
  ['Ramesh Kumar', 'payment', 300, [], 6],
  ['Ramesh Kumar', 'credit', 410, [{ name: 'tel', qty: '1 litre' }, { name: 'daal', qty: '2 kilo' }], 2],
  ['Sunita Devi', 'credit', 1250, [{ name: 'chawal', qty: '10 kilo' }, { name: 'ghee', qty: '1 kilo' }], 12],
  ['Sunita Devi', 'payment', 500, [], 4],
  ['Abdul Rahman', 'credit', 220, [{ name: 'doodh', qty: '4 packet' }, { name: 'bread', qty: null }], 1],
  ['Lakshmi Akka', 'credit', 1850, [{ name: 'rava', qty: '5 kilo' }, { name: 'tel', qty: '5 litre' }], 15],
  ['Lakshmi Akka', 'payment', 600, [], 8],
  ['Murugan Anna', 'credit', 930, [{ name: 'chawal', qty: '25 kilo' }], 7],
  ['Subhash Dada', 'credit', 480, [{ name: 'sarson tel', qty: '1 litre' }, { name: 'aloo', qty: '5 kilo' }], 3],
  ['Subhash Dada', 'payment', 480, [], 1],
  ['Pooja Patil', 'credit', 350, [{ name: 'poha', qty: '2 kilo' }, { name: 'chai patti', qty: null }], 5],
];
const backdate = db.prepare("UPDATE entries SET created_at = datetime('now','localtime', ?) WHERE id = ?");
for (const [name, type, amount, items, days] of history) {
  const e = Entries.add({ customerId: ids[name], type, amount, items, source: 'seed', engine: 'manual' });
  backdate.run(`-${days} days`, e.id);
}
console.log(`Seeded ${people.length} synthetic customers and ${history.length} entries.`);
