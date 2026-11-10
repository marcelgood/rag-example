// Evaluate the document RAG pipeline on the test cases in evals/doc-cases.json.
//
//   npm run eval                        retrieval and answers (calls the LLM)
//   npm run eval -- --retrieval-only    retrieval only: no LLM, a few seconds
//   npm run eval -- --only vacation-days
//
// It grades the two halves of RAG separately, because they fail for
// different reasons and are fixed in different places:
//  1. Retrieval: is the passage with the answer among the top-k chunks?
//     If not, no LLM can answer well. Fix with chunking, the embedding model, topK.
//  2. Answer: given those chunks, is the answer right, does it cite the
//     right document, and does it admit when the documents don't say?
//     Fix with the prompt or the model.

import { config } from '../config.ts';
import { retrieve, type RetrievalMethod, type RetrievedChunk } from '../retrieve.ts';
import { answerQuestion } from '../answer.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { mentionsAll, mentionsNone, normalize, saysItDoesNotKnow, type CheckResult, type Expected } from './checks.ts';
import { flagValue, hasFlag, loadCases, modelName, percent, printCase, printCheckTotals, saveReport } from './report.ts';

type DocCase = {
  id: string;
  question: string;
  /** The document that holds the answer (absent for unanswerable questions). */
  expectedSource?: string;
  /** A short phrase from that document's answer passage. */
  expectedPassage?: string;
  mustInclude?: Expected[];
  mustNotInclude?: string[];
  /** The documents don't answer this; the model should say so. */
  expectRefusal?: boolean;
};

const METHODS: RetrievalMethod[] = ['vector', 'keyword', 'hybrid', 'vector-rerank', 'hybrid-rerank'];
const method = (flagValue('--method') ?? config.retrievalMethod) as RetrievalMethod;
if (!METHODS.includes(method)) {
  console.error(`Unknown retrieval method "${method}". Choose one of: ${METHODS.join(', ')}.`);
  process.exit(1);
}

const retrievalOnly = hasFlag('--retrieval-only');
const cases = loadCases<DocCase>(config.evalDocCasesPath);

/** Rank (1 = first) of the chunk with the expected passage, 0 if missed, undefined for unanswerable cases. */
function rankOf(c: DocCase, chunks: RetrievedChunk[]): number | undefined {
  if (!c.expectedSource || !c.expectedPassage) return undefined;
  const passage = normalize(c.expectedPassage);
  return chunks.findIndex((ch) => ch.source === c.expectedSource && normalize(ch.text).includes(passage)) + 1;
}

