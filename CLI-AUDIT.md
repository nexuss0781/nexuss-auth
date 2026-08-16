# Nexuss-auth CLI: End-to-End Production Audit

**Author:** Manus AI  
**Audit date:** 16 August 2026  
**Reviewed release:** Python package `nexuss-auth==0.2.1`  
**Primary implementation:** `python-cli/nexuss_auth_cli/cli.py`

## Executive conclusion

The CLI has a clear and useful command model: browser-based sign-in for ordinary users, optional user-scoped API tokens for automation, project lifecycle commands, and a local JSON synchronization workflow. Its packaging is correct for `pip install nexuss-auth`, its Python source compiles, its two existing CLI contract tests pass, and the underlying TypeScript server tests pass.

However, the current release is **not production-safe for multi-user token-based management**. The server distinguishes browser sessions from API-token identities, but project authorization checks treat only `kind: 'user'` as owner-scoped. A `kind: 'token'` identity is therefore allowed to list all projects, inspect any project, mutate any project, delete any project, and create projects with a null owner. This is visible in the live behavior: the authenticated CLI token returned records with `ownerUserId: null`, including the control-plane project and the Morrow Field demo. This issue must be fixed before presenting API tokens as a secure user-agnostic automation interface.

A second confirmed issue blocks the documented first-time synchronization workflow: the README instructs users to run `nexuss project pull --id <project-id>`, but the parser does not accept `--id` for `pull`, and the implementation requires a local file containing `projectId` before it can pull. The documented command cannot work as written.

## Audit scope and evidence

The review covered the Python CLI implementation, package metadata, README, AI-agent documentation references, server routes used by the CLI, database ownership filtering, Python tests, TypeScript SDK/server tests, parser help output, read-only live CLI workflows, and negative-path behavior. No destructive project or token operation was executed during the audit.

| Area | Evidence | Result |
|---|---|---|
| Python syntax | `python3 -m compileall -q python-cli/nexuss_auth_cli` | Passed |
| Python CLI tests | `python3 -m unittest discover -s tests-python-cli -v` | 2 passed |
| SDK/server contract tests | `npm test` | 14 tests passed; command wrapper reported a status-variable bug in the shell pipeline, not a test failure |
| Installed command surface | `nexuss --help` and every subcommand’s `--help` | Captured and consistent with source |
| Live token workflow | `whoami`, JSON project list/show | Passed, but exposed the ownership flaw described below |
| OAuth redirect check | Production Google start route | Returned HTTP 302 instead of `redirect_uri_not_allowed` |
| Credential handling | Session file and token activation paths | Token is stored locally with restrictive permissions; token is not printed by the CLI after activation |

## Intended end-to-end workflow

The intended user journey is straightforward. A user installs the package, signs in through Google or GitHub, confirms identity with `whoami`, creates or selects an account-owned project, and then uses the project ID in an SDK integration. For automation, the user creates a per-user API token once through a browser-authenticated CLI session, activates that token locally with `token use`, and then lets an AI agent run project commands without opening a browser.

The operational sequence is:

```text
pip install nexuss-auth
        |
        +--> nexuss login [--provider google|github]
        |        |
        |        +--> loopback callback receives a browser session
        |        +--> ~/.config/nexuss-auth/session.json is written
        |
        +--> nexuss whoami
        +--> nexuss project list/show/create/rename/providers/icon/delete
        |
        +--> nexuss token create --label ...
                 |
                 +--> secret is shown once
                 +--> nexuss token use --value nxa_...
                 +--> automation uses the local token session
```

The local synchronization model is intended to resemble a small project configuration workflow:

```text
local project file -> project diff -> project push -> cloud project
cloud project      -> project pull -> local project file
```

At present, the first `cloud project -> local project file` step is incomplete because `pull` requires the local file to exist already. The workflow must either accept `--id` for `pull` or provide a separate `project init` command.

## Complete command inventory

