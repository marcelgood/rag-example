// The query pipeline: QUESTION -> EMBED -> RETRIEVE -> GENERATE.
// Run with: npm run ask -- "your question"

import { config, modelLabel } from './config.ts';
import { embedText } from './embed.ts';
import { searchChunks } from './store.ts';
import { answerQuestion } from './answer.ts';
import { exitIfMissingCredentials, handleLlmError } from './llm/errors.ts';

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error('Usage: npm run ask -- "your question"');
  process.exit(1);
}
exitIfMissingCredentials();

// STEP 5 — RETRIEVE: embed the question with the SAME model used during
// ingestion, then find the closest chunks in the vector database.
const chunks = await searchChunks(await embedText(question), config.topK);

console.log(`Question: ${question}`);
console.log(`Retrieved ${chunks.length} chunks:`);
for (const c of chunks) {
  console.log(`  - ${c.source} (chunk ${c.chunkIndex}), similarity ${(1 - c._distance).toFixed(3)}`);
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
