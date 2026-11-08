// STEP 1 — LOAD
// Read the raw documents from disk. Each document keeps its text plus
// metadata (where it came from), so an answer can later cite its source.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export type SourceDocument = {
  /** Path relative to the data folder, with forward slashes. */
  source: string;
  text: string;
};

const SUPPORTED = new Set(['.md', '.txt']);

export async function loadDocuments(dir: string): Promise<SourceDocument[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const docs: SourceDocument[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SUPPORTED.has(ext)) continue;

    const fullPath = path.join(entry.parentPath, entry.name);
    const text = await readFile(fullPath, 'utf8');
    docs.push({
      // Forward slashes so the id is the same on every OS.
      source: path.relative(dir, fullPath).split(path.sep).join('/'),
      text,
    });
  }

  return docs;
}
