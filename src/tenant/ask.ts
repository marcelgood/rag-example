// Part 6: ask a question about your company's sales data.
// Run with: npm run ask:tenant -- "your question"   (after npm run login)

import { modelLabel } from '../config.ts';
import { exitIfMissingCredentials, handleLlmError } from '../llm/errors.ts';
import { askAsUser } from './agent.ts';
import { AuthError, currentSession, getAccessToken } from './session.ts';

const question = process.argv.slice(2).join(' ');
if (!question) {
  console.error('Usage: npm run ask:tenant -- "your question"');
  process.exit(1);
}
exitIfMissingCredentials();

try {
  const { email } = currentSession();
  const accessToken = await getAccessToken();
  console.log(`Signed in as ${email}\nQuestion: ${question}\nAsking ${modelLabel()}...`);
  const started = Date.now();
  const answer = await askAsUser(question, accessToken, (line) => console.log(`\n${line}`));
  console.log(`\nAnswer:\n${answer.text}\n\n(${answer.steps} steps, ${((Date.now() - started) / 1000).toFixed(1)}s)`);
} catch (error) {
  if (error instanceof AuthError) {
    console.error(error.message);
    process.exitCode = 1;
  } else {
    handleLlmError(error);
  }
}
