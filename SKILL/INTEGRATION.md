# Application integration guide

Use this file when the primary task is adding or repairing sign-in inside an application. Do not redesign the application around Nexuss-auth; add only the authentication behavior the task requires.

## Required configuration

Do not write integration code until these values are known:

```text
NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
NEXUSS_AUTH_PROJECT_ID=<registered-project-id>
NEXUSS_AUTH_REDIRECT_URI=<exact-registered-callback>
```

The callback must exactly match the project record. Keep `NEX_AUTH_ADMIN_TOKEN` out of browser code.

## Preferred implementation

Install the SDK and construct one client in the application's authentication module:

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

Connect the task's existing sign-in controls to the enabled providers:

```ts
await auth.signInWithGoogle({ redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI! });
await auth.signInWithGitHub({ redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI! });
```

Do not call a provider that the project disables. Do not handle provider secrets or provider authorization codes in the application.

## Session behavior

Restore state on application startup and after the callback route loads:

```ts
const user = await auth.getUser();
if (user) {
  setSignedInState(user);
} else {
  setSignedOutState();
}
```

The returned identity is display data. Apply the application's own authorization policy separately. Do not use email as a project-ownership key.

Log out through the SDK, then clear application-local state:

```ts
await auth.logout();
clearSignedInState();
```

## Direct browser requests

Use direct requests only when the SDK cannot be used. Include project context and credentials:

```ts
const response = await fetch(`${authUrl}/v1/me?project_id=${encodeURIComponent(projectId)}`, {
  credentials: 'include',
  headers: { 'x-nex-auth-project': projectId },
});
const { user } = await response.json();
```

For a server route that constructs a sign-in URL, use `auth.getLoginUrl(provider, { redirectUri })` and send the browser to that URL. Do not fetch an OAuth start URL expecting JSON.

## Verification

1. Check signed-out startup state.
2. Start each enabled provider.
3. Complete or cancel authorization and handle both outcomes.
4. Confirm `getUser()` after callback and after refresh.
5. Confirm logout returns `user: null`.
6. Confirm an unregistered redirect URI is rejected.

If sign-in fails with `redirect_uri_not_allowed`, correct the exact project redirect URI before changing application code.
