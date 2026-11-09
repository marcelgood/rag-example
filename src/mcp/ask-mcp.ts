// Part 4: answer questions about the sales database through an MCP server.
// Run with: npm run ask:mcp -- "your question"
//
// Same agent loop as Part 2 (npm run ask:sql), but the tools come from the
// MCP server in server.ts instead of run_sql in this process.

import { modelLabel } from '../config.ts';
import { runAgent } from '../agent/run.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { connectToSalesServer } from './client.ts';

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error('Usage: npm run ask:mcp -- "your question"');
  process.exit(1);
}
exitIfMissingCredentials();

const connection = await connectToSalesServer();
const agent = connection.createAgent();
console.log(`Connected to the MCP server. Tools: ${agent.tools.map((t) => t.name).join(', ')}`);
console.log(`Question: ${question}\nAsking ${modelLabel()}...`);
const started = Date.now();

try {
  const answer = await runAgent(agent, question);
  console.log(`\nAnswer:\n${answer}\n\n(${((Date.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  handleLlmError(error);
} finally {
  await connection.close();
}
