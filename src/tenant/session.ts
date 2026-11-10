// Part 6: the client side of authentication.
//
// Two kinds of tokens, like most token-based setups:
//   - The session token proves "I signed in with my password". It lasts for
//     days, is stored in .auth/session.json (like a browser cookie), and is
//     only ever sent to the auth server.
//   - The access token (a JWT) proves "this is anna@larkspur.test" to the MCP
//     server. It's fetched fresh from the auth server before each run and
//     expires after 15 minutes, so a leaked one is useful only briefly.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

type Session = { email: string; sessionToken: string };

/** A problem the user can fix: not signed in, wrong password, server not running. */
export class AuthError extends Error {}

async function callAuthServer(route: string, init: RequestInit = {}): Promise<Response> {
  // better-auth protects against cross-site request forgery: for requests
  // that look like they come from a browser (Node's fetch sends the same
  // Sec-Fetch-* headers) it requires an Origin it trusts. A command-line
  // client has no web page of its own, so it uses the auth server's origin,
  // which better-auth trusts by default.
  const headers = new Headers(init.headers);
  headers.set('Origin', new URL(config.authServerUrl).origin);
  try {
    return await fetch(new URL(`/api/auth${route}`, config.authServerUrl), { ...init, headers });
  } catch {
    throw new AuthError(`Can't reach the auth server at ${config.authServerUrl}. Start it with: npx agent serve tenant`);
  }
}

/** Check email and password with the auth server; returns a new session token. */
export async function createSession(email: string, password: string): Promise<string> {
  const response = await callAuthServer('/sign-in/email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (response.status === 401) throw new AuthError('Sign-in failed: wrong email or password.');
  if (!response.ok) throw new AuthError(`Sign-in failed (${response.status}): ${await response.text()}`);
  // The bearer plugin returns the session token in this header (a browser would get a cookie).
  const sessionToken = response.headers.get('set-auth-token');
  if (!sessionToken) throw new AuthError('The auth server returned no session token.');
  return sessionToken;
}

/** Exchange a session token for a short-lived access token for the MCP server. */
export async function accessTokenFor(sessionToken: string): Promise<string> {
  const response = await callAuthServer('/token', { headers: { Authorization: `Bearer ${sessionToken}` } });
  if (response.status === 401) throw new AuthError('Your session has expired. Sign in again: npx agent login you@company.test');
  if (!response.ok) throw new AuthError(`The auth server refused to issue a token (${response.status}).`);
  return ((await response.json()) as { token: string }).token;
}

/** End a session on the auth server. Its session token stops working. */
export async function endSession(sessionToken: string): Promise<void> {
  const response = await callAuthServer('/sign-out', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) throw new AuthError(`Sign-out failed (${response.status}): ${await response.text()}`);
}

// --- The command-line client's saved session --------------------------------

/** Sign in and keep the session token in .auth/session.json. */
export async function signIn(email: string, password: string): Promise<void> {
  const sessionToken = await createSession(email, password);
  mkdirSync(path.dirname(config.sessionFilePath), { recursive: true });
  writeFileSync(config.sessionFilePath, JSON.stringify({ email, sessionToken } satisfies Session, null, 2));
  chmodSync(config.sessionFilePath, 0o600); // readable by this user only (where the OS supports it)
}

export function currentSession(): Session {
  if (!existsSync(config.sessionFilePath)) throw new AuthError('Not signed in. Run: npx agent login you@company.test');
  return JSON.parse(readFileSync(config.sessionFilePath, 'utf8')) as Session;
}

/** A fresh access token for the saved session. */
export const getAccessToken = () => accessTokenFor(currentSession().sessionToken);

/** End the saved session on the server, then forget it locally. */
export async function signOut(): Promise<string | undefined> {
  if (!existsSync(config.sessionFilePath)) return undefined;
  const { email, sessionToken } = currentSession();
  // Forget the session locally even if the server can't be reached, but say so:
  // the session then stays valid on the server until it expires.
  await endSession(sessionToken).catch((error: Error) => console.error(`Warning: ${error.message}`));
  rmSync(config.sessionFilePath);
  return email;
}
