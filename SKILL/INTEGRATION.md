# Application integration guide

Use this guide when an application needs Google or GitHub sign-in through Nexuss Auth. Follow the sections in order. Do not mix the browser-cookie flow and the server-handoff flow in the same application unless the application has a deliberate migration plan.

## 1. Decide the session model first

There are two supported models. Choose one before writing application code.

| Deployment topology | Use this model | Application session is established by |
|---|---|---|
| The application and Nexuss Auth are same-site under one registrable domain | Browser-cookie session | Nexuss Auth’s HTTP-only cookie, read through `getUser()` |
| The application and Nexuss Auth are cross-site, such as `onrender.com` and `vercel.app` | Server-side handoff | The application server, after exchanging a one-time handoff token |

A redirect to the application is not authentication by itself. The application must either verify `getUser()` or complete the server-side handoff.

## 2. Prepare the Nexuss Auth project

Before changing application code, confirm the project record. The project must be active, the requested provider must be enabled, and the callback and origin must match exactly.

```json
{
  "projectId": "your-project-id",
  "status": "active",
  "enabledProviders": ["google"],
  "homepageUrl": "https://app.example.com/",
  "allowedRedirectUris": [
    "https://app.example.com/auth/callback"
  ],
  "allowedOrigins": [
    "https://app.example.com"
  ]
}
```

Use the CLI to inspect the record before changing it:

```bash
nexuss --json project show --id your-project-id
```

If the project is owned by the authenticated account, update only the provider set that is intended to remain enabled:

```bash
nexuss project providers --id your-project-id --provider google
```

The provider command replaces the complete provider list. Include every provider that must remain enabled. Never guess a project ID or silently create a replacement after `project_not_found`.

## 3. Configure provider credentials

Provider credentials belong only in the Nexuss Auth service environment. They do not belong in the application, browser bundle, project file, or frontend environment.

```text
NEX_AUTH_PUBLIC_URL=https://auth.example.com
GOOGLE_CLIENT_ID=<protected Google client ID>
GOOGLE_CLIENT_SECRET=<protected Google client secret>
GITHUB_CLIENT_ID=<protected GitHub client ID>
GITHUB_CLIENT_SECRET=<protected GitHub client secret>
```

The Google or GitHub provider console must register Nexuss Auth’s callback, not the application callback. For example:

```text
https://auth.example.com/oauth/callback
```

Nexuss Auth then validates the application callback against the project’s `allowedRedirectUris` list.

## 4. Configure the application

The application needs the following public project settings. These values are safe to expose because they identify routing configuration, not credentials.

```text
NEXUSS_AUTH_URL=https://auth.example.com
NEXUSS_AUTH_PROJECT_ID=your-project-id
NEXUSS_AUTH_REDIRECT_URI=https://app.example.com/auth/callback
```

If the browser bundle reads the values directly, provide the corresponding build-time variables using the frontend framework’s public prefix, for example:

```text
VITE_NEXUSS_AUTH_URL=https://auth.example.com
VITE_NEXUSS_AUTH_PROJECT_ID=your-project-id
VITE_NEXUSS_AUTH_REDIRECT_URI=https://app.example.com/auth/callback
```

Do not place `NEX_AUTH_ADMIN_TOKEN`, `nxa_` project tokens, provider secrets, database credentials, OAuth codes, session cookies, or handoff tokens in frontend variables.

## 5. Install and initialize the SDK

```bash
npm install nexuss-auth
```

```ts
import { createAuth } from 'nexuss-auth';

export const auth = createAuth({
  projectId: process.env.NEXUSS_AUTH_PROJECT_ID!,
  authUrl: process.env.NEXUSS_AUTH_URL!,
});
```

The SDK does not contain provider secrets. It only builds project-scoped URLs and reads or logs out the Nexuss Auth session when the selected topology supports that model.

## 6. Implement the same-site browser-cookie flow

Use this flow only when the application and Nexuss Auth are same-site and the browser can send the Nexuss Auth cookie on the application’s requests.

```ts
await auth.signInWithGoogle({
  redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI!,
});
```

After the callback route loads, ask Nexuss Auth for the current user:

```ts
const user = await auth.getUser();
if (user) {
  setSignedInState(user);
} else {
  setSignedOutState();
}
```

A `200` response with `user: null` is a valid signed-out result. Do not treat a `nex_auth=success` query parameter alone as authentication.

## 7. Implement the cross-site server-handoff flow

Use this flow for cross-site deployments. Request the handoff explicitly:

```ts
await auth.signInWithGoogle({
  redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI!,
  handoff: true,
});
```

After successful provider authentication, Nexuss Auth redirects to the registered application callback with a short-lived `handoff_token`. The application callback must be a server route. The browser must not exchange the token.

The application server sends the token to Nexuss Auth:

```ts
const response = await fetch(`${authUrl}/v1/handoff/exchange`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    projectId,
    handoffToken,
  }),
});

if (!response.ok) {
  throw new Error('Nexuss Auth handoff failed');
}

const { user } = await response.json();
// Create the application’s own secure, HTTP-only session here.
```

