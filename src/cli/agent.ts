// The `agent` command: one entry point for everything in this project.
//
//   npx agent ask "How many vacation days do I get?"
//   npx agent ask --sql "Which customers have overdue invoices?"
//
// Run it from the project folder with npx, which finds it through "bin" in
// package.json. It's a thin dispatcher:
// each command runs the same script as the matching `npm run` script, which
// keep working too.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// The project folder. Paths in src/config.ts are relative to it, so run from
// there whatever folder the command was started in.
const ROOT = path.resolve(import.meta.dirname, '../..');
process.chdir(ROOT);
// What `node --env-file-if-exists=.env` does for the npm scripts: the API key.
if (existsSync('.env')) process.loadEnvFile('.env');

const HELP = `Usage: npx agent <command> [options]   (from the project folder)

Documents (Part 1)
  npx agent ingest                     Read data/ into the vector database
  npx agent search <query>             Show the chunks most similar to a query (no LLM)
  npx agent ask <question>             Answer a question from the documents

Sales database (Parts 2, 4 and 5)
  npx agent seed                       Create the sample sales database
  npx agent ask --sql <question>       The model writes SQL (Part 2)
  npx agent ask --mcp <question>       The model uses the MCP server's tools (Part 4)
  npx agent ask --ai-sdk <question>    Part 4 written with the Vercel AI SDK (Part 5)
  npx agent serve mcp                  Run the MCP server on stdio, for other MCP clients

Signed-in users and tenants (Part 6)
  npx agent seed --tenants             Create the multi-tenant database and test users
  npx agent serve tenant               Start the auth server and the MCP server
  npx agent login <email>              Sign in (asks for the password)
  npx agent whoami                     Show who is signed in
  npx agent ask --tenant <question>    Ask about your company's sales data
  npx agent logout                     Sign out

Evals (Part 3)
  npx agent eval [suite] [--only <case-id>]
      docs (default)   document questions: retrieval and answers
      retrieval        retrieval only, no LLM
      sql | mcp        database questions with run_sql or with the MCP tools
      tenant           security checks and questions as users of both tenants
      security         the tenant security checks only, no LLM

The LLM is chosen in src/config.ts (llmProvider).`;

/** Run one of the project's scripts as if it had been started with `node <script> <args>`. */
async function run(script: string, args: string[] = []): Promise<void> {
  const file = path.join(ROOT, script);
  process.argv = [process.argv[0]!, file, ...args];
  await import(pathToFileURL(file).href);
}

function fail(message: string): never {
  console.error(`${message}\nRun "npx agent help" for the list of commands.`);
  process.exit(1);
}

/** Split arguments into known --flags and the rest (the question). */
function takeFlags(args: string[], known: string[]) {
  const flags = args.filter((a) => known.includes(a));
  const unknown = args.filter((a) => a.startsWith('--') && !known.includes(a));
  if (unknown.length) fail(`Unknown option ${unknown[0]}.`);
  return { flags, text: args.filter((a) => !known.includes(a)).join(' ').trim() };
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'ingest':
    await run('src/ingest.ts');
    break;

  case 'search': {
    if (!args.length) fail('Usage: npx agent search <query>');
    await run('src/search.ts', args);
    break;
  }

  case 'ask': {
    const ASK_SCRIPTS: Record<string, string> = {
      '--sql': 'src/sql/ask-sql.ts',
      '--mcp': 'src/mcp/ask-mcp.ts',
      '--ai-sdk': 'src/ai-sdk/ask-mcp.ts',
      '--tenant': 'src/tenant/ask.ts',
    };
    const { flags, text } = takeFlags(args, Object.keys(ASK_SCRIPTS));
    if (flags.length > 1) fail(`Choose one of ${flags.join(', ')}.`);
    if (!text) fail('Usage: npx agent ask [--sql | --mcp | --ai-sdk | --tenant] <question>');
    await run(flags[0] ? ASK_SCRIPTS[flags[0]]! : 'src/ask.ts', [text]);
    break;
  }

  case 'seed': {
    const { flags, text } = takeFlags(args, ['--tenants']);
    if (text) fail('Usage: npx agent seed [--tenants]');
    await run(flags.length ? 'src/tenant/seed.ts' : 'src/sql/seed.ts');
    break;
  }

  case 'eval': {
    const suite = args[0] && !args[0].startsWith('--') ? args.shift()! : 'docs';
    const EVALS: Record<string, [script: string, flags: string[]]> = {
      docs: ['src/eval/eval-docs.ts', []],
      retrieval: ['src/eval/eval-docs.ts', ['--retrieval-only']],
      sql: ['src/eval/eval-sql.ts', []],
      mcp: ['src/eval/eval-sql.ts', ['--mcp']],
      tenant: ['src/eval/eval-tenant.ts', []],
      security: ['src/eval/eval-tenant.ts', ['--security-only']],
    };
    const evalRun = EVALS[suite];
    if (!evalRun) fail(`Unknown eval suite "${suite}". Choose one of: ${Object.keys(EVALS).join(', ')}.`);
    const [script, flags] = evalRun;
    await run(script, [...flags, ...args]); // passes --only <case-id> through
    break;
  }

  case 'serve': {
    if (args[0] === 'mcp') await run('src/mcp/server.ts');
    else if (args[0] === 'tenant') await run('src/tenant/start-servers.ts');
    else fail('Usage: npx agent serve mcp | npx agent serve tenant');
    break;
  }

  case 'login': {
    if (args.length !== 1) fail('Usage: npx agent login <email>');
    await run('src/tenant/login.ts', args);
    break;
  }

  case 'logout':
    await run('src/tenant/logout.ts');
    break;

  case 'whoami': {
    const { AuthError, currentSession } = await import('../tenant/session.ts');
    try {
      console.log(`Signed in as ${currentSession().email}`);
    } catch (error) {
      if (!(error instanceof AuthError)) throw error;
      console.log(error.message);
    }
    break;
  }

  case undefined:
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;

  default:
    fail(`Unknown command "${command}".`);
}
