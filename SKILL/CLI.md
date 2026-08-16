# Nexuss-auth CLI guide for AI agents

Use this guide when an AI agent must authenticate the Nexuss CLI, create or manage an account-owned project, use a user API token, synchronize a local project file, or diagnose a CLI failure.

The CLI is installed as `nexuss` by the Python package `nexuss-auth`. It manages **only the signed-in user's projects** when used with either a browser session or that user's API token. It is not the private admin-management interface.

## First decision: choose the correct authority

Choose the authority before running a command. Never substitute one authority for another.

| Authority | Credential | What it can do | Use it when |
|---|---|---|---|
| Browser session | Created by `nexuss login` | Create, list, inspect, update, and delete the signed-in user's projects; create, list, and revoke that user's API tokens | A person can complete browser login or must administer tokens |
| User API token | `nxa_...` activated by `nexuss token use` | Create, list, inspect, update, and delete only the token owner's projects | An agent or CI job must manage one user's projects without browser login |
| Private admin automation | `NEX_AUTH_ADMIN_TOKEN`, used through protected server tooling | Cross-project server administration | A protected server or operator task explicitly requires admin scope |

> Never place `NEX_AUTH_ADMIN_TOKEN` in an application browser, a user-facing terminal command, source code, a local project file, or agent output. Never use an admin credential to imitate a user.

## Required inputs before a project operation

Collect only the values required for the requested operation. Do not guess any value.

| Operation | Required values |
|---|---|
| Browser login | Provider, if Google is not the desired default |
| Token activation | Full `nxa_...` user token and optional service URL |
| Create project | Project ID, name, homepage URL, exact redirect URI, providers |
| Change a project | Project ID and the smallest requested change |
| Pull project | Project ID on the first pull; file path if not using the default |
| Push project | Existing local project file with `projectId` |

For a production project, the homepage and redirect URI must use addresses controlled by the application. Register the exact redirect URI, including its scheme, hostname, path, and trailing slash behavior.

## Installation and command discovery

Install or upgrade the released CLI:

```bash
pip install --upgrade nexuss-auth
```

Use the command help before assuming an option exists:

```bash
nexuss --help
nexuss project --help
nexuss project create --help
nexuss project pull --help
```

For scripts and agents, add `--json` before the command group whenever structured output is supported:

```bash
nexuss --json project list
nexuss --json project show --id my-project
```

The CLI stores its local credential in `~/.config/nexuss-auth/session.json` by default. Set `NEXUSS_AUTH_CONFIG_DIR` to use an isolated configuration directory, for example in a CI runner. The credential file is written with restrictive permissions where the platform supports them.

```bash
export NEXUSS_AUTH_CONFIG_DIR="$HOME/.config/nexuss-agent"
```

Set `NEXUSS_AUTH_URL` only when using a non-default Nexuss-auth deployment. The default service is `https://nexuss-auth.vercel.app`.

```bash
export NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
```

## Browser-session authentication

Use browser login when a person is present or when the task must create, list, or revoke API tokens.

```bash
nexuss login
nexuss whoami
```

Google is the default provider. Select GitHub explicitly when required:

```bash
nexuss login --provider github
nexuss whoami
```

The CLI opens the provider login in a browser and listens only on a temporary loopback address. The browser returns a short-lived Nexuss-auth session to that loopback callback. The agent must not copy, display, log, or persist the loopback `session_token` value.

After login, verify identity before performing a consequential project action:

```bash
nexuss --json whoami
nexuss --json project list
```

Use `nexuss logout` to remove the local CLI credential:

```bash
nexuss logout
```

Logout removes local state only. It does not revoke a separately created API token. Revoke tokens explicitly when they are no longer needed.

## User API-token authentication without browser login

Use this path when an authorized user provides a user-scoped token to an agent or protected CI process. The token must begin with `nxa_`.

```bash
nexuss token use --value nxa_<user-token>
nexuss --json project list
```

`token use` writes the token to the protected CLI session file. It does not need a browser session. It validates the `nxa_` prefix locally; the next authenticated command validates the token with Nexuss-auth.

If the user has not yet created a token, they must first complete browser login and run:

```bash
nexuss token create --label "Agent automation"
```

The full token is shown once. Treat it as a password. Store it in an operating-system credential store or protected secret manager, never in Git, a project file, an application bundle, logs, screenshots, or agent output.

Token administration is deliberately browser-session-only:

```bash
nexuss token list
nexuss token revoke --id <token-id>
```

An API token cannot create, list, or revoke tokens. It cannot access another user's projects. If an API-token command returns `401`, activate a valid replacement token:

```bash
nexuss token use --value nxa_<replacement-token>
```

## Project lifecycle

### List and inspect before changing

Always inspect the current record before changing a project. This prevents accidental replacement of working redirect URIs, provider settings, and descriptions.

```bash
nexuss --json project list
nexuss --json project show --id my-project
# `inspect` is an alias for `show`.
nexuss --json project inspect --id my-project
```

If the project is absent, do not silently create a new project with a different ID. Confirm the intended ID, homepage, redirect URI, and providers first.

### Create a project

Provide every important value explicitly for unattended agent use:

```bash
nexuss --json project create \
  --id my-project \
  --name "My Project" \
  --home https://app.example.com/ \
  --redirect https://app.example.com/auth/callback \
  --description "Customer sign-in for My Project" \
  --icon https://cdn.example.com/my-project.png \
  --provider google \
  --provider github
```

