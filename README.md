# RAG example in Node.js

A small, readable example of Retrieval-Augmented Generation (RAG): an **ingestion pipeline** that turns documents into searchable vectors, and a **query pipeline** that answers questions from them with an LLM, citing its sources. Part 2 does the same for a relational database (text-to-SQL), Part 3 measures answer quality with evals, and Part 4 moves the database tools into an MCP server.

The LLM is either a free local model through [Ollama](https://ollama.com) or Claude through the API. Set `llmProvider` in `src/config.ts`.

## How RAG works

```
INGESTION (offline, run when documents change)           npm run ingest
  data/*.md, *.txt → load → chunk → embed → store in LanceDB

QUERY (online, per question)                             npm run ask -- "..."
  question → embed → vector search (top-k chunks) → LLM answers from those chunks → answer + citations
```

An LLM only knows its training data. RAG looks up the relevant pieces of *your* documents at question time and puts them in the prompt, so the model answers from them and can cite them.

## The pieces

| Piece | Choice here | Why |
|---|---|---|
| Runtime | Node.js 26 LTS (`.node-version`, used by nvs) | Runs TypeScript files directly by stripping the types, so there is no build step. |
| Language | TypeScript 7 | `tsc` only type-checks (`npm run typecheck`); it never writes JavaScript files. |
| Chunking | `@langchain/textsplitters` | Well-tested recursive splitting with Markdown presets. Only this package is used, not the rest of LangChain. |
| Embedding model | `Xenova/all-MiniLM-L6-v2` via Transformers.js | Runs locally on CPU. No API key, no cost. 384-dim vectors. |
| Vector database | LanceDB (embedded) | A folder on disk (`.lancedb/`). No server or Docker needed. |
| LLM, local (default) | `qwen3:4b-instruct` via Ollama | Free and offline. A 4B model: fine for simple questions, weaker on hard ones. |
| LLM, hosted | Claude Opus 5.5 via `@anthropic-ai/sdk` | Much stronger, with built-in citations. Needs an API key with credits. |

You can swap each one out separately. Use a hosted embedding API by changing only `src/embed.ts`, or a server database (pgvector, Qdrant, Chroma) by changing only `src/store.ts`.

## Files

- `src/config.ts`: all settings (chunk size, models, LLM provider, paths)
- `src/load.ts`: step 1, read files and keep their source path as metadata
- `src/chunk.ts`: step 2, LangChain's recursive splitter (Markdown-aware for `.md`), sized in embedding-model tokens
- `src/embed.ts`: step 3, text → normalized vectors
- `src/store.ts`: step 4, write to LanceDB and run vector search
- `src/ingest.ts`: runs steps 1–4
- `src/search.ts`: retrieval-only check (no LLM)
- `src/answer.ts`: step 6, picks the provider; `answer-ollama.ts` and `answer-claude.ts` do the actual call
- `src/ask.ts`: runs the query pipeline (embed question → retrieve → answer)
- `src/llm/`: the shared Ollama client and error messages
- `data/`: sample documents about a fictional company, so answers can't come from the LLM's own knowledge

## Setup

```bash
npm install
npm run typecheck
npm run ingest
npm run search -- "How many vacation days do I get?"
```

**Local LLM (default):** install Ollama from [ollama.com/download](https://ollama.com/download), then download the model (2.5 GB):

```bash
ollama pull qwen3:4b-instruct
```

**Claude instead:** set `llmProvider: 'claude'` in `src/config.ts`, copy `.env.example` to `.env`, and put your Anthropic API key in it (`.env` is git-ignored). With Opus 5.5 a document question costs about 1 cent. Setting `llmModel` to `claude-haiku-5-5` makes it about 25 times cheaper.

## Ask questions

```bash
npm run ask -- "Who gets paged if the on-call engineer doesn't respond?"
```

The output shows which chunks were retrieved, the answer with `[1]`-style markers, what each number refers to, the token count and the time taken.

The citations work differently per provider. Claude has a built-in citation feature that returns the exact passage behind each statement. Open models don't, so `answer-ollama.ts` numbers the chunks in the prompt and asks the model to write the markers itself. Small models sometimes forget them or pick the wrong number.

Add your own `.md`/`.txt` files to `data/` and run `npm run ingest` again. Each run rebuilds the table from scratch.

## Things to try

- Change `chunkSize` / `chunkOverlap` in `src/config.ts`, re-ingest, and see how the search results change.
- Ask questions that use different words from the documents ("time off" vs. "vacation"). Embeddings match by meaning, not by keyword.
- Note that the best chunk isn't always ranked first. That's why RAG gives the LLM the top few chunks, not just one.
- Ask something the documents don't cover ("What is the CEO's name?"). The model should say it couldn't find it instead of inventing an answer. Small local models fail this more often.
- Set `topK` to 1 in `src/config.ts` and ask the questions again to see what happens when retrieval misses the right chunk.
- Ask the same questions with Ollama and with Claude, and compare.

## Part 2: questions over a relational database (text-to-SQL)

Vector search finds the few most *similar* pieces of text. It can't count, add up or find *every* matching row, so it can't answer "What was our revenue in Spain?". For structured data, retrieval is a SQL query instead:

```
question → LLM writes SQL from the schema → run it read-only → LLM answers from the rows
```

The model gets the schema and a `run_sql` tool, and decides which queries to run. It may run more than one, for example to check what values a column holds before writing the real query.

```bash
npm run db:seed
npm run ask:sql -- "Which customers have overdue invoices, and how much do they owe?"
```

Every query the model runs is printed, so you can check its SQL.

| File | What it does |
|---|---|
| `db/schema.sql` | The tables. Its comments are also sent to the model as column descriptions, which is the biggest factor in query accuracy. |
| `src/sql/seed.ts` | Creates `db/larkspur.db` with made-up customers and orders, using Node's built-in `node:sqlite`. |
| `src/sql/database.ts` | Runs the model's SQL safely: read-only connection, an authorizer that only allows reads (no writes, `ATTACH` or `PRAGMA`), and a row limit. |
| `src/sql/tool.ts` | The system prompt, the `run_sql` tool definition, and running one tool call (including checking its arguments). |
| `src/agent/ollama.ts`, `claude.ts` | The tool-use loop for each provider, written by hand to show how it works. Same idea, different message formats. Shared with Part 4. |
| `src/sql/ask-sql.ts` | The command line entry point. |

Things to try:

- Questions that need joins and aggregation: "Revenue per country in 2025, paid orders only", "Which customer bought the most sensors?"
- Ambiguous questions ("How are sales going?") and see which assumptions the model states.
- Remove a comment from `db/schema.sql`, such as the explanation of order statuses, and ask about "unpaid invoices" again.
- Ask it to change data ("Mark order 5 as paid"). The authorizer blocks the write, even if the model tries.

## Part 3: evaluating answer quality (evals)

Trying a few questions by hand tells you little: an LLM can answer one question well and the next one badly, and a change that fixes one answer can quietly break another. An **eval** is a fixed set of test questions with a definition of "correct" for each, run automatically. It turns "seems better" into a number you can compare before and after a change.

```bash
npm run eval:retrieval   # retrieval only, no LLM, a few seconds
npm run eval             # document questions: retrieval + answers
npm run eval:sql         # database questions
```

Each run prints a line per question (✓ or ✗ with the reason), a summary, and saves everything (questions, answers, retrieved chunks, checks) to `evals/results/` as JSON, so you can read failed answers and compare runs.

### The three parts of an eval

1. **Test cases** (`evals/*.json`): realistic questions, including ones the data can't answer and ones that try to trick the model. 15–30 good cases go a long way; add a case every time you find a bad answer.
2. **Graders** (`src/eval/checks.ts`): code that decides pass or fail. Here they're simple text checks: does the answer mention "27"? Does it cite the right document? Does it say it couldn't find the answer?
3. **A runner** (`src/eval/eval-docs.ts`, `eval-sql.ts`): runs the real pipeline on every case, applies the graders and adds up the results.

### What gets measured

**Documents:** retrieval and the answer are graded separately, because they fail for different reasons and are fixed in different places.

| Measure | Meaning | If it's low, change |
|---|---|---|
| hit@1, hit@5 | Share of questions where the passage with the answer was the 1st chunk / in the top 5 | `chunkSize`, `chunkOverlap`, embedding model |
| MRR | Average of 1/rank (1st = 1, 2nd = 0.5, missed = 0) | the same |
| mentions the expected facts | The answer contains the facts in `mustInclude` | prompt, model |
| cites the right document | At least one citation points to the expected file | prompt, model |
| says it could not find the answer | For unanswerable questions: no invented answer | prompt (`SYSTEM_PROMPT` in `src/answer.ts`), model |

**Database:** each case has a `referenceSql` query that a human wrote and checked. The eval runs it and checks that every value in its result (names, amounts, counts) appears in the model's answer. The right answers therefore come from the data, not from the test file. Only the answer is graded, not the model's SQL, because many different queries are correct.

### How to use it

1. Run the eval and note the score (the baseline).
2. Change one thing: the prompt, `topK`, `chunkSize`, the model, or `llmProvider`.
3. Run it again and compare. Read the failed answers in the JSON report, not just the score.

Keep in mind:

- **Results vary between runs.** The same model can pass a question once and fail it the next time. With 15 cases, one question is almost 7%, so don't trust a difference of one or two cases. Run twice when it matters.
- **The graders can be wrong too.** A ✗ can mean the answer said "four weeks" where the check wanted "28 days". Read the answer before blaming the model, and add the wording to the case if it was fine.
- **The checks are lenient on extra content.** An answer that lists the right customers plus a wrong one still passes `containsValues`. Add `mustNotInclude` for mistakes you've seen.

### Next step: an LLM as the grader

Text checks can't judge an open answer like "Summarize the remote work policy". For those, the usual approach is **LLM-as-judge**: a second model gets the question, the retrieved chunks, the answer and a short rubric, and returns pass or fail with a reason. Typical rubric questions:

- **Correct:** does the answer agree with a reference answer?
- **Faithful (grounded):** is every statement supported by the retrieved chunks? This catches invented details.
- **Relevant:** does it answer the question that was asked?

A judge should be at least as strong as the model being graded, and you should check its verdicts against your own on a few cases before trusting it. A 4B local model is not a reliable judge; Claude is.

## Part 4: the database tools as an MCP server

In Part 2 the `run_sql` tool is a function in the same Node process as the agent. The [Model Context Protocol](https://modelcontextprotocol.io) (MCP) moves tools into a separate program, an **MCP server**, that any MCP client can use: this project's agent, Claude Code, Claude Desktop, and others.

```
agent (MCP client) ── starts ──▶ src/mcp/server.ts (MCP server) ──▶ db/larkspur.db
        │   ◀── listTools: names, descriptions, JSON Schemas ──┘
        └── callTool("sales_summary", {groupBy: "country", status: "paid", year: 2025}) ──▶ rows as JSON
```

The model loop doesn't change; only where the tools come from does. The client in `src/mcp/client.ts` contains no tool names, schemas or SQL: it asks the server at runtime.

### Purpose-built tools instead of SQL

The server doesn't take SQL. It offers four tools that match the business, each with typed parameters:

| Tool | What it does |
|---|---|
| `sales_summary` | Totals and order counts, optionally grouped by country, customer, product, month or status, and filtered by status, year, product, country |
| `list_orders` | Individual orders with customer, date, status and amount |
| `get_order` | One order with its line items |
| `list_customers` | Customers with country, region and sign-up date |

The SQL is written in the server, and the model's values only go in as `?` parameters, so the model can't change what a query does. Invalid arguments (an unknown `groupBy`, a year as text) are rejected by the schema before any code runs.

| | Part 2: `run_sql` | Part 4: purpose-built tools |
|---|---|---|
| Questions it can answer | Anything the schema allows | Only what the tools were designed for |
| Safety | Needs a read-only connection, an authorizer and a row limit | Safe by design: no model-written SQL |
| What the model must do | Write correct SQL | Pick a tool and fill in a few fields |
| Typical use | Analysts exploring data | Production apps and shared MCP servers |

### Run it

```bash
npm run ask:mcp -- "What was the revenue per country in 2025?"
npm run eval:mcp
```

`eval:mcp` runs the same questions as `eval:sql` (`evals/sql-cases.json`), so you can compare the two approaches directly.

| File | What it does |
|---|---|
| `src/mcp/server.ts` | The MCP server: the four tools (Zod schemas, fixed SQL) and server instructions such as "revenue means paid orders" |
| `src/mcp/client.ts` | Starts the server, lists its tools, puts its instructions in the system prompt, forwards tool calls |
| `src/mcp/ask-mcp.ts` | The command line entry point |
| `src/agent/` | The tool-use loops, shared with Part 2 |

Uses the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server` and `@modelcontextprotocol/client`), with stdio as the transport: the client starts the server as a child process and they exchange JSON-RPC messages over stdin and stdout. That is also why the server must never write to stdout with `console.log`.


### What the eval showed

The first version made `groupBy` and `status` optional. The local model scored 7/9: it summed every status when asked for revenue, and returned one grand total when asked which customers owe money. Making both parameters required, so the model must choose explicitly, raised it to 9/9 in two runs in a row. Tool design is prompt design: names, descriptions and which fields are required matter as much as the system prompt.

### Use the server from Claude Code

Because it's a standard MCP server, other MCP clients can use it too. To add it to Claude Code (use the full path to Node 26, since the server is TypeScript run directly by Node):

```bash
claude mcp add larkspur-sales -- "C:/Users/<you>/AppData/Local/nvs/node/26.13.0/x64/node.exe" "C:/Workspace/AI/RAG/src/mcp/server.ts"
```

Then ask Claude Code something like "Using the larkspur-sales tools, which customers owe us money?". Claude Desktop works the same way through its MCP server settings.
