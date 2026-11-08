// Evaluate the text-to-SQL pipeline on the test cases in evals/sql-cases.json.
//
//   npm run eval:sql
//   npm run eval:sql -- --only overdue-customers
//
// The right answers aren't typed into the test file. Each case has a
// reference query that a human wrote and checked; the eval runs it against
// the database and checks that the model's answer contains the same values.
// So the expected answers stay correct if the data changes (re-seeding).
//
// Only the final answer is graded, not the model's SQL: there are many
// correct ways to write a query, so comparing SQL text would fail good answers.

import { config } from '../config.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { runQuery } from '../sql/database.ts';
import { containsValues, mentionsNone, saysItDoesNotKnow, type CheckResult } from './checks.ts';
import { loadCases, modelName, percent, printCase, printCheckTotals, saveReport } from './report.ts';

type SqlCase = {
  id: string;
  question: string;
  /** A checked query whose result values must all appear in the answer. */
  referenceSql?: string;
  mustNotInclude?: string[];
  /** The data can't answer this; the model should say so. */
  expectRefusal?: boolean;
};

const cases = loadCases<SqlCase>(config.evalSqlCasesPath);
exitIfMissingCredentials();
const ask =
  config.llmProvider === 'claude'
    ? (await import('../sql/agent-claude.ts')).askClaude
    : (await import('../sql/agent-ollama.ts')).askOllama;

console.log(`Evaluating ${cases.length} questions with ${modelName()}\n`);

const results = [];
const allChecks: CheckResult[][] = [];
const started = Date.now();

try {
  for (const c of cases) {
    const caseStarted = Date.now();
    const expectedRows = c.referenceSql ? runQuery(c.referenceSql).rows : undefined;

    // Collect the model's queries instead of printing them.
    const log: string[] = [];
    const answer = await ask(c.question, (line) => log.push(line.trim()));

    const checks: CheckResult[] = [];
    if (expectedRows) checks.push(containsValues(answer, expectedRows));
    if (c.mustNotInclude) checks.push(mentionsNone(answer, c.mustNotInclude));
    if (c.expectRefusal) checks.push(saysItDoesNotKnow(answer));
    allChecks.push(checks);

    const queries = log.filter((line) => line.startsWith('SQL> ')).length;
    const seconds = (Date.now() - caseStarted) / 1000;
    printCase(c.id, checks, `${queries} quer${queries === 1 ? 'y' : 'ies'}, ${seconds.toFixed(1)}s`);
    results.push({ ...c, expectedRows, answer, toolLog: log, checks, pass: checks.every((ch) => ch.pass), seconds });
  }
} catch (error) {
  handleLlmError(error);
  process.exit();
}

const passed = allChecks.filter((checks) => checks.every((ch) => ch.pass)).length;
console.log(`\nAnswers: ${passed}/${allChecks.length} passed (${percent(passed, allChecks.length)})`);
printCheckTotals(allChecks);
console.log(`Total time ${((Date.now() - started) / 1000).toFixed(0)}s`);

const file = saveReport('sql', { summary: { cases: allChecks.length, passed }, results });
console.log(`\nFull results: ${file}`);
