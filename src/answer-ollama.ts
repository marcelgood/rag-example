// The answer step with a local model through Ollama.
//
// Open models have no built-in citation feature like Claude's. Instead we
// number the chunks in the prompt and ask the model to write [n] markers
// itself. That works, but small models sometimes forget the markers or cite
// the wrong number, so treat them as a hint and check the source.

import { ensureOllamaModel, ollama, ollamaChatOptions } from './llm/ollama.ts';
import { SYSTEM_PROMPT, type AnswerFunction, type Source } from './answer.ts';

const CITATION_INSTRUCTIONS = `The documents are numbered. After each statement, cite the \
documents it is based on as [1], [2] and so on. Only cite documents you actually used.`;

export const answer: AnswerFunction = async (question, chunks) => {
  await ensureOllamaModel();

  const documents = chunks
    .map((chunk, i) => `[${i + 1}] ${chunk.source} (chunk ${chunk.chunkIndex})\n${chunk.text}`)
    .join('\n\n');

  const response = await ollama.chat({
    ...ollamaChatOptions,
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n${CITATION_INSTRUCTIONS}` },
      // Documents first, question last.
      { role: 'user', content: `Documents:\n\n${documents}\n\nQuestion: ${question}` },
    ],
  });

  const text = response.message.content.trim();

  // Collect the [n] markers the model wrote, ignoring numbers that don't
  // match a document (small models sometimes invent them).
  const cited = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const sources: Source[] = [];
  for (const n of [...cited].sort((a, b) => a - b)) {
    const chunk = chunks[n - 1];
    if (chunk) sources.push({ n, source: chunk.source, chunkIndex: chunk.chunkIndex, quote: `${chunk.text.slice(0, 120)}…` });
  }

  return { text, sources, inputTokens: response.prompt_eval_count, outputTokens: response.eval_count };
};
