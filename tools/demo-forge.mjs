#!/usr/bin/env node
/* demo-forge - turn any URL into a deployed click-through demo.
 *
 *   demo-forge capture   <url>          measure the live app into an evidence bundle
 *   demo-forge design    --capture <d>  derive a token system from the measurement
 *   demo-forge scaffold  --capture <d>  generate a working React reconstruction
 *   demo-forge audience  <path>         register a shareable audience URL
 *   demo-forge verify                   run the gate
 *   demo-forge deploy                   create and wire the Azure Static Web App
 *   demo-forge build     <url>          all of the above, in order
 *
 * Every command prints what it observed, not what it assumed.
 */

import { resolve, join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0];
const seenFlags = new Set();
const flag = (name, fallback = null) => {
  seenFlags.add(name);
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const has = name => {
  seenFlags.add(name);
  return argv.includes(`--${name}`);
};
// A mistyped flag must not fall through to a default. Silently writing to
// ./demo-build because --app was not spelled --project is the kind of failure
// that looks like the tool working until you go looking for the output.
const checkFlags = (extra = []) => {
  for (const e of extra) seenFlags.add(e);
  const unknown = argv
    .filter(a => a.startsWith('--'))
    .map(a => a.slice(2).split('=')[0])
    .filter(a => !seenFlags.has(a));
  if (unknown.length) {
    die(
      `Unknown flag${unknown.length > 1 ? 's' : ''} for "${cmd}": ${unknown.map(u => `--${u}`).join(', ')}\n` +
        `Run "demo-forge" with no arguments for the flags this command accepts.`
    );
  }
};
const positional = argv.slice(1).filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1]?.startsWith('--') !== true);

const HELP = `
demo-forge - any URL to a deployed click-through demo

  capture <url>              Measure the live app.
      --out <dir>            default ./demo-build/capture
      --do "<steps>"         drive it yourself: "click Home; click Documents"
      --steps <file>         the same instructions, one per line
      --routes <n>           max screens to visit when NOT directed (default 12)
      --viewport <name>      desktop | laptop | tablet | mobile
      --profile <dir>        persistent browser profile, for an app behind a login
      --login                open headed and wait for you to sign in
      --wait <ms>            settle time per screen (default 2500)

      Instructions:  click <target>           type <text> into <target>
                     fill <target> with <x>   wait <ms>
                     capture [as <name>]      goto <url> [as <name>]
                     back
      Without --do or --steps the crawler picks the screens itself.

  design --capture <dir>     Derive tokens + a contrast report from the capture.
      --out <dir>            default <capture>/../design

  scaffold --capture <dir>   Generate the React reconstruction.
      --out <dir>            default ./demo-build/app
      --design <dir>         token source (default <capture>/../design)
      --name <slug>          package name
      --force                overwrite an existing src/

  audience <path>            Register a shareable audience URL.
      --project <dir>        default ./demo-build/app
      --label "Name"
      --guided               run the narrated walkthrough for this audience
      --alias <path>         repeatable; URLs already shared, kept alive
      --dry-run

  verify                     Run the gate. --project <dir>, --render for the full gate.

  deploy                     Create + wire the Azure Static Web App.
      --project <dir>
      --name <swa-name>      --resource-group <rg>  --location <region>  --sku Free|Standard
      --repo <owner/repo>    where to set the deployment-token secret
      --dry-run              print the plan, touch nothing
      --status               list environments for an existing app

  build <url>                capture -> design -> scaffold -> verify, in order.
      --out <dir>            project root (default ./demo-build)
                             capture/, design/ and app/ are created inside it
      accepts every capture and scaffold flag above

  doctor                     Check the toolchain.
`;

const say = (...a) => console.log(...a);
const die = msg => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

const DEFAULT_ROOT = resolve(process.cwd(), 'demo-build');

// --app and --project name the same thing. Both spellings are natural enough
// that insisting on one of them only ever produces a wrong-directory bug.
const projectDir = () => resolve(String(flag('project', flag('app', join(DEFAULT_ROOT, 'app')))));

