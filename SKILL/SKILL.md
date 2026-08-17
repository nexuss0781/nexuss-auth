# Nexuss Auth agent skill

## Purpose

Use Nexuss Auth only when the assigned task requires sign-in, session recovery, project-scoped OAuth, or controlled project configuration. It is implementation infrastructure, not the task objective. First complete the application or automation task; use this skill only for the authentication decisions needed to complete it safely.

Do not read every reference by default. Select the smallest reference that matches the immediate work.

| Immediate task | Read |
|---|---|
| Add or repair application sign-in or session recovery | [`INTEGRATION.md`](./INTEGRATION.md) |
| Operate the `nexuss` CLI or project token | [`CLI.md`](./CLI.md) |
| Call an OAuth, identity, handoff, or management route directly | [`API.md`](./API.md) |
| Use protected server or CI authority | [`AUTOMATION.md`](./AUTOMATION.md) |
| Deploy, migrate, or diagnose the service | [`OPERATIONS.md`](./OPERATIONS.md) |

## Required decisions before acting

Resolve these facts from the task, project files, or current service state. Do not invent them.

| Fact | Required when |
|---|---|
| Application homepage and exact callback URL | Configuring or changing sign-in |
| Nexuss project ID | Integrating, inspecting, or changing a project |
| Enabled providers | Creating or changing provider behavior |
| Session model: same-site cookie or cross-site handoff | Any application integration |
| Authority mode | Any project-management or automation operation |
| Deployment URL | Calling a non-default Nexuss Auth service |

## Authority boundary

Use one authority mode per operation.

| Mode | Credential | Scope |
|---|---|---|
| Same-site application session | HTTP-only Nexuss Auth cookie | Read the current identity for one application project |
| Cross-site application handoff | No management credential | Exchange a short-lived handoff token on the trusted application server |
| Project-scoped agent work | Browser CLI session or `nxa_` token | Manage only projects owned by that credential’s account |
| Protected automation | `NEX_AUTH_ADMIN_TOKEN` | Server-side administration only |

A management token is never required by a deployed application. Never place `NEX_AUTH_ADMIN_TOKEN`, provider secrets, database credentials, session cookies, OAuth codes, state values, handoff tokens, or full `nxa_` tokens in browser code, source control, local project configuration, logs, prompts, or agent output.

## Execution order

1. Identify whether authentication is actually needed for the primary task.
2. Read the smallest matching reference file.
3. Choose the session model: same-site browser cookie or cross-site server handoff.
4. Inspect the project, provider set, exact callback, allowed origin, and deployment URL.
5. Apply the smallest change that completes the primary task.
6. Verify the result with a non-secret signal: CLI JSON output, route status, `getUser()`, handoff exchange, replay rejection, or a targeted sign-in test.
7. Preserve existing redirect URIs, origins, providers, and status unless the task explicitly changes them.

## Non-negotiable rules

1. Register exact production redirect URIs. Do not use wildcards.
2. Use `auth.getUser()` or `GET /v1/me` for same-site sessions; use `/v1/handoff/exchange` and an application-owned session for cross-site sessions. A redirect alone is not proof of a session.
3. Navigate a browser to OAuth start routes. Do not expect OAuth start routes to return JSON.
4. Treat `200` with `user: null` as a valid signed-out state.
5. Treat a handoff token as short-lived and single-use; exchange it only on the trusted application server.
6. Do not retry `400`, `401`, `403`, `404`, or `409` without correcting the cause.
7. Do not use protected admin authority to bypass project ownership.
8. Stop on an unknown project ID, callback URL, session model, or authority mode instead of guessing.

## Completion check

Authentication work is complete only when the requested application or automation behavior works, the exact callback and origin are registered, the chosen session model is verified end to end, replay and logout behavior are tested, project ownership remains isolated, and no credential or bearer-like value was exposed.

Use [`VERSION.md`](./VERSION.md) to identify this contract revision.
