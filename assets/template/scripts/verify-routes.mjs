#!/usr/bin/env node
/* Routes resolve, and no two claim the same path.
 *
 * A duplicate route is a hard failure rather than a warning: the second one
 * silently never renders, and that is the kind of bug that is only noticed in
 * front of a customer.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const src = await readFile(join(ROOT, 'src/routes/index.jsx'), 'utf8');

// Scope to the routes export. navItems in the same file repeats every path, and
// an unscoped match makes the duplicate-route check fire on every single route.
const routesBlock = src.match(/export const routes\s*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
const navBlock = src.match(/export const navItems\s*=\s*\[([\s\S]*?)\n\];/)?.[1] ?? '';
const paths = [...routesBlock.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1]);
const navPaths = [...navBlock.matchAll(/path:\s*'([^']+)'/g)].map(m => m[1]);
const components = [...routesBlock.matchAll(/Component:\s*([A-Za-z0-9_]+)/g)].map(m => m[1]);
const imports = [...src.matchAll(/^import\s+([A-Za-z0-9_]+)\s+from\s+'\.\/([^']+)'/gm)];

let fail = 0;
if (!paths.length) { console.error('FAIL  no routes found (expected `export const routes = [`)'); fail++; }

// Every nav link must resolve. A nav item pointing at an unregistered path is a
// dead end in the demo, and it will only be found by the person presenting it.
for (const p of navPaths) {
  if (!paths.includes(p)) { console.error(`FAIL  nav item points at unregistered route: ${p}`); fail++; }
}
const seen = new Map();
for (const p of paths) {
  if (seen.has(p.toLowerCase())) { console.error(`FAIL  duplicate route: ${p}`); fail++; }
  seen.set(p.toLowerCase(), p);
  if (!p.startsWith('/')) { console.error(`FAIL  route must start with /: ${p}`); fail++; }
}
if (!paths.includes('/')) { console.error('FAIL  no root route registered'); fail++; }

for (const [, name, file] of imports) {
  if (!existsSync(join(ROOT, 'src/routes', file))) { console.error(`FAIL  missing route file: src/routes/${file}`); fail++; }
}
for (const c of components) {
  if (!imports.some(([, name]) => name === c)) { console.error(`FAIL  route component not imported: ${c}`); fail++; }
}

console.log(fail ? `ROUTES FAIL - ${fail} problem(s)` : `ROUTES PASS - ${paths.length} routes, ${new Set(paths).size} unique`);
process.exit(fail ? 1 : 0);
