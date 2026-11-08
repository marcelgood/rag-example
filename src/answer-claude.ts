// The answer step with Claude.
//
// Each chunk is passed as a "document" content block with citations enabled.
// Claude then marks which passages of which document support each part of
// its answer, so you can show sources and check the answer yourself.

import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.ts';
import { SYSTEM_PROMPT, type Answer, type AnswerFunction, type Source } from './answer.ts';
import type { SearchResult } from './store.ts';

// Reads ANTHROPIC_API_KEY from the environment (npm run ask loads .env).
const client = new Anthropic();

export const answer: AnswerFunction = async (question, chunks) => {
  const documents: Anthropic.DocumentBlockParam[] = chunks.map((chunk) => ({
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: chunk.text },
    title: `${chunk.source} (chunk ${chunk.chunkIndex})`,
    citations: { enabled: true },
  }));

  const response = await client.messages.create({
    model: config.llmModel,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { effort: config.llmEffort },
    messages: [
      {
        role: 'user',
        // Documents first, question last.
        content: [...documents, { type: 'text', text: question }],
      },
    ],
  });

  const tokens = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };

  // A safety classifier can occasionally decline a request, even a harmless one.
  if (response.stop_reason === 'refusal') {
    const reason = response.stop_details?.explanation ?? 'no explanation given';
    return { text: `(The model declined to answer: ${reason})`, sources: [], ...tokens };
  }

  return { ...formatWithCitations(response.content, chunks), ...tokens };
};

// Turn Claude's answer into plain text with [1], [2] markers, plus a list of
// the sources those numbers refer to.
function formatWithCitations(
  content: Anthropic.ContentBlock[],
  chunks: SearchResult[],
): Pick<Answer, 'text' | 'sources'> {
  const numberByDoc = new Map<number, number>(); // document_index -> citation number
  const sources: Source[] = [];
  let text = '';

  for (const block of content) {
    // Other block types (e.g. thinking) are not part of the visible answer.
    if (block.type !== 'text') continue;
    text += block.text;

    const markers = new Set<number>();
    for (const citation of block.citations ?? []) {
      // Plain-text documents are cited by character range.
      if (citation.type !== 'char_location') continue;
      const docIndex = citation.document_index;
      const chunk = chunks[docIndex];
      if (!chunk) continue;

      let n = numberByDoc.get(docIndex);
      if (n === undefined) {
        n = numberByDoc.size + 1;
        numberByDoc.set(docIndex, n);
        sources.push({ n, source: chunk.source, chunkIndex: chunk.chunkIndex, quote: citation.cited_text });
      }
      markers.add(n);
    }
    if (markers.size) text += [...markers].map((n) => `[${n}]`).join('');
  }

  return { text: text.trim(), sources };
}
