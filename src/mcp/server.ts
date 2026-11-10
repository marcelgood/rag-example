// Part 4: an MCP server for the Larkspur sales database.
//
// Instead of one tool that runs any SQL the model writes (Part 2), this
// server offers a few purpose-built tools. The model only picks a tool and
// fills in typed parameters; the SQL is written here, by us, and only
// values are passed in as parameters. Nothing the model sends ever becomes
// part of a SQL statement.
//
// It speaks MCP over stdio: the client starts this file as a child process
// and exchanges JSON-RPC messages over its stdin and stdout. So stdout
// belongs to the protocol. Never use console.log here; use console.error.
//
// Any MCP client can use it, not only this project's agent. See the README
// for adding it to Claude Code or Claude Desktop.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import { config } from '../config.ts';

// Resolve the database from this file's location, not the working folder,
// so the server also works when another program (e.g. Claude Desktop) starts it.
const DB_PATH = path.resolve(import.meta.dirname, '../..', config.sqlDbPath);

let db: DatabaseSync | undefined;
function query(sql: string, params: SQLInputValue[] = []): Record<string, SQLInputValue>[] {
  if (!db) {
    if (!existsSync(DB_PATH)) throw new Error(`Database not found at ${DB_PATH}. Run: npx agent seed`);
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return db.prepare(sql).all(...params);
}

/** Tool results go back to the model as JSON text. */
const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });

// Product names the model can use, mapped to the SKUs in the database.
const PRODUCTS = { sensor: 'RL-SENSOR', gateway: 'RL-GATEWAY', cloud: 'RL-CLOUD-YEAR', auger: 'RL-AUGER' } as const;
const product = z
  .enum(['sensor', 'gateway', 'cloud', 'auger'])
  .describe('sensor = Rootline soil sensor, gateway = Rootline Gateway, cloud = cloud dashboard subscription, auger = installation auger');
const status = z
  .enum(['paid', 'pending', 'overdue', 'refunded'])
  .describe("paid; pending = invoice sent, not yet due; overdue = invoice past due, unpaid; refunded");
const year = z.number().int().min(2020).max(2100).describe('Only orders placed in this year');

// The amount of an order line. An order's total is the sum over its lines.
const LINE_AMOUNT = 'oi.quantity * oi.unit_price_eur';

type Filters = {
  status?: string;
  year?: number;
  product?: keyof typeof PRODUCTS;
  country?: string;
  customer?: string;
};