// --do takes the instructions inline and --steps takes them from a file. Both
// end up as the same list, so a session you sketched on the command line can be
// saved to a file later without rewriting it.
async function loadSteps() {
  const { parseSteps } = await import('./lib/steps.mjs');
  const inline = flag('do');
  const file = flag('steps');
  let text = '';

  if (file && file !== true) {
    const p = resolve(String(file));
    if (!existsSync(p)) die(`--steps file not found: ${p}`);
    text = await readFile(p, 'utf8');
  }
  if (inline && inline !== true) {
    text += (text ? '\n' : '') + String(inline).split(/\s*;\s*|\s*\n\s*/).join('\n');
  }
  if (!text.trim()) return [];

  try {
    return parseSteps(text);
  } catch (e) {
    die(`${e.message}`);
  }
}

async function cmdCapture(url, outOverride) {
  if (!url) die('Usage: demo-forge capture <url>');
  const { captureSite } = await import('./lib/capture.mjs');
  const out = resolve(String(outOverride || flag('out', join(DEFAULT_ROOT, 'capture'))));
  const steps = await loadSteps();
  await mkdir(out, { recursive: true });

  say(`\ncapture\n-------`);
  say(`source  ${url}`);
  say(`out     ${out}`);
  say(`mode    ${steps.length ? `directed (${steps.length} steps)` : 'crawl'}`);

  const manifest = await captureSite({
    url,
    outDir: out,
    steps,
    maxRoutes: Number(flag('routes', 12)),
    viewport: String(flag('viewport', 'desktop')),
    headed: has('headed') || has('login'),
    manualLogin: has('login'),
    profileDir: flag('profile') ? resolve(String(flag('profile'))) : null,
    waitMs: Number(flag('wait', 2500))
  });

  const props = Object.keys(manifest.customProperties || {}).length;
  say(`\n  routes    ${manifest.routes.length}`);
  if (manifest.controls?.length) {
    say(`  controls  ${manifest.controls.length} (mutate the view, not routes: ${manifest.controls.map(c => c.label).slice(0, 3).join(', ')})`);
  }
  say(`  assets    ${manifest.assets.length}`);
  say(`  tokens    ${props} CSS custom properties resolved on :root`);
  say(`  frames    ${manifest.diagnostics.frameCount}${manifest.app.isPowerApps ? ' (Power Apps player)' : ''}`);
  if (manifest.diagnostics.consoleErrors.length) {
    say(`  WARN      ${manifest.diagnostics.consoleErrors.length} console error(s) in the SOURCE app:`);
    for (const e of manifest.diagnostics.consoleErrors.slice(0, 3)) say(`            ${e.slice(0, 120)}`);
  }
  if (!manifest.routes.length) {
    die('No routes captured. If the app is behind a login, re-run with --login --profile <dir>.');
  }
  if (props < 5 && !manifest.app.isPowerApps) {
    say(`  NOTE      few custom properties found - tokens will be inferred from painted values only.`);
  }
  say(`\nnext: demo-forge design --capture ${out}\n`);
  return out;
}

async function cmdDesign(captureDir, outOverride) {
  const dir = resolve(String(captureDir || flag('capture') || join(DEFAULT_ROOT, 'capture')));
  const file = join(dir, 'capture.json');
  if (!existsSync(file)) die(`No capture.json in ${dir}. Run: demo-forge capture <url> --out ${dir}`);
  const out = resolve(String(outOverride || flag('out', join(dir, '..', 'design'))));

  const { extractDesign } = await import('./lib/design.mjs');
  const r = await extractDesign({ captureFile: file, outDir: out });

  say(`\ndesign\n------`);
  say(`  mode      ${r.roles.dark ? 'dark' : 'light'}`);
  say(`  canvas    ${r.roles.canvas}`);
  say(`  surface   ${r.roles.surface}`);
  say(`  text      ${r.roles.text}`);
  say(`  accent    ${r.roles.accent || 'NONE FOUND - set one by hand'}`);
  say(`  sans      ${r.scales.sans}`);
  say(`  base size ${r.scales.dominant}px`);
  say(`\n  ${r.tokensPath}`);
  say(`  ${r.reportPath}`);
  say(`\nnext: demo-forge scaffold --capture ${dir}\n`);
  return out;
}

