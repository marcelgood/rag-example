// Part 6: the multi-tenant MCP server (http://localhost:3200/mcp).
//
// Same idea as the Part 4 server, with two differences:
//
// 1. It runs over HTTP instead of stdio, so it can check who is calling.
//    Every request must carry an access token (Authorization: Bearer <JWT>)
//    issued by the auth server. Without a valid one the answer is 401.
//
// 2. Every query is limited to the caller's tenant. The tenant comes from
//    the verified token (the email domain), never from the model: no tool
//    has a tenant parameter. So no question, prompt injection or tool call
//    can reach another company's data.
//
// For each request, a fresh McpServer is built for that request's tenant
// (createMcpHandler's server factory). The tools are closures over that
// tenant, which makes "forgot the tenant filter" hard to write by accident.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  McpServer,
  OAuthError,
  OAuthErrorCode,
  requireBearerAuth,
  type AuthInfo,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { config } from '../config.ts';

const db = new DatabaseSync(config.tenantDbPath, { readOnly: true });
const query = (sql: string, params: SQLInputValue[] = []) => db.prepare(sql).all(...params);

// --- Authentication: check the access token -------------------------------

// The auth server's public keys, fetched once and cached by jose.
const jwks = createRemoteJWKSet(new URL('/api/auth/jwks', config.authServerUrl));

/** Checks a JWT: signature (with the public key), issuer and expiry. */
async function verifyAccessToken(token: string): Promise<AuthInfo> {
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer: config.authServerUrl });
    const audience = Array.isArray(payload.aud) ? payload.aud[0] : payload.aud;
    return {
      token,
      clientId: 'rag-demo',
      scopes: [],
      expiresAt: payload.exp,
      // requireBearerAuth compares this with expectedResource below.
      resource: audience ? new URL(audience) : undefined,
      extra: { email: payload.email, userId: payload.sub },
    };
  } catch {
    throw new OAuthError(OAuthErrorCode.InvalidToken, 'Invalid or expired access token');
  }
}

// The MCP SDK's bearer-token gate: reads the Authorization header, runs the
// verifier, and checks that the token was issued for this server (audience).
const requireToken = requireBearerAuth({
  verifier: { verifyAccessToken },
  expectedResource: new URL(config.mcpServerUrl),
});

// --- Authorization: which tenant may this user see? ------------------------

type Tenant = { id: string; name: string };

/** anna@larkspur.test → the tenant whose email_domain is larkspur.test. */
function tenantForEmail(email: unknown): Tenant | undefined {
  if (typeof email !== 'string' || !email.includes('@')) return undefined;
  const domain = email.split('@').pop()!.toLowerCase();
  return query('SELECT id, name FROM tenants WHERE email_domain = ?', [domain])[0] as Tenant | undefined;
}

// --- The tools, for one tenant ---------------------------------------------

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const LINE_AMOUNT = 'oi.quantity * oi.unit_price_eur';
const GROUPS = {
  country: 'c.country',
  customer: 'c.name',
  product: 'p.name',
  month: 'substr(o.order_date, 1, 7)',
  status: 'o.status',
} as const;
const status = z.enum(['paid', 'pending', 'overdue', 'refunded']);
const year = z.number().int().min(2020).max(2100).describe('Only orders placed in this year');

