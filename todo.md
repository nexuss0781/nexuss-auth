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
