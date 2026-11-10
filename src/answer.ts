// STEP 6 — GENERATE
// Give the retrieved chunks to an LLM together with the question, and ask it
// to answer from those chunks only, citing which chunks it used.
// config.llmProvider picks the implementation.

import { config } from './config.ts';
import type { ChunkText } from './store.ts';

export type Source = {
  /** The number shown as [n] in the answer text. */
  n: number;
  source: string;
  chunkIndex: number;
  /** The exact passage quoted (Claude), or the start of the chunk (Ollama). */
  quote: string;
};

export type Answer = {
  text: string;
  sources: Source[];
  inputTokens: number;
  outputTokens: number;
};

export type AnswerFunction = (question: string, chunks: ChunkText[]) => Promise<Answer>;

export const SYSTEM_PROMPT = `You answer questions using only the documents provided with the question. \
They are excerpts retrieved from a company knowledge base and may not all be relevant. \
If the documents do not contain the answer, say that you could not find it rather than guessing. \
Keep answers short and direct.`;

export async function answerQuestion(question: string, chunks: ChunkText[]): Promise<Answer> {
  // Load the provider's module on demand. (A static import would be circular:
  // both provider modules import SYSTEM_PROMPT and the types from this file.)
  const { answer } =
    config.llmProvider === 'claude' ? await import('./answer-claude.ts') : await import('./answer-ollama.ts');
  return answer(question, chunks);
}
