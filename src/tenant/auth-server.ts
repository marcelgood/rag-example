// Part 6: the auth server (http://localhost:3100).
//
// It answers better-auth's endpoints under /api/auth. The ones this demo uses:
//   POST /api/auth/sign-in/email   email + password → session token
//   GET  /api/auth/token           session token → access token (a JWT for the MCP server)
//   GET  /api/auth/jwks            the public keys that check a JWT's signature
//   POST /api/auth/sign-out        ends the session
//
// This server owns the users and passwords. The MCP server never sees a
// password; it only checks access tokens with the public keys.

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from '../config.ts';
import { createAuth } from './auth.ts';

const auth = createAuth();
const app = new Hono();

// better-auth handles its own routes from a standard web Request.
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

const { port } = new URL(config.authServerUrl);
serve({ fetch: app.fetch, port: Number(port) });
console.error(`Auth server running at ${config.authServerUrl}`);
