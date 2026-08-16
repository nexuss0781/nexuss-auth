# Operations guide

Use this file only when deployment, service configuration, or runtime diagnosis blocks the primary task.

## Protected configuration

Keep these values in the protected service environment: `NEX_AUTH_PUBLIC_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `NEX_AUTH_ADMIN_TOKEN`, `PARADOX_API_URL`, `PARADOX_API_KEY`, and `PARADOX_PASSPHRASE`.

Never print or commit these values. Provider console callbacks must point to the service callback, for example:

```text
https://nexuss-auth.vercel.app/oauth/callback
```

## Minimal release verification

```bash
curl -fsS https://nexuss-auth.vercel.app/health
curl -i https://nexuss-auth.vercel.app/
curl -i https://nexuss-auth.vercel.app/auth
```

Check an OAuth start route only for its response status and redirect behavior. Do not print or report the full authorization URL.

## Diagnosis order

1. Check `/health`.
2. Inspect the target project and confirm it is active.
3. Compare the application's exact callback URL with the project allowlist.
4. Compare `NEX_AUTH_PUBLIC_URL` with the public deployment URL.
5. Check the provider callback configuration.
6. Inspect request-scoped logs without credentials, cookies, OAuth codes, or state.
7. Complete one browser sign-in test only after configuration is correct.

## Failure mapping

| Symptom | Correct action |
|---|---|
| `invalid_client` | Verify matching provider client ID and secret in the same provider application |
| `redirect_uri_not_allowed` | Correct the exact project redirect URI and retry browser flow |
| `/v1/me` returns `user: null` | Treat as signed out; start a fresh sign-in with correct project context |
| Project request is forbidden or missing | Check ownership and selected authority; do not bypass scope |
| CORS failure | Compare request origin with allowed origins and include browser credentials |
| `5xx` | Preserve task inputs, inspect service and persistence health, then recover deliberately |

## Release record

Record deployment commit, public URL, health result, route status, and interactive sign-in outcome. Record statuses and timestamps only, never credentials or complete authorization URLs.
