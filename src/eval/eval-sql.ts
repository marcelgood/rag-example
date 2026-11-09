// Evaluate the database agents on the test cases in evals/sql-cases.json.
//
//   npm run eval:sql     Part 2: the model writes SQL (run_sql)
//   npm run eval:mcp     Part 4: the model uses the MCP server's sales tools
//   add -- --only overdue-customers to run one case
//
// Both agents answer the same questions, so their scores can be compared.
//
// The right answers aren't typed into the test file. Each case has a
// reference query that a human wrote and checked; the eval runs it against
// the database and checks that the model's answer contains the same values.
// So the expected answers stay correct if the data changes (re-seeding).
//
// Only the final answer is graded, not how the model got there: there are
// many correct ways to write a query or combine tool calls.

import { config, modelLabel } from '../config.ts';
import type { Agent, Log } from '../agent/types.ts';
import { runAgent } from '../agent/run.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { runQuery } from '../sql/database.ts';
import { createSqlAgent } from '../sql/tool.ts';
import { connectToSalesServer } from '../mcp/client.ts';
import { containsValues, mentionsNone, saysItDoesNotKnow, type CheckResult } from './checks.ts';
import { hasFlag, loadCases, percent, printCase, printCheckTotals, saveReport } from './report.ts';

type SqlCase = {
  id: string;
  question: string;
  /** A checked query whose result values must all appear in the answer. */
  referenceSql?: string;
  mustNotInclude?: string[];
  /** The data can't answer this; the model should say so. */
  expectRefusal?: boolean;
};

const useMcp = hasFlag('--mcp');
const cases = loadCases<SqlCase>(config.evalSqlCasesPath);
exitIfMissingCredentials();

const mcp = useMcp ? await connectToSalesServer() : undefined;
const createAgent = (log: Log): Agent => (mcp ? mcp.createAgent(log) : createSqlAgent(log));

console.log(`Evaluating ${cases.length} questions with ${modelLabel()}, ${useMcp ? 'MCP sales tools' : 'run_sql'}\n`);

const results = [];
const allChecks: CheckResult[][] = [];
const started = Date.now();

try {
  for (const c of cases) {
    const caseStarted = Date.now();
    const expectedRows = c.referenceSql ? runQuery(c.referenceSql).rows : undefined;

    // Collect the agent's tool calls instead of printing them.
    const log: string[] = [];
    const answer = await runAgent(createAgent((line) => log.push(line.trim())), c.question);

    const checks: CheckResult[] = [];
    if (expectedRows) checks.push(containsValues(answer, expectedRows));
    if (c.mustNotInclude) checks.push(mentionsNone(answer, c.mustNotInclude));
    if (c.expectRefusal) checks.push(saysItDoesNotKnow(answer));
    allChecks.push(checks);

    const calls = log.filter((line) => /^(SQL|MCP)> /.test(line)).length;
    const seconds = (Date.now() - caseStarted) / 1000;
    printCase(c.id, checks, `${calls} tool call${calls === 1 ? '' : 's'}, ${seconds.toFixed(1)}s`);
    results.push({ ...c, expectedRows, answer, toolLog: log, checks, pass: checks.every((ch) => ch.pass), seconds });
  }
} catch (error) {
  handleLlmError(error);
  await mcp?.close();
  process.exit();
}
await mcp?.close();

const passed = allChecks.filter((checks) => checks.every((ch) => ch.pass)).length;
console.log(`\nAnswers: ${passed}/${allChecks.length} passed (${percent(passed, allChecks.length)})`);
printCheckTotals(allChecks);
console.log(`Total time ${((Date.now() - started) / 1000).toFixed(0)}s`);

const file = saveReport(useMcp ? 'mcp' : 'sql', { summary: { cases: allChecks.length, passed }, results });
console.log(`\nFull results: ${file}`);