| Command | Authentication requirement | Server/API behavior | Intended use | Audit result |
|---|---|---|---|---|
| `nexuss --help` | None | None | Discover top-level commands | Works |
| `nexuss --json ...` | Depends on nested command | None by itself | Machine-readable output for agents | Works for supported dictionary/list output |
| `nexuss login` | None before login | Opens `/oauth/start/google` by default with a loopback callback | Browser sign-in | Works conceptually; single-request timeout and browser dependency should be documented |
| `nexuss login --provider google` | None before login | Opens provider-specific OAuth start route | Choose Google | Works |
| `nexuss login --provider github` | None before login | Opens provider-specific OAuth start route | Choose GitHub | Works |
| `nexuss login --auth-url <url>` | None before login | Uses an alternate Nexuss-auth service URL | Self-hosted or staging service | Works, but custom endpoint trust warning is absent |
| `nexuss logout` | None | Deletes local session file | Remove local credentials | Works; it does not revoke remote API tokens or invalidate browser sessions |
| `nexuss whoami` | Local session or API token | `GET /v1/me?project_id=nexuss-dashboard` | Confirm active identity | Works |
| `nexuss token create --label <label>` | Browser session only | `POST /v1/tokens` | Create a user API token | Correctly restricted to browser session |
| `nexuss token list` | Browser session only | `GET /v1/tokens` | List token metadata | Correctly restricted; secrets are not returned |
| `nexuss token revoke --id <id>` | Browser session only | `DELETE /v1/tokens/<id>` | Revoke a user token | Correctly restricted |
| `nexuss token use --value nxa_...` | None before activation | No network request; writes local API-token session | Activate automation credentials | Works in 0.2.1 when the correct installed package is used |
| `nexuss project list` | Browser session or API token | `GET /v1/projects` | List manageable projects | **Critical token ownership flaw** |
| `nexuss project show --id <id>` | Browser session or API token | `GET /v1/projects/<id>` | Inspect one project | **Critical token ownership flaw** |
| `nexuss project inspect --id <id>` | Alias of `show` | Same as `show` | Friendly synonym | Works |
| `nexuss project create` | Browser session or API token | `POST /v1/projects` | Create a project | **Critical token ownership flaw**; token-created records can have null owner |
| `nexuss project rename --id <id> --name <name>` | Browser session or API token | `PATCH /v1/projects/<id>` with name | Rename project | **Critical token ownership flaw** |
| `nexuss project providers --id <id> --provider ...` | Browser session or API token | `PATCH /v1/projects/<id>` with complete provider list | Set Google/GitHub providers | Works, but cannot express an empty provider set |
| `nexuss project icon --id <id> --icon <url>` | Browser session or API token | `PATCH /v1/projects/<id>` with avatar URL | Set remote icon URL | Works; no local upload or URL preflight |
| `nexuss project delete --id <id>` | Browser session or API token | `DELETE /v1/projects/<id>` | Permanently delete project | **Critical token ownership flaw**; confirmation is safe by default but `--yes` is destructive |
| `nexuss project pull --file <file>` | Browser session or API token | Reads local `projectId`, then `GET /v1/projects/<id>` and overwrites file | Download cloud record | **Documentation and first-run workflow bug** |
| `nexuss project push --file <file>` | Browser session or API token | Reads local `projectId`, then `PATCH /v1/projects/<id>` | Apply local changes | Works after a file exists |
| `nexuss project diff --file <file>` | Browser session or API token | Reads local `projectId`, then `GET /v1/projects/<id>` | Compare local/cloud state | Works; always emits JSON for differences |

## Authentication and local-state analysis

The CLI stores state under `NEXUSS_AUTH_CONFIG_DIR` when set, otherwise under `~/.config/nexuss-auth/session.json`. `save_session` writes JSON and attempts to set mode `0600`. Browser login stores `mode: "session"`; `token use` stores `mode: "api"`. This is a good separation of local credential state, and the implementation does not place the token in the project configuration file.

The browser login flow creates a random state value, starts a local HTTP server on `127.0.0.1` and an ephemeral port, opens the provider URL, and accepts one callback request. The callback requires the matching state and stores the received session token. This is appropriate for a local CLI, but the implementation has no explicit callback success page for all failure paths, no signal that the 180-second timeout expired, and no retry or manual-code fallback.

