// Run an agent with the loop and LLM provider selected in config.ts.

import { config } from '../config.ts';
import type { Agent } from './types.ts';

export async function runAgent(agent: Agent, question: string): Promise<string> {
  let run: (agent: Agent, question: string) => Promise<string>;
  if (config.agentLoop === 'ai-sdk') run = (await import('../ai-sdk/run.ts')).runWithAiSdk;
  else if (config.llmProvider === 'claude') run = (await import('./claude.ts')).runWithClaude;
  else run = (await import('./ollama.ts')).runWithOllama;
  return run(agent, question);
}
