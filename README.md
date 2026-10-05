# Nex-auth

Nex-auth is a centralized authentication service and TypeScript SDK for **Continue with Google**, **Continue with GitHub**, and **Continue with ENVX** (OIDC) across multiple applications. Each application registers a project and uses the same auth service, while upstream provider credentials and user sessions remain on the server.

> The npm package is an SDK, not a place to store OAuth secrets. The server is the identity authority; the SDK only starts redirects and reads the authenticated session.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/server` | Central OAuth/OIDC callback service, PostgreSQL and Paradox persistence adapters, project allowlists, and secure session cookies. |
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

The callback is centralized: applications send Google, GitHub, or ENVX to Nex-auth, which validates the upstream identity and sends the user back to that project's exact registered redirect URI.

Google should be configured with the `openid`, `email`, and `profile` scopes. GitHub should be configured with `read:user` and `user:email` scopes. ENVX should use its existing Supabase Auth OAuth Server project with an exact Nex-auth callback, an asymmetric JWT signing key, and the `openid email profile` scopes. Never commit provider secrets or the admin token.

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
(document.querySelector('#envx') as HTMLButtonElement).onclick = () => auth.signInWithEnvx({
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

The Vercel deployment uses the existing Paradox-db gateway as the persistent store. It does not create PostgreSQL or a new database. Configure the canonical secret-bearing `DATABASE_URL` using the `parad://` format expected by the adapter (not a raw PostgreSQL URL). A warm serverless instance keeps one encrypted database connection in memory, explicitly pulls the remote snapshot before initialization and before writes, never uploads snapshots for read-only requests, and pushes only after successful mutations. If the remote snapshot cannot be loaded, the handler fails closed instead of serving an empty database.

Set the following Vercel environment variables before deploying:

```text
NEX_AUTH_PUBLIC_URL
NEX_AUTH_ADMIN_TOKEN
DATABASE_URL=parad://<API_KEY>@local/<PROJECT>/<DATABASE>?passphrase=<URL_ENCODED_PASSPHRASE>&gateway=https://paradox-db.wasmer.app/v1
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
ENVX_OIDC_ISSUER_URL=https://<project-ref>.supabase.co/auth/v1
ENVX_OIDC_CLIENT_ID
ENVX_OIDC_CLIENT_SECRET
```

The URL must point to the existing Paradox project/database and current Wasmer gateway; keep its API key and passphrase inside Vercel's encrypted environment settings. Preserve existing Google/GitHub credentials. Register the ENVX OIDC client with the exact Nex-auth callback `https://nexuss-auth.vercel.app/oauth/callback`; set `ENVX_OIDC_ISSUER_URL` to the issuer discovered from the existing Supabase project. Do not commit any secret-bearing URL or credential.
