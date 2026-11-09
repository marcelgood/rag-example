// Part 6: sign out. Run with: npm run logout

import { signOut } from './session.ts';

const email = await signOut();
console.log(email ? `Signed out ${email}.` : 'Not signed in.');
