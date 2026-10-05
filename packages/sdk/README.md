# nexuss-auth

A small, framework-agnostic browser SDK for the Nex-auth centralized Google, GitHub, and ENVX OIDC login service.

```ts
import { createAuth } from 'nexuss-auth';

const auth = createAuth({
  projectId: 'my-project',
  authUrl: 'https://auth.example.com',
});

auth.signInWithGoogle();
auth.signInWithGitHub();
auth.signInWithEnvx();
const user = await auth.getUser();
await auth.logout();
```

The package never receives Google, GitHub, or ENVX client secrets. It redirects the browser to the configured Nex-auth service. For same-site browser applications, it can use the service's HTTP-only session cookie. For cross-site applications, use the explicit `handoff: true` option and exchange the resulting one-time handoff token on the application server; never exchange it in browser code.

## API

`createAuth({ projectId, authUrl, fetch? })` creates a client. `signIn(provider, { redirectUri?, handoff? })` starts a provider redirect, while `signInWithGoogle`, `signInWithGitHub`, and `signInWithEnvx` are convenience methods. ENVX login uses the server's OIDC authorization-code flow; the SDK never handles the ENVX password or provider secret. Set `handoff: true` when the application needs a server-side session handoff. The callback receives a short-lived one-time `handoff_token`; the application server must exchange it through `POST /v1/handoff/exchange` with the project ID, then create its own session. `getLoginUrl` is available for server-rendered applications. `getUser` returns the current user or `null`, and `logout` invalidates the current session.
