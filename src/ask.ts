// The query pipeline: QUESTION -> EMBED -> RETRIEVE -> GENERATE.
// Run with: npm run ask -- "your question"

import { config, modelLabel } from './config.ts';
import { parseMethodArgs, retrieve, SCORE_LABELS } from './retrieve.ts';
import { answerQuestion } from './answer.ts';
import { exitIfMissingCredentials, handleLlmError } from './llm/errors.ts';

const { method, rest } = parseMethodArgs(process.argv.slice(2));
const question = rest.join(' ');
if (!question) {
  console.error('Usage: npx agent ask [--method <name>] "your question"');
  process.exit(1);
}
exitIfMissingCredentials();

// STEP 5 — RETRIEVE: find the chunks most likely to answer the question.
// With the 'vector' method (Part 1), that's the question's embedding (made
// with the SAME model used during ingestion) compared with the chunks'.
// Part 7 adds keyword search, hybrid search and re-ranking (see retrieve.ts).
const chunks = await retrieve(question, config.topK, method);

console.log(`Question: ${question}`);
console.log(`Retrieved ${chunks.length} chunks (${method}):`);
const label = SCORE_LABELS[method];
for (const c of chunks) {
  const score = label && c.score !== undefined ? `, ${label} ${c.score.toFixed(3)}` : '';
  console.log(`  - ${c.source} (chunk ${c.chunkIndex})${score}`);
}

console.log(`\nAsking ${modelLabel()}...`);
const started = Date.now();

try {
  const { text, sources, inputTokens, outputTokens } = await answerQuestion(question, chunks);

  console.log(`\nAnswer:\n${text}\n`);
  if (sources.length) {
    console.log('Sources:');
    for (const s of sources) {
      const quote = s.quote.replace(/\s+/g, ' ').trim();
      console.log(`  [${s.n}] ${s.source} (chunk ${s.chunkIndex}): "${quote}"`);
    }
  } else {
    console.log('Sources: none cited');
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nTokens: ${inputTokens} in, ${outputTokens} out, ${seconds}s`);
} catch (error) {
  handleLlmError(error);
}
