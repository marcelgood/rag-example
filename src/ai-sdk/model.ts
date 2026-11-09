// Part 5: the model, as the Vercel AI SDK sees it.
//
// The AI SDK separates the model from everything else. A provider package
// turns "which model" into a LanguageModel object; generateText and the rest
// of the code don't care which provider it came from. Switching between
// Claude and Ollama happens here and nowhere else.

import { anthropic } from '@ai-sdk/anthropic';
import { createOllama } from 'ai-sdk-ollama';
import type { LanguageModel } from 'ai';
import { config } from '../config.ts';

// Reads ANTHROPIC_API_KEY from the environment, like the Anthropic SDK does.
const claude = () => anthropic(config.llmModel);

// A community provider that talks to Ollama's own API (not its OpenAI-compatible
// one), so Ollama options such as the context window size can be passed.
const ollama = createOllama({ baseURL: config.ollamaHost });
const local = () => ollama(config.ollamaModel, { options: { num_ctx: config.ollamaContextTokens } });

export const languageModel = (): LanguageModel => (config.llmProvider === 'claude' ? claude() : local());
