// Friendly messages for the setup problems people hit most often,
// shared by `npm run ask` and `npm run ask:sql`.

import Anthropic from '@anthropic-ai/sdk';
import { APICallError, RetryError } from 'ai';
import { config } from '../config.ts';
import { OllamaSetupError } from './ollama.ts';

/** Exit early with a hint if the selected provider has no credentials. */
export function exitIfMissingCredentials(): void {
  if (config.llmProvider !== 'claude') return;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.error('No ANTHROPIC_API_KEY found. Copy .env.example to .env and put your key in it,');
    console.error("or set llmProvider to 'ollama' in src/config.ts to use a free local model.");
    process.exit(1);
  }
}

/** A readable message for a known LLM error, or undefined for anything else. */
export function describeLlmError(error: unknown): string | undefined {
  if (error instanceof OllamaSetupError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) return 'Authentication failed. Check the key in your .env file.';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a moment and try again.';
  if (error instanceof Anthropic.APIError) return `API error ${error.status}: ${error.message}`;
  // The same failures through the Vercel AI SDK (Part 5). It retries failed
  // calls first, then throws a RetryError wrapping the last one.
  const aiError = RetryError.isInstance(error) ? error.lastError : error;
  if (APICallError.isInstance(aiError)) {
    if (aiError.statusCode === 401) return 'Authentication failed. Check the key in your .env file.';
    return `API error ${aiError.statusCode ?? ''}: ${aiError.message}`;
  }
  if (config.llmProvider === 'ollama' && error instanceof Error) return `Ollama error: ${error.message}`;
  return undefined;
}

/** Print a known LLM error and set a failing exit code; rethrow anything else. */
export function handleLlmError(error: unknown): void {
  const message = describeLlmError(error);
  if (message === undefined) throw error;
  console.error(`\n${message}`);
  process.exitCode = 1;
}
