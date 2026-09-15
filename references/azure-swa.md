# Azure Static Web Apps

The deploy target. These constraints are Azure's, not ours, and each one below
has cost somebody an afternoon.

## Hostname shape

Azure owns the hostname and only appends the environment name as a **suffix**:

```
https://<generated-host>.<region>.azurestaticapps.net            production
https://<generated-host>-<env>.<region>.azurestaticapps.net      named environment
```

A prefix host such as `finance-<generated-host>.azurestaticapps.net` **cannot be
created**. If someone asks for one, the answer is a route on the production site
instead: `/#/Finance-guide`.

## Environment names

Alphanumeric, **16 characters maximum**. No hyphens. `sapsfdc`, not `sap-sfdc`.

Silent truncation and rejection both happen; validate before the deploy rather
than reading the failure out of a workflow log.

## The production typo

In the workflow, an **empty or omitted `deployment_environment` means
production**.

```yaml
- uses: Azure/static-web-apps-deploy@v1
  with:
    deployment_environment: ${{ env.SWA_ENV }}   # empty -> PRODUCTION
```

If `SWA_ENV` is unset for a branch, that branch publishes over the live site.
The generated workflow fails the build for an unmapped branch rather than
guessing, which is the correct trade: a failed build costs a rerun, a wrong
deploy costs the front door.

## Quota

Staging environments are capped: **3 on Free, 10 on Standard**. Production is not
counted.

On Free with three branch environments allocated, the fourth fails at the deploy
step with `This Static Web App already has the maximum number of staging
environments`. The verify gate still passes and production is untouched, but the
branch has no URL.

This is why pull requests do not get preview environments here. A per-PR preview
is a second environment for code already live on its branch subdomain, contending
for the same capped pool - a busy week of PRs can evict a workstream subdomain and
break a link that has already been sent to a customer.

## Custom domains

Production-only. A named environment cannot have one. If a demo needs a branded
URL, it goes on production and gets a route.

## Routing configuration

`staticwebapp.config.json` in the generated app:

```json
{
  "navigationFallback": { "rewrite": "/index.html" },
  "trailingSlash": "auto"
}
```

`trailingSlash: auto` normalises, which means `/urls` and `/urls/` are the **same
route**. Declaring both is a duplicate and a hard build failure. The route gate
catches it in a second instead of a deploy cycle.

The navigation fallback is what makes hash-free deep links work. Without it,
loading a sub-path directly returns 404 from storage before the app ever boots.

## Deploy model

Deploys run on **push**, not on pull request.

- `main` publishes production.
- A mapped branch publishes to its own named environment.
- An unmapped branch fails the build on purpose, so it can never deploy over production.

## Creating the app

```bash
node $DF deploy --name contoso-demo --resource-group rg-demos --dry-run
```

Prints the plan and touches nothing. Read it, then drop `--dry-run`:

```bash
node $DF deploy --name contoso-demo --resource-group rg-demos --repo owner/repo
```

This creates the resource group if missing, creates the Static Web App, reads the
deployment token, and sets it as `AZURE_STATIC_WEB_APPS_API_TOKEN` on the repo.

The token is a deploy credential. It is set as a secret through `gh` and never
written to a file. Do not paste it into a workflow, a README or a chat.

## Checking what exists

```bash
node $DF deploy --name contoso-demo --resource-group rg-demos --status
```

Lists environments with hostnames and how many of the quota are used. Run it
before adding a branch environment on a Free plan.

## Region

`--location` defaults to `eastus2`. Static Web Apps are globally distributed, so
the region affects where the managed functions run and where the resource is
billed, not where the static content is served from. Match the resource group's
region unless there is a reason not to.
