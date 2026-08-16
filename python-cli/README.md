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
nexuss project pull --id morrow-field
nexuss project diff
nexuss project push
```

`pull` downloads the cloud record, `diff` shows local and cloud differences, and `push` updates only the project represented by the local `projectId`. Secrets are never written to the file.

## Agent output

Add `--json` to commands that support structured output:

```bash
nexuss --json project list
nexuss --json project show --id morrow-field
```

The service enforces ownership for every user-session request. A user cannot list, inspect, update, or delete another account’s project.
