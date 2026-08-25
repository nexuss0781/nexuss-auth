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
- [x] Deploy with the provided Vercel token and verify production login.

## User-agnostic auth change checklist

- [x] Any new user can authenticate with an enabled provider.
- [x] New project creation assigns the current authenticated user as owner.
- [x] Users cannot read, update, or delete another user’s projects.
- [x] Server-only admin automation remains separate from browser sessions.
- [x] Dashboard shows sign-in and empty-project onboarding states.
- [x] Vercel production variables and callback URLs remain configured.

## User-agnostic auth error cycles

- [x] Record and resolve ownership migration or deployment errors here.

## User-agnostic auth final review

- [x] Confirm project ownership boundaries with automated tests.
- [x] Confirm production Google/GitHub OAuth start and project-management protection; interactive provider callback remains user-session dependent.
- [x] Confirm the dashboard and CLI documentation match the final behavior.

## User-agnostic auth deliverables

- [x] Commit and push the user-agnostic implementation.
- [x] Deploy the unified frontend and API to Vercel.
- [x] Report the production URL and remaining setup requirements.

## User-agnostic auth decisions

- [x] Document the owner-scoped project model and admin-token boundary.

## User-agnostic auth acceptance criteria

- [x] Every authenticated user sees only their own projects.
- [x] Every project has exactly one owner in the initial release.
- [x] Project settings persist across sessions.
- [x] A fresh user can sign in, create a project, and use the SDK/CLI integration guidance.
- [x] No frontend bundle contains the admin token or provider secret.

## Google OAuth invalid-client follow-up

- [x] Inspect the production Google client configuration and callback alignment without exposing credentials.
- [x] Correct the deployment or Google OAuth configuration if a mismatch is found.
- [x] Redeploy and verify the Google OAuth authorization flow.

## Public dashboard refinement

- [x] Remove internal/debug labels from visible UI, including owner, local, agent, API, and connection-status language.
- [x] Clarify the ordinary-user flow with explicit sign-in, project-creation, save, success, and project-management states.
- [x] Ensure users see a clean empty state before creating their first project and a project list only after saved projects exist.
- [x] Review all visible copy for concise, selective, user-agnostic product language.
- [x] Verify the revised dashboard responsively and run the final build/tests.

## Dashboard information architecture refinement

- [x] Separate the guide, project list, project creation, project settings, and integration views into distinct pages or routes.
- [x] Build a scoped dashboard sidebar with clear navigation and project context.
- [x] Add a signed-in user card using authenticated avatar, display name, and email when available.
- [x] Make the “Simple by default” guidance card dismissible and persist its dismissal across sessions.
- [x] Keep project creation separate from project editing and prevent empty editor cards from appearing before creation.
- [x] Verify responsive navigation, page transitions, and the complete create-to-settings flow.

## Premium guest experience

- [x] Audit the current routes and identify the landing-to-auth transition.
- [x] Define the premium dark visual system for technical and non-technical guests.
- [x] Generate and integrate atmospheric landing and auth background assets.
- [x] Build a public landing page at `/` with a clear route to `/auth`.
- [x] Build a dedicated `/auth` page with colored Google and GitHub provider icons.
- [x] Verify responsive layout, asset loading, provider navigation, build, and production deployment.

## First-viewport composition revision

- [x] Make the background visual field visible and aligned within the first viewport.
- [x] Balance the headline, entrypoint panel, and visual effect before scrolling.
- [x] Verify desktop and mobile first-impression composition after the revision.

## Production visual parity

- [x] Compare deployed and preview hero assets and visual treatment.
- [x] Strengthen the hero effect so production renders the same first impression.
- [x] Redeploy and verify the live landing page visually.

## Google provider mark

- [x] Add an official multicolor Google G asset to the authorization CTA.
- [x] Verify the Google CTA and redeploy the production auth page.

## Auth vertical balance

- [x] Move the authorization panel upward slightly and equalize visible space above and below it.
- [x] Verify the balanced auth composition and redeploy production.

## Signed-in workspace polish

- [x] Replace plain loading copy with a branded loading effect.
- [x] Fix the production font 404 and `/me` 500 resource errors.
- [x] Move signed-in avatar, display name, and email into the bottom profile card below dismissal guidance.
- [x] Rename the main signed-in view to Dashboard.
- [x] Add a Projects sidebar view with populated and polished empty states.
- [x] Verify responsive behavior, build, and production smoke tests.

