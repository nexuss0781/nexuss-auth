# Nexuss-auth HTTP API

Base URL:

```text
https://nexuss-auth.vercel.app
```

Replace this address with the configured Nexuss-auth service address when operating another deployment. All production traffic must use HTTPS.

## Request identity

There are two supported request identities.

| Caller | How it proves identity | Scope |
|---|---|---|
| Browser application | HTTP-only Nexuss-auth session cookie plus project context | The signed-in user’s own session and projects. |
| User CLI | Short-lived `Authorization: Bearer <session token>` created by browser login | The signed-in user’s own projects. |
| Private automation | `Authorization: Bearer <NEX_AUTH_ADMIN_TOKEN>` | Server-side project administration. |

Never send the admin token from browser JavaScript.

## Health

### `GET /health`

Use this endpoint to check whether the service is responding.

```bash
curl -i https://nexuss-auth.vercel.app/health
```

Expected response:

```json
{"ok":true}
```

Do not use health success as proof that OAuth credentials or a project configuration are valid.

## OAuth start

### `GET /oauth/start/google`

### `GET /oauth/start/github`

Required query parameters:

| Parameter | Required | Meaning |
|---|---:|---|
| `project_id` | Yes | The Nexuss-auth project that owns the sign-in flow. |
| `redirect_uri` | Yes | The exact application address to receive the completed sign-in. |

Example:

```text
https://nexuss-auth.vercel.app/oauth/start/google?project_id=my-dashboard&redirect_uri=https%3A%2F%2Fdashboard.example.com%2Fauth%2Fcallback
```

Expected behavior is an HTTP `302` redirect to Google or GitHub. The service validates the provider, project, redirect address, and origin before starting the flow. It creates short-lived one-time OAuth state and stores it as a hash.

Do not call the OAuth start route with a server-to-server JSON client when the intended result is browser sign-in. Navigate the user’s browser to the URL.

## OAuth callback

### `GET /oauth/callback`

This route is called by Google or GitHub after authorization. The application must register the Nexuss-auth callback address in the provider console:

```text
https://nexuss-auth.vercel.app/oauth/callback
```

Nexuss-auth verifies the one-time state, exchanges the provider code, finds or creates the user record, creates the HTTP-only session, and redirects to the project’s registered application redirect address.

The application should not call this endpoint directly, store the provider code, or attempt to exchange the provider code itself.

## Current user

### `GET /v1/me`

Query parameter:

```text
project_id=<project id>
```

Header:

```text
x-nex-auth-project: <project id>
```

Browser request:

```ts
const response = await fetch(
  'https://nexuss-auth.vercel.app/v1/me?project_id=my-dashboard',
  {
    credentials: 'include',
    headers: { 'x-nex-auth-project': 'my-dashboard' },
  },
);

const payload = await response.json();
```

Signed-in response:

```json
{
  "user": {
    "id": "user_123",
    "email": "person@example.com",
    "name": "Example Person",
    "avatarUrl": "https://provider.example/avatar.png"
  }
}
```

Signed-out response:

```json
{"user":null}
```

Treat both `200` with a user and `200` with `user: null` as valid API responses. The first means signed in; the second means signed out. Do not assume that a browser cookie is valid just because it exists.

## Logout

### `POST /v1/logout`

Browser request:

```ts
await fetch('https://nexuss-auth.vercel.app/v1/logout', {
  method: 'POST',
  credentials: 'include',
  headers: { 'x-nex-auth-project': 'my-dashboard' },
});
```

The service clears the current session. The application must also clear its own in-memory user state and route the user to its signed-out experience.

## Project management

The same project routes support two modes.

### Signed-in user mode

The browser sends the HTTP-only session cookie. Project reads, creates, updates, and deletes are restricted to the authenticated user’s owned projects.

### User CLI mode

The Python CLI opens the Nexuss-auth browser login, receives a short-lived session token through a loopback callback, and sends it as `Authorization: Bearer <session token>`. This is a user session, not an API key. It has the same ownership scope as the signed-in dashboard and must never be replaced with `NEX_AUTH_ADMIN_TOKEN`.

