import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "python-cli"))

from nexuss_auth_cli.cli import build_parser, read_config, write_config  # noqa: E402


class CliContractTests(unittest.TestCase):
    def test_parser_exposes_easy_project_commands(self):
        parser = build_parser()
        self.assertEqual(parser.parse_args(["login"]).command, "login")
        args = parser.parse_args(["project", "rename", "--id", "demo", "--name", "Renamed"])
        self.assertEqual(args.project_action, "rename")
        self.assertEqual(args.name, "Renamed")
        pull = parser.parse_args(["project", "pull", "--id", "demo"])
        self.assertEqual(pull.project_action, "pull")
        self.assertEqual(pull.id, "demo")

    def test_missing_local_file_explains_first_time_pull(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "missing.json"
            with self.assertRaisesRegex(RuntimeError, "project pull --id"):
                read_config(path)

    def test_local_project_file_round_trip(self):
        project = {"projectId": "morrow-field", "name": "Morrow Field", "enabledProviders": ["google", "github"]}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "nexuss.yaml.json"
            write_config(project, path)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), project)
            self.assertEqual(read_config(path), project)


if __name__ == "__main__":
    unittest.main()
