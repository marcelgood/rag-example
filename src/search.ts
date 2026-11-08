// Sanity check for the ingestion: search the stored chunks by meaning.
// This is the "R" (retrieval) in RAG, without the LLM yet.
// Run with: npm run search -- "your question"

import { embedText } from './embed.ts';
import { searchChunks } from './store.ts';

const query = process.argv.slice(2).join(' ');
if (!query) {
  console.error('Usage: npm run search -- "your question"');
  process.exit(1);
}

const results = await searchChunks(await embedText(query), 3);

console.log(`Query: ${query}\n`);
for (const r of results) {
  // Cosine distance: 0 = same direction (very similar), 1 = unrelated.
  const similarity = (1 - r._distance).toFixed(3);
  const preview = r.text.replace(/\s+/g, ' ').slice(0, 220);
  console.log(`[similarity ${similarity}] ${r.source} (chunk ${r.chunkIndex})`);
  console.log(`  ${preview}${r.text.length > 220 ? '…' : ''}\n`);
}
