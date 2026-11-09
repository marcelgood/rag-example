// What a tool-using agent is made of, independent of the LLM provider:
// a system prompt, the tools the model may call, and a function that runs a
// call. Part 2 (run_sql in this process) and Part 4 (tools from an MCP
// server) both describe themselves this way and share the same loops.

/** A tool as the model sees it: a name, what it does, and a JSON Schema for its input. */
export type ToolSpec = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[]; [key: string]: unknown };
  /** Claude only: guarantee the input matches the schema (needs a schema that strict mode supports). */
  strict?: boolean;
};

/** The result of one tool call. Errors go back to the model too, so it can correct itself. */
export type ToolOutcome = { content: string; isError: boolean };

export type Agent = {
  system: string;
  tools: ToolSpec[];
  /** Run one tool call. `input` is whatever the model sent, so check it. */
  runTool: (name: string, input: unknown) => ToolOutcome | Promise<ToolOutcome>;
};

/** Where progress lines go: the console by default, a list when running evals. */
export type Log = (line: string) => void;