function createTenantServer(tenant: Tenant): McpServer {
  const server = new McpServer(
    { name: 'tenant-sales', version: '1.0.0' },
    {
      instructions:
        `Sales data of ${tenant.name}, the company of the signed-in user. Only this company's data ` +
        "is available. All amounts are in euros, excluding VAT. Revenue means orders with status 'paid'. " +
        "Money owed means status 'overdue'. These tools only read data.",
    },
  );

  /** WHERE clause for the filters, always starting with this tenant. */
  function where(filters: { status?: string; year?: number; product?: string; country?: string; customer?: string }) {
    const conditions = ['o.tenant_id = ?'];
    const params: SQLInputValue[] = [tenant.id];
    const add = (condition: string, value: SQLInputValue) => {
      conditions.push(condition);
      params.push(value);
    };
    if (filters.status) add('o.status = ?', filters.status);
    if (filters.year) add('substr(o.order_date, 1, 4) = ?', String(filters.year));
    if (filters.product) {
      conditions.push("(p.name LIKE '%' || ? || '%' OR p.sku = ?)");
      params.push(filters.product, filters.product);
    }
    if (filters.country) add('c.country = ? COLLATE NOCASE', filters.country);
    if (filters.customer) add("c.name LIKE '%' || ? || '%'", filters.customer);
    return { where: `WHERE ${conditions.join(' AND ')}`, params };
  }

  server.registerTool(
    'sales_summary',
    {
      title: 'Sales summary',
      description:
        'Total order amounts in euros and order counts, as one grand total or one row per country, ' +
        'customer, product, month or status. With a product filter, also returns the number of units sold.',
      inputSchema: z.object({
        groupBy: z.enum(['none', 'country', 'customer', 'product', 'month', 'status'])
          .describe("One row per country, customer, etc.; 'none' for a single grand total"),
        status: z.enum(['paid', 'pending', 'overdue', 'refunded', 'all'])
          .describe("Which orders to include: 'paid' for revenue, 'overdue' for money owed, 'all' for every order"),
        year: year.optional(),
        product: z.string().optional().describe('Only this product: part of its name or its SKU (see list_products)'),
        country: z.string().optional().describe("Only customers in this country, e.g. 'Spain'"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ groupBy, status, year, product, country }) => {
      const w = where({ status: status === 'all' ? undefined : status, year, product, country });
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
         ${w.where}
         ${group ? `GROUP BY ${group} ORDER BY amount_eur DESC` : ''}`,
        w.params,
      );
      return json({ filters: { status, year, product, country }, rows });
    },
  );

  server.registerTool(
    'list_orders',
    {
      title: 'List orders',
      description: 'Individual orders with customer, date, status and total amount, newest first.',
      inputSchema: z.object({
        status: status.optional(),
        customer: z.string().optional().describe('Part of the customer name'),
        year: year.optional(),
        limit: z.number().int().min(1).max(100).optional().describe('Maximum number of orders; default 20'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ status, customer, year, limit = 20 }) => {
      const w = where({ status, customer, year });
      const rows = query(
        `SELECT o.id AS order_id, o.order_date, c.name AS customer, c.country, o.status,
                ROUND(SUM(${LINE_AMOUNT}), 2) AS amount_eur
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
         JOIN order_items oi ON oi.order_id = o.id
         ${w.where}
         GROUP BY o.id ORDER BY o.order_date DESC LIMIT ?`,
        [...w.params, limit],
      );
      return json({ returned: rows.length, orders: rows });
    },
  );

  server.registerTool(
    'get_order',
    {
      title: 'Get one order',
      description: 'One order by its number: customer, date, status and its line items.',
      inputSchema: z.object({ orderId: z.number().int().positive().describe('The order number') }),
      annotations: { readOnlyHint: true },
    },
    async ({ orderId }) => {
      // Another tenant's order gets the same answer as a missing one, so
      // the reply doesn't reveal that the number exists.
      const [order] = query(
        `SELECT o.id AS order_id, o.order_date, o.status, c.name AS customer, c.country
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE o.id = ? AND o.tenant_id = ?`,
        [orderId, tenant.id],
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

  server.registerTool(
    'list_customers',
    {
      title: 'List customers',
      description: 'All customers with country, region and sign-up date.',
      inputSchema: z.object({ country: z.string().optional().describe("Only customers in this country, e.g. 'Austria'") }),
      annotations: { readOnlyHint: true },
    },
    async ({ country }) => {
      const rows = query(
        `SELECT name, country, region, signed_up FROM customers
         WHERE tenant_id = ? ${country ? 'AND country = ? COLLATE NOCASE' : ''} ORDER BY country, name`,
        country ? [tenant.id, country] : [tenant.id],
      );
      return json({ count: rows.length, customers: rows });
    },
  );

  server.registerTool(
    'list_products',
    {
      title: 'List products',
      description: 'The products the company sells, with SKU and list price.',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => json({ products: query('SELECT sku, name, unit_price_eur FROM products WHERE tenant_id = ? ORDER BY name', [tenant.id]) }),
  );

  return server;
}

// --- HTTP: authenticate, find the tenant, serve MCP -------------------------

const mcp = createMcpHandler(({ authInfo }) => {
  const tenant = authInfo?.extra?.tenant as Tenant | undefined;
  if (!tenant) throw new Error('No tenant for this request'); // the route below always sets one
  return createTenantServer(tenant);
});

const forbidden = (description: string) =>
  Response.json({ error: 'forbidden', error_description: description }, { status: 403 });

const app = new Hono();
app.all(new URL(config.mcpServerUrl).pathname, async (c) => {
  const request = c.req.raw;
  // Refuse requests for other host names (protects a local server from DNS rebinding).
  const badHost = hostHeaderValidationResponse(request, localhostAllowedHostnames());
  if (badHost) return badHost;

  // 1. Who is it? No valid token → 401 with a WWW-Authenticate challenge.
  const auth = await requireToken(request);
  if (auth instanceof Response) return auth;

  // 2. Which tenant? Signed in, but no company for the email domain → 403.
  const email = auth.extra?.email;
  const tenant = tenantForEmail(email);
  if (!tenant) return forbidden(`No tenant for ${String(email)}`);

  console.error(`${String(email)} → ${tenant.id}`);
  return mcp.fetch(request, { authInfo: { ...auth, extra: { ...auth.extra, tenant } } });
});

const { port } = new URL(config.mcpServerUrl);
serve({ fetch: app.fetch, port: Number(port) });
console.error(`Multi-tenant MCP server running at ${config.mcpServerUrl}`);
