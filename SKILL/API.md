# Direct API execution guide

Use direct HTTP only when the SDK or CLI cannot complete the immediate task. Prefer the SDK for browser integration and [`CLI.md`](./CLI.md) for project-scoped agent work.

Base URL: `https://nexuss-auth.vercel.app`. Use HTTPS in production.

## Select identity before calling

| Use case | Credential |
|---|---|
| Browser application session | HTTP-only cookie with `x-nex-auth-project` |
| Project-scoped agent work | Browser CLI session bearer or `nxa_` token through the CLI |
| Protected server automation | `Authorization: Bearer <NEX_AUTH_ADMIN_TOKEN>` |

Never send an admin credential to a browser. A project-scoped credential can access only its own projects.

## Routes and required handling

| Route | Method | Agent use |
|---|---|---|
| `/health` | `GET` | Confirm service availability; not OAuth correctness |
| `/oauth/start/google` | `GET` | Navigate browser with `project_id` and exact `redirect_uri` |
| `/oauth/start/github` | `GET` | Navigate browser with `project_id` and exact `redirect_uri` |
| `/oauth/callback` | `GET` | Provider-only callback; do not call directly |
| `/v1/me` | `GET` | Read current browser identity; `200` with `user: null` is signed out |
| `/v1/logout` | `POST` | Clear service session, then clear local application state |
| `/v1/projects` | `GET`, `POST` | List or create within caller scope |
| `/v1/projects/:projectId` | `GET`, `PATCH`, `DELETE` | Inspect, minimally update, or explicitly delete within caller scope |
| `/v1/tokens` | `GET`, `POST` | Browser-session token metadata and creation |
| `/v1/tokens/:tokenId` | `DELETE` | Browser-session token revocation |

## Browser session request

```ts
const response = await fetch(`${authUrl}/v1/me?project_id=${encodeURIComponent(projectId)}`, {
  credentials: 'include',
  headers: { 'x-nex-auth-project': projectId },
});
```

`/v1/me` returns either `{ "user": { ... } }` or `{ "user": null }`. Both are valid `200` responses.

## Project payload rules

Create requests require `projectId`, `name`, `homepageUrl`, `allowedRedirectUris`, `allowedOrigins`, `enabledProviders`, and `status`. Use exact redirect URIs and origins. Patch only fields that the task changes. Inspect a project before patch or delete.

## Status handling

| Status | Agent action |
|---:|---|
| `400` | Correct the supplied URL, provider, or payload |
| `401` | Re-authenticate or replace the protected credential |
| `403` | Stop; scope does not permit the operation |
| `404` | Recheck route and project ID; do not create a substitute automatically |
| `409` | Inspect the existing project before retrying |
| `5xx` | Preserve inputs, check `/health`, and retry only after recovery |

Never log authorization headers, cookies, full token values, OAuth codes, state values, or full provider authorization URLs.
