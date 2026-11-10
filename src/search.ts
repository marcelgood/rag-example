// Sanity check for the ingestion: search the stored chunks.
// This is the "R" (retrieval) in RAG, without the LLM yet.
// Run with: npx agent search "your question"
//      or:  npx agent search --method hybrid-rerank "your question"   (Part 7)

import { parseMethodArgs, retrieve, SCORE_LABELS } from './retrieve.ts';

const { method, rest } = parseMethodArgs(process.argv.slice(2));
const query = rest.join(' ');
if (!query) {
  console.error('Usage: npx agent search [--method <name>] "your question"');
  process.exit(1);
}

const results = await retrieve(query, 3, method);
const label = SCORE_LABELS[method];

console.log(`Query: ${query}\nMethod: ${method}\n`);
results.forEach((r, i) => {
  const score = label && r.score !== undefined ? `${label} ${r.score.toFixed(3)}` : `rank ${i + 1}`;
  const preview = r.text.replace(/\s+/g, ' ').slice(0, 220);
  console.log(`[${score}] ${r.source} (chunk ${r.chunkIndex})`);
  console.log(`  ${preview}${r.text.length > 220 ? '…' : ''}\n`);
});