## Authenticated /v1/me production error

- [x] Trace the authenticated session and Paradox user lookup path causing the production 500.
- [x] Patch stale or malformed session handling so `/v1/me` returns a safe response.
- [x] Redeploy and verify authenticated and unauthenticated `/v1/me` behavior.

## Project avatar upload

- [x] Add a centered branded avatar upload control above the project creation fields.
- [x] Preview the selected image and include it in the project creation payload.
- [x] Verify the form and deploy the avatar upload update.

## AI agent SKILL package

- [x] Audit current Nexuss-auth API, SDK, CLI, OAuth, persistence, and security contracts.
- [x] Create a structured `SKILL/` directory with a main directive and focused reference files.
- [x] Document quick starts, complete API coverage, project lifecycle, session use, and automation boundaries.
- [x] Add AI-agent operating rules, failure handling, validation steps, and production security directives.
- [ ] Validate examples and commit the complete SKILL package.

## SKILL distribution and release readiness

- [ ] Include `SKILL/` in the published package contents without changing runtime behavior.
- [ ] Add automated Markdown link, route-coverage, and code-example validation.
- [ ] Add a documented SKILL version and changelog entry.
- [ ] Run full repository tests, package inspection, and SKILL validation.
- [ ] Commit the safe packaging update and prepare the end-to-end test procedure.


## Release publication

- [x] Commit release-readiness changes.
- [x] Push the commit to the Nexuss-auth repository.
- [ ] Publish nexuss-auth 0.2.0 to npm — npm authentication is required on this machine.


## Authenticated PyPI CLI

- [ ] Audit current project-management API and session contracts.
- [ ] Define browser-login CLI authentication without user API keys.
- [ ] Add project list/create/rename/delete/configure and project-ID output workflows.
- [ ] Add icon and push/synchronization support with ownership enforcement.
- [ ] Build and test the PyPI package and document installation and usage.


## First PyPI CLI release

- [x] Define the browser-login and local-session contract.
- [x] Implement authenticated CLI commands without user API keys.
- [x] Implement project list/create/show/rename/delete and provider/icon updates.
- [x] Implement pull, push, diff, and project-ID output.
- [x] Add Python packaging, tests, and usage documentation; interactive provider login requires a user account.


## PyPI publication

- [x] Build and inspect the Python wheel and source distribution.
- [x] Authenticate with PyPI and publish `nexuss-auth` 0.1.0.
- [x] Verify installation from PyPI in a clean environment.


## Per-user API token management

- [x] Audit current database, server, dashboard, SDK, and CLI authentication contracts.
- [x] Add hashed per-user token persistence with prefix, label, timestamps, and revocation state.
- [x] Add generate, list, and revoke API routes with session ownership enforcement.
- [x] Authenticate project management through user API tokens without accepting admin tokens as user tokens.
- [x] Add dashboard, TypeScript SDK, and PyPI CLI token management commands.
- [x] Add security tests, update documentation, deploy, and verify production behavior.

## Central GitHub Authorization Grants

- [x] Keep GitHub provider credentials and access tokens owned by Nexuss Auth.
- [x] Add explicit `github_authorization` OAuth purpose and repository scope.
- [x] Store encrypted GitHub connections and project-scoped opaque application grants.
- [x] Add server-only repository listing and immediate clone-token endpoints.
- [x] Document the central authorization and relying-application contract in `SKILL/API.md` and `SKILL/INTEGRATION.md`.
- [x] Validate the central server build and complete authentication regression suite.

## OAuth Start 500 Repair

- [x] Diagnose the deployed OAuth start failure as a database-schema migration gap in existing Postgres deployments.
- [x] Apply OAuth-purpose, handoff-grant, GitHub connection, and GitHub grant migrations automatically during startup.
- [x] Return a safe error code and support ID instead of an opaque `internal_error` for OAuth preparation failures.

## Deployed OAuth State Persistence Repair

- [x] Identify that Vercel uses the Paradox adapter, not the Postgres adapter.
- [x] Prevent write operations from pulling the pre-migration remote snapshot after local schema migration.
- [x] Apply legacy Paradox migrations before OAuth state inserts and preserve them through the write push.
- [x] Validate the fix with the complete central-auth test and build suite.
