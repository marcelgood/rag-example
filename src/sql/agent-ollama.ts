// The text-to-SQL tool loop with a local model through Ollama.
//
// Same idea as the Claude version, different message format:
//  - the tool is described in the OpenAI-style { type: 'function' } format,
//  - tool calls arrive in message.tool_calls,
//  - each result goes back as a message with role 'tool'.
// Ollama has no strict mode, so the arguments may not match the schema;
// executeRunSql checks them.

import type { Message, Tool } from 'ollama';
import { config } from '../config.ts';
import { ensureOllamaModel, ollama, ollamaChatOptions } from '../llm/ollama.ts';
import { SQL_PARAM_DESCRIPTION, SYSTEM_PROMPT, TOOL_DESCRIPTION, TOOL_NAME, executeRunSql, type Log } from './tool.ts';

const RUN_SQL_TOOL: Tool = {
  type: 'function',
  function: {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: {
      type: 'object',
      properties: { sql: { type: 'string', description: SQL_PARAM_DESCRIPTION } },
      required: ['sql'],
    },
  },
};

export async function askOllama(question: string, log?: Log): Promise<string> {
  await ensureOllamaModel();
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: question },
  ];

  for (let toolCalls = 0; ; ) {
    const response = await ollama.chat({ ...ollamaChatOptions, messages, tools: [RUN_SQL_TOOL] });
    messages.push(response.message);

    const calls = response.message.tool_calls ?? [];
    if (calls.length === 0) return response.message.content.trim();

    toolCalls += calls.length;
    if (toolCalls > config.sqlMaxToolCalls) return `(Stopped: more than ${config.sqlMaxToolCalls} queries.)`;

    for (const call of calls) {
      const outcome =
        call.function.name === TOOL_NAME
          ? executeRunSql(call.function.arguments, log)
          : { content: `Error: unknown tool "${call.function.name}".`, isError: true };
      messages.push({ role: 'tool', tool_name: call.function.name, content: outcome.content });
    }
  }
}
