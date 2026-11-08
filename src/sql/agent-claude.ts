// The text-to-SQL tool loop with Claude.
//
// Written by hand so you can see how tool use works:
//   1. Send the question and the tool definition.
//   2. If Claude replies with tool_use blocks, run each query and send the
//      results back as tool_result blocks.
//   3. Repeat until Claude gives a final answer (stop_reason "end_turn").
// For real projects, the SDK's tool runner does this loop for you. It is
// still a beta feature (client.beta.messages.toolRunner).

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { SQL_PARAM_DESCRIPTION, SYSTEM_PROMPT, TOOL_DESCRIPTION, TOOL_NAME, executeRunSql, type Log } from './tool.ts';

const RUN_SQL_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: TOOL_DESCRIPTION,
  input_schema: {
    type: 'object',
    properties: { sql: { type: 'string', description: SQL_PARAM_DESCRIPTION } },
    required: ['sql'],
    additionalProperties: false,
  },
  strict: true, // the input always matches the schema above
};

export async function askClaude(question: string, log?: Log): Promise<string> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  for (let toolCalls = 0; ; ) {
    const response = await client.messages.create({
      model: config.llmModel,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { effort: config.llmEffort },
      tools: [RUN_SQL_TOOL],
      messages,
    });

    if (response.stop_reason === 'refusal') {
      return `(The model declined: ${response.stop_details?.explanation ?? 'no explanation given'})`;
    }

    // Always append Claude's whole reply (including any thinking blocks)
    // unchanged; the next request must contain it exactly as it was sent.
    messages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    }

    toolCalls += toolUses.length;
    if (toolCalls > config.sqlMaxToolCalls) return `(Stopped: more than ${config.sqlMaxToolCalls} queries.)`;

    // All results of one turn go back together in a single user message.
    const results: Anthropic.ToolResultBlockParam[] = toolUses.map((block) => {
      const { content, isError } = executeRunSql(block.input, log);
      return { type: 'tool_result', tool_use_id: block.id, content, is_error: isError };
    });
    messages.push({ role: 'user', content: results });
  }
}
