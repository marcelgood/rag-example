#!/usr/bin/env node
// The `agent` command, started by `npx agent` (see "bin" in package.json).
// Plain JavaScript, because npm starts bin files through a shim; the real
// work is in src/cli/agent.ts, which Node runs directly like the rest of the
// project.
import '../src/cli/agent.ts';