/** hit@1, hit@k and MRR (mean reciprocal rank: rank 1 scores 1, rank 2 scores 0.5, a miss 0). */
function retrievalMetrics(ranks: number[]) {
  const hits = (k: number) => ranks.filter((r) => r > 0 && r <= k).length;
  const mrr = ranks.length ? ranks.reduce((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length : 0;
  return { cases: ranks.length, hitAt1: hits(1), hitAtK: hits(config.topK), mrr: Number(mrr.toFixed(3)) };
}

// --compare: every retrieval method on every question, side by side. No LLM.
if (hasFlag('--compare')) {
  console.log(`Comparing retrieval methods on ${cases.length} questions, top ${config.topK} chunks\n`);
  const ranksByMethod: Record<string, (number | undefined)[]> = {};
  const msPerQuestion: Record<string, number> = {};
  for (const m of METHODS) {
    await retrieve('warm-up', config.topK, m); // load the models first, so they don't count in the timing
    ranksByMethod[m] = [];
    const started = performance.now();
    for (const c of cases) ranksByMethod[m].push(rankOf(c, await retrieve(c.question, config.topK, m)));
    msPerQuestion[m] = (performance.now() - started) / cases.length;
  }
  // One row per answerable question: the rank each method found the passage at (- = missed).
  const width = 15;
  console.log(`${'question'.padEnd(26)}${METHODS.map((m) => m.padStart(width)).join('')}`);
  cases.forEach((c, i) => {
    if (ranksByMethod.vector![i] === undefined) return;
    const cells = METHODS.map((m) => String(ranksByMethod[m]![i] || '-').padStart(width));
    console.log(`${c.id.padEnd(26)}${cells.join('')}`);
  });
  const summary = Object.fromEntries(METHODS.map((m) => [m, retrievalMetrics(ranksByMethod[m]!.filter((r) => r !== undefined))]));
  console.log(`\n${'method'.padEnd(16)}${'hit@1'.padStart(8)}${`hit@${config.topK}`.padStart(8)}${'MRR'.padStart(8)}${'ms/question'.padStart(14)}`);
  for (const [m, s] of Object.entries(summary)) {
    const cells = [percent(s.hitAt1, s.cases), percent(s.hitAtK, s.cases), s.mrr.toFixed(2)].map((v) => v.padStart(8)).join('');
    console.log(`${m.padEnd(16)}${cells}${msPerQuestion[m]!.toFixed(0).padStart(14)}`);
  }
  const file = saveReport('retrieval-compare', {
    settings: { topK: config.topK, candidates: config.retrievalCandidates },
    summary,
    msPerQuestion,
    ranksByMethod,
  });
  console.log(`\nFull results: ${file}`);
  process.exit();
}

if (!retrievalOnly) exitIfMissingCredentials();

console.log(
  `Evaluating ${cases.length} questions: ${retrievalOnly ? 'retrieval only' : `retrieval + answers by ${modelName()}`}, ` +
    `${method} retrieval, top ${config.topK} chunks\n`,
);

const results = [];
const answerChecks: CheckResult[][] = [];
/** For each answerable case: the rank (1 = first) of the right chunk, or 0 if it wasn't retrieved. */
const ranks: number[] = [];
const started = Date.now();

try {
  for (const c of cases) {
    const caseStarted = Date.now();
    const chunks = await retrieve(c.question, config.topK, method);

    // 1. Retrieval
    const rank = rankOf(c, chunks);
    if (rank !== undefined) ranks.push(rank);
    const retrievalText = rank === undefined ? 'retrieval: n/a' : rank ? `retrieval: rank ${rank}` : 'retrieval: MISSED';

    if (retrievalOnly) {
      const checks = rank === undefined ? [] : [{ name: 'retrieved the answer passage', pass: rank > 0 }];
      printCase(c.id, checks, retrievalText);
      results.push({ ...c, rank, retrieved: chunks.map((ch) => `${ch.source}#${ch.chunkIndex}`) });
      continue;
    }

    // 2. Answer
    const answer = await answerQuestion(c.question, chunks);
    const checks: CheckResult[] = [];
    if (c.expectRefusal) checks.push(saysItDoesNotKnow(answer.text));
    if (c.mustInclude) checks.push(mentionsAll(answer.text, c.mustInclude));
    if (c.mustNotInclude) checks.push(mentionsNone(answer.text, c.mustNotInclude));
    if (c.expectedSource) {
      const cited = answer.sources.some((s) => s.source === c.expectedSource);
      checks.push({ name: 'cites the right document', pass: cited, detail: cited ? undefined : `expected ${c.expectedSource}` });
    }
    answerChecks.push(checks);

    const seconds = (Date.now() - caseStarted) / 1000;
    printCase(c.id, checks, `${retrievalText.padEnd(20)} ${seconds.toFixed(1)}s`);
    results.push({
      ...c,
      rank,
      retrieved: chunks.map((ch) => `${ch.source}#${ch.chunkIndex}`),
      answer: answer.text,
      cited: answer.sources.map((s) => `[${s.n}] ${s.source}#${s.chunkIndex}`),
      checks,
      pass: checks.every((ch) => ch.pass),
      seconds,
      inputTokens: answer.inputTokens,
      outputTokens: answer.outputTokens,
    });
  }
} catch (error) {
  handleLlmError(error);
  process.exit();
}

// Summary. hit@k: share of questions whose answer passage was in the top k.
// MRR (mean reciprocal rank): average of 1/rank, so rank 1 scores 1, rank 2
// scores 0.5, and a miss scores 0. It rewards finding the passage early.
const retrieval = retrievalMetrics(ranks);
const summary: Record<string, unknown> = { retrieval };

console.log(`\nRetrieval (${retrieval.cases} answerable questions):`);
console.log(
  `  hit@1 ${percent(retrieval.hitAt1, retrieval.cases)}, hit@${config.topK} ${percent(retrieval.hitAtK, retrieval.cases)}, MRR ${retrieval.mrr.toFixed(2)}`,
);

if (!retrievalOnly) {
  const passed = answerChecks.filter((checks) => checks.every((ch) => ch.pass)).length;
  summary.answers = { cases: answerChecks.length, passed };
  console.log(`Answers: ${passed}/${answerChecks.length} passed (${percent(passed, answerChecks.length)})`);
  printCheckTotals(answerChecks);
  console.log(`Total time ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const file = saveReport(retrievalOnly ? 'retrieval' : 'docs', {
  settings: {
    retrievalMethod: method,
    topK: config.topK,
    chunkSize: config.chunkSize,
    chunkOverlap: config.chunkOverlap,
    embeddingModel: config.embeddingModel,
  },
  summary,
  results,
});
console.log(`\nFull results: ${file}`);
