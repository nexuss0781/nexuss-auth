# Error Cycles

## Dashboard migration — 2026-08-16

The copied dashboard template initially referenced UI components and packages that were not used by the dashboard itself. The migration removed the unused components and simplified the remaining input, textarea, and not-found primitives so the dashboard only depends on declared packages.

The root build script still referenced the former scoped SDK workspace name. It has been corrected to the published `nexuss-auth` workspace name so unified builds include the SDK, authentication server, and dashboard.
