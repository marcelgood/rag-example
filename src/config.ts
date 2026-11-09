// Central settings for the RAG example. Change values here, not in the modules.

export const config = {
  // Folder with the source documents to ingest (.md and .txt files).
  dataDir: 'data',

  // Where LanceDB stores its files. It is an embedded database:
  // just a folder on disk, no server to run.
  dbDir: '.lancedb',
  tableName: 'chunks',

  // Embedding model. It runs locally through Transformers.js and is
  // downloaded once (~23 MB) on first use. It turns text into 384 numbers.
  // IMPORTANT: ingestion and querying must use the SAME model, or the
  // vectors will not be comparable.
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  embeddingDims: 384,

  // Chunking. Sizes are in tokens of the embedding model (about 4
  // characters each in English). MiniLM reads at most 256 tokens and
  // silently ignores the rest, so chunkSize must stay below that.
  chunkSize: 200,
  chunkOverlap: 40,

  // How many texts to embed in one call.
  embedBatchSize: 16,

  // --- Query / answer step ---

  // How many chunks to retrieve and hand to the LLM per question.
  // Too few and the right chunk may be missed; too many adds noise and cost.
  topK: 5,

  // Which LLM writes the answers:
  //   'ollama' - a small open model running locally. Free, but weaker.
  //   'claude' - the Claude API. Needs an API key with credits.
  llmProvider: 'ollama' as 'claude' | 'ollama',

  // Claude settings.
  llmModel: 'claude-opus-5-5',
  // How much the model thinks before answering: low | medium | high | xhigh | max.
  // Short Q&A over a few chunks does well at "low"; raise it for harder questions.
  llmEffort: 'low',

  // Ollama settings. The model must be downloaded first: ollama pull <name>
  ollamaHost: 'http://127.0.0.1:11434',
  // A 4B model (2.5 GB) that supports tool calling and fits in a 4 GB GPU.
  // The "instruct" variant answers directly; "qwen3:4b-thinking" reasons
  // first, which is a bit more accurate but much slower on a laptop.
  // Any tool-capable model from ollama.com/search?c=tools works here.
  ollamaModel: 'qwen3:4b-instruct',
  // Context window in tokens. Ollama's default is small; schema plus query
  // results for the SQL example need more.
  ollamaContextTokens: 8192,

  // --- Text-to-SQL example ---

  sqlDbPath: 'db/larkspur.db',
  // Sent to Claude as the schema description; its comments explain the columns.
  sqlSchemaPath: 'db/schema.sql',
  // At most this many rows of a query result go back to the model.
  sqlMaxRows: 100,
  // Safety stop for the tool-using agents (Parts 2 and 4): at most this many tool calls per question.
  maxToolCalls: 8,

  // Who runs the tool-use loop for Parts 2 and 4 (see Part 5 in the README):
  //   'hand-written' - our own loops in src/agent/claude.ts and src/agent/ollama.ts
  //   'ai-sdk'       - the Vercel AI SDK's generateText (src/ai-sdk/run.ts)
  agentLoop: 'hand-written' as 'hand-written' | 'ai-sdk',

  // --- Evals ---

  // The test questions and what a good answer must contain.
  evalDocCasesPath: 'evals/doc-cases.json',
  evalSqlCasesPath: 'evals/sql-cases.json',
  // Each eval run saves a JSON report here (git-ignored), so runs can be compared.
  evalResultsDir: 'evals/results',
} as const; // `as const` keeps literal types, e.g. llmEffort is 'low', not string.

/** The model that answers, for display: "claude-opus-5-5" or "qwen3:4b-instruct via Ollama". */
export const modelLabel = () => (config.llmProvider === 'claude' ? config.llmModel : `${config.ollamaModel} via Ollama`);
