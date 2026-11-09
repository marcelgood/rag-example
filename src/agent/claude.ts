// The tool-use loop with Claude.
//
// Written by hand so you can see how tool use works:
//   1. Send the question and the tool definitions.
//   2. If Claude replies with tool_use blocks, run each call and send the
//      results back as tool_result blocks.
//   3. Repeat until Claude gives a final answer (stop_reason "end_turn").
// For real projects, the SDK's tool runner does this loop for you. It is
// still a beta feature (client.beta.messages.toolRunner).

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import type { Agent } from './types.ts';

export async function runWithClaude(agent: Agent, question: string): Promise<string> {
  const client = new Anthropic();
  const tools: Anthropic.Tool[] = agent.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
    ...(t.strict ? { strict: true } : {}),
  }));
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: question }];

  for (let toolCalls = 0; ; ) {
    const response = await client.messages.create({
      model: config.llmModel,
      max_tokens: 16000,
      system: agent.system,
      output_config: { effort: config.llmEffort },
      tools,
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
    if (toolCalls > config.maxToolCalls) return `(Stopped: more than ${config.maxToolCalls} tool calls.)`;

    // All results of one turn go back together in a single user message.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUses) {
      const { content, isError } = await agent.runTool(block.name, block.input);
      results.push({ type: 'tool_result', tool_use_id: block.id, content, is_error: isError });
    }
    messages.push({ role: 'user', content: results });
  }
}
