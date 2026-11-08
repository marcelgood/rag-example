// STEP 2 — CHUNK
// Split each document into smaller pieces. Why?
//  - An embedding is one vector for the whole input. A vector for a whole
//    document is a blurry average; a vector for one paragraph is precise.
//  - At answer time we put only the few best chunks into the LLM prompt,
//    not whole documents.
//
// We use LangChain's RecursiveCharacterTextSplitter. It cuts at the most
// natural boundary first and only falls back to smaller ones when a piece
// is still too long. For Markdown those boundaries are headings, then code
// blocks and horizontal rules, then paragraphs, lines and words, so a
// section usually stays together with its heading. Neighbouring chunks
// share `chunkOverlap` tokens so a sentence that straddles a boundary is
// not lost.
//
// Sizes are measured in tokens of the embedding model itself (not
// characters), so a chunk never exceeds what the model can read.

import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { countTokens } from './embed.ts';
import type { SourceDocument } from './load.ts';

export type Chunk = {
  /** Unique id: "<source>#<chunkIndex>". */
  id: string;
  source: string;
  chunkIndex: number;
  text: string;
};

export type ChunkOptions = {
  /** Maximum chunk length, in embedding-model tokens. */
  chunkSize: number;
  /** Tokens repeated between neighbouring chunks. */
  chunkOverlap: number;
};

function createSplitter(source: string, { chunkSize, chunkOverlap }: ChunkOptions) {
  const options = { chunkSize, chunkOverlap, lengthFunction: countTokens };
  return source.toLowerCase().endsWith('.md')
    ? RecursiveCharacterTextSplitter.fromLanguage('markdown', options)
    : new RecursiveCharacterTextSplitter(options); // plain text: paragraphs, lines, words
}

export async function chunkDocuments(docs: SourceDocument[], options: ChunkOptions): Promise<Chunk[]> {
  const chunks: Chunk[] = [];

  for (const doc of docs) {
    const texts = await createSplitter(doc.source, options).splitText(doc.text);
    texts.forEach((text, i) => {
      chunks.push({ id: `${doc.source}#${i}`, source: doc.source, chunkIndex: i, text });
    });
  }

  return chunks;
}
