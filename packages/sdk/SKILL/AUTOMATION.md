# Protected automation guide

Use this file only when the task explicitly requires protected server or CI authority across projects. For an account-scoped implementation task, use [`CLI.md`](./CLI.md) instead.

## Authority

Use `NEX_AUTH_ADMIN_TOKEN` only in a protected runtime:

```text
NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
NEX_AUTH_ADMIN_TOKEN=<protected-secret>
```

Do not place this token in browser code, repository files, local project files, logs, prompts, or agent output. Do not use it to bypass an account-scoped task when a user CLI token is available.

## Agent procedure

1. Confirm that cross-project administration is required.
2. Read the current project record before mutation.
3. Compute the smallest create or patch payload.
4. Preserve redirect URIs, origins, providers, avatar, description, and status unless explicitly changed.
5. Verify the resulting record and report only non-secret fields.

## SDK pattern

```ts
import { createManagementClient } from 'nexuss-auth';

const management = createManagementClient({
  authUrl: process.env.NEXUSS_AUTH_URL!,
  adminToken: process.env.NEX_AUTH_ADMIN_TOKEN!,
});

const current = await management.getProject(projectId);
const updated = await management.updateProject(projectId, patch);
```

## Safe mutation rules

Project creation is not safe to repeat blindly. On an uncertain result, inspect by project ID before retrying. For updates, retry only known transient `5xx` failures with bounded delays. Do not retry `400`, `401`, `403`, `404`, or `409` without a corrected input or authority.

When changing a callback, register and test the new exact callback before removing the old one. When disabling a provider, confirm that the task intends to prevent new sign-ins through it. Do not disable both providers without explicit instruction.

## Isolation verification

Before declaring a multi-account implementation complete, verify that a separate account-scoped credential cannot list, read, update, or delete a project outside its ownership. Admin authority may access management scope; account-scoped credentials may not.
