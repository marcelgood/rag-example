// Helpers shared by the two eval runners: loading test cases, printing
// results, and saving a report so you can compare runs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import type { CheckResult } from './checks.ts';

export function loadCases<T extends { id: string; question: string }>(file: string): T[] {
  const { cases } = JSON.parse(readFileSync(file, 'utf8')) as { cases: T[] };
  // `--only <id>` runs a single case, handy while fixing one failure.
  const onlyIndex = process.argv.indexOf('--only');
  const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : undefined;
  const selected = only ? cases.filter((c) => c.id === only) : cases;
  if (selected.length === 0) throw new Error(`No test case with id "${only}" in ${file}`);
  return selected;
}

export const hasFlag = (flag: string) => process.argv.includes(flag);

/** The value after a flag, e.g. "hybrid" for `--method hybrid`. */
export function flagValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export const percent = (part: number, total: number) => (total ? `${Math.round((100 * part) / total)}%` : 'n/a');

export const modelName = () => (config.llmProvider === 'claude' ? config.llmModel : config.ollamaModel);

/** One line per case: ✓/✗, the id, and the reason for any failed check. */
export function printCase(id: string, checks: CheckResult[], extra = ''): void {
  const failed = checks.filter((c) => !c.pass);
  const mark = failed.length === 0 ? '✓' : '✗';
  console.log(`${mark} ${id.padEnd(28)} ${extra}`);
  for (const f of failed) console.log(`    ✗ ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
}

/** Pass counts per check name, e.g. "mentions the expected facts 11/12". */
export function printCheckTotals(allChecks: CheckResult[][]): void {
  const totals = new Map<string, { pass: number; total: number }>();
  for (const check of allChecks.flat()) {
    const t = totals.get(check.name) ?? { pass: 0, total: 0 };
    t.total++;
    if (check.pass) t.pass++;
    totals.set(check.name, t);
  }
  for (const [name, t] of totals) console.log(`  ${name}: ${t.pass}/${t.total}`);
}

/** Save the full results (questions, answers, checks) as JSON and return the path. */
export function saveReport(kind: string, report: object): string {
  mkdirSync(config.evalResultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(config.evalResultsDir, `${kind}-${modelName().replace(/[^\w.-]/g, '_')}-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ kind, provider: config.llmProvider, model: modelName(), date: new Date().toISOString(), ...report }, null, 2)}\n`);
  return file.split(path.sep).join('/');
}
