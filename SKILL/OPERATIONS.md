# Nexuss-auth production operations

Use this guide when deploying, diagnosing, or validating Nexuss-auth.

## Required production configuration

Set these values in the protected service environment:

| Variable | Purpose |
|---|---|
| `NEX_AUTH_PUBLIC_URL` | Public Nexuss-auth address used to build callback and redirect URLs. |
| `GOOGLE_CLIENT_ID` | Google OAuth client identifier. Store only the bare client ID. |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret. |
| `GITHUB_CLIENT_ID` | GitHub OAuth client identifier. |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret. |
| `NEX_AUTH_ADMIN_TOKEN` | Private management credential for automation. |
| `PARADOX_API_URL` | Persistence service endpoint. |
| `PARADOX_API_KEY` | Persistence service key. |
| `PARADOX_PASSPHRASE` | Persistence encryption passphrase. |

Never print the values of these variables. A Google client ID must not contain `https://`; the callback address, not the client ID, contains the protocol.

## Provider console configuration

Register the Nexuss-auth callback in both provider consoles:

```text
https://nexuss-auth.vercel.app/oauth/callback
```

Google must allow the correct web application origin and callback address. GitHub must contain the same callback address in its OAuth application configuration. Provider callback values are exact strings; a different protocol, host, path, or trailing slash can invalidate the flow.

## Deployment validation

Run the following checks after each production deployment:

```bash
curl -fsS https://nexuss-auth.vercel.app/health
curl -i https://nexuss-auth.vercel.app/
curl -i https://nexuss-auth.vercel.app/auth
curl -i https://nexuss-auth.vercel.app/dashboard
```

Check the API without a session:

```bash
curl -i 'https://nexuss-auth.vercel.app/v1/me?project_id=nexuss-dashboard' \
  -H 'x-nex-auth-project: nexuss-dashboard' \
  -H 'Origin: https://nexuss-auth.vercel.app'
```

A valid signed-out result is `200` with `{"user":null}`. A provider start check should return `302` and must not expose a client secret:

```bash
curl -sS -D - -o /dev/null \
  'https://nexuss-auth.vercel.app/oauth/start/google?project_id=nexuss-dashboard&redirect_uri=https%3A%2F%2Fnexuss-auth.vercel.app%2Fdashboard'
```

Do not complete a real provider sign-in from an unattended shell. Use a browser session for the final interactive test.

## Production diagnosis

Use this order when a user reports a sign-in failure:

1. Check `/health`.
2. Check that the project exists and is active.
3. Compare the application’s exact redirect address with the project’s allowlist.
4. Compare the public service URL with `NEX_AUTH_PUBLIC_URL`.
5. Inspect the provider start response status without printing the full authorization URL.
6. Verify the provider console callback address.
7. Inspect server logs using a request identifier, never a token or OAuth code.
8. Test in a private browser window to exclude stale cookies.

## Error diagnosis table

| Symptom | Likely cause | Action |
|---|---|---|
| Google `401 invalid_client` | Malformed or mismatched client ID/secret. | Confirm the bare client ID and matching secret in the same provider project. |
| OAuth redirect rejected | Callback or origin is not allowlisted. | Compare exact values in Nexuss-auth, the application, and provider console. |
| `/v1/me` returns `user: null` | No session, stale cookie, wrong project context, or user signed out. | Start a fresh sign-in and verify the project ID. |
| `/v1/me` returns `401` | Request lacks a valid session or protected credential. | Re-authenticate or correct the server credential. |
| Project request returns `403` | Caller does not own the project or lacks management authority. | Stop; verify the intended account and authority mode. |
| Project request returns `409` | Project ID already exists. | Inspect the existing project before retrying. |
| Browser reports CORS failure | Application origin is not allowlisted or credentials are omitted. | Correct `allowedOrigins` and send credentials. |
| Browser reports a missing image or font | Asset path is not production-safe or an external font is unavailable. | Use a durable repository or managed asset and a reliable fallback font. |
| API returns `5xx` | Service, persistence, or deployment failure. | Check health, logs, and persistence configuration; preserve input and retry deliberately. |

## Recovery rules

If a browser has a stale session, do not ask the user to expose the cookie. Ask them to sign out, open a private window, or sign in again. The `/v1/me` route must treat malformed or unresolved sessions as signed out rather than exposing internal errors.

If a deployment has incorrect OAuth environment values, correct the protected environment configuration and redeploy. Do not place replacement secrets in source control. After correcting a client ID or callback, test the provider start route and complete one interactive browser login.

If persistence is unavailable, do not create replacement projects or seed substitute user records. Preserve the request, report the service failure, and restore the configured persistence connection.

## Security review before release

Confirm that the frontend bundle contains no admin token, provider secret, database key, or session value. Confirm that logs redact authorization headers, cookies, OAuth codes, and state values. Confirm that redirect addresses are exact and that the application uses HTTPS. Confirm that user-owned project isolation tests pass with two separate accounts.

## Operational completion record

For every production release, record the deployment commit, public URL, health result, route results, provider start results, and interactive login result. Record status codes and timestamps, not credentials or full authorization URLs.
