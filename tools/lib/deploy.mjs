// Create and wire the Azure Static Web App.
//
// Azure constraints that are not negotiable, and that cost a deploy cycle each
// if you learn them the hard way:
//
//   * The environment name is a SUFFIX. Azure owns the hostname and only
//     appends: <host>-<env>.<region>.azurestaticapps.net. A prefix host cannot
//     be created.
//   * Environment names are alphanumeric, 16 characters maximum. Hyphens are
//     rejected at deploy time, not at create time.
//   * Custom domains are production-only. A named environment cannot have one.
//   * Named environments count against a quota: 3 on Free, 10 on Standard. On
//     Free that binds fast - the fourth branch fails at the deploy step with
//     "maximum number of staging environments" while the gate still passes.
//   * An empty deployment_environment means PRODUCTION to the Azure action.
//     That is what main wants and it is a footgun everywhere else.

import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), status: r.status };
};

export const envName = branch =>
  String(branch || '')
    .replace(/^projects\//, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 16)
    .toLowerCase();

export function preflight() {
  const checks = [];
  const az = run('az', ['version', '--output', 'json']);
  checks.push({ name: 'azure-cli', ok: az.ok, detail: az.ok ? JSON.parse(az.out)['azure-cli'] : 'not installed - https://aka.ms/azcli' });

  const account = run('az', ['account', 'show', '--output', 'json']);
  checks.push({
    name: 'azure-login',
    ok: account.ok,
    detail: account.ok ? `${JSON.parse(account.out).name} (${JSON.parse(account.out).id})` : 'run: az login'
  });

  const gh = run('gh', ['auth', 'status']);
  checks.push({ name: 'gh-cli', ok: gh.ok, detail: gh.ok ? 'authenticated' : 'run: gh auth login' });

  const node = run('node', ['-v']);
  checks.push({ name: 'node', ok: node.ok && parseInt(node.out.slice(1), 10) >= 18, detail: node.out || 'missing' });

  return checks;
}

export function listSubscriptions() {
  const r = run('az', ['account', 'list', '--output', 'json', '--query', '[].{name:name,id:id,isDefault:isDefault}']);
  return r.ok ? JSON.parse(r.out) : [];
}

export async function createSwa({
  projectDir,
  name,
  resourceGroup,
  location = 'eastus2',
  sku = 'Free',
  repoUrl = null,
  branch = 'main',
  dryRun = false
}) {
  const steps = [];
  const record = (label, result) => {
    steps.push({ label, ok: result.ok, detail: result.ok ? result.out.slice(0, 400) : result.err.slice(0, 400) });
    return result;
  };

  if (dryRun) {
    return {
      dryRun: true,
      plan: [
        `az group create --name ${resourceGroup} --location ${location}`,
        `az staticwebapp create --name ${name} --resource-group ${resourceGroup} --location ${location} --sku ${sku}`,
        `az staticwebapp secrets list --name ${name} --resource-group ${resourceGroup}`,
        `gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --body <token>`
      ]
    };
  }

  const rg = run('az', ['group', 'show', '--name', resourceGroup, '--output', 'json']);
  if (!rg.ok) {
    record(`create resource group ${resourceGroup}`, run('az', ['group', 'create', '--name', resourceGroup, '--location', location, '--output', 'json']));
  } else {
    steps.push({ label: `resource group ${resourceGroup}`, ok: true, detail: 'already exists' });
  }

  const existing = run('az', ['staticwebapp', 'show', '--name', name, '--resource-group', resourceGroup, '--output', 'json']);
  let app;
  if (existing.ok) {
    app = JSON.parse(existing.out);
    steps.push({ label: `static web app ${name}`, ok: true, detail: `already exists - ${app.defaultHostname}` });
  } else {
    const args = ['staticwebapp', 'create', '--name', name, '--resource-group', resourceGroup, '--location', location, '--sku', sku, '--output', 'json'];
    const created = record(`create static web app ${name}`, run('az', args));
    if (!created.ok) return { ok: false, steps };
    app = JSON.parse(created.out);
  }

  const secrets = run('az', ['staticwebapp', 'secrets', 'list', '--name', name, '--resource-group', resourceGroup, '--output', 'json']);
  let token = null;
  if (secrets.ok) {
    token = JSON.parse(secrets.out)?.properties?.apiKey || null;
    steps.push({ label: 'deployment token', ok: !!token, detail: token ? 'retrieved (not printed)' : 'could not read apiKey' });
  }

  if (token) {
    // The token goes straight into the GitHub secret. It is never written to
    // disk and never echoed - a deployment token in a repo is a deployment
    // token in everyone's shell history.
    const ghArgs = ['secret', 'set', 'AZURE_STATIC_WEB_APPS_API_TOKEN', '--body', token];
    if (repoUrl) ghArgs.push('--repo', repoUrl);
    const set = run('gh', ghArgs, { cwd: projectDir });
    steps.push({ label: 'gh secret AZURE_STATIC_WEB_APPS_API_TOKEN', ok: set.ok, detail: set.ok ? 'set' : set.err.slice(0, 300) });
  }

  const productionUrl = `https://${app.defaultHostname}`;
  const meta = {
    site: {
      name,
      resourceGroup,
      location,
      sku,
      defaultHostName: app.defaultHostname.replace(/\.\d+\.azurestaticapps\.net$/, ''),
      productionUrl,
      envUrlTemplate: `https://${app.defaultHostname.replace(/^([^.]+)\.(\d+)\./, '$1-{env}.$2.')}`
    },
    branches: [],
    $comment: [
      'The canonical branch -> environment -> route map.',
      'env must be alphanumeric and 16 characters or fewer. An Azure constraint.',
      'The env name is a SUFFIX: Azure owns the hostname and only appends.',
      `Named environments count against the ${sku} quota (${sku === 'Free' ? 3 : 10}).`
    ]
  };
  await writeFile(join(projectDir, 'branch-environments.json'), JSON.stringify(meta, null, 2));
  steps.push({ label: 'branch-environments.json', ok: true, detail: productionUrl });

  return { ok: steps.every(s => s.ok), steps, productionUrl, app: { name, resourceGroup, hostname: app.defaultHostname } };
}

export function deployStatus({ name, resourceGroup }) {
  const r = run('az', ['staticwebapp', 'environment', 'list', '--name', name, '--resource-group', resourceGroup, '--output', 'json']);
  if (!r.ok) return { ok: false, error: r.err };
  const envs = JSON.parse(r.out);
  return {
    ok: true,
    environments: envs.map(e => ({
      name: e.name,
      hostname: e.hostname,
      status: e.status,
      buildId: e.buildId,
      url: `https://${e.hostname}`
    }))
  };
}