The handoff token is short-lived and single-use. Never log it, store it in local storage, put it in an application API response, or accept it without checking the expected project ID. After creating the application session, redirect the browser to a clean URL without authentication query parameters.

## 8. Logout and session recovery

For the browser-cookie model, call the SDK logout method and clear local UI state:

```ts
await auth.logout();
clearSignedInState();
```

For the server-handoff model, clear the application’s own session cookie. If the application also maintains a Nexuss Auth browser session, call the Nexuss Auth logout endpoint from a trusted same-site context as appropriate. Never rely on clearing only frontend state.

On application startup, read the application’s verified session. Do not trust a user object posted from browser JavaScript and do not use an email address as the authorization key.

## 9. Verification checklist

Complete every check before declaring integration complete:

1. Confirm `/health` returns success.
2. Confirm the project ID is correct and the project status is `active`.
3. Confirm the requested provider appears in `enabledProviders`.
4. Confirm the exact application callback appears in `allowedRedirectUris`.
5. Confirm the application origin appears in `allowedOrigins`.
6. Confirm the Google or GitHub console points to Nexuss Auth’s `/oauth/callback`.
7. Confirm the OAuth start route is opened as a browser navigation, not fetched as JSON.
8. Complete one successful sign-in and one cancellation test.
9. For same-site mode, verify `getUser()` after callback and refresh.
10. For handoff mode, verify the application session after callback and verify that replaying the same handoff token fails.
11. Verify logout and signed-out startup behavior.
12. Confirm no secret, OAuth code, state, cookie, complete authorization URL, or handoff token was logged.

## 10. Troubleshooting

| Symptom | Meaning | Correct action |
|---|---|---|
| `invalid_project_or_provider` | The project is missing, disabled, or does not enable the requested provider | Inspect the exact project ID and provider set; do not change Google credentials first |
| `redirect_uri_not_allowed` | The callback is not an exact member of the project allowlist | Register the exact callback, including scheme, host, path, and trailing slash behavior |
| `user: null` from `/v1/me` | The request is signed out or the browser cannot send the service cookie | Start a fresh sign-in or use server handoff for a cross-site deployment |
| `invalid_handoff` | The handoff token is expired, already used, or paired with another project | Start a fresh sign-in and exchange the token only once on the server |
| `invalid_client` | Provider credentials do not match the provider application | Correct the provider credentials in Nexuss Auth and verify its `/oauth/callback` registration |
| OAuth succeeds but the application remains signed out | The application treated redirect success as a session or did not create its local session | Implement `getUser()` or the server-side handoff exchange |
| `401` on project management | The CLI token or session is missing, invalid, or revoked | Re-authenticate or activate a valid project-scoped token; never put it in the application |
| CORS or cookie failure | Origin, credentials, or same-site topology is wrong | Compare exact origins and choose the handoff model when the services are cross-site |
| `5xx` from the service | Runtime, provider exchange, or persistence failure | Check health and protected service logs without exposing secrets, then retry deliberately |

## 11. Security rules

The application must not handle Google or GitHub client secrets. The browser must not receive management credentials. Handoff tokens and OAuth codes are bearer-like, short-lived secrets and must be handled only by the trusted callback server. The application must enforce its own authorization policy after identity verification. Nexuss Auth identity proves who signed in; it does not automatically authorize access to every application resource.

## 12. Central GitHub repository authorization for relying applications

A relying application that needs to list or import a user’s GitHub repositories must not implement a second GitHub OAuth client. It should start the central flow by navigating the browser to:

```text
https://auth.example.com/oauth/start/github?project_id=PROJECT_ID&redirect_uri=ENCODED_APPLICATION_CALLBACK&handoff=1&purpose=github_authorization
```

The central service validates the project, provider, and exact callback, completes GitHub OAuth using the credentials held by Nexuss Auth, and stores the GitHub access token in the central encrypted database. The application receives only a short-lived, opaque `githubGrantToken` through its trusted server-side `/v1/handoff/exchange` call. The browser must never receive or exchange this value.

The application server may then call these central routes with `Authorization: Bearer GITHUB_GRANT_TOKEN` and the expected `project_id` query parameter:

```text
GET /v1/github/repositories?project_id=PROJECT_ID
GET /v1/github/clone-token?project_id=PROJECT_ID
```

The first route returns sanitized repository metadata. The second route returns the provider access token only to the trusted application server for the immediate clone operation; the application must keep it in memory, must not persist it, and must not return it to the browser. The grant is scoped to the central project and expires. A `401` means the user must authorize GitHub again.

For this mode, the GitHub OAuth application’s provider callback is Nexuss Auth’s callback, not the relying application’s callback. The central project must enable GitHub, and its allowed redirect list must contain the relying application callback exactly. The relying application needs only `NEXUSS_AUTH_URL`, `NEXUSS_AUTH_PROJECT_ID`, and `NEXUSS_AUTH_REDIRECT_URI`; it does not need `GITHUB_CLIENT_ID`, `GITHUB_SECRET`, or a GitHub OAuth client of its own.
