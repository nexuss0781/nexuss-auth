# Nex-auth security checklist

Nex-auth is designed around a central OAuth callback and browser session model. Before production use, complete the following controls.

| Area | Required control |
|---|---|
| Transport | Serve the auth service and every application over HTTPS. Set `NEX_AUTH_PUBLIC_URL` to the HTTPS origin. |
| Secrets | Inject Google, GitHub, database, and admin secrets through a secret manager. Do not commit `.env` files. |
| Redirects | Register exact redirect URIs per project. Never accept arbitrary redirect destinations or production wildcards. |
| Sessions | Keep the HTTP-only cookie enabled, use `Secure` in production, hash tokens before database storage, and revoke sessions on logout. |
| OAuth state | Keep state one-time use, short-lived, random, and hashed at rest. |
| Database | Use encrypted connections, least-privilege credentials, backups, and monitoring. |
| Abuse prevention | Apply edge rate limits to OAuth starts, callbacks, project administration, and session endpoints. |
| Logging | Do not log authorization codes, OAuth state, session tokens, cookies, provider access tokens, or admin tokens. |
| Operations | Add health monitoring, expired-state/session cleanup, alerting, and a documented secret rotation procedure. |
| Browser policy | Configure a narrow Content Security Policy and security headers at the reverse proxy. |

The repository includes the core controls in code, but rate limiting, deployment-specific headers, secret management, and operational monitoring must be supplied by the deployment environment.
