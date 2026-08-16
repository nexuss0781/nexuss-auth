# Error Cycles

## Dashboard migration — 2026-08-16

The copied dashboard template initially referenced UI components and packages that were not used by the dashboard itself. The migration removed the unused components and simplified the remaining input, textarea, and not-found primitives so the dashboard only depends on declared packages.

The root build script still referenced the former scoped SDK workspace name. It has been corrected to the published `nexuss-auth` workspace name so unified builds include the SDK, authentication server, and dashboard.

## Project management and CLI — 2026-08-16

The CLI was initially rejected by strict TypeScript checks because its parser could create boolean/string arrays and optional update values were not narrowed before assignment. The parser now keeps flags and repeated string options distinct, while update fields are narrowed once before assignment.

The management-client unit test initially assumed Fetch receives a `Request` object. The test now constructs a `Request` from Fetch input and init, matching the SDK implementation and verifying the bearer token and JSON body correctly.