| Option | Meaning | Rule |
|---|---|---|
| `--id` | Stable project identifier | Use lowercase letters, numbers, and hyphens; do not reuse another account's ID |
| `--name` | Human-readable project name | Use the application's real name |
| `--home` | Application homepage | Must be an HTTP or HTTPS URL controlled by the application |
| `--redirect` | OAuth return address | Must be the exact application callback registered for this project |
| `--description` | Project description | Optional but recommended |
| `--icon` | Remote project avatar URL | Optional; use HTTPS in production |
| `--provider` | Enabled provider | Repeat for both `google` and `github` |

If no `--provider` option is supplied, Google and GitHub are enabled by default. The create command prompts for missing required values, so agents should provide `--id`, `--name`, `--home`, and `--redirect` explicitly to avoid waiting for standard input.

### Update only the requested field

Rename a project:

```bash
nexuss --json project rename --id my-project --name "My Project Studio"
```

Replace the enabled provider set:

```bash
nexuss --json project providers --id my-project --provider google --provider github
```

`project providers` replaces the provider list with the providers supplied in that command. Include every provider that must remain enabled. Before disabling a provider, warn that users will no longer be able to start new sign-ins with it.

Set a remote avatar URL:

```bash
nexuss --json project icon --id my-project --icon https://cdn.example.com/my-project.png
```

### Delete only with explicit confirmation

Deletion permanently removes the project record. The CLI asks the operator to type the project ID unless `--yes` is supplied.

```bash
nexuss project delete --id my-project
```

An agent may use `--yes` only after the user explicitly authorized deletion of that exact project ID and the agent has shown or inspected the current project record in the same task.

```bash
nexuss project delete --id my-project --yes
```

## Local project synchronization

The CLI uses `nexuss.yaml.json` by default. Despite the filename, the file contains JSON. It holds public project configuration and must never contain API tokens, browser sessions, provider secrets, or admin credentials.

### First pull: create the local file from the cloud

The first pull needs the cloud project ID because no local file exists yet:

```bash
nexuss project pull --id my-project --file nexuss.yaml.json
```

The command writes the full cloud project record to the file. On later pulls, the CLI can infer the project ID from the existing file:

```bash
nexuss project pull --file nexuss.yaml.json
```

### Safe local editing workflow

Follow this sequence:

```bash
# 1. Download the current cloud record.
nexuss project pull --id my-project --file nexuss.yaml.json

# 2. Edit only the intended public fields in nexuss.yaml.json.

# 3. Inspect differences before writing anything to the cloud.
nexuss project diff --file nexuss.yaml.json

# 4. Push only after the differences are expected.
nexuss --json project push --file nexuss.yaml.json
```

`project push` updates the project identified by the local `projectId`. Do not change `projectId` to a different value in a copied file. If `project pull --id` is used with an existing file whose `projectId` differs, the CLI stops instead of overwriting the wrong project.

## End-to-end AI-agent runbook

Use this procedure for a normal user-owned application project.

1. Confirm the application name, homepage URL, exact callback URL, requested providers, and whether the task allows browser login or supplies an `nxa_` token.
2. Choose browser-session authentication for token administration or human approval; choose user-token authentication for unattended user-scoped work.
3. Authenticate and run `nexuss --json whoami` or `nexuss --json project list` to confirm access.
4. List projects and inspect the candidate project ID before creation or update.
5. Create the project only when all homepage, redirect, provider, and naming values are final.
6. Return only the project ID, homepage, redirect URI, enabled providers, and non-secret command outcome.
7. Configure the application SDK with the returned project ID and the Nexuss-auth service URL.
8. Test Google and GitHub sign-in, `getUser()`, logout, and the exact production redirect route.
9. Verify ownership using a separate user or token: it must not list, inspect, update, or delete the first user's project.
10. Revoke temporary tokens after the task when they are no longer required.

## Error handling

| Result | Meaning | Agent action |
|---|---|---|
| `Not signed in` | No local browser session or API token | Run browser login, or activate an authorized `nxa_` token |
| `This command requires browser sign-in` | Token mode attempted token administration | Run `nexuss login`; do not use the API token for token create/list/revoke |
| `API token is invalid or revoked` | Token cannot authenticate | Ask for a replacement user token and run `nexuss token use` |
| `project_not_found` | Project does not exist or belongs to another user | Recheck the exact ID; do not create a replacement without instruction |
| `project_id_unavailable` | Requested ID is owned by another user | Choose a new approved ID; do not retry the same create blindly |
| `invalid_project_configuration` | URL, provider, project ID, or other project fields are invalid | Inspect the request and correct the exact invalid value |
| `redirect_uri_not_allowed` during sign-in | Application callback is not registered exactly | Update the project redirect URI, then retry the browser flow |
| `401` after browser login | Browser session expired or invalid | Run `nexuss login` again |
| `5xx` or network error | Service or connectivity issue | Preserve inputs, check `GET /health`, then retry only after confirming service recovery |

## Security and reporting rules

An agent may report project ID, name, homepage URL, registered redirect URI, enabled providers, project status, command status, and non-secret errors.

An agent must never report a raw API token, browser session token, HTTP-only cookie, admin token, provider client secret, OAuth authorization code, state value, or an authorization URL containing state.

Do not attempt to decode, copy, or expose Nexuss-auth session cookies. Do not register wildcard redirect URIs in production. Do not claim that sign-in succeeded until the application verifies a user with `auth.getUser()` or `GET /v1/me`.

## Related guides

Read [`INTEGRATION.md`](./INTEGRATION.md) when adding sign-in to an application. Read [`API.md`](./API.md) for HTTP contracts. Read [`AUTOMATION.md`](./AUTOMATION.md) for protected admin automation. Read [`OPERATIONS.md`](./OPERATIONS.md) for deployment and production diagnostics.
