// Part 6: create the multi-tenant database (db/tenants.db) with two
// companies, their sales data, and test users.
// Run with: npm run tenant:seed
//
// Tenants (a user's email domain decides which one they belong to):
//   larkspur.test    Larkspur Labs: soil sensors for vineyards (as in Parts 2 and 4)
//   copperleaf.test  Copperleaf Coffee Works: espresso machines for cafés
//
// Users, all with the password "password123":
//   anna@larkspur.test, ben@larkspur.test        → Larkspur Labs
//   carla@copperleaf.test, david@copperleaf.test → Copperleaf Coffee Works
//   eve@unknown.test   can sign in, but belongs to no tenant, so the MCP server refuses her

import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { config } from '../config.ts';
import { createAuth } from './auth.ts';

import { TEST_PASSWORD } from './test-users.ts';

type Tenant = {
  id: string;
  name: string;
  domain: string;
  users: [email: string, name: string][];
  customers: [name: string, country: string, region: string][];
  /** [sku, name, list price, quantity range per order] */
  products: [sku: string, name: string, price: number, min: number, max: number][];
};

const TENANTS: Tenant[] = [
  {
    id: 'larkspur',
    name: 'Larkspur Labs',
    domain: 'larkspur.test',
    users: [['anna@larkspur.test', 'Anna Ferreira'], ['ben@larkspur.test', 'Ben Okafor']],
    customers: [
      ['Quinta do Vale Alto', 'Portugal', 'Douro'],
      ['Herdade das Oliveiras', 'Portugal', 'Alentejo'],
      ['Bodegas Sierra Roja', 'Spain', 'Rioja'],
      ['Celler Mas Blau', 'Spain', 'Priorat'],
      ['Château Lescure', 'France', 'Bordeaux'],
      ['Tenuta Colle Verde', 'Italy', 'Tuscany'],
      ['Weingut Steinberg', 'Germany', 'Mosel'],
    ],
    products: [
      ['RL-SENSOR', 'Rootline Sensor', 189, 10, 60],
      ['RL-GATEWAY', 'Rootline Gateway', 449, 1, 2],
      ['RL-CLOUD-YEAR', 'Cloud dashboard, 1 sensor for 1 year', 48, 10, 60],
    ],
  },
  {
    id: 'copperleaf',
    name: 'Copperleaf Coffee Works',
    domain: 'copperleaf.test',
    users: [['carla@copperleaf.test', 'Carla Jansen'], ['david@copperleaf.test', 'David Moreau']],
    customers: [
      ['Café de Kroon', 'Netherlands', 'Amsterdam'],
      ['Koffiebar Noord', 'Netherlands', 'Utrecht'],
      ['Maison Grain', 'Belgium', 'Brussels'],
      ['Kaffeehaus Lindner', 'Austria', 'Vienna'],
      ['Bryggeriet Kaffe', 'Denmark', 'Copenhagen'],
      ['Rösterei am Markt', 'Germany', 'Hamburg'],
    ],
    products: [
      ['CL-ESPRESSO-2G', 'Copperleaf Duo espresso machine', 6900, 1, 2],
      ['CL-GRINDER', 'Copperleaf burr grinder', 1250, 1, 3],
      ['CL-SERVICE-YEAR', 'Service plan, 1 machine for 1 year', 540, 1, 2],
    ],
  },
];

// Signs in, but no tenant has this email domain.
const USER_WITHOUT_TENANT: [string, string] = ['eve@unknown.test', 'Eve Unknown'];

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

const isoDate = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

// --- Start from an empty database ---------------------------------------

if (existsSync(config.tenantDbPath)) rmSync(config.tenantDbPath);
mkdirSync(path.dirname(config.tenantDbPath), { recursive: true });

// 1. better-auth's own tables: user, account (with the password hash),
//    session, verification and jwks (the token signing keys).
const auth = createAuth({ seeding: true });
await (await getMigrations(auth.options)).runMigrations();

// 2. Tenants and their sales data.
const db = new DatabaseSync(config.tenantDbPath);
db.exec(readFileSync(config.tenantSchemaPath, 'utf8'));

const random = createRandom(7);
const insertTenant = db.prepare('INSERT INTO tenants (id, name, email_domain) VALUES (?, ?, ?)');
const insertCustomer = db.prepare(
  'INSERT INTO customers (tenant_id, name, country, region, signed_up) VALUES (?, ?, ?, ?, ?) RETURNING id',
);
const insertProduct = db.prepare(
  'INSERT INTO products (tenant_id, sku, name, unit_price_eur) VALUES (?, ?, ?, ?) RETURNING id',
);
const insertOrder = db.prepare(
  'INSERT INTO orders (tenant_id, customer_id, order_date, status) VALUES (?, ?, ?, ?) RETURNING id',
);
const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, unit_price_eur) VALUES (?, ?, ?, ?)');

db.exec('BEGIN');
for (const tenant of TENANTS) {
  insertTenant.run(tenant.id, tenant.name, tenant.domain);
  const productIds = tenant.products.map(
    ([sku, name, price]) => (insertProduct.get(tenant.id, sku, name, price) as { id: number }).id,
  );

  for (const [name, country, region] of tenant.customers) {
    const signedUp = isoDate(2024, random.int(1, 12), random.int(1, 28));
    const { id: customerId } = insertCustomer.get(tenant.id, name, country, region, signedUp) as { id: number };

    // First order: every product. Later orders: one or two products.
    const orderCount = random.int(2, 4);
    for (let n = 0; n < orderCount; n++) {
      const year = n === 0 ? 2025 : random.pick([2025, 2026]);
      const month = year === 2026 ? random.int(1, 10) : random.int(1, 12);
      const recent = year === 2026 && month >= 9;
      const status = recent
        ? random.pick(['paid', 'pending', 'pending', 'overdue'])
        : random.chance(0.06) ? 'refunded' : random.chance(0.1) ? 'overdue' : 'paid';
      const date = isoDate(year, month, random.int(1, 28));
      const { id: orderId } = insertOrder.get(tenant.id, customerId, date, status) as { id: number };

      const lines = n === 0 ? tenant.products.map((_, i) => i) : [random.int(0, tenant.products.length - 1)];
      for (const i of lines) {
        const [, , price, min, max] = tenant.products[i]!;
        insertItem.run(orderId, productIds[i]!, random.int(min, max), price);
      }
    }
  }
}
db.exec('COMMIT');

// 3. Users. Signing up through better-auth hashes the password the same way
//    signing in checks it. (Sign-up is switched off in the auth server.)
for (const [email, name] of [...TENANTS.flatMap((t) => t.users), USER_WITHOUT_TENANT]) {
  await auth.api.signUpEmail({ body: { email, name, password: TEST_PASSWORD } });
}

const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
console.log(`Created ${config.tenantDbPath}`);
for (const tenant of TENANTS) {
  const n = (table: string) => count(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = '${tenant.id}'`);
  console.log(`  ${tenant.name} (@${tenant.domain}): ${n('customers')} customers, ${n('orders')} orders`);
}
console.log(`  ${count('SELECT COUNT(*) AS n FROM user')} users, all with the password "${TEST_PASSWORD}"`);
db.close();
