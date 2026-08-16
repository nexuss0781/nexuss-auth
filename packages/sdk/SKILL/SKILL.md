# Nexuss-auth agent skill

## Operating principle

Use Nexuss-auth only when the assigned task requires sign-in, session recovery, project-scoped OAuth, or controlled project configuration. It is implementation infrastructure, not the task objective. First complete the application or automation task; use this skill only for the authentication decisions needed to complete it safely.

Do not read every reference by default. Select the smallest reference that matches the immediate work.

| Immediate task | Read |
|---|---|
| Add or repair application sign-in | [`INTEGRATION.md`](./INTEGRATION.md) |
| Operate the `nexuss` CLI | [`CLI.md`](./CLI.md) |
| Call a service route directly | [`API.md`](./API.md) |
| Use protected server or CI authority | [`AUTOMATION.md`](./AUTOMATION.md) |
| Deploy or diagnose the service | [`OPERATIONS.md`](./OPERATIONS.md) |

## Required decisions before acting

Resolve these facts from the task, project files, or current service state. Do not invent them.

| Fact | Required when |
|---|---|
| Application homepage and exact callback URL | Configuring or changing sign-in |
| Nexuss project ID | Integrating, inspecting, or changing a project |
| Enabled providers | Creating or changing provider behavior |
| Authority mode | Any project-management or automation operation |
| Deployment URL | Calling a non-default Nexuss-auth service |

## Authority boundary

Use one authority mode per operation.

| Mode | Credential | Scope |
|---|---|---|
| Application session | HTTP-only cookie | Read the current authenticated identity for one application project |
| Project-scoped agent work | Browser CLI session or `nxa_` token | Manage only projects owned by that credential's account |
| Protected automation | `NEX_AUTH_ADMIN_TOKEN` | Server-side administration only |

Never place `NEX_AUTH_ADMIN_TOKEN`, provider secrets, database credentials, session cookies, OAuth codes, state values, or full `nxa_` tokens in browser code, source control, local project configuration, logs, or agent output.

## Execution order

1. Identify whether authentication is actually needed for the primary task.
2. Read the smallest matching reference file.
3. Inspect existing project configuration before creating or changing anything.
4. Apply the smallest change that completes the primary task.
5. Verify the result with a non-secret signal: CLI JSON output, route status, `getUser()`, or a targeted sign-in test.
6. Preserve existing redirect URIs, origins, providers, and status unless the task explicitly changes them.

## Non-negotiable rules

1. Register exact production redirect URIs. Do not use wildcards.
2. Use `auth.getUser()` or `GET /v1/me` to establish signed-in state; a redirect alone is not proof of a session.
3. Navigate a browser to OAuth start routes. Do not expect OAuth start routes to return JSON.
4. Treat `200` with `user: null` as a valid signed-out state.
5. Do not retry `400`, `401`, `403`, `404`, or `409` without correcting the cause.
6. Do not use protected admin authority to bypass project ownership.
7. Stop on an unknown project ID, callback URL, or authority mode instead of guessing.

## Completion check

Authentication work is complete only when the requested application or automation behavior works, the exact callback is registered, project ownership remains isolated, and no credential was exposed.

Use [`VERSION.md`](./VERSION.md) to identify this contract revision.
