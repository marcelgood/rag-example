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

/** A row returned by vector search. */
export type SearchResult = Pick<Chunk, 'source' | 'chunkIndex' | 'text'> & {
  /** Cosine distance: 0 = same direction (very similar), 1 = unrelated. */
  _distance: number;
};

async function connect(): Promise<lancedb.Connection> {
  return lancedb.connect(config.dbDir);
}

// Replace the whole table with the given rows. The simplest correct
// strategy for a small example: every ingestion run rebuilds from scratch,
// so deleted or edited documents never leave stale chunks behind.
export async function replaceChunks(rows: ChunkRow[]): Promise<lancedb.Table> {
  const db = await connect();
  return db.createTable(config.tableName, rows, { mode: 'overwrite' });
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