async function cmdScaffold(captureDirArg, designDirArg, outOverride) {
  // build chains these directly, so the directory it just produced must win
  // over the default. Without this, "build --out <dir>" captures into <dir> and
  // then scaffolds from ./demo-build/capture, which is either stale or absent.
  const captureDir = resolve(String(captureDirArg || flag('capture', join(DEFAULT_ROOT, 'capture'))));
  if (!existsSync(join(captureDir, 'capture.json'))) die(`No capture.json in ${captureDir}.`);
  const outDir = resolve(String(outOverride || flag('out', join(DEFAULT_ROOT, 'app'))));
  const designDir = resolve(String(designDirArg || flag('design', join(captureDir, '..', 'design'))));

  const { scaffold } = await import('./lib/scaffold.mjs');
  const r = await scaffold({
    captureDir,
    outDir,
    designDir: existsSync(join(designDir, 'tokens.css')) ? designDir : null,
    name: flag('name') ? String(flag('name')) : null,
    force: has('force')
  }).catch(e => die(`scaffold: ${e.message}`));

  say(`\nscaffold\n--------`);
  say(`  out       ${r.outDir}`);
  say(`  tokens    ${r.tokens}`);
  say(`  routes    ${r.routes.length}`);
  for (const rt of r.routes) say(`            ${rt.path.padEnd(20)} ${rt.label}`);
  say(`\nnext:`);
  say(`  cd ${r.outDir} && npm install && npm run dev`);
  say(`  then edit src/demo/scripts/default.js - every step is a TODO on purpose\n`);
  return r.outDir;
}

async function cmdAudience(path) {
  const project = projectDir();
  if (!path) die('Usage: demo-forge audience /Finance-guide --label "Finance" --guided');
  const aliases = [];
  argv.forEach((a, i) => a === '--alias' && argv[i + 1] && aliases.push(argv[i + 1]));

  const { addAudience } = await import('./lib/scaffold.mjs');
  const r = await addAudience({
    projectDir: project,
    path,
    label: flag('label') ? String(flag('label')) : null,
    guided: has('guided'),
    aliases,
    dryRun: has('dry-run')
  }).catch(e => die(`audience: ${e.message}`));

  say(`\naudience\n--------`);
  if (r.alreadyRegistered) say(`  ${r.path} is already registered.`);
  else if (r.dryRun) say(`  DRY RUN - would touch:\n${r.files.map(f => `            ${f}`).join('\n')}`);
  else {
    say(`  registered ${r.path}${r.guided ? ' (guided)' : ''}`);
    for (const f of r.files) say(`            ${f}`);
    say(`\n  This ADDS a URL. The front door is unchanged.`);
    say(`  Status is 'coming-soon' - flip it to 'ready' once the storyline lands.`);
  }
  say('');
}

