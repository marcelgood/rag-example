// Part 7: retrieval with LangChain — vector, keyword, hybrid and re-ranked.
//
// Each search is wrapped as a LangChain retriever: an object with
// invoke(query) that returns Documents. Retrievers compose, which is what
// LangChain is good at:
//
//   vector ─┐
//           ├─ EnsembleRetriever (reciprocal rank fusion) ── hybrid
//   keyword ┘
//   any retriever ── ContextualCompressionRetriever(CrossEncoderReranker) ── re-ranked
//
// The searches themselves run in LanceDB: vector search over the embeddings,
// and BM25 over the full-text index created at ingestion.

import { ContextualCompressionRetriever } from '@langchain/classic/retrievers/contextual_compression';
import { EnsembleRetriever } from '@langchain/classic/retrievers/ensemble';
import { Document } from '@langchain/core/documents';
import { BaseRetriever } from '@langchain/core/retrievers';
import { config } from './config.ts';
import { embedText } from './embed.ts';
import { CrossEncoderReranker } from './rerank.ts';
import { searchChunks, searchKeywords, type ChunkText } from './store.ts';

export type RetrievalMethod = typeof config.retrievalMethod;

/** A retrieved chunk, with the score of the last step that ordered it (if that step has one). */
export type RetrievedChunk = ChunkText & { score?: number };

/** What the score means, for display. */
export const SCORE_LABELS: Record<RetrievalMethod, string | undefined> = {
  vector: 'similarity',
  keyword: 'BM25',
  hybrid: undefined, // rank fusion orders by rank, not by a score
  'vector-rerank': 'relevance',
  'hybrid-rerank': 'relevance',
};

const toDocument = (chunk: ChunkText, score: number) =>
  new Document({ pageContent: chunk.text, metadata: { source: chunk.source, chunkIndex: chunk.chunkIndex, score } });

/** Search by meaning: the chunks whose embeddings are closest to the query's. */
class VectorRetriever extends BaseRetriever {
  lc_namespace = ['rag', 'retrievers'];
  k: number;
  constructor(k: number) {
    super();
    this.k = k;
  }
  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const rows = await searchChunks(await embedText(query), this.k);
    return rows.map((row) => toDocument(row, 1 - row._distance));
  }
}

/** Search by words: BM25 over LanceDB's full-text index. */
class KeywordRetriever extends BaseRetriever {
  lc_namespace = ['rag', 'retrievers'];
  k: number;
  constructor(k: number) {
    super();
    this.k = k;
  }
  async _getRelevantDocuments(query: string): Promise<Document[]> {
    const rows = await searchKeywords(query, this.k);
    return rows.map((row) => toDocument(row, row._score));
  }
}

function createRetriever(method: RetrievalMethod, k: number): BaseRetriever {
  const candidates = Math.max(k, config.retrievalCandidates);
  const vector = new VectorRetriever(candidates);
  const keyword = new KeywordRetriever(candidates);
  // Reciprocal rank fusion: each chunk scores 1 / (60 + rank) in each list,
  // weighted, and the sums decide the order. It uses only the ranks, so it
  // doesn't matter that similarity and BM25 scores are on different scales.
  const hybrid = () => new EnsembleRetriever({ retrievers: [vector, keyword], weights: [...config.hybridWeights] });
  const reranked = (base: BaseRetriever) =>
    new ContextualCompressionRetriever({ baseRetriever: base, baseCompressor: new CrossEncoderReranker(k) });

  switch (method) {
    case 'vector':
      return new VectorRetriever(k);
    case 'keyword':
      return new KeywordRetriever(k);
    case 'hybrid':
      return hybrid();
    case 'vector-rerank':
      return reranked(vector);
    case 'hybrid-rerank':
      return reranked(hybrid());
  }
}

export const RETRIEVAL_METHODS = Object.keys(SCORE_LABELS) as RetrievalMethod[];

/**
 * Split command-line arguments into an optional `--method <name>` and the
 * rest (the question). Without the option, the method from config.ts is used.
 */
export function parseMethodArgs(args: string[]): { method: RetrievalMethod; rest: string[] } {
  const index = args.indexOf('--method');
  if (index < 0) return { method: config.retrievalMethod, rest: args };
  const method = args[index + 1] as RetrievalMethod;
  if (!RETRIEVAL_METHODS.includes(method)) {
    console.error(`Unknown retrieval method "${method ?? ''}". Choose one of: ${RETRIEVAL_METHODS.join(', ')}.`);
    process.exit(1);
  }
  return { method, rest: args.filter((_, i) => i !== index && i !== index + 1) };
}

/** The k chunks that best match the question, found with the given method. */
export async function retrieve(question: string, k: number = config.topK, method: RetrievalMethod = config.retrievalMethod): Promise<RetrievedChunk[]> {
  const documents = await createRetriever(method, k).invoke(question);
  return documents.slice(0, k).map((doc) => ({
    source: doc.metadata.source as string,
    chunkIndex: doc.metadata.chunkIndex as number,
    text: doc.pageContent,
    score: SCORE_LABELS[method] ? (doc.metadata.score as number) : undefined,
  }));
}
