// Part 7: re-ranking with a cross-encoder.
//
// Vector search compares two vectors that were computed separately: one for
// the question, one for the chunk. That's fast, because the chunk vectors
// are computed once at ingestion, but the model never sees the question and
// the chunk together.
//
// A cross-encoder reads the question and one chunk together and scores how
// well the chunk answers the question. That's much more accurate, but it
// has to run once per (question, chunk) pair at question time, so it's only
// used to reorder a short list of candidates found by a fast search.
//
// The model here, ms-marco-MiniLM-L-6-v2, was trained on Bing search queries
// and the passages that answered them. It runs locally through Transformers.js.

import { AutoModelForSequenceClassification, AutoTokenizer, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import { BaseDocumentCompressor } from '@langchain/core/retrievers/document_compressors';
import type { DocumentInterface } from '@langchain/core/documents';
import { config } from './config.ts';

let modelPromise: Promise<[PreTrainedTokenizer, PreTrainedModel]> | undefined;

function loadModel() {
  modelPromise ??= Promise.all([
    AutoTokenizer.from_pretrained(config.rerankModel),
    AutoModelForSequenceClassification.from_pretrained(config.rerankModel, { dtype: 'fp32' }),
  ]);
  return modelPromise;
}

/** A relevance score per text: higher means a better answer to the query. */
export async function scorePairs(query: string, texts: string[]): Promise<number[]> {
  if (texts.length === 0) return [];
  const [tokenizer, model] = await loadModel();
  // Each input is the pair (query, text), read by the model as one sequence.
  const inputs = tokenizer(texts.map(() => query), { text_pair: texts, padding: true, truncation: true });
  const { logits } = await model(inputs);
  return (logits.tolist() as number[][]).map((row) => row[0]!);
}

/**
 * LangChain's hook for this step is a "document compressor": it receives the
 * retrieved documents and the query, and returns a shorter, better list.
 * ContextualCompressionRetriever (in retrieve.ts) runs it after the search.
 */
export class CrossEncoderReranker extends BaseDocumentCompressor {
  topN: number;

  constructor(topN: number) {
    super();
    this.topN = topN;
  }

  async compressDocuments(documents: DocumentInterface[], query: string): Promise<DocumentInterface[]> {
    const scores = await scorePairs(query, documents.map((d) => d.pageContent));
    return documents
      .map((doc, i) => ({ ...doc, metadata: { ...doc.metadata, score: scores[i]! } }))
      .sort((a, b) => b.metadata.score - a.metadata.score)
      .slice(0, this.topN);
  }
}
