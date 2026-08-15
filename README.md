# Nex-auth

Nex-auth is a centralized authentication service and TypeScript SDK for adding **Continue with Google** and **Continue with GitHub** to multiple applications. Each application registers a project and uses the same auth service, while OAuth client secrets and user sessions remain on the server.

> The npm package is an SDK, not a place to store OAuth secrets. The server is the identity authority; the SDK only starts redirects and reads the authenticated session.

## Repository layout

| Path | Purpose |
|---|---|
| `packages/server` | Central OAuth callback service, PostgreSQL persistence, project allowlists, and secure session cookies. |
| `packages/sdk` | Framework-agnostic browser SDK published as `@nex-auth/sdk`. |
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
    "allowedRedirectUris": ["https://dashboard.example.com/login"]
  }'
```

Redirect URIs are exact-match allowlisted. Do not use a wildcard in production.

## Use the SDK

Install the SDK in an application:

```bash
npm install @nex-auth/sdk
```

Initialize it once:

```ts
import { createAuth } from '@nex-auth/sdk';

const auth = createAuth({
  projectId: 'my-dashboard',
  authUrl: 'https://auth.example.com',
});

(document.querySelector('#google') as HTMLButtonElement).onclick = () => auth.signInWithGoogle();
(document.querySelector('#github') as HTMLButtonElement).onclick = () => auth.signInWithGitHub();

const user = await auth.getUser();
if (user) console.log(`Signed in as ${user.name ?? user.email ?? user.id}`);

await auth.logout();
```

For server-rendered applications, generate a login URL without using browser globals:

```ts
const url = auth.getLoginUrl('google', {
  redirectUri: 'https://dashboard.example.com/login',
});
```

The SDK sends credentials with requests so the browser can use the HTTP-only session cookie. The application origin must correspond to an allowlisted redirect URI origin, and the auth service must return the appropriate CORS headers.

## Security model

Nex-auth stores only SHA-256 hashes of OAuth state values and session tokens. OAuth state is one-time use and expires quickly. Sessions are HTTP-only, `SameSite=Lax`, and `Secure` when the service public URL uses HTTPS. Provider credentials and the admin token are server-side secrets. Production deployments must use HTTPS, a managed PostgreSQL instance, secret injection, exact redirect allowlists, rate limiting at the edge, structured logging without token values, and scheduled cleanup of expired state and sessions.

This initial version intentionally keeps the persistence contract separate from the HTTP layer so a future adapter can support another database without changing the SDK API.
