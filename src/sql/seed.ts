// Create the sample SQLite database (db/larkspur.db) and fill it with
// made-up but consistent sales data. Prices match the product FAQ in data/.
// Run with: npm run db:seed

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.ts';

// A tiny seeded random number generator, so every run produces the same data.
function createRandom(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
  return {
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    chance: (p: number) => next() < p,
  };
}

const customers = [
  ['Quinta do Vale Alto', 'Portugal', 'Douro'],
  ['Herdade das Oliveiras', 'Portugal', 'Alentejo'],
  ['Quinta da Ribeira', 'Portugal', 'Douro'],
  ['Bodegas Sierra Roja', 'Spain', 'Rioja'],
  ['Viñedos del Duero', 'Spain', 'Ribera del Duero'],
  ['Celler Mas Blau', 'Spain', 'Priorat'],
  ['Château Lescure', 'France', 'Bordeaux'],
  ['Domaine des Collines', 'France', 'Burgundy'],
  ['Tenuta Colle Verde', 'Italy', 'Tuscany'],
  ['Cantina Monte Aperto', 'Italy', 'Piedmont'],
  ['Weingut Steinberg', 'Germany', 'Mosel'],
  ['Weingut Rheinblick', 'Germany', 'Rheingau'],
] as const;

const products = [
  ['RL-SENSOR', 'Rootline Sensor', 189],
  ['RL-GATEWAY', 'Rootline Gateway', 449],
  ['RL-CLOUD-YEAR', 'Cloud dashboard, 1 sensor for 1 year', 48],
  ['RL-AUGER', 'Installation auger', 35],
] as const;

if (existsSync(config.sqlDbPath)) rmSync(config.sqlDbPath);
const db = new DatabaseSync(config.sqlDbPath);
db.exec(readFileSync(config.sqlSchemaPath, 'utf8'));

const random = createRandom(42);
const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

db.exec('BEGIN');

const insertCustomer = db.prepare('INSERT INTO customers (id, name, country, region, signed_up) VALUES (?, ?, ?, ?, ?)');
customers.forEach(([name, country, region], i) => {
  insertCustomer.run(i + 1, name, country, region, isoDate(2024, random.int(1, 12), random.int(1, 28)));
});

const insertProduct = db.prepare('INSERT INTO products (id, sku, name, unit_price_eur) VALUES (?, ?, ?, ?)');
products.forEach(([sku, name, price], i) => insertProduct.run(i + 1, sku, name, price));

const insertOrder = db.prepare('INSERT INTO orders (id, customer_id, order_date, status) VALUES (?, ?, ?, ?)');
const insertItem = db.prepare(
  'INSERT INTO order_items (order_id, product_id, quantity, unit_price_eur) VALUES (?, ?, ?, ?)',
);

let orderId = 0;
for (let customerId = 1; customerId <= customers.length; customerId++) {
  // First order: a gateway, sensors, augers and a year of cloud dashboard.
  // Later orders: more sensors and dashboard renewals.
  const orderCount = random.int(2, 5);
  for (let n = 0; n < orderCount; n++) {
    orderId++;
    const year = n === 0 ? 2025 : random.pick([2025, 2026]);
    const month = year === 2026 ? random.int(1, 10) : random.int(1, 12);
    const recent = year === 2026 && month >= 9;
    const status = recent
      ? random.pick(['paid', 'pending', 'pending', 'overdue'])
      : random.chance(0.06) ? 'refunded' : random.chance(0.08) ? 'overdue' : 'paid';
    insertOrder.run(orderId, customerId, isoDate(year, month, random.int(1, 28)), status);

    const sensors = random.int(10, 60);
    const discount = sensors >= 50 ? 0.9 : 1; // 10% volume discount on sensors
    insertItem.run(orderId, 1, sensors, 189 * discount);
    insertItem.run(orderId, 3, sensors, 48);
    if (n === 0) {
      insertItem.run(orderId, 2, random.int(1, 2), 449);
      insertItem.run(orderId, 4, random.int(1, 3), 35);
    }
  }
}

db.exec('COMMIT');

const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
console.log(
  `Created ${config.sqlDbPath}: ${count('customers')} customers, ${count('products')} products, ` +
    `${count('orders')} orders, ${count('order_items')} order items`,
);
db.close();
