#!/usr/bin/env node
/* The gate, in the order that fails cheapest first. */
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const steps = [
  ['Routes resolve and have no duplicates', 'scripts/verify-routes.mjs'],
  ['The audience registry is intact', 'scripts/verify-audiences.mjs']
];

let failed = 0;
for (const [name, script] of steps) {
  console.log(`\n== ${name}`);
  const r = spawnSync(process.execPath, [join(ROOT, script)], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0) failed++;
}
console.log(`\n${failed ? `GATE FAIL - ${failed} step(s)` : 'GATE PASS'}`);
console.log('Run `npm run gate` to add the render gate, which needs a build.');
process.exit(failed ? 1 : 0);