The API token activation path validates only the `nxa_` prefix and writes the token without verifying it. That is acceptable as a fast offline activation command, but the first subsequent command should produce a token-specific error if the token is invalid or revoked. Today, every HTTP 401 is translated to “Your Nexuss-auth session expired. Run `nexuss login` again,” which is inaccurate for API-token users and sends them toward the wrong recovery path.

## Critical security finding: API tokens bypass project ownership

This is the highest-priority issue in the audit.

The server defines three management identities: `admin`, `user` for a browser/session token, and `token` for a per-user API token. In the project routes, ownership is enforced only when `identity.kind === 'user'`. For example, project listing calls `listProjects(identity.kind === 'user' ? identity.userId : undefined)`, which means a `token` identity receives the unfiltered query. Project inspection, deletion, and patch operations use the same conditional pattern. Project creation assigns an owner only when the identity is `user`; an API-token creation falls through to `ownerUserId: null`.

The database layer confirms that `listProjects(ownerUserId)` correctly filters with `WHERE owner_user_id = ?`, so the flaw is the server’s failure to pass the token user ID into that method. The same identity mismatch affects the project mutation guards. The relevant code is in `packages/server/src/server.ts` around the `ManagementIdentity` type and project route handlers, especially lines 151–170 and 312–361, with the SQL filter in `packages/server/src/paradox-db.ts` lines 199–218.

The required authorization rule is simple:

```ts
const ownerScoped = identity.kind === 'user' || identity.kind === 'token';
const userId = ownerScoped ? identity.userId : undefined;
```

Every project list, create, show, patch, and delete path must use `identity.userId` for both browser sessions and API tokens. The ownership condition must be based on `identity.kind !== 'admin'`, not `identity.kind === 'user'`. Project creation must set `ownerUserId` for both user and token identities. Existing null-owner projects should be reviewed and explicitly migrated or reserved as system projects; they should not become implicitly manageable by every token.

This finding should receive a regression test that creates two users, creates one token for each, and asserts that each token can only list, inspect, update, and delete its own projects. The test must also assert that a token-created project stores the token owner ID.

## Documentation and workflow findings

| Priority | Finding | Impact | Recommended action |
|---|---|---|---|
| Critical | API-token identities bypass ownership checks | Cross-user project access and mutation | Fix all project routes to scope `kind: 'token'` by `userId`; add two-user regression tests |
| High | README says `project pull --id`, but parser rejects `--id` | First-time sync cannot work as documented | Add `--id` to `pull`, or add `project init --id`; update the error message and README together |
| High | Token 401 errors are reported as expired browser sessions | Agents receive an incorrect recovery instruction | Distinguish `mode: api` and report “token invalid or revoked; activate a new token” |
| Medium | Installed user-site CLI can shadow system 0.2.1 | Users may unknowingly run 0.1.0 behavior | Add a version command, document `nexuss --version`, and test package upgrade paths |
| Medium | Local file is called `nexuss.yaml.json` | Name implies YAML while content is JSON | Rename to `nexuss.project.json` in a future breaking release, or clearly standardize the existing name |
| Medium | `project providers` cannot set an empty list | Cannot disable all providers through CLI | Add `--none` or a repeated `--provider` model that explicitly supports zero providers |
| Medium | Project create prompts interactively when required flags are missing | Agents can hang waiting for stdin | Add `--non-interactive`, validate required fields, and return actionable errors |
| Medium | No command-level HTTP retry/backoff or request ID | Transient failures are difficult for automation to recover from | Add bounded retries for safe GETs, request IDs, and structured error fields |
| Low | `--json` behavior is not uniform | Agents must special-case output parsing | Guarantee JSON for every successful command when requested, including delete and activation responses |
| Low | `logout` only removes local state | Users may assume remote tokens are revoked | Document the distinction and provide an explicit `token revoke` workflow |

## Recommended command workflow for current release

Until the ownership bug is fixed, the safest production guidance is to use browser sessions for project management and avoid distributing API tokens to untrusted agents. For a single-user local test, the current workflow is:

