// Shared Ollama client. Ollama runs models locally and serves them over HTTP
// on port 11434; the `ollama` package is a thin client for that API.

import { Ollama } from 'ollama';
import { config } from '../config.ts';

export const ollama = new Ollama({ host: config.ollamaHost });

/** Ollama is not running, or the model is not downloaded. */
export class OllamaSetupError extends Error {}

/** Check that Ollama is running and the configured model is downloaded. */
export async function ensureOllamaModel(): Promise<void> {
  let installed: string[];
  try {
    installed = (await ollama.list()).models.map((m) => m.name);
  } catch {
    throw new OllamaSetupError(`Can't reach Ollama at ${config.ollamaHost}. Is it installed and running?`);
  }
  const wanted = config.ollamaModel.includes(':') ? config.ollamaModel : `${config.ollamaModel}:latest`;
  if (!installed.includes(wanted)) {
    throw new OllamaSetupError(`Model "${config.ollamaModel}" is not downloaded. Run: ollama pull ${config.ollamaModel}`);
  }
}

/** Options used for every Ollama chat request. */
export const ollamaChatOptions = {
  model: config.ollamaModel,
  options: { num_ctx: config.ollamaContextTokens },
};
