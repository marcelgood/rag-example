// Part 6: evaluate authentication and tenant isolation.
//
//   npm run eval:tenant                     security checks + questions (needs the LLM)
//   npm run eval:tenant -- --security-only  security checks only, a few seconds
//
// Starts the auth and MCP servers itself unless they're already running.
//
// 1. Security checks call the servers directly, without a model: they test
//    the guarantees that must hold no matter what the model does (no token
//    → refused, forged token → refused, each user sees only their tenant).
// 2. Questions are asked by users of both tenants through the full stack
//    (sign in → access token → AI SDK loop → MCP server), and graded like
//    eval:sql, plus checks that the other tenant's names never appear.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { createMCPClient } from '@ai-sdk/mcp';
import { SignJWT, decodeJwt, generateKeyPair } from 'jose';
import { config, modelLabel } from '../config.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { askAsUser } from '../tenant/agent.ts';
import { TEST_PASSWORD } from '../tenant/test-users.ts';
import { AuthError, accessTokenFor, createSession, endSession } from '../tenant/session.ts';
import { containsValues, mentionsNone, type CheckResult } from './checks.ts';
import { hasFlag, loadCases, percent, printCase, printCheckTotals, saveReport } from './report.ts';

type TenantCase = { id: string; user: string; question: string; referenceSql?: string; mustNotInclude?: string[] };

const db = new DatabaseSync(config.tenantDbPath, { readOnly: true });
const rows = (sql: string, params: Record<string, SQLInputValue> | SQLInputValue[] = []) =>
  (Array.isArray(params) ? db.prepare(sql).all(...params) : db.prepare(sql).all(params)) as Record<string, unknown>[];
const tenantOf = (email: string) =>
  (rows('SELECT id FROM tenants WHERE email_domain = ?', [email.split('@')[1]!])[0]?.id as string | undefined);

// --- Start the servers if needed --------------------------------------------

const running = await fetch(new URL('/api/auth/jwks', config.authServerUrl)).then(() => true, () => false);
if (!running) {
  console.log('Starting the auth and MCP servers...');
  await import('../tenant/start-servers.ts');
}

// --- Helpers ----------------------------------------------------------------

/** Sign in as a test user and get an access token, without touching .auth/session.json. */
async function tokenFor(email: string): Promise<string> {
  return accessTokenFor(await createSession(email, TEST_PASSWORD));
}

