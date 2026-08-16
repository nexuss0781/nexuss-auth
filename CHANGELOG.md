# Changelog

All notable changes to Nexuss-auth and its AI-agent operating package are recorded here.

## 2026-08-16 — SKILL 1.0.0

- Added the `SKILL/` directory to the published `nexuss-auth` package.
- Added directive-based guidance for application integration, HTTP API use, private automation, CLI workflows, production operations, and security boundaries.
- Added complete coverage for health, Google and GitHub OAuth, callback handling, current-user lookup, logout, project listing, project creation, project inspection, and project updates.
- Added `npm run skill:validate` to verify required files, internal links, API routes, directives, code fences, and prohibited wording.
- Added the `SKILL/VERSION.md` release contract and CI enforcement for the validator.


## Unreleased — Python CLI 0.1.0

Added a PyPI-ready `nexuss-auth` Python CLI with browser-based Google or GitHub login, local protected session storage, account-scoped `whoami`, project listing, creation, inspection, rename, deletion, provider configuration, icon configuration, and JSON output for AI agents. Added local `pull`, `diff`, and `push` synchronization commands.

The service now accepts the CLI’s user-session bearer credential for `/v1/me`, logout, and project management, while preserving the separate admin-token boundary for private automation. Project deletion is ownership-checked and returns `204` only after the caller is authorized.
