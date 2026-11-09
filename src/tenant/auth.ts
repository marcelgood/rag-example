// Part 6: the authentication setup, using better-auth.
//
// better-auth is an authentication framework. Here it provides:
//   - users with email and password; passwords are hashed with scrypt, a
//     deliberately slow algorithm, so a stolen database doesn't reveal them
//   - sessions: signing in returns a session token (the bearer plugin lets
//     a command-line client send it in an Authorization header instead of a
//     browser cookie)
//   - access tokens: the jwt plugin turns a session into a short-lived,
//     signed JWT, and publishes the public keys to check the signature
//     (JWKS). The MCP server only needs those public keys, never the
//     database of sessions or the private key.
//
// The auth server (auth-server.ts) and the seed script use this setup.

import { DatabaseSync } from 'node:sqlite';
import { betterAuth } from 'better-auth';
import { bearer, jwt } from 'better-auth/plugins';
import { config } from '../config.ts';

// better-auth uses the secret to encrypt the private signing key in the
// database and to sign session tokens. A real deployment sets
// BETTER_AUTH_SECRET to a long random value; this fallback is for the demo.
const secret = process.env.BETTER_AUTH_SECRET ?? 'development-only-secret-do-not-use-in-production';

export function createAuth({ seeding = false } = {}) {
  return betterAuth({
    baseURL: config.authServerUrl,
    secret,
    database: new DatabaseSync(config.tenantDbPath),
    emailAndPassword: {
      enabled: true,
      // Users are created by the seed script only; nobody can register.
      disableSignUp: !seeding,
    },
    // The seed script creates the tables, so they don't exist yet when it starts.
    ...(seeding ? { advanced: { database: { validateSchema: false } } } : {}),
    plugins: [
      bearer(),
      jwt({
        jwt: {
          issuer: config.authServerUrl,
          // The token is only valid for the MCP server. Another service that
          // receives it must refuse it (and our MCP server refuses tokens
          // meant for anything else).
          audience: config.mcpServerUrl,
          expirationTime: config.accessTokenLifetime,
          // What the MCP server learns about the user. The tenant is NOT in
          // the token: the MCP server derives it from the verified email.
          definePayload: ({ user }) => ({ email: user.email, name: user.name }),
        },
      }),
    ],
  });
}
