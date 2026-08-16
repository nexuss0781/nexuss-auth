# nexuss-auth Python CLI

The Python CLI gives ordinary Nexuss-auth users a simple terminal workflow. Sign in through the browser, then manage only the projects owned by that account. No user-level API key is required.

## Install

```bash
pip install nexuss-auth
```

## Sign in

```bash
nexuss login
nexuss whoami
```

The CLI opens Google in the browser, receives a short-lived user session through a loopback callback, and stores the local session with restrictive file permissions. It never asks for or stores the Nexuss-auth admin token.

## Manage projects

```bash
nexuss project list
nexuss project create --id morrow-field --name "Morrow Field" --home https://morrowfield.example --redirect https://morrowfield.example/
nexuss project show --id morrow-field
nexuss project rename --id morrow-field --name "Morrow Field Studio"
nexuss project providers --id morrow-field --provider google --provider github
nexuss project icon --id morrow-field --icon https://cdn.example/morrow-field.png
nexuss project delete --id morrow-field
```

Project creation returns the project record, including the `projectId` needed by an application SDK. The default provider set is Google and GitHub unless providers are supplied explicitly.

## Synchronize local configuration

The CLI uses a JSON file named `nexuss.yaml.json` in the current directory for the first release. It is intentionally JSON-compatible so shell tools and AI agents can inspect it without another parser.

```bash
# First pull: --id is enough when the local file does not exist.
nexuss project pull --id morrow-field --file nexuss.yaml.json
nexuss project diff --file nexuss.yaml.json
nexuss project push --file nexuss.yaml.json
```

`pull` downloads the cloud record, `diff` shows local and cloud differences, and `push` updates only the project represented by the local `projectId`. If the file already exists, `pull` can infer the project ID from it. Secrets are never written to the file.

## Agent output

Add `--json` to commands that support structured output:

```bash
nexuss --json project list
nexuss --json project show --id morrow-field
```

The service enforces ownership for every browser session and API-token request. A user or token cannot list, inspect, update, or delete another account’s project.


## API tokens

After browser sign-in, generate a user-scoped token for terminal access:

```bash
nexuss token create --label "Portfolio CLI"
nexuss token use --value nxa_<copied-secret>
nexuss project list
```

The full secret appears only once. The CLI stores the activated token in its protected local session file and sends it only over HTTPS to Nexuss-auth. Token administration remains tied to browser sign-in:

```bash
nexuss token list
nexuss token revoke --id <token-id>
```

A token can manage only projects owned by its user. It cannot generate or revoke other tokens and it is never equivalent to the server-only admin token. If a token is revoked or invalid, activate a replacement token with `nexuss token use --value <new-token>`.
