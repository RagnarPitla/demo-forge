// Reusing a real browser profile, without touching it.
//
// The documented way to capture an authenticated app was "--login, sign in by
// hand, and the persistent profile remembers you". That works, but it makes you
// sign in again for a tenant you are already signed into in your everyday
// browser. Worse, it cannot be used at all while that browser is running,
// because Chromium holds an exclusive lock on its user data directory.
//
// So: find the profile by the account signed into it, copy the parts that carry
// the session into a scratch directory, and launch a real Edge or Chrome
// against the copy. Your live browser is never opened, never locked, never
// modified. On macOS the cookie encryption key lives in the login keychain
// under "<Browser> Safe Storage" and is scoped to the user account, not to the
// directory, so a copy launched by the same binary as the same user decrypts.

import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, mkdir, cp, rm } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

const ROOTS = {
  msedge: {
    darwin: 'Library/Application Support/Microsoft Edge',
    win32: 'AppData/Local/Microsoft/Edge/User Data',
    linux: '.config/microsoft-edge'
  },
  chrome: {
    darwin: 'Library/Application Support/Google/Chrome',
    win32: 'AppData/Local/Google/Chrome/User Data',
    linux: '.config/google-chrome'
  }
};

// Everything that carries a sign-in, and nothing that does not. The full
// profile is over a gigabyte, almost all of it service-worker and GPU cache
// that would slow the copy down without making the session any more valid.
const SESSION_PARTS = [
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Web Data',
  'Preferences',
  'Secure Preferences',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Network'
];

export function browserRoot(channel = 'msedge') {
  const spec = ROOTS[channel];
  if (!spec) throw new Error(`Unknown browser channel "${channel}". Use msedge or chrome.`);
  const rel = spec[process.platform];
  if (!rel) throw new Error(`${channel} profile discovery is not implemented for ${process.platform}.`);
  return join(homedir(), rel);
}

/** Every profile in the browser's user data directory, with the account signed into it. */
export async function listProfiles(channel = 'msedge') {
  const root = browserRoot(channel);
  if (!existsSync(root)) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const out = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!/^(Default|Profile \d+)$/.test(e.name)) continue;
    const prefs = join(root, e.name, 'Preferences');
    if (!existsSync(prefs)) continue;

    let account = '';
    let display = '';
    try {
      const p = JSON.parse(await readFile(prefs, 'utf8'));
      account = p.account_info?.[0]?.email || '';
      display = p.profile?.name || '';
    } catch {
      /* a profile with unreadable preferences is still a profile; it just has no label */
    }
    out.push({ dir: e.name, path: join(root, e.name), account, display });
  }

  return out;
}

/** Resolve "ragnar@example.com", "Profile 16" or "Default" to one profile. */
export async function findProfile(channel, needle) {
  const all = await listProfiles(channel);
  if (!all.length) throw new Error(`No ${channel} profiles found under ${browserRoot(channel)}.`);

  const want = String(needle).trim().toLowerCase();
  const hit =
    all.find(p => p.account.toLowerCase() === want) ||
    all.find(p => p.dir.toLowerCase() === want) ||
    all.find(p => p.display.toLowerCase() === want) ||
    all.find(p => p.account.toLowerCase().startsWith(want));

  if (!hit) {
    const known = all
      .map(p => `    ${p.dir.padEnd(12)} ${p.account || p.display || '(no account)'}`)
      .join('\n');
    throw new Error(`No ${channel} profile matching "${needle}".\n  Profiles on this machine:\n${known}`);
  }
  return hit;
}

/**
 * Copy the session-bearing parts of a profile into a Playwright user data dir.
 * Returns the directory to hand to launchPersistentContext.
 */
export async function cloneProfile({ channel = 'msedge', profile, outDir, verbose = true, fresh = false }) {
  const src = await findProfile(channel, profile);
  const root = browserRoot(channel);

  // Playwright drives the profile named "Default" inside the user data dir, so
  // the copy is renamed on the way in rather than passing --profile-directory,
  // which Playwright does not thread through reliably.
  const dest = join(outDir, 'Default');

  // Reuse a clone that has already been through sign-in. Copying afresh every
  // run would throw away the session the previous run established, and any
  // tenant with conditional access would then demand a phone approval on every
  // single capture - which is no better than not having the profile at all.
  if (!fresh && existsSync(join(dest, 'Cookies'))) {
    if (verbose) console.log(`  profile   reusing ${basename(outDir)}/Default (pass --fresh-profile to re-copy)`);
    return { userDataDir: outDir, source: src, copied: [], reused: true };
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  // Local State sits beside the profiles and holds the encrypted key that the
  // cookie store is sealed with. Copy the profile without it and every cookie
  // decrypts to an empty string, which looks exactly like being signed out.
  const localState = join(root, 'Local State');
  if (existsSync(localState)) await cp(localState, join(outDir, 'Local State'));

  const copied = [];
  for (const part of SESSION_PARTS) {
    const from = join(src.path, part);
    if (!existsSync(from)) continue;
    await cp(from, join(dest, part), { recursive: true }).catch(() => {});
    copied.push(part);
  }

  if (verbose) {
    console.log(`  profile   ${src.dir} (${src.account || src.display}) -> ${basename(outDir)}/Default`);
    console.log(`  carried   ${copied.join(', ')}`);
  }

  return { userDataDir: outDir, source: src, copied };
}
