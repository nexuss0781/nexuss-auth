# Nexuss-auth private automation

Use this guide when an AI agent, server, CI job, or CLI must create or manage projects.

## Authority model

Private automation uses `NEX_AUTH_ADMIN_TOKEN`. This credential is stronger than an ordinary user session and must remain outside browser code.

Store it in a protected secret store:

```text
NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
NEXUSS_AUTH_ADMIN_TOKEN=<protected value>
```

An agent must not ask an ordinary end user to paste the admin token into a browser form. If the token is missing, ask the operator to configure it in the protected runtime or use the signed-in dashboard flow instead.

## SDK quick start

```ts
import { createManagementClient } from 'nexuss-auth';

const management = createManagementClient({
  authUrl: process.env.NEXUSS_AUTH_URL!,
  adminToken: process.env.NEXUSS_AUTH_ADMIN_TOKEN!,
});

const projects = await management.listProjects();
```

Create a project:

```ts
const project = await management.createProject({
  projectId: 'my-dashboard',
  name: 'My Dashboard',
  homepageUrl: 'https://dashboard.example.com',
  description: 'Customer account access.',
  avatarUrl: null,
  allowedRedirectUris: ['https://dashboard.example.com/auth/callback'],
  allowedOrigins: ['https://dashboard.example.com'],
  enabledProviders: ['google', 'github'],
  status: 'active',
});
```

Read and update a project:

```ts
const current = await management.getProject('my-dashboard');

const updated = await management.updateProject('my-dashboard', {
  enabledProviders: ['google'],
  status: 'active',
});
```

## CLI quick start

Install or build the package that contains the CLI, then set protected environment values:

```bash
export NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
export NEXUSS_AUTH_ADMIN_TOKEN=your-server-only-token
```

List projects:

```bash
nexuss-auth project list
```

Inspect one project:

```bash
nexuss-auth project inspect --id my-dashboard
```

Create a project:

```bash
nexuss-auth project create \
  --id my-dashboard \
  --name "My Dashboard" \
  --home https://dashboard.example.com \
  --redirect https://dashboard.example.com/auth/callback \
  --provider google \
  --provider github
```

Update a project:

```bash
nexuss-auth project update \
  --id my-dashboard \
  --name "Customer Dashboard" \
  --status active \
  --provider google
```

Run `nexuss-auth --help` or `nexuss-auth project --help` when exact local command options are uncertain. Do not guess option names.

## Agent project lifecycle

When an agent is asked to prepare authentication for an application, follow this sequence:

1. Read the application’s current public URL, callback route, and environment conventions.
2. Search existing Nexuss-auth projects by stable project ID before creating anything.
3. If a matching project exists, inspect it and compare every redirect and origin value.
4. If no matching project exists, propose a project ID and show the exact callback address before creation when the operation is consequential.
5. Create only after the project values are complete and valid.
6. Return the project ID, enabled providers, and registered callback address. Never return the admin token.
7. Integrate the SDK using the project ID and public service URL.
8. Test sign-in, current-user lookup, logout, and ownership boundaries.

## Safe update behavior

Before changing a project, fetch its current record. Compute the smallest update needed. Preserve existing redirect addresses, allowed origins, provider choices, avatar, description, and status unless the user explicitly requests a change.

When changing a redirect address:

1. Verify that the new address is controlled by the application.
2. Add or replace the exact address in the project configuration.
3. Update the provider console callback configuration if required.
4. Test the full browser redirect.
5. Remove the old address only after the new address succeeds, unless the user asks for immediate removal.

When disabling a provider, warn that users will no longer be able to begin new sign-ins with that provider. Do not disable both providers without explicit confirmation.

## Idempotency and retries

Project creation is not automatically safe to repeat. Before retrying a failed creation request, list or inspect the project ID. If it exists, compare the record rather than sending another create request.

For updates, retry only when the request is known to have failed before reaching the service. If the result is unknown, inspect the project first. Use bounded retries with increasing delays for temporary `5xx` responses. Never retry `400`, `401`, `403`, `404`, or `409` without correcting the underlying condition.

## Agent output rules

An agent may report:

- Project ID.
- Project name.
- Homepage address.
- Registered redirect addresses.
- Enabled providers.
- Project status.
- Non-secret API status codes.

An agent must not report:

- Admin token.
- Provider client secret.
- OAuth authorization code.
- Session cookie.
- Full authorization URL containing sensitive state.
- Raw database credentials.

## Ownership verification procedure

For a user-facing product, never use the admin token to imitate ordinary user behavior. Test with two real user sessions:

| Test | Expected result |
|---|---|
| Account A creates project A | Project A is visible to A. |
| Account B lists projects | Project A is not visible to B. |
| Account B reads project A directly | Request is rejected. |
| Account B updates project A | Request is rejected. |
| Admin automation lists projects | Authorized server process may access management scope. |

Record only the status and outcome, never cookies or tokens.