/** Build a WHERE clause from the filters the model chose. Values only ever go in as `?` parameters. */
function buildWhere(filters: Filters): { where: string; params: SQLInputValue[] } {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  const add = (condition: string, value: SQLInputValue) => {
    conditions.push(condition);
    params.push(value);
  };
  if (filters.status) add('o.status = ?', filters.status);
  if (filters.year) add('substr(o.order_date, 1, 4) = ?', String(filters.year));
  if (filters.product) add('p.sku = ?', PRODUCTS[filters.product]);
  if (filters.country) add('c.country = ? COLLATE NOCASE', filters.country);
  if (filters.customer) add("c.name LIKE '%' || ? || '%'", filters.customer);
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const server = new McpServer(
  { name: 'larkspur-sales', version: '1.0.0' },
  {
    // Sent to the client when it connects; a good client puts it in the system prompt.
    instructions:
      'Sales data of Larkspur Labs, which sells soil sensors to vineyards. All amounts are in euros, ' +
      "excluding VAT. Revenue means orders with status 'paid'. Money owed means status 'overdue'. " +
      'These tools only read data; nothing can be changed through them.',
  },
);

// --- sales_summary: totals, optionally grouped ---------------------------

// Each grouping maps to a fixed SQL expression. The model picks a key; it
// never supplies SQL.
const GROUPS = {
  country: 'c.country',
  customer: 'c.name',
  product: 'p.name',
  month: "substr(o.order_date, 1, 7)",
  status: 'o.status',
} as const;

server.registerTool(
  'sales_summary',
  {
    title: 'Sales summary',
    description:
      'Total order amounts in euros and order counts, as one grand total or one row per country, ' +
      'customer, product, month or status. With a product filter, also returns the number of units sold.',
    // groupBy and status are required on purpose. When they were optional,
    // a small model often left them out: it summed all statuses when asked
    // for revenue, and returned one total when asked "which customers".
    // A required field forces an explicit choice (see npm run eval:mcp).
    inputSchema: z.object({
      groupBy: z.enum(['none', 'country', 'customer', 'product', 'month', 'status'])
        .describe("One row per country, customer, etc.; 'none' for a single grand total"),
      status: z.enum(['paid', 'pending', 'overdue', 'refunded', 'all'])
        .describe("Which orders to include: 'paid' for revenue, 'overdue' for money owed, 'all' for every order"),
      year: year.optional(),
      product: product.optional().describe('Only this product'),
      country: z.string().optional().describe("Only customers in this country, e.g. 'Spain'"),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ groupBy, status, year, product, country }) => {
    const { where, params } = buildWhere({ status: status === 'all' ? undefined : status, year, product, country });
    const group = groupBy === 'none' ? undefined : GROUPS[groupBy];
    const rows = query(
      `SELECT ${group ? `${group} AS ${groupBy},` : ''}
              COUNT(DISTINCT o.id) AS orders,
              ${product ? 'SUM(oi.quantity) AS units,' : ''}
              ROUND(SUM(${LINE_AMOUNT}), 2) AS amount_eur
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       ${where}
       ${group ? `GROUP BY ${group} ORDER BY amount_eur DESC` : ''}`,
      params,
    );
    return json({ filters: { status, year, product, country }, rows });
  },
);

// --- list_orders ---------------------------------------------------------

server.registerTool(
  'list_orders',
  {
    title: 'List orders',
    description: 'Individual orders with customer, date, status and total amount, newest first.',
    inputSchema: z.object({
      status: status.optional(),
      customer: z.string().optional().describe('Part of the customer name, e.g. "Ribeira"'),
      year: year.optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum number of orders; default 20'),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ status, customer, year, limit = 20 }) => {
    const { where, params } = buildWhere({ status, customer, year });
    const rows = query(
      `SELECT o.id AS order_id, o.order_date, c.name AS customer, c.country, o.status,
              ROUND(SUM(${LINE_AMOUNT}), 2) AS amount_eur
       FROM orders o
       JOIN customers c ON c.id = o.customer_id
       JOIN order_items oi ON oi.order_id = o.id
       ${where}
       GROUP BY o.id ORDER BY o.order_date DESC LIMIT ?`,
      [...params, limit],
    );
    const [{ total }] = query(`SELECT COUNT(*) AS total FROM orders o JOIN customers c ON c.id = o.customer_id ${where}`, params) as [{ total: number }];
    return json({ totalMatching: total, returned: rows.length, orders: rows });
  },
);

// --- get_order -----------------------------------------------------------

server.registerTool(
  'get_order',
  {
    title: 'Get one order',
    description: 'One order by its number: customer, date, status and its line items.',
    inputSchema: z.object({ orderId: z.number().int().positive().describe('The order number') }),
    annotations: { readOnlyHint: true },
  },
  async ({ orderId }) => {
    const [order] = query(
      `SELECT o.id AS order_id, o.order_date, o.status, c.name AS customer, c.country
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
      [orderId],
    );
    if (!order) return { ...json({ error: `There is no order ${orderId}.` }), isError: true };
    const items = query(
      `SELECT p.name AS product, oi.quantity, oi.unit_price_eur, ROUND(${LINE_AMOUNT}, 2) AS amount_eur
       FROM order_items oi JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?`,
      [orderId],
    );
    const total = items.reduce((sum, item) => sum + Number(item.amount_eur), 0);
    return json({ ...order, total_eur: Math.round(total * 100) / 100, items });
  },
);

// --- list_customers ------------------------------------------------------

server.registerTool(
  'list_customers',
  {
    title: 'List customers',
    description: 'All customers (vineyards) with country, wine region and sign-up date.',
    inputSchema: z.object({ country: z.string().optional().describe("Only customers in this country, e.g. 'Italy'") }),
    annotations: { readOnlyHint: true },
  },
  async ({ country }) => {
    const rows = country
      ? query('SELECT name, country, region, signed_up FROM customers WHERE country = ? COLLATE NOCASE ORDER BY name', [country])
      : query('SELECT name, country, region, signed_up FROM customers ORDER BY country, name');
    return json({ count: rows.length, customers: rows });
  },
);

await server.connect(new StdioServerTransport());
console.error(`larkspur-sales MCP server running (database: ${DB_PATH})`);
