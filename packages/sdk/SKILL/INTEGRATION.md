# Nexuss-auth application integration

Use this guide when adding Nexuss-auth to an application.

## Required values

Before editing application code, obtain:

```text
NEXUSS_AUTH_URL=https://nexuss-auth.vercel.app
NEXUSS_AUTH_PROJECT_ID=<registered project id>
NEXUSS_AUTH_REDIRECT_URI=<exact registered application callback>
```

Do not continue if the project ID or exact callback address is unknown. Do not place `NEX_AUTH_ADMIN_TOKEN` in this application’s browser environment.

## SDK quick start

Install the package:

```bash
npm install nexuss-auth
```

Create one client instance in the application’s authentication module:

```ts
import { createAuth } from 'nexuss-auth';

export const auth = createAuth({
  projectId: 'my-dashboard',
  authUrl: 'https://nexuss-auth.vercel.app',
});
```

Connect the provider actions:

```ts
import { auth } from './auth';

document.querySelector('#continue-google')?.addEventListener('click', () => {
  auth.signInWithGoogle({
    redirectUri: 'https://dashboard.example.com/auth/callback',
  });
});

document.querySelector('#continue-github')?.addEventListener('click', () => {
  auth.signInWithGitHub({
    redirectUri: 'https://dashboard.example.com/auth/callback',
  });
});
```

If the application always returns to the current browser address, omit `redirectUri` in browser code. For predictable production behavior, provide the registered callback explicitly.

## Restore the application session

Call `getUser()` when the application starts and after the provider callback returns:

```ts
const user = await auth.getUser();

if (user) {
  showSignedInApplication(user);
} else {
  showSignInScreen();
}
```

The returned user contains:

```ts
{
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
}
```

Use the returned values for display only. Do not use an email address as the authorization key for projects.

## Logout

```ts
await auth.logout();
clearApplicationUserState();
redirectToSignIn();
```

If logout fails, keep the local application state signed out and show a recoverable error. Do not attempt to edit the HTTP-only cookie in browser code.

## Applications with server routes

Use `getLoginUrl()` when a server or framework route must construct the provider address:

```ts
const googleUrl = auth.getLoginUrl('google', {
  redirectUri: 'https://dashboard.example.com/auth/callback',
});
```

Send the user to the returned URL. Do not fetch the URL from the server expecting JSON.

Outside a browser, `redirectUri` is required because there is no current browser location.

## Direct HTTP browser integration

Use this only when the SDK cannot be used:

```ts
const authUrl = 'https://nexuss-auth.vercel.app';
const projectId = 'my-dashboard';
const redirectUri = 'https://dashboard.example.com/auth/callback';

function startGoogleSignIn() {
  const url = new URL('/oauth/start/google', authUrl);
  url.searchParams.set('project_id', projectId);
  url.searchParams.set('redirect_uri', redirectUri);
  window.location.assign(url.toString());
}

async function loadUser() {
  const response = await fetch(`${authUrl}/v1/me?project_id=${encodeURIComponent(projectId)}`, {
    credentials: 'include',
    headers: { 'x-nex-auth-project': projectId },
  });

  if (!response.ok) throw new Error(`Profile request failed: ${response.status}`);
  return (await response.json()).user;
}
```

## Callback handling

The OAuth callback is centralized at Nexuss-auth. The application does not receive the provider code directly. The service creates the session and redirects to the project callback. At the callback route, the application should:

1. Call `getUser()`.
2. Verify that a user object is present.
3. Create application-local signed-in state if required.
4. Route the user to the intended signed-in page.
5. Show a sign-in error if the user is null or the request failed.

Do not trust a query parameter that claims a user is authenticated.

## Project configuration checklist

Before testing an application, confirm:

| Check | Required state |
|---|---|
| Project ID | Matches the SDK configuration exactly. |
| Homepage | Uses the application’s public address. |
| Redirect URI | Exact callback address, including path and protocol. |
| Allowed origin | Origin of the browser application, without a path. |
| Providers | Google and/or GitHub enabled for the project. |
| Provider console | Nexuss-auth callback registered in Google and GitHub settings. |
| HTTPS | Required in production. |

## Integration test

Test in this order:

1. Open the application while signed out.
2. Select Google and verify that the browser reaches Google.
3. Complete or cancel authorization.
4. Confirm the application handles both success and cancellation.
5. On success, call `getUser()` and verify the returned identity.
6. Refresh the application and confirm the session remains available.
7. Call logout and confirm `getUser()` returns `null`.
8. Repeat with GitHub if enabled.
9. Test an unregistered redirect URI and confirm that the service rejects it.
10. Test the application with a second Nexuss-auth account and confirm project isolation.

## Common integration mistakes

Do not use a provider client ID as the Nexuss-auth project ID. Do not send the provider callback directly to the application when the project is configured to use the centralized Nexuss-auth callback. Do not omit `credentials: 'include'` from direct browser requests. Do not call `getUser()` only once at build time. Do not store the returned user object as proof of authorization beyond the current application session without applying the application’s own session policy.
