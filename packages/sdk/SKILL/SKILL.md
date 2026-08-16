# Nexuss-auth AI Skill

## Purpose

Use this skill when an AI agent must add authentication to an application, create or manage a Nexuss-auth project, connect Google or GitHub sign-in, inspect an authenticated user, or operate the Nexuss-auth service through the SDK, CLI, or HTTP API.

Nexuss-auth is a centralized authentication service. An application registers one project, sends users to Nexuss-auth for Google or GitHub sign-in, and receives the user back at the application’s registered redirect address. Nexuss-auth owns the provider exchange and session. The application consumes the authenticated user through the SDK or session API.

Read this file first. Then read only the reference file required for the current task:

| Task | Read |
|---|---|
| Add sign-in to an application | [`INTEGRATION.md`](./INTEGRATION.md) |
| Call or explain HTTP endpoints | [`API.md`](./API.md) |
| Create or update projects with an agent | [`AUTOMATION.md`](./AUTOMATION.md) |
| Deploy, troubleshoot, or operate production | [`OPERATIONS.md`](./OPERATIONS.md) |

## Non-negotiable rules

1. **Never place `NEX_AUTH_ADMIN_TOKEN` in browser code.** Use it only in a protected server, CI job, private CLI process, or controlled agent runtime.
2. **Never invent a project ID, redirect address, user identity, provider secret, session cookie, or API response.** Read the current configuration or ask for the missing value.
3. **Use exact redirect addresses.** Register the complete callback address. Do not add wildcards in production.
4. **Use the SDK for normal application integration.** Call the HTTP API directly only when the task requires custom transport, server integration, or API inspection.
5. **Treat the browser session as the user credential.** Send requests with credentials included. Do not copy, decode, log, or expose the HTTP-only cookie.
6. **Keep ownership boundaries intact.** A signed-in user may manage only projects assigned to that user. An automation token is a separate server-side authority.
7. **Do not claim that a user is signed in until `getUser()` or `GET /v1/me` returns a user object.** A successful redirect alone is not proof of an active application session.
8. **Do not retry provider authorization blindly.** First inspect the project ID, redirect address, provider configuration, and server response.
9. **Do not log access tokens, provider secrets, admin tokens, session cookies, OAuth codes, or state values.** Redact these values in diagnostics.
10. **Prefer a safe failure over a guessed recovery.** Stop and report the exact missing input, status code, or validation failure.

## Standard end-to-end workflow

Follow this order unless the user explicitly requests a different operation.

### 1. Identify the application

Collect the application name, public homepage address, application callback address, required providers, and the environment where Nexuss-auth will run. The callback address must be controlled by the application and must be reachable over HTTPS in production.

### 2. Create or locate the Nexuss-auth project

For a normal user, sign in to the Nexuss-auth dashboard and create a project. The project is automatically owned by that signed-in account. For private automation, use the management SDK or CLI with `NEX_AUTH_ADMIN_TOKEN`.

Record these values without exposing secrets:

```text
NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
NEXUSS_AUTH_PROJECT_ID=<project id>
NEXUSS_AUTH_REDIRECT_URI=<exact application callback>
```

### 3. Configure the application

Install `nexuss-auth`, initialize the client with the project ID and service URL, and connect the Google and GitHub actions to the application’s sign-in controls. Use `credentials: include` for direct browser requests.

### 4. Validate the session

After the provider returns to the application, call `auth.getUser()`. If it returns `null`, show the signed-out state. If it returns a user, create the application session state from that response. Do not trust client-provided identity fields without asking Nexuss-auth.

### 5. Handle logout

Call `auth.logout()` and clear application-local user state. Redirect the user to a signed-out page. Do not attempt to delete or edit a Nexuss-auth cookie from browser JavaScript.

### 6. Test ownership

Create a project as account A, sign out, sign in as account B, and confirm account B cannot list, read, or update account A’s project. Perform this test before declaring a multi-user deployment ready.

## Supported providers

Nexuss-auth currently supports:

| Provider | SDK method | OAuth start route |
|---|---|---|
| Google | `signInWithGoogle()` | `/oauth/start/google` |
| GitHub | `signInWithGitHub()` | `/oauth/start/github` |

Provider secrets belong only in the Nexuss-auth server configuration. An application does not receive Google or GitHub provider secrets.

## Response handling

Use this decision table for common responses:

| Response | Agent action |
|---|---|
| `200` with a user | Treat the application session as signed in. |
| `200` with `user: null` | Treat the application session as signed out and show sign-in. |
| `302` from OAuth start | Continue the browser redirect; do not parse it as an API JSON response. |
| `400` | Check the project ID, required query values, URL format, or missing project. |
| `401` | Re-authenticate or check whether the server credential is missing or invalid. |
| `403` | Stop. The caller is authenticated but outside the project’s ownership or permission boundary. |
| `404` | Check the endpoint path and project ID. Do not create a replacement project automatically. |
| `409` | The project ID or resource conflicts with an existing record. Inspect before retrying. |
| `5xx` | Preserve the user’s form data, record the request context without secrets, and retry only after checking service health or deployment logs. |

## AI agent operating contract

When asked to integrate Nexuss-auth, the agent must first state which values are available and which values are missing. It must then choose one of these modes:

| Mode | Credential | Appropriate use |
|---|---|---|
| Application session | HTTP-only browser cookie | Sign users in and read the current user. |
| User project management | Signed-in dashboard session | Let an ordinary user create and manage their own projects. |
| Server automation | `NEX_AUTH_ADMIN_TOKEN` | Manage projects from a private server, CI job, CLI, or agent process. |

The agent must not mix these modes. A browser must never receive the automation token. An automation process must not pretend to be an ordinary user. If the user asks for a project operation but has not chosen a mode, ask whether the operation is for a signed-in person or protected automation.

## Definition of done

An integration is complete only when all of the following are true:

- The project ID and exact callback address are configured.
- Google and/or GitHub sign-in starts from the intended application control.
- The callback returns to the application.
- `getUser()` returns the expected user after sign-in.
- Logout clears the application session and Nexuss-auth session.
- A second user cannot access the first user’s projects.
- No provider secret, admin token, OAuth code, or session cookie appears in source, logs, browser storage, or error messages.
- The application handles `user: null`, validation errors, authorization errors, and service errors without losing user input.

For exact endpoint contracts, use [`API.md`](./API.md). For code integration, use [`INTEGRATION.md`](./INTEGRATION.md). For agent and CLI project management, use [`AUTOMATION.md`](./AUTOMATION.md). For production checks, use [`OPERATIONS.md`](./OPERATIONS.md).
