// The tool-use loop with a local model through Ollama.
//
//   1. Send the question and the tool definitions.
//   2. If the reply contains tool calls, run each one and send the results
//      back as messages with role 'tool'.
//   3. Repeat until the model answers without calling a tool.
//
// Ollama uses the OpenAI-style { type: 'function' } tool format. It has no
// strict mode, so the arguments may not match the schema; the tool checks them.

import type { Message, Tool } from 'ollama';
import { config } from '../config.ts';
import { ensureOllamaModel, ollama, ollamaChatOptions } from '../llm/ollama.ts';
import type { Agent } from './types.ts';

export async function runWithOllama(agent: Agent, question: string): Promise<string> {
  await ensureOllamaModel();
  const tools: Tool[] = agent.tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema as Tool['function']['parameters'] },
  }));
  const messages: Message[] = [
    { role: 'system', content: agent.system },
    { role: 'user', content: question },
  ];

  for (let toolCalls = 0; ; ) {
    const response = await ollama.chat({ ...ollamaChatOptions, messages, tools });
    messages.push(response.message);

    const calls = response.message.tool_calls ?? [];
    if (calls.length === 0) return response.message.content.trim();

    toolCalls += calls.length;
    if (toolCalls > config.maxToolCalls) return `(Stopped: more than ${config.maxToolCalls} tool calls.)`;

    for (const call of calls) {
      const outcome = await agent.runTool(call.function.name, call.function.arguments);
      messages.push({ role: 'tool', tool_name: call.function.name, content: outcome.content });
    }
  }
}
