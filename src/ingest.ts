// The ingestion pipeline: LOAD -> CHUNK -> EMBED -> STORE.
// Run with: npm run ingest

import { config } from './config.ts';
import { loadDocuments } from './load.ts';
import { chunkDocuments } from './chunk.ts';
import { embedTexts } from './embed.ts';
import { replaceChunks, type ChunkRow } from './store.ts';

const started = Date.now();

console.log(`1. Loading documents from ./${config.dataDir}`);
const docs = await loadDocuments(config.dataDir);
if (docs.length === 0) {
  console.error(`No .md or .txt files found in ./${config.dataDir}`);
  process.exit(1);
}
console.log(`   ${docs.length} documents`);

console.log(`2. Chunking (size ${config.chunkSize} tokens, overlap ${config.chunkOverlap})`);
const chunks = await chunkDocuments(docs, config);
console.log(`   ${chunks.length} chunks`);

console.log(`3. Embedding with ${config.embeddingModel} (first run downloads the model)`);
const vectors = await embedTexts(chunks.map((c) => c.text));
const dims = vectors[0]?.length;
if (dims !== config.embeddingDims) {
  throw new Error(`Expected ${config.embeddingDims} dimensions, got ${dims}`);
}
console.log(`   ${vectors.length} vectors x ${dims} dimensions`);

console.log(`4. Storing in LanceDB (./${config.dbDir}, table "${config.tableName}")`);
const rows: ChunkRow[] = chunks.map((chunk, i) => ({ ...chunk, vector: vectors[i]! }));
const table = await replaceChunks(rows);
console.log(`   ${await table.countRows()} rows stored`);

console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
