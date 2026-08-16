# Nexuss-auth Dashboard Migration

- [x] Inspect the current monorepo structure and select a non-conflicting frontend location.
- [x] Copy the dashboard source, styles, and safe static branding assets into the Nexuss-auth repository.
- [x] Add dashboard build scripts and verify the unified workspace compiles successfully.
- [x] Commit and push the dashboard frontend to the `main` branch.
- [x] Define the project-management request and response contracts for human and agent consumers.
- [x] Extend persistence with project home URL, description, branding, provider settings, and status.
- [x] Implement authenticated project create, list, read, update, and provider-toggle API endpoints.
- [x] Implement portable CLI commands for project create, inspect, list, and update operations.
- [x] Connect the dashboard to the real management API without exposing server secrets to the browser.
- [x] Validate, document, commit, and push the full workflow.

- [x] Add an owner user ID to every project and migrate existing project records safely.
- [x] Restrict browser project reads and writes to the authenticated session user.
- [x] Add user-agnostic Google/GitHub onboarding and a signed-in dashboard state.
- [x] Update SDK and CLI management flows for owner-scoped projects and admin-only automation.
- [ ] Deploy with the provided Vercel token and verify production login.

## User-agnostic auth change checklist

- [x] Any new user can authenticate with an enabled provider.
- [x] New project creation assigns the current authenticated user as owner.
- [x] Users cannot read, update, or delete another user’s projects.
- [x] Server-only admin automation remains separate from browser sessions.
- [x] Dashboard shows sign-in and empty-project onboarding states.
- [ ] Vercel production variables and callback URLs remain configured.

## User-agnostic auth error cycles

- [ ] Record and resolve ownership migration or deployment errors here.

## User-agnostic auth final review

- [x] Confirm project ownership boundaries with automated tests.
- [ ] Confirm production Google/GitHub login and project creation.
- [x] Confirm the dashboard and CLI documentation match the final behavior.

## User-agnostic auth deliverables

- [ ] Commit and push the user-agnostic implementation.
- [ ] Deploy the unified frontend and API to Vercel.
- [ ] Report the production URL and remaining setup requirements.

## User-agnostic auth decisions

- [ ] Document the owner-scoped project model and admin-token boundary.

## User-agnostic auth acceptance criteria

- [ ] Every authenticated user sees only their own projects.
- [ ] Every project has exactly one owner in the initial release.
- [ ] Project settings persist across sessions.
- [ ] A fresh user can sign in, create a project, and use the SDK/CLI integration guidance.
- [ ] No frontend bundle contains the admin token or provider secret.