### Private automation mode

A server or CLI sends:

```http
Authorization: Bearer <NEX_AUTH_ADMIN_TOKEN>
```

The browser dashboard never receives this token.

### `GET /v1/projects`

List projects within the caller’s scope.

```bash
curl -sS https://nexuss-auth.vercel.app/v1/projects \
  -H "Authorization: Bearer $NEX_AUTH_ADMIN_TOKEN"
```

Expected shape:

```json
{
  "projects": [
    {
      "projectId": "my-dashboard",
      "name": "My Dashboard",
      "homepageUrl": "https://dashboard.example.com",
      "description": "Customer account access.",
      "avatarUrl": null,
      "allowedRedirectUris": ["https://dashboard.example.com/auth/callback"],
      "allowedOrigins": ["https://dashboard.example.com"],
      "enabledProviders": ["google", "github"],
      "status": "active"
    }
  ]
}
```

### `POST /v1/projects`

Create a project.

Required JSON fields:

| Field | Type | Rule |
|---|---|---|
| `projectId` | string | Lowercase URL-safe identifier, 1–63 characters. |
| `name` | string | User-facing project name. |
| `homepageUrl` | string | Valid HTTP or HTTPS application address. |
| `allowedRedirectUris` | string[] | Exact callback addresses. |
| `allowedOrigins` | string[] | Valid origin addresses. |
| `enabledProviders` | `("google" | "github")[]` | Select one or both supported providers. |
| `status` | `"active" | "disabled"` | Use `active` for normal sign-in. |
| `description` | string | Optional product description. |
| `avatarUrl` | string or null | Optional project avatar address or stored image value. |

Automation example:

```bash
curl -X POST https://nexuss-auth.vercel.app/v1/projects \
  -H "Authorization: Bearer $NEX_AUTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId":"my-dashboard",
    "name":"My Dashboard",
    "homepageUrl":"https://dashboard.example.com",
    "description":"Customer account access.",
    "avatarUrl":null,
    "allowedRedirectUris":["https://dashboard.example.com/auth/callback"],
    "allowedOrigins":["https://dashboard.example.com"],
    "enabledProviders":["google","github"],
    "status":"active"
  }'
```

### `GET /v1/projects/:projectId`

Read one project. URL-encode the project ID. The server enforces the caller’s scope.

```bash
curl -sS https://nexuss-auth.vercel.app/v1/projects/my-dashboard \
  -H "Authorization: Bearer $NEX_AUTH_ADMIN_TOKEN"
```

### `PATCH /v1/projects/:projectId`

Update only the fields that must change. Do not send a replacement object unless the application intends to replace every mutable setting.

```bash
curl -X PATCH https://nexuss-auth.vercel.app/v1/projects/my-dashboard \
  -H "Authorization: Bearer $NEX_AUTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "enabledProviders":["google"],
    "status":"active"
  }'
```

### `DELETE /v1/projects/:projectId`

Delete a project within the caller’s scope. The service returns `204` after a successful deletion. The CLI requires an explicit project-ID confirmation unless `--yes` is supplied for controlled automation.

## CORS and browser rules

The application origin must be derived from a project’s allowlisted redirect origins. Browser requests that use the session must include credentials. If the browser receives a CORS error, check the project’s `allowedOrigins`, the request origin, and the service’s CORS response before changing application code.

## Error handling

| Status | Meaning | Required action |
|---:|---|---|
| `400` | Missing, malformed, or disallowed input | Correct the project ID, URL, provider, or payload. |
| `401` | No valid session or invalid admin token | Sign in again or replace the protected automation credential. |
| `403` | Authenticated caller is outside the allowed scope | Stop and inspect ownership. Never bypass with a browser token. |
| `404` | Unknown endpoint or project | Confirm the URL and project ID. |
| `409` | Existing project or conflicting state | Inspect before retrying. |
| `500` | Server or persistence failure | Check service logs and health; preserve user data and retry deliberately. |

The API may return an error object such as:

```json
{"error":"unauthorized"}
```

Do not expose raw server errors to end users. Record a safe request ID or status code instead.
