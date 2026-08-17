# Operations guide

Use this guide when deployment, service configuration, schema migration, or runtime diagnosis blocks the primary task.

## Protected service configuration

Keep these values in the protected Nexuss Auth service environment:

```text
NEX_AUTH_PUBLIC_URL=https://auth.example.com
NEX_AUTH_ADMIN_TOKEN=<protected server administration token>
GOOGLE_CLIENT_ID=<protected Google client ID>
GOOGLE_CLIENT_SECRET=<protected Google client secret>
GITHUB_CLIENT_ID=<protected GitHub client ID>
GITHUB_CLIENT_SECRET=<protected GitHub client secret>
PARADOX_GATEWAY_URL=<protected or approved Paradox gateway URL>
PARADOX_API_KEY=<protected Paradox API key>
PARADOX_PASSPHRASE=<protected Paradox passphrase>
```

Never print or commit these values. Provider consoles must register Nexuss Auth’s callback, for example:

```text
https://auth.example.com/oauth/callback
```

The application’s callback is a separate value stored in the project record, for example:

```text
https://app.example.com/auth/callback
```

## Release order

Deploy the Nexuss Auth service before deploying an application that requests `handoff: true`. The service release must contain the handoff route, schema, and one-time consumption logic. Then verify `/health`, verify the target project record, and only then deploy the application with its public project settings.

If using PostgreSQL, apply `packages/server/sql/schema.sql` before enabling traffic. If using the Paradox adapter, allow the application startup migration to create the `handoff` column and `oauth_handoffs` table, and verify that the configured Paradox project and database are the intended production records.

## Application configuration

The deployed application needs public project values, not management credentials:

```text
NEXUSS_AUTH_URL=https://auth.example.com
NEXUSS_AUTH_PROJECT_ID=your-project-id
NEXUSS_AUTH_REDIRECT_URI=https://app.example.com/auth/callback
```

If a frontend bundle reads them, provide the framework’s public build variables separately. Never provide `NEX_AUTH_ADMIN_TOKEN`, `nxa_` tokens, provider secrets, database credentials, cookies, OAuth codes, or handoff tokens to the application frontend.

## Minimal release verification

```bash
curl -fsS https://auth.example.com/health
curl -i 'https://auth.example.com/oauth/start/google?project_id=PROJECT_ID&redirect_uri=ENCODED_CALLBACK'
```

Record only the status and whether the OAuth start response redirects to the provider. Do not print or report the full authorization URL, because it contains state and provider parameters.

For a handoff release, verify the following in a controlled test:

1. Start OAuth with `handoff=1`.
2. Complete provider authentication.
3. Confirm the application server receives `handoff_token`.
4. Confirm the server exchanges it and creates its own session.
5. Repeat the same exchange and confirm it fails.
6. Confirm logout clears the application session.

## Diagnosis order

1. Check `/health`.
2. Inspect the target project and confirm that it exists and is `active`.
3. Confirm the requested provider is in `enabledProviders`.
4. Compare the application callback byte-for-byte with `allowedRedirectUris`.
5. Compare the application origin with `allowedOrigins`.
6. Confirm `NEX_AUTH_PUBLIC_URL` matches the deployed Nexuss Auth origin.
7. Check the provider console callback against Nexuss Auth’s `/oauth/callback`.
8. For handoff failures, check that the service and application deployments both contain the handoff implementation and that the project ID is identical on both sides.
9. Inspect protected logs without credentials, cookies, OAuth codes, state values, or handoff tokens.
10. Complete one browser sign-in test only after configuration is correct.

## Failure mapping

| Symptom | Meaning | Correct action |
|---|---|---|
| `invalid_project_or_provider` | Project missing, disabled, or provider not enabled | Inspect the exact project record and provider set |
| `redirect_uri_not_allowed` | Application callback is not an exact allowlisted URI | Correct the project record or application callback |
| `invalid_client` | Provider credentials do not match the provider application | Correct provider credentials in Nexuss Auth and verify its callback |
| `/v1/me` returns `user: null` | Browser session is absent or cannot cross the site boundary | Start a fresh sign-in or use handoff mode |
| `invalid_handoff` | Handoff token is expired, replayed, malformed, or paired with another project | Start a fresh sign-in and exchange only once on the server |
| `handoff_token is required` | Callback reached the application without a requested handoff | Start sign-in with `handoff: true` or use the same-site flow deliberately |
| OAuth succeeds but application remains signed out | Application trusted redirect success or failed to create its own session | Verify `getUser()` or the server-side exchange path |
| CORS or cookie failure | Origin, credentials, or same-site topology is wrong | Correct exact origins or use server handoff |
| `401` on project management | CLI or automation credential is missing, invalid, or revoked | Re-authenticate using the correct authority mode |
| `5xx` | Runtime, provider exchange, persistence, or migration failure | Check health, deployment version, schema, and protected logs |

## Release record

Record deployment commit, public URL, schema migration result, health result, route status, selected session model, and interactive sign-in outcome. Record statuses and timestamps only. Never record credentials, complete authorization URLs, cookies, OAuth codes, state values, or handoff tokens.
