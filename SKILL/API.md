# Direct API guide

Use direct HTTP only when the SDK or CLI cannot complete the immediate task. Prefer the SDK for application sign-in, the CLI for account-scoped project management, and protected automation only for deliberate cross-project administration.

## Base URL and authority

The production base URL is `https://nexuss-auth.vercel.app`. Use the deployed service URL for the target environment.

| Use case | Credential | Where it may be used |
|---|---|---|
| Browser application session | Nexuss Auth HTTP-only cookie | Browser requests only |
| Project-scoped management | Browser CLI session or `nxa_` token | CLI or trusted local agent only |
| Protected automation | `NEX_AUTH_ADMIN_TOKEN` | Protected server or CI only |
| Cross-site application handoff | No management token | Application server sends the one-time handoff token with project ID |

Never send an admin credential, project token, provider secret, cookie, OAuth code, state value, or handoff token to an untrusted browser client.

## Public and application routes

| Route | Method | Purpose | Required handling |
|---|---:|---|---|
| `/health` | `GET` | Service availability | A successful result does not prove project or provider correctness |
| `/oauth/start/google` | `GET` | Start Google sign-in | Navigate the browser with `project_id`, exact `redirect_uri`, and optional `handoff=1` |
| `/oauth/start/github` | `GET` | Start GitHub sign-in | Navigate the browser with `project_id`, exact `redirect_uri`, and optional `handoff=1` |
| `/oauth/callback` | `GET` | Provider callback handled by Nexuss Auth | Do not call directly from application code |
| `/v1/me` | `GET` | Read the current Nexuss Auth identity | Use browser credentials and project context; `user: null` means signed out |
| `/v1/logout` | `POST` | Clear the Nexuss Auth session | Clear application-local state separately |
| `/v1/handoff/exchange` | `POST` | Exchange a one-time server handoff | Call only from the trusted application server; never from browser code |
| `/v1/projects` | `GET`, `POST` | List or create projects within caller scope | Use CLI or protected automation; inspect before mutation |
| `/v1/projects/:projectId` | `GET`, `PATCH`, `DELETE` | Inspect, minimally update, or explicitly delete one project | Preserve ownership and exact configuration |

## OAuth start

Start OAuth by browser navigation, not by expecting a JSON response:

```text
https://nexuss-auth.vercel.app/oauth/start/google?project_id=PROJECT_ID&redirect_uri=ENCODED_CALLBACK
```

For a cross-site application, add `handoff=1`. Nexuss Auth validates that the project is active and that the requested provider is enabled before checking the exact redirect URI.

## Browser identity

```ts
const response = await fetch(`${authUrl}/v1/me?project_id=${encodeURIComponent(projectId)}`, {
  credentials: 'include',
  headers: { 'x-nex-auth-project': projectId },
});

if (!response.ok) throw new Error(`Nexuss Auth user lookup failed: ${response.status}`);
const { user } = await response.json();
```

A successful response is either `{ "user": { ... } }` or `{ "user": null }`. Both are valid `200` responses.

## Server-side handoff exchange

When the callback receives `handoff_token`, the application server exchanges it once:

```ts
const response = await fetch(`${authUrl}/v1/handoff/exchange`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ projectId, handoffToken }),
});

if (response.status === 401) throw new Error('Handoff is invalid, expired, or already used');
if (!response.ok) throw new Error(`Handoff exchange failed: ${response.status}`);
const { user } = await response.json();
```

The exchange consumes the handoff record. A replay must fail. The application must create its own secure session from the verified user and then redirect to a clean URL.

## Project management payloads

Create requests require `projectId`, `name`, `homepageUrl`, at least one `allowedRedirectUris` entry, `enabledProviders`, and `status`. `allowedOrigins` should contain the exact application origins. Patch only fields that the task changes. Inspect before patch or delete.

## Status handling

| Status | Meaning | Action |
|---:|---|---|
| `200` | Request succeeded | Validate the response body and session state |
| `302` | OAuth navigation started or callback completed | Follow as browser navigation; do not parse as an API success |
| `400` | Invalid project, provider, callback, or payload | Correct the supplied value before retrying |
| `401` | Signed out, invalid credential, or invalid handoff | Re-authenticate or start a fresh handoff |
| `403` | Authority or origin not permitted | Stop and correct scope or origin |
| `404` | Route or project not found | Recheck the route and project ID; do not create a substitute automatically |
| `409` | Project ID or mutation conflict | Inspect the existing project before retrying |
| `5xx` | Service, provider, or persistence failure | Check `/health` and protected logs, then recover deliberately |

Never log authorization headers, cookies, full tokens, OAuth codes, state values, handoff tokens, or complete provider authorization URLs.

## 10. Central GitHub repository authorization

Use the GitHub OAuth start route with `purpose=github_authorization` only when a configured relying application needs repository access:

```text
GET /oauth/start/github?project_id=PROJECT_ID&redirect_uri=ENCODED_CALLBACK&handoff=1&purpose=github_authorization
```

The callback remains `/oauth/callback` on Nexuss Auth. After the relying application exchanges the one-time handoff, the successful response may include an opaque `githubGrantToken`. The application server may use that value, with the same `project_id`, on:

```text
GET /v1/github/repositories?project_id=PROJECT_ID
GET /v1/github/clone-token?project_id=PROJECT_ID
```

The repositories response contains repository metadata only. The clone-token response is for a trusted application server performing an immediate clone. Do not send it to browser code, persist it in the relying application, include it in a URL, or log it. Nexuss Auth retains the actual GitHub provider token and checks the grant’s project and expiry on every request.

A relying application must not configure `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET`; those credentials belong only to Nexuss Auth. `401` responses from either repository route mean the grant or central GitHub connection is missing, expired, or invalid and require a fresh authorization navigation.
