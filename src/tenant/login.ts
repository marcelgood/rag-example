// Part 6: sign in. Run with: npm run login -- anna@larkspur.test
// It asks for the password without showing it. (The test users' password
// is "password123"; see src/tenant/seed.ts.)

import { AuthError, signIn } from './session.ts';

const email = process.argv[2];
if (!email) {
  console.error('Usage: npm run login -- you@company.test');
  process.exit(1);
}

try {
  await signIn(email, await readPassword('Password: '));
  console.log(`Signed in as ${email}.`);
} catch (error) {
  if (!(error instanceof AuthError)) throw error;
  console.error(error.message);
  process.exitCode = 1;
}

/** Read a password from the terminal without echoing it, or one line from piped input. */
function readPassword(prompt: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    if (!stdin.isTTY) {
      // e.g. echo password123 | npm run login -- anna@larkspur.test
      let input = '';
      stdin.setEncoding('utf8').on('data', (chunk) => (input += chunk)).on('end', () => {
        process.stdout.write('\n');
        // Windows PowerShell may start piped text with a byte order mark.
        resolve(input.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '');
      });
      return;
    }
    let password = '';
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    const onData = (keys: string) => {
      for (const key of keys) {
        if (key === '\r' || key === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(password);
          return;
        }
        if (key === '\u0003') process.exit(130); // Ctrl+C
        if (key === '\u007f' || key === '\b') password = password.slice(0, -1);
        else password += key;
      }
    };
    stdin.on('data', onData).resume();
  });
}