```bash
pip install --upgrade nexuss-auth==0.2.1
nexuss login --provider google
nexuss whoami
nexuss project list
nexuss project create \
  --id my-project \
  --name "My Project" \
  --home https://example.com/ \
  --redirect https://example.com/
nexuss project show --id my-project
nexuss project providers --id my-project --provider google --provider github
nexuss project icon --id my-project --icon https://cdn.example/icon.png
```

For automation after the server authorization fix:

```bash
nexuss token create --label "CI or agent"
nexuss token use --value nxa_<copied-secret>
nexuss --json project list
nexuss --json project show --id my-project
```

For synchronization, the current implementation needs an existing local file containing at least `projectId`. A correct current-release workaround is:

```json
{
  "projectId": "my-project"
}
```

```bash
nexuss project pull --file nexuss.project.json
nexuss project diff --file nexuss.project.json
nexuss project push --file nexuss.project.json
```

The README’s `pull --id` example should not be used until the parser is changed.

## Release and test assessment

The package manifest correctly declares `nexuss-auth` version `0.2.1`, Python `>=3.9`, and both `nexuss` and `nexuss-auth` console entry points. The source compiles and the two current Python tests pass, but the CLI test suite is too small for a production authentication tool: it tests parser presence and local file round-trip only. The TypeScript SDK and server tests pass, including server-side token creation and a CLI bearer session test, but the existing server tests do not cover a true API-token cross-user authorization matrix. That missing test is why the identity-kind flaw remained undetected.

The repository’s `npm test` command executed 14 passing JavaScript tests in this audit: four SDK tests and ten server tests. The shell wrapper used for the audit did not propagate a pipeline status correctly, so future CI should use `set -o pipefail` or avoid piping test output when deciding success.

## Prioritized implementation plan

**P0: Fix authorization before further token adoption.** Change all project management checks to treat both browser sessions and API tokens as owner-scoped user identities. Preserve unrestricted access only for the explicit admin identity. Repair or quarantine existing null-owner records, and add a two-user API-token regression suite.

**P1: Repair first-run synchronization.** Add `--id` to `project pull`, or add `project init --id` that creates a minimal local file. Make the error message match the supported syntax. Add tests for pull, diff, push, invalid JSON, project-ID mismatch, and file permissions.

**P1: Improve token-specific failure handling.** Keep the API/session mode in the local state and map 401 errors to mode-specific recovery instructions. Add a `nexuss token verify` command or make `token use --verify` perform a safe `/v1/me` request.

**P2: Make the CLI agent-safe.** Add `--non-interactive`, stable JSON schemas, explicit exit-code documentation, bounded retries for safe requests, request IDs, and a version command. Do not make destructive commands easier by default; retain explicit confirmation for delete.

**P2: Expand test coverage.** Test every parser branch, every command handler with mocked HTTP responses, browser callback state validation, token-mode session persistence, ownership isolation, null-owner system-project behavior, and the documented install/upgrade path.

## Final assessment

The CLI’s **shape and user experience are strong**, and the package is close to being a practical AI-agent interface. The design correctly separates browser-only token administration from token-based automation and uses a compact command vocabulary. It should not yet be described as production-ready for multi-user API-token project management because the token identity authorization bug is a direct tenant-isolation failure. Once that P0 issue and the broken first-run pull workflow are corrected and covered by regression tests, the CLI will have a solid foundation for the portable, user-agnostic authentication system described in the product requirements.

## References

[1]: https://github.com/nexuss0781/nexuss-auth "Nexuss-auth repository"
[2]: https://github.com/nexuss0781/nexuss-auth/blob/main/python-cli/nexuss_auth_cli/cli.py "Nexuss Python CLI implementation"
[3]: https://github.com/nexuss0781/nexuss-auth/blob/main/python-cli/README.md "Nexuss Python CLI README"
[4]: https://github.com/nexuss0781/nexuss-auth/blob/main/packages/server/src/server.ts "Nexuss server routes and authorization"
[5]: https://github.com/nexuss0781/nexuss-auth/blob/main/packages/server/src/paradox-db.ts "Nexuss Paradox-db project persistence"
[6]: https://github.com/nexuss0781/nexuss-auth/blob/main/tests-python-cli/test_cli.py "Nexuss Python CLI tests"
