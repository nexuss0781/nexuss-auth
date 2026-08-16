from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

DEFAULT_AUTH_URL = "https://nexuss-auth.vercel.app"
DASHBOARD_PROJECT_ID = "nexuss-dashboard"
SESSION_DIR = Path(os.environ.get("NEXUSS_AUTH_CONFIG_DIR", Path.home() / ".config" / "nexuss-auth"))
SESSION_FILE = SESSION_DIR / "session.json"
LOCAL_CONFIG = Path("nexuss.yaml.json")


class CliError(RuntimeError):
    pass


def output(value: Any, as_json: bool = False) -> None:
    if as_json:
        print(json.dumps(value, indent=2, sort_keys=True))
    elif isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, list):
                print(f"{key}: {', '.join(map(str, item))}")
            else:
                print(f"{key}: {item}")
    elif isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                print(f"{item.get('projectId', '')}\t{item.get('name', '')}\t{item.get('status', '')}")
            else:
                print(item)
    else:
        print(value)


def save_session(token: str, auth_url: str, mode: str = "session") -> None:
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    SESSION_FILE.write_text(json.dumps({"token": token, "authUrl": auth_url.rstrip("/"), "mode": mode}), encoding="utf-8")
    try:
        SESSION_FILE.chmod(0o600)
    except OSError:
        pass


def load_session() -> dict[str, str]:
    if not SESSION_FILE.exists():
        raise CliError("Not signed in. Run `nexuss login` first.")
    try:
        value = json.loads(SESSION_FILE.read_text(encoding="utf-8"))
        if not value.get("token") or not value.get("authUrl"):
            raise ValueError
        return {"token": str(value["token"]), "authUrl": str(value["authUrl"]), "mode": str(value.get("mode", "session"))}
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise CliError("The local Nexuss-auth session is invalid. Run `nexuss logout` and then `nexuss login`.") from exc


def require_browser_session() -> dict[str, str]:
    session = load_session()
    if session.get("mode") != "session":
        raise CliError("This command requires browser sign-in. Run `nexuss login` first.")
    return session


def save_api_token(token: str, auth_url: str) -> None:
    save_session(token, auth_url, "api")


