// STEP 3 — EMBED
// Turn each chunk of text into a vector (a list of numbers) that captures
// its meaning. Texts about similar things get vectors that point in similar
// directions, which is what makes "search by meaning" possible.
//
// This uses a small open model that runs locally on the CPU, so there is no
// API key and no cost. To use a hosted model instead (e.g. Voyage AI or
// OpenAI embeddings), replace only this file; the rest stays the same.

import {
  AutoTokenizer,
  pipeline,
  type FeatureExtractionPipeline,
  type PreTrainedTokenizer,
} from '@huggingface/transformers';
import { config } from './config.ts';

export type Vector = number[];

let tokenizerPromise: Promise<PreTrainedTokenizer> | undefined;

// Count tokens exactly as the embedding model sees them, including the
// special start/end tokens it adds. Used by the chunker so that no chunk is
// longer than the model can read.
export async function countTokens(text: string): Promise<number> {
  tokenizerPromise ??= AutoTokenizer.from_pretrained(config.embeddingModel);
  const tokenizer = await tokenizerPromise;
  return tokenizer.encode(text).length;
}

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  // Load the model once and reuse it.
  extractorPromise ??= pipeline('feature-extraction', config.embeddingModel, { dtype: 'fp32' });
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<Vector[]> {
  const extractor = await getExtractor();
  const vectors: Vector[] = [];

  for (let i = 0; i < texts.length; i += config.embedBatchSize) {
    const batch = texts.slice(i, i + config.embedBatchSize);
    // pooling: 'mean' averages the per-token vectors into one vector per text.
    // normalize: true scales each vector to length 1, so cosine similarity
    // becomes a simple dot product.
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    // A [batch, dims] tensor becomes one number[] per input text.
    vectors.push(...(output.tolist() as Vector[]));
  }

  return vectors;
}

export async function embedText(text: string): Promise<Vector> {
  const [vector] = await embedTexts([text]);
  if (!vector) throw new Error('Embedding model returned no vector');
  return vector;
}
