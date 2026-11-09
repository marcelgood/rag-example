// Part 5: the tool-use loop, done by the Vercel AI SDK.
//
// This file replaces both hand-written loops (src/agent/claude.ts and
// src/agent/ollama.ts). Compare them: the loop, the message bookkeeping, and
// the provider-specific tool formats are all gone. What's left is turning
// our tools into AI SDK tools and one call to generateText.
//
// It takes the same Agent as the hand-written loops, so the Part 2 (run_sql)
// and Part 4 (MCP) agents run unchanged. Select it in config.ts with
// agentLoop: 'ai-sdk'.

import { generateText, isStepCount, jsonSchema, tool, type ToolSet } from 'ai';
import { config } from '../config.ts';
import { ensureOllamaModel } from '../llm/ollama.ts';
import type { Agent } from '../agent/types.ts';
import { languageModel } from './model.ts';

export async function runWithAiSdk(agent: Agent, question: string): Promise<string> {
  if (config.llmProvider === 'ollama') await ensureOllamaModel(); // friendly setup errors

  // Each tool becomes an AI SDK tool: the same name, description and JSON
  // Schema, plus an execute function the SDK calls when the model uses it.
  const tools: ToolSet = Object.fromEntries(
    agent.tools.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema),
        strict: t.strict,
        execute: async (input) => {
          const { content, isError } = await agent.runTool(t.name, input);
          // A thrown error goes back to the model as a tool error, so it can
          // correct itself, like is_error in the hand-written loops.
          if (isError) throw new Error(content);
          return content;
        },
      }),
    ]),
  );

  const result = await generateText({
    model: languageModel(),
    system: agent.system,
    prompt: question,
    tools,
    // Keep calling the model while it asks for tools, for at most this many
    // steps. A step is one model call plus the tools it asked for.
    stopWhen: isStepCount(config.maxToolCalls),
    // Portable reasoning setting; the Anthropic provider maps it to effort.
    // The local instruct model has no setting for it, so it's left out there.
    ...(config.llmProvider === 'claude' ? { reasoning: config.llmEffort } : {}),
  });

  // The loop stopped at the step limit while the model still wanted tools.
  if (result.finishReason === 'tool-calls') return `(Stopped: more than ${config.maxToolCalls} steps.)`;
  return result.text.trim();
}