class Api:
    def __init__(self, session: dict[str, str]):
        self.auth_url = session["authUrl"]
        self.token = session["token"]
        self.mode = session.get("mode", "session")

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        url = f"{self.auth_url}{path}"
        payload = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"authorization": f"Bearer {self.token}", "x-nex-auth-project": DASHBOARD_PROJECT_ID, "accept": "application/json"}
        if body is not None:
            headers["content-type"] = "application/json"
        request = urllib.request.Request(url, data=payload, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                if not raw:
                    return None
                return json.loads(raw.decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                detail = json.loads(exc.read().decode("utf-8"))
            except Exception:
                detail = {"error": exc.reason}
            message = detail.get("error", f"HTTP {exc.code}") if isinstance(detail, dict) else f"HTTP {exc.code}"
            if exc.code == 401:
                message = (
                    "The API token is invalid or revoked. Run `nexuss token use --value <new-token>."
                    if self.mode == "api"
                    else "Your Nexuss-auth session expired. Run `nexuss login` again."
                )
            raise CliError(message) from exc
        except urllib.error.URLError as exc:
            raise CliError(f"Nexuss-auth is unreachable: {exc.reason}") from exc

    def me(self) -> dict[str, Any] | None:
        result = self.request("GET", f"/v1/me?project_id={urllib.parse.quote(DASHBOARD_PROJECT_ID)}")
        return result.get("user") if isinstance(result, dict) else None

    def projects(self) -> list[dict[str, Any]]:
        return self.request("GET", "/v1/projects")["projects"]

    def project(self, project_id: str) -> dict[str, Any]:
        return self.request("GET", f"/v1/projects/{urllib.parse.quote(project_id)}")


def login(args: argparse.Namespace) -> None:
    auth_url = (args.auth_url or os.environ.get("NEXUSS_AUTH_URL") or DEFAULT_AUTH_URL).rstrip("/")
    provider = args.provider
    state = secrets.token_urlsafe(16)
    result: dict[str, str] = {}

    class Callback(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            if query.get("cli_state", [""])[0] != state:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Invalid CLI login state")
                return
            token = query.get("session_token", [""])[0]
            result["token"] = token
            self.send_response(200 if token else 400)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<h2>Nexuss-auth CLI connected.</h2><p>You can close this window and return to the terminal.</p>" if token else b"Missing session token")
            threading.Thread(target=self.server.shutdown, daemon=True).start()

        def log_message(self, *_: Any) -> None:
            return

    server = HTTPServer(("127.0.0.1", 0), Callback)
    callback = f"http://127.0.0.1:{server.server_port}/callback?cli_state={urllib.parse.quote(state)}"
    query = urllib.parse.urlencode({"project_id": DASHBOARD_PROJECT_ID, "redirect_uri": callback})
    login_url = f"{auth_url}/oauth/start/{provider}?{query}"
    print(f"Opening {provider.title()} in your browser…")
    print("If it does not open, copy this URL into a browser:")
    print(login_url)
    webbrowser.open(login_url)
    server.timeout = 180
    server.handle_request()
    server.server_close()
    if result.get("token"):
        save_session(result["token"], auth_url, "session")
        print("Signed in. Run `nexuss whoami` or `nexuss project list`.")
    else:
        raise CliError("CLI login did not complete.")


def write_config(project: dict[str, Any], path: Path = LOCAL_CONFIG) -> None:
    path.write_text(json.dumps(project, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def read_config(path: Path = LOCAL_CONFIG) -> dict[str, Any]:
    if not path.exists():
        raise CliError(f"No local project file at {path}. Run `nexuss project pull --id <project-id>` first, or create a file containing projectId.")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CliError(f"Invalid project file: {path}") from exc
    if not isinstance(value, dict) or not value.get("projectId"):
        raise CliError("The local project file must contain a projectId.")
    return value


def token_command(args: argparse.Namespace) -> None:
    if args.token_action == "use":
        if not args.value.startswith("nxa_"):
            raise CliError("API tokens must start with nxa_.")
        auth_url = (args.auth_url or os.environ.get("NEXUSS_AUTH_URL") or DEFAULT_AUTH_URL).rstrip("/")
        save_api_token(args.value, auth_url)
        print("API token activated for this CLI. Run `nexuss project list` to verify it.")
        return
    session = require_browser_session()
    api = Api(session)
    if args.token_action == "create":
        created = api.request("POST", "/v1/tokens", {"label": args.label})
        output(created, args.json)
        if not args.json:
            print("Save the token now; it will not be shown again.")
        return
    if args.token_action == "list":
        output(api.request("GET", "/v1/tokens").get("tokens", []), args.json)
        return
    if args.token_action == "revoke":
        api.request("DELETE", f"/v1/tokens/{urllib.parse.quote(args.id)}")
        print(f"Revoked token {args.id}.")
        return
    raise CliError("Unknown token command.")


def project_command(args: argparse.Namespace) -> None:
    api = Api(load_session())
    if args.project_action == "list":
        output(api.projects(), args.json)
        return
    if args.project_action == "show":
        output(api.project(args.id), args.json)
        return
    if args.project_action == "create":
        project_id = args.id or input("Project ID: ").strip()
        name = args.name or input("Project name: ").strip()
        home = args.home or input("Homepage URL: ").strip()
        redirect = args.redirect or input("Redirect URL: ").strip()
        project = {
            "projectId": project_id,
            "name": name,
            "homepageUrl": home,
            "description": args.description or "",
            "avatarUrl": args.icon,
            "allowedRedirectUris": [redirect],
            "allowedOrigins": [urllib.parse.urlparse(home).scheme + "://" + urllib.parse.urlparse(home).netloc],
            "enabledProviders": args.provider or ["google", "github"],
            "status": "active",
        }
        created = api.request("POST", "/v1/projects", project)
        output(created, args.json)
        return
    if args.project_action == "rename":
        updated = api.request("PATCH", f"/v1/projects/{urllib.parse.quote(args.id)}", {"name": args.name})
        output(updated, args.json)
        return
    if args.project_action == "delete":
        if not args.yes:
            answer = input(f"Delete project {args.id}? Type the project ID to confirm: ").strip()
            if answer != args.id:
                raise CliError("Deletion cancelled.")
        api.request("DELETE", f"/v1/projects/{urllib.parse.quote(args.id)}")
        print(f"Deleted {args.id}.")
        return
    if args.project_action in {"providers", "icon"}:
        body = {"enabledProviders": args.provider} if args.project_action == "providers" else {"avatarUrl": args.icon}
        output(api.request("PATCH", f"/v1/projects/{urllib.parse.quote(args.id)}", body), args.json)
        return
    if args.project_action in {"pull", "push", "diff"}:
        path = Path(args.file)
        if args.project_action == "pull":
            local = read_config(path) if path.exists() else {}
            project_id = args.id or local.get("projectId")
            if not project_id:
                raise CliError("Project pull requires --id <project-id> when the local file does not exist.")
            if local.get("projectId") and local["projectId"] != project_id:
                raise CliError("The local projectId does not match --id.")
            remote = api.project(project_id)
            write_config(remote, path)
            print(f"Pulled {project_id} into {args.file}.")
        else:
            local = read_config(path)
            remote = api.project(local["projectId"])
            if args.project_action == "diff":
                changes = {key: {"local": local.get(key), "cloud": remote.get(key)} for key in sorted(set(local) | set(remote)) if local.get(key) != remote.get(key)}
                output(changes, True)
            else:
                changes = {key: value for key, value in local.items() if key != "projectId"}
                output(api.request("PATCH", f"/v1/projects/{urllib.parse.quote(local['projectId'])}", changes), args.json)
        return
    raise CliError("Unknown project command.")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="nexuss", description="Manage your Nexuss-auth projects from the terminal.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON where supported.")
    sub = parser.add_subparsers(dest="command", required=True)
    login_parser = sub.add_parser("login", help="Sign in through the Nexuss-auth website.")
    login_parser.add_argument("--provider", choices=["google", "github"], default="google")
    login_parser.add_argument("--auth-url", default=None)
    sub.add_parser("logout", help="Remove the local CLI session.")
    sub.add_parser("whoami", help="Show the signed-in Nexuss-auth user.")
    token = sub.add_parser("token", help="Manage per-user CLI API tokens.")
    token_sub = token.add_subparsers(dest="token_action", required=True)
    create_token = token_sub.add_parser("create", help="Generate a token; the secret is shown once."); create_token.add_argument("--label", default="CLI token")
    token_sub.add_parser("list", help="List token metadata without secrets.")
    revoke_token = token_sub.add_parser("revoke", help="Revoke one token."); revoke_token.add_argument("--id", required=True)
    use_token = token_sub.add_parser("use", help="Activate a token in this CLI profile."); use_token.add_argument("--value", required=True); use_token.add_argument("--auth-url", default=None)
    project = sub.add_parser("project", help="Manage account-owned projects.")
    project_sub = project.add_subparsers(dest="project_action", required=True)
    project_sub.add_parser("list", help="List your projects.")
    show = project_sub.add_parser("show", aliases=["inspect"]); show.add_argument("--id", required=True)
    create = project_sub.add_parser("create"); create.add_argument("--id"); create.add_argument("--name"); create.add_argument("--home"); create.add_argument("--redirect"); create.add_argument("--description", default=""); create.add_argument("--icon"); create.add_argument("--provider", action="append", choices=["google", "github"])
    rename = project_sub.add_parser("rename"); rename.add_argument("--id", required=True); rename.add_argument("--name", required=True)
    delete = project_sub.add_parser("delete"); delete.add_argument("--id", required=True); delete.add_argument("--yes", action="store_true")
    providers = project_sub.add_parser("providers"); providers.add_argument("--id", required=True); providers.add_argument("--provider", action="append", choices=["google", "github"], required=True)
    icon = project_sub.add_parser("icon"); icon.add_argument("--id", required=True); icon.add_argument("--icon", required=True)
    for action in ["pull", "push", "diff"]:
        sync = project_sub.add_parser(action)
        sync.add_argument("--file", default=str(LOCAL_CONFIG))
        if action == "pull":
            sync.add_argument("--id", default=None, help="Project ID to download when the local file does not exist.")
    login_parser.set_defaults(handler=login)
    token.set_defaults(handler=token_command)
    project.set_defaults(handler=project_command)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        if args.command == "logout":
            SESSION_FILE.unlink(missing_ok=True)
            print("Signed out.")
        elif args.command == "whoami":
            output(Api(load_session()).me(), args.json)
        else:
            args.handler(args)
        return 0
    except CliError as exc:
        print(f"nexuss: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nCancelled.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
