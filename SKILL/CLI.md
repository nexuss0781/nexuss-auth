# CLI execution guide

Use this file only when the task requires the `nexuss` command-line tool. Prefer the CLI for project-scoped agent work; use protected admin tooling only when the task explicitly requires cross-project server authority.

## Setup

```bash
pip install --upgrade nexuss-auth
nexuss --help
```

The default service URL is `https://nexuss-auth.vercel.app`. Set `NEXUSS_AUTH_URL` only for a different deployment. Set `NEXUSS_AUTH_CONFIG_DIR` to isolate local CLI state for an agent or CI run.

```bash
export NEXUSS_AUTH_CONFIG_DIR="$HOME/.config/nexuss-agent"
```

Use `--json` before the command group whenever the agent needs machine-readable output.

```bash
nexuss --json project list
nexuss --json project show --id <project-id>
```

## Choose access mode

| Access mode | Command | Use when |
|---|---|---|
| Browser CLI session | `nexuss login [--provider google|github]` | Interactive authorization is available or token administration is required |
| Existing project token | `nexuss token use --value nxa_<token>` | The task supplies an authorized project-scoped token; no browser login is needed |
| Protected admin workflow | Do not use this CLI path | Use [`AUTOMATION.md`](./AUTOMATION.md) instead |

Verify access before a consequential mutation:

```bash
nexuss --json whoami
nexuss --json project list
```

`nexuss logout` removes local CLI state. It does not revoke a token.

## Token operations

Token creation, metadata listing, and revocation require a browser CLI session. Treat the returned `nxa_` value as a secret and never echo it in a report.

```bash
nexuss token create --label "agent-run"
nexuss token list
nexuss token revoke --id <token-id>
```

Activate a supplied token without browser login:

```bash
nexuss token use --value nxa_<token>
nexuss --json project list
```

An `nxa_` token can list, create, inspect, update, and delete only projects owned by the credential's account. It cannot administer tokens or act as `NEX_AUTH_ADMIN_TOKEN`.

## Project operations

Inspect before mutation:

```bash
nexuss --json project list
nexuss --json project show --id <project-id>
```

Create a project only when all values are known:

```bash
nexuss --json project create \
  --id <project-id> \
  --name "<application-name>" \
  --home https://app.example.com/ \
  --redirect https://app.example.com/auth/callback \
  --provider google \
  --provider github
```

| Command | Effect | Agent rule |
|---|---|---|
| `project rename --id ID --name NAME` | Changes the project name | Inspect first |
| `project providers --id ID --provider PROVIDER ...` | Replaces the enabled-provider set | Include every provider that must remain enabled |
| `project icon --id ID --icon URL` | Changes the avatar URL | Use a durable HTTPS asset URL |
| `project delete --id ID` | Deletes after typed confirmation | Use `--yes` only after explicit authorization for that exact ID |

## Local synchronization

The default local file is `nexuss.yaml.json`, which contains JSON public configuration. Never add a credential to it.

First pull requires an ID because no local file exists:

```bash
nexuss project pull --id <project-id> --file nexuss.yaml.json
```

Use this safe sequence for changes that need local review:

```bash
nexuss project pull --id <project-id> --file nexuss.yaml.json
# edit only intended public fields
nexuss project diff --file nexuss.yaml.json
nexuss --json project push --file nexuss.yaml.json
```

`push` updates the project named by the local `projectId`. Do not repurpose a copied file by changing `projectId`.

## Agent response to failures

| Result | Required action |
|---|---|
| `Not signed in` | Run browser login or activate an authorized `nxa_` token |
| Token invalid or revoked | Activate a replacement token; do not retry the revoked token |
| `project_not_found` | Recheck ID and authority; do not create a replacement automatically |
| `project_id_unavailable` | Choose a confirmed unused ID |
| `invalid_project_configuration` | Correct the exact URL, provider, or project field |
| `401` after browser mode | Re-run `nexuss login` |
| Network or `5xx` failure | Preserve inputs, check `/health`, then retry only after service recovery |

## Minimal agent runbook

1. Determine whether a browser session or `nxa_` token is available.
2. Verify scope with `project list`.
3. Inspect the target project.
4. Apply the smallest requested change.
5. Verify the final record in JSON.
6. Return IDs, URLs, enabled providers, and status only; never return credentials.
