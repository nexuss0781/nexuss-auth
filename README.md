# Nex-auth

Nex-auth is a centralized authentication service and TypeScript SDK for adding **Continue with Google** and **Continue with GitHub** to multiple applications. Each application registers a project and uses the same auth service, while OAuth client secrets and user sessions remain on the server.

> The npm package is an SDK, not a place to store OAuth secrets. The server is the identity authority; the SDK only starts redirects and reads the authenticated session.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/server` | Central OAuth callback service, PostgreSQL persistence, project allowlists, and secure session cookies. |
| `packages/sdk` | Framework-agnostic browser SDK published as `nexuss-auth`. |
| `apps/dashboard` | Static Nexuss-auth Control Plane dashboard for owner-managed projects. |
| `packages/server/sql/schema.sql` | PostgreSQL schema for projects, users, identities, OAuth state, and sessions. |

## Local setup

Nex-auth requires Node.js 20 or newer and PostgreSQL. Install dependencies and build the workspace:

```bash
npm install
npm run build
```

Apply the schema to PostgreSQL:

```bash
psql "$DATABASE_URL" -f packages/server/sql/schema.sql
```

Copy `packages/server/.env.example` to `packages/server/.env` and set the provider credentials. The server entrypoint expects environment variables to be loaded by the process manager or shell; for a local shell, use an environment loader such as `dotenvx`, or export the variables directly.

Start the server after compiling:

```bash
node packages/server/dist/index.js
```

The service exposes `GET /health` and listens on port `8787` by default.

## OAuth provider configuration

Set the OAuth callback URL in both provider dashboards to:

```text
https://auth.example.com/oauth/callback
```

The callback is centralized: every application sends Google or GitHub to Nex-auth, and Nex-auth sends the user back to the application redirect URI registered for that project.

Google should be configured with the `openid`, `email`, and `profile` scopes. GitHub should be configured with `read:user` and `user:email` scopes. Never commit provider secrets or the admin token.

## Register an application project

Project registration is protected by `NEX_AUTH_ADMIN_TOKEN`:

```bash
curl -X POST https://auth.example.com/v1/projects \
  -H "Authorization: Bearer $NEX_AUTH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-dashboard",
    "name": "My Dashboard",
    "homepageUrl": "https://dashboard.example.com",
    "description": "Customer account access.",
    "avatarUrl": null,
    "allowedRedirectUris": ["https://dashboard.example.com/login"],
    "allowedOrigins": ["https://dashboard.example.com"],
    "enabledProviders": ["google", "github"],
    "status": "active"
  }'
```

Redirect URIs are exact-match allowlisted. Do not use a wildcard in production.

## Project management API and CLI

The management API supports `GET /v1/projects`, `POST /v1/projects`, `GET /v1/projects/:projectId`, and `PATCH /v1/projects/:projectId`. A signed-in user manages projects through their HTTP-only Nexuss-auth session, and every project created by that user is automatically assigned to their user ID. Project list, read, and update operations are owner-scoped, so users cannot access another user’s projects. CLI and server-to-server callers may use `NEX_AUTH_ADMIN_TOKEN` as an automation credential; the browser dashboard never receives this token.

The source package exposes portable project commands after it is built or published:

```bash
export NEXUSS_AUTH_URL=https://auth.example.com
export NEXUSS_AUTH_ADMIN_TOKEN=your-server-only-admin-token

nexuss-auth project list
nexuss-auth project inspect --id my-dashboard
nexuss-auth project create \
  --id my-dashboard \
  --name "My Dashboard" \
  --home https://dashboard.example.com \
  --redirect https://dashboard.example.com/login
```

Treat `NEXUSS_AUTH_ADMIN_TOKEN` as an automation and server secret. Do not put it in a browser, frontend build environment, or client-side agent prompt.

## Use the SDK

Install the SDK in an application:

```bash
npm install nexuss-auth
```

Initialize it once:

```ts
import { createAuth } from 'nexuss-auth';

const auth = createAuth({
  projectId: 'my-dashboard',
  authUrl: 'https://auth.example.com',
});

(document.querySelector('#google') as HTMLButtonElement).onclick = () => auth.signInWithGoogle({
  redirectUri: 'https://dashboard.example.com/auth/callback',
});
(document.querySelector('#github') as HTMLButtonElement).onclick = () => auth.signInWithGitHub({
  redirectUri: 'https://dashboard.example.com/auth/callback',
});

const user = await auth.getUser();
if (user) console.log(`Signed in as ${user.name ?? user.email ?? user.id}`);

await auth.logout();
```

For server-rendered applications, generate a login URL without using browser globals. For a cross-site deployment, request a server-side handoff:

```ts
const url = auth.getLoginUrl('google', {
  redirectUri: 'https://dashboard.example.com/auth/callback',
  handoff: true,
});
```

The callback receives a short-lived, one-time `handoff_token`. The application server must exchange it through `POST /v1/handoff/exchange` with the project ID, create its own HTTP-only session, and then redirect to a clean application URL. Never exchange the handoff token in browser code.

The SDK sends credentials with requests so a same-site browser can use the HTTP-only session cookie. The application origin must correspond to an allowlisted redirect URI origin, and the auth service must return the appropriate CORS headers. Use the handoff flow when the application and auth service are cross-site.

## Security model

Nex-auth stores only SHA-256 hashes of OAuth state values, session tokens, and handoff records. OAuth state and handoff records are one-time use and expire quickly. Sessions are HTTP-only, `SameSite=Lax`, and `Secure` when the service public URL uses HTTPS. Provider credentials and the admin token are server-side secrets. Production deployments must use HTTPS, a managed PostgreSQL instance or the supported Paradox adapter, secret injection, exact redirect allowlists, rate limiting at the edge, structured logging without token values, and scheduled cleanup of expired state, sessions, and handoff records.

This initial version intentionally keeps the persistence contract separate from the HTTP layer so a future adapter can support another database without changing the SDK API.

## Vercel deployment with Paradox-db

The Vercel deployment uses the existing Paradox-db gateway as the persistent store. It does not create PostgreSQL or a new database. A warm serverless instance keeps one encrypted database connection in memory, explicitly pulls the remote snapshot before initialization and before writes, never uploads snapshots for read-only requests, and pushes only after successful mutations. If the remote snapshot cannot be loaded, the handler fails closed instead of serving an empty database.

Set the following Vercel environment variables before deploying:

```text
NEX_AUTH_PUBLIC_URL
NEX_AUTH_ADMIN_TOKEN
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
PARADOX_GATEWAY_URL
PARADOX_API_KEY
PARADOX_PASSPHRASE
PARADOX_PROJECT
PARADOX_DATABASE
```

`PARADOX_PROJECT` and `PARADOX_DATABASE` must identify the same production Paradox project and database that contain the Nexuss Auth records. The handler also accepts the aliases `PARADOX_PROJECT_NAME` and `PARADOX_DATABASE_NAME`, but the canonical names above are recommended.

Use the gateway base URL including `/v1`, for example `https://paradox-db.onrender.com/v1`. `PARADOX_API_KEY` must be an API key issued by the Paradox-db gateway. `PARADOX_PASSPHRASE` is the encryption passphrase for the Nex-auth database; generate a long random value and keep it in Vercel secrets. The Vercel callback URL is `/oauth/callback` on the deployed auth domain and must be registered in both OAuth provider dashboards.
