// Run an agent with the LLM provider selected in config.ts.

import { config } from '../config.ts';
import type { Agent } from './types.ts';

export async function runAgent(agent: Agent, question: string): Promise<string> {
  const run =
    config.llmProvider === 'claude'
      ? (await import('./claude.ts')).runWithClaude
      : (await import('./ollama.ts')).runWithOllama;
  return run(agent, question);
}
