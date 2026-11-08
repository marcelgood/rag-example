// Text-to-SQL: answer questions about the sales database.
// Run with: npm run ask:sql -- "your question"
//
// Retrieval here is a SQL query instead of a vector search. The model gets
// the schema and a run_sql tool. It decides which queries to run, sees the
// results, and answers from them. It may run several queries, e.g. one to
// look at the data and one for the real answer.

import { config } from '../config.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error('Usage: npm run ask:sql -- "your question"');
  process.exit(1);
}
exitIfMissingCredentials();

const model = config.llmProvider === 'claude' ? config.llmModel : `${config.ollamaModel} via Ollama`;
console.log(`Question: ${question}\nAsking ${model}...`);
const started = Date.now();

try {
  const answer =
    config.llmProvider === 'claude'
      ? await (await import('./agent-claude.ts')).askClaude(question)
      : await (await import('./agent-ollama.ts')).askOllama(question);
  console.log(`\nAnswer:\n${answer}\n\n(${((Date.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  handleLlmError(error);
}
