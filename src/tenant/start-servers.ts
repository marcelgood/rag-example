// Part 6: start the auth server and the MCP server together.
// Run with: npm run tenant:servers   (leave it running, ask in another terminal)
//
// They are separate servers that share nothing but the auth server's public
// keys (fetched over HTTP), so in production they would run apart.

await import('./auth-server.ts');
await import('./mcp-server.ts');
