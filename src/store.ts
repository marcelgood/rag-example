// STEP 4 — STORE
// Save each chunk (text + metadata + vector) in the vector database.
// LanceDB is embedded: it runs inside this Node process and keeps its data
// in a local folder (config.dbDir). Nothing to install or start.

import * as lancedb from '@lancedb/lancedb';
import { config } from './config.ts';
import type { Chunk } from './chunk.ts';
import type { Vector } from './embed.ts';

/** One row in the LanceDB table. */
export type ChunkRow = Chunk & { vector: Vector };

/** The part of a chunk that retrieval returns and the answer step uses. */
export type ChunkText = Pick<Chunk, 'source' | 'chunkIndex' | 'text'>;

/** A row returned by vector search. */
export type SearchResult = ChunkText & {
  /** Cosine distance: 0 = same direction (very similar), 1 = unrelated. */
  _distance: number;
};

/** A row returned by keyword (full-text) search. */
export type KeywordResult = ChunkText & {
  /** BM25 score: higher means the query's words are more prominent in the chunk. */
  _score: number;
};

async function connect(): Promise<lancedb.Connection> {
  return lancedb.connect(config.dbDir);
}

// Replace the whole table with the given rows. The simplest correct
// strategy for a small example: every ingestion run rebuilds from scratch,
// so deleted or edited documents never leave stale chunks behind.
export async function replaceChunks(rows: ChunkRow[]): Promise<lancedb.Table> {
  const db = await connect();
  const table = await db.createTable(config.tableName, rows, { mode: 'overwrite' });
  // A full-text index on the text, for keyword search (Part 7). Words are
  // lowercased and stemmed ("installing" → "install"), and common words
  // such as "the" and "what" are left out, so they don't count as matches.
  await table.createIndex('text', { config: lancedb.Index.fts({ stem: true, removeStopWords: true }) });
  return table;
}

export async function openChunks(): Promise<lancedb.Table> {
  const db = await connect();
  return db.openTable(config.tableName);
}

// Find the k chunks whose vectors are closest to the query vector.
export async function searchChunks(queryVector: Vector, k = 4): Promise<SearchResult[]> {
  const table = await openChunks();
  // LanceDB returns untyped rows; we know their shape from select() below.
  const rows: SearchResult[] = await table
    .vectorSearch(queryVector)
    .distanceType('cosine')
    .limit(k)
    .select(['source', 'chunkIndex', 'text', '_distance'])
    .toArray();
  return rows;
}

// Find the k chunks that best match the query's words (BM25 ranking), using
// the full-text index. Exact terms such as "ERR-07" or "LARKSPUR-GUEST" are
// where this beats vector search.
export async function searchKeywords(query: string, k = 4): Promise<KeywordResult[]> {
  const table = await openChunks();
  const rows: KeywordResult[] = await table
    .query()
    .fullTextSearch(query, { columns: 'text' })
    .limit(k)
    .select(['source', 'chunkIndex', 'text', '_score'])
    .toArray();
  return rows;
}
