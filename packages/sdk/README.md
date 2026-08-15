# nexuss-auth

A small, framework-agnostic browser SDK for the Nex-auth centralized Google and GitHub login service.

```ts
import { createAuth } from 'nexuss-auth';

const auth = createAuth({
  projectId: 'my-project',
  authUrl: 'https://auth.example.com',
});

auth.signInWithGoogle();
auth.signInWithGitHub();
const user = await auth.getUser();
await auth.logout();
```

The package never receives Google or GitHub client secrets. It redirects the browser to the configured Nex-auth service and uses the service's HTTP-only session cookie for subsequent requests.

## API

`createAuth({ projectId, authUrl, fetch? })` creates a client. `signIn(provider, { redirectUri? })` starts a provider redirect, while `signInWithGoogle` and `signInWithGitHub` are convenience methods. `getLoginUrl` is available for server-rendered applications. `getUser` returns the current user or `null`, and `logout` invalidates the current session.
