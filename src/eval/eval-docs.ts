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
import { embedText } from '../embed.ts';
import { searchChunks } from '../store.ts';
import { answerQuestion } from '../answer.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { mentionsAll, mentionsNone, normalize, saysItDoesNotKnow, type CheckResult, type Expected } from './checks.ts';
import { hasFlag, loadCases, modelName, percent, printCase, printCheckTotals, saveReport } from './report.ts';

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

const retrievalOnly = hasFlag('--retrieval-only');
const cases = loadCases<DocCase>(config.evalDocCasesPath);
if (!retrievalOnly) exitIfMissingCredentials();

console.log(
  `Evaluating ${cases.length} questions: ${retrievalOnly ? 'retrieval only' : `retrieval + answers by ${modelName()}`}, top ${config.topK} chunks\n`,
);

const results = [];
const answerChecks: CheckResult[][] = [];
/** For each answerable case: the rank (1 = first) of the right chunk, or 0 if it wasn't retrieved. */
const ranks: number[] = [];
const started = Date.now();

try {
  for (const c of cases) {
    const caseStarted = Date.now();
    const chunks = await searchChunks(await embedText(c.question), config.topK);

    // 1. Retrieval
    let rank: number | undefined;
    if (c.expectedSource && c.expectedPassage) {
      const passage = normalize(c.expectedPassage);
      rank = chunks.findIndex((ch) => ch.source === c.expectedSource && normalize(ch.text).includes(passage)) + 1;
      ranks.push(rank);
    }
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
const hits = (k: number) => ranks.filter((r) => r > 0 && r <= k).length;
const mrr = ranks.length ? ranks.reduce((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length : 0;
const summary: Record<string, unknown> = {
  retrieval: { cases: ranks.length, hitAt1: hits(1), hitAtK: hits(config.topK), mrr: Number(mrr.toFixed(3)) },
};

console.log(`\nRetrieval (${ranks.length} answerable questions):`);
console.log(
  `  hit@1 ${percent(hits(1), ranks.length)}, hit@${config.topK} ${percent(hits(config.topK), ranks.length)}, MRR ${mrr.toFixed(2)}`,
);

if (!retrievalOnly) {
  const passed = answerChecks.filter((checks) => checks.every((ch) => ch.pass)).length;
  summary.answers = { cases: answerChecks.length, passed };
  console.log(`Answers: ${passed}/${answerChecks.length} passed (${percent(passed, answerChecks.length)})`);
  printCheckTotals(answerChecks);
  console.log(`Total time ${((Date.now() - started) / 1000).toFixed(0)}s`);
}

const file = saveReport(retrievalOnly ? 'retrieval' : 'docs', {
  settings: { topK: config.topK, chunkSize: config.chunkSize, chunkOverlap: config.chunkOverlap, embeddingModel: config.embeddingModel },
  summary,
  results,
});
console.log(`\nFull results: ${file}`);