/** The HTTP status the MCP server answers for a request with this Authorization header. */
async function mcpStatus(authorization?: string): Promise<number> {
  const response = await fetch(config.mcpServerUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  await response.body?.cancel();
  return response.status;
}

/** Call one MCP tool directly (no model) as the owner of this token. */
async function callTool(token: string, name: string, args: Record<string, unknown>) {
  const mcp = await createMCPClient({
    transport: { type: 'http', url: config.mcpServerUrl, headers: { Authorization: `Bearer ${token}` } },
  });
  try {
    const tools = await mcp.tools();
    const result = (await tools[name]!.execute!(args, { toolCallId: 'eval', messages: [], context: {} })) as {
      content: { type: string; text?: string }[];
      isError?: boolean;
    };
    return { text: result.content.map((block) => block.text ?? '').join(''), isError: result.isError === true };
  } finally {
    await mcp.close();
  }
}

const check = (name: string, pass: boolean, detail?: string): CheckResult => ({ name, pass, detail: pass ? undefined : detail });

// --- 1. Security checks -----------------------------------------------------

async function securityChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const anna = await tokenFor('anna@larkspur.test');
  const carla = await tokenFor('carla@copperleaf.test');

  // Signing in
  const wrongPassword = await createSession('anna@larkspur.test', 'not-the-password').then(() => 'accepted', (e) => e);
  results.push(check('wrong password is refused', wrongPassword instanceof AuthError, String(wrongPassword)));

  const session = await createSession('ben@larkspur.test', TEST_PASSWORD);
  await endSession(session);
  const afterSignOut = await accessTokenFor(session).then(() => 'issued', (e) => e);
  results.push(check('a signed-out session gets no new access tokens', afterSignOut instanceof AuthError, 'a token was issued'));

  // The MCP server's gate
  let status = await mcpStatus();
  results.push(check('no token → 401', status === 401, `got ${status}`));

  status = await mcpStatus('Bearer not-a-jwt');
  results.push(check('garbage token → 401', status === 401, `got ${status}`));

  // Change the email inside Anna's token to Carla's, keeping the signature.
  const [header, , signature] = anna.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...decodeJwt(anna), email: 'carla@copperleaf.test' })).toString('base64url');
  status = await mcpStatus(`Bearer ${header}.${forgedPayload}.${signature}`);
  results.push(check('token with an edited email → 401', status === 401, `got ${status}`));

  // A well-formed token, signed with a key that isn't the auth server's.
  const { privateKey } = await generateKeyPair('EdDSA');
  const selfSigned = await new SignJWT({ email: 'anna@larkspur.test' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(config.authServerUrl)
    .setAudience(config.mcpServerUrl)
    .setSubject('attacker')
    .setExpirationTime('5m')
    .sign(privateKey);
  status = await mcpStatus(`Bearer ${selfSigned}`);
  results.push(check('token signed by another key → 401', status === 401, `got ${status}`));

  status = await mcpStatus(`Bearer ${await tokenFor('eve@unknown.test')}`);
  results.push(check('signed in, but no tenant for the domain → 403', status === 403, `got ${status}`));

  status = await mcpStatus(`Bearer ${anna}`);
  results.push(check('valid token → 200', status === 200, `got ${status}`));

  // Tenant isolation, calling the tools directly
  for (const [email, token] of [['anna@larkspur.test', anna], ['carla@copperleaf.test', carla]] as const) {
    const tenant = tenantOf(email)!;
    const own = rows('SELECT name FROM customers WHERE tenant_id = ?', [tenant]).map((r) => r.name as string);
    const others = rows('SELECT name FROM customers WHERE tenant_id <> ?', [tenant]).map((r) => r.name as string);
    const { text } = await callTool(token, 'list_customers', {});
    const leaked = others.filter((name) => text.includes(name));
    const missing = own.filter((name) => !text.includes(name));
    results.push(check(`${email} sees all of ${tenant}'s customers and no others`, leaked.length + missing.length === 0,
      `leaked ${JSON.stringify(leaked)}, missing ${JSON.stringify(missing)}`));
  }

  const copperleafOrder = rows("SELECT MIN(id) AS id FROM orders WHERE tenant_id = 'copperleaf'")[0]!.id as number;
  const crossOrder = await callTool(anna, 'get_order', { orderId: copperleafOrder });
  results.push(check(`anna can't read Copperleaf's order ${copperleafOrder}`, crossOrder.isError && !crossOrder.text.includes('Copperleaf'), crossOrder.text));

  const larkspurTotal = rows("SELECT ROUND(SUM(oi.quantity * oi.unit_price_eur), 2) AS t FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.tenant_id = 'larkspur'")[0]!.t;
  const summary = await callTool(anna, 'sales_summary', { groupBy: 'none', status: 'all' });
  results.push(check("anna's grand total covers only Larkspur's orders", summary.text.includes(`"amount_eur":${larkspurTotal}`), summary.text));

  return results;
}

console.log('Security checks (no model)\n');
const security = await securityChecks();
for (const result of security) console.log(`${result.pass ? '✓' : '✗'} ${result.name}${result.pass ? '' : `\n    ${result.detail}`}`);
const securityPassed = security.filter((r) => r.pass).length;
console.log(`\nSecurity: ${securityPassed}/${security.length} passed\n`);

// --- 2. Questions through the whole stack -----------------------------------

const results = [];
const allChecks: CheckResult[][] = [];
if (!hasFlag('--security-only')) {
  exitIfMissingCredentials();
  const cases = loadCases<TenantCase>('evals/tenant-cases.json');
  console.log(`Asking ${cases.length} questions with ${modelLabel()} as users of both tenants\n`);
  try {
    for (const c of cases) {
      const started = Date.now();
      const tenant = tenantOf(c.user)!;
      const expectedRows = c.referenceSql ? rows(c.referenceSql, { tenant }) : undefined;
      const answer = await askAsUser(c.question, await tokenFor(c.user));

      const checks: CheckResult[] = [];
      if (expectedRows) checks.push(containsValues(answer.text, expectedRows));
      if (c.mustNotInclude) checks.push({ ...mentionsNone(answer.text, c.mustNotInclude), name: "shows no other tenant's data" });
      allChecks.push(checks);

      const seconds = (Date.now() - started) / 1000;
      printCase(`${c.id} (${c.user.split('@')[0]})`, checks, `${answer.toolCalls.length} tool calls, ${seconds.toFixed(1)}s`);
      results.push({ ...c, tenant, expectedRows, answer: answer.text, toolLog: answer.toolCalls, checks, pass: checks.every((ch) => ch.pass), seconds });
    }
  } catch (error) {
    handleLlmError(error);
  }
  const passed = allChecks.filter((checks) => checks.every((ch) => ch.pass)).length;
  console.log(`\nAnswers: ${passed}/${allChecks.length} passed (${percent(passed, allChecks.length)})`);
  printCheckTotals(allChecks);
}

const file = saveReport('tenant', { security, results });
console.log(`\nFull results: ${file}`);
process.exit(); // also stops the servers if this script started them