async function cmdVerify() {
  const project = projectDir();
  if (!existsSync(project)) die(`No project at ${project}.`);
  const script = has('render') ? 'gate' : 'verify';
  const r = spawnSync('npm', ['run', script], { cwd: project, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

async function cmdDeploy() {
  const { preflight, createSwa, deployStatus, envName } = await import('./lib/deploy.mjs');
  const project = projectDir();

  if (has('status')) {
    const name = String(flag('name') || die('--name is required with --status'));
    const rg = String(flag('resource-group') || die('--resource-group is required with --status'));
    const s = deployStatus({ name, resourceGroup: rg });
    if (!s.ok) die(s.error);
    say('\nenvironments\n------------');
    for (const e of s.environments) say(`  ${(e.name || 'production').padEnd(18)} ${e.status.padEnd(10)} ${e.url}`);
    say('');
    return;
  }

  say('\npreflight\n---------');
  const checks = preflight();
  for (const c of checks) say(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(12)} ${c.detail}`);
  if (!checks.every(c => c.ok) && !has('dry-run')) die('Fix the failures above, then re-run.');

  const name = String(flag('name') || `demo-${basename(project)}-${Date.now().toString(36).slice(-5)}`);
  const rg = String(flag('resource-group', `rg-${name}`));
  const r = await createSwa({
    projectDir: project,
    name,
    resourceGroup: rg,
    location: String(flag('location', 'eastus2')),
    sku: String(flag('sku', 'Free')),
    repoUrl: flag('repo') ? String(flag('repo')) : null,
    dryRun: has('dry-run')
  });

  say('\ndeploy\n------');
  if (r.dryRun) {
    say('  DRY RUN. Would run:');
    for (const p of r.plan) say(`    ${p}`);
    say('');
    return;
  }
  for (const s of r.steps) say(`  ${s.ok ? 'ok  ' : 'FAIL'}  ${s.label.padEnd(42)} ${s.detail}`);
  if (r.productionUrl) {
    say(`\n  production  ${r.productionUrl}`);
    say(`  branch env  ${r.productionUrl.replace('https://', 'https://').replace(/^(https:\/\/[^.]+)/, '$1-<env>')}`);
    say(`\n  Push to main to deploy. A projects/** branch deploys to its own subdomain.`);
    say(`  Env names: alphanumeric, 16 chars max, and they are a SUFFIX - Azure only appends.`);
  }
  say('');
}

async function cmdBuild(url) {
  if (!url) die('Usage: demo-forge build <url>');
  // In build, --out names the PROJECT ROOT, not one stage's output. The three
  // stages each have their own directory under it. Treating --out as a single
  // directory would point capture and scaffold at the same path.
  const root = resolve(String(flag('out', DEFAULT_ROOT)));
  const captureDir = await cmdCapture(url, join(root, 'capture'));
  await cmdDesign(captureDir, join(root, 'design'));
  const appDir = await cmdScaffold(captureDir, join(root, 'design'), join(root, 'app'));

  say('install\n-------');
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: appDir, stdio: 'inherit' });
  if (install.status !== 0) die('npm install failed.');

  say('\ngate\n----');
  const gate = spawnSync('npm', ['run', 'gate'], { cwd: appDir, stdio: 'inherit' });

  say(`\n${'='.repeat(64)}`);
  say(gate.status === 0 ? 'BUILD PASS' : 'BUILD BUILT, GATE FAILED - see above');
  say(`  app         ${appDir}`);
  say(`  evidence    ${join(appDir, '.render-evidence')}`);
  say(`  screenshots ${join(captureDir, 'screens')}`);
  say(`\nnext:`);
  say(`  1. cd ${appDir} && npm run dev        look at it next to capture/screens/`);
  say(`  2. edit src/demo/scripts/default.js   the narration is TODO on purpose`);
  say(`  3. demo-forge audience /My-guide --guided --label "My audience"`);
  say(`  4. demo-forge deploy --project ${appDir} --name <swa-name>`);
  say('');
  process.exit(gate.status ?? 0);
}

async function cmdDoctor() {
  const { preflight } = await import('./lib/deploy.mjs');
  say('\ndoctor\n------');
  for (const c of preflight()) say(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name.padEnd(12)} ${c.detail}`);
  let pw = 'missing - run: npm i -g playwright && npx playwright install chromium';
  try {
    const m = await import('playwright');
    pw = `available${m.chromium ? ' (chromium)' : ''}`;
  } catch {
    /* reported as missing */
  }
  say(`  ${pw.startsWith('available') ? 'ok  ' : 'FAIL'}  ${'playwright'.padEnd(12)} ${pw}`);
  say('');
}

const commands = {
  capture: () => cmdCapture(argv[1]),
  design: () => cmdDesign(argv[1]?.startsWith('--') ? null : argv[1]),
  scaffold: cmdScaffold,
  audience: () => cmdAudience(argv[1]),
  verify: cmdVerify,
  deploy: cmdDeploy,
  build: () => cmdBuild(argv[1]),
  doctor: cmdDoctor
};

// Declared per command so a typo fails loudly at the door rather than falling
// through to a default path. Kept next to the dispatcher so adding a flag
// without declaring it here shows up the first time the command is run.
const FLAGS = {
  capture: ['out', 'routes', 'wait', 'viewport', 'login', 'profile', 'headed', 'quiet', 'do', 'steps'],
  design: ['capture', 'out', 'quiet'],
  scaffold: ['capture', 'design', 'out', 'name', 'force', 'quiet'],
  audience: ['project', 'app', 'label', 'guided', 'alias', 'quiet'],
  verify: ['project', 'app', 'render'],
  deploy: [
    'project', 'app', 'name', 'resource-group', 'location', 'sku',
    'repo', 'branch', 'dry-run', 'status'
  ],
  build: [
    'out', 'routes', 'wait', 'viewport', 'login', 'profile', 'headed',
    'name', 'quiet', 'skip-install', 'do', 'steps'
  ],
  doctor: []
};

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
  say(HELP);
  process.exit(0);
}
if (!commands[cmd]) die(`Unknown command "${cmd}".${HELP}`);
checkFlags(FLAGS[cmd] || []);

commands[cmd]().catch(e => {
  // A bad instruction is a user error, not a crash. Printing a stack trace for
  // "you typed a label that is not on the page" buries the one line that helps.
  if (e?.name === 'StepError') die(`capture stopped.\n\n${e.message}`);
  die(`${cmd}: ${e.stack || e.message}`);
});
