"""Run with: python3 -m unittest discover -s deploy/tests -v"""

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GOOD = {
    "SECRET_KEY": "s" * 48,
    "GOOGLE_CLIENT_IDS": "123-abc.apps.googleusercontent.com",
}


MAP_SETTINGS = {"MAP_PROVIDER", "OLA_MAPS_API_KEY"}


def run(**overrides):
    env = {k: v for k, v in os.environ.items()
           if k not in GOOD and k not in MAP_SETTINGS}
    env.update({k: v for k, v in {**GOOD, **overrides}.items() if v is not None})
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / ".env"
        result = subprocess.run(
            [sys.executable, str(ROOT / "deploy/create-env.py"),
             str(ROOT / "deploy/production.env.example"), str(out)],
            env=env, capture_output=True, text=True,
        )
        content = out.read_text() if out.exists() else ""
        mode = out.stat().st_mode & 0o777 if out.exists() else None
    return result, content, mode


class CreateEnvTest(unittest.TestCase):
    def test_fills_placeholders_and_keeps_defaults(self):
        result, content, mode = run(SECRET_KEY="a$b" + "x" * 40)
        self.assertEqual(result.returncode, 0, result.stderr)
        # The database credentials come from postgres-platform, not this file.
        self.assertNotIn("POSTGRES", content)
        self.assertIn('SECRET_KEY="a$$b', content)  # $ escaped for Compose
        self.assertIn("APP_ENV=production", content)
        self.assertIn("SEED_DEMO_DATA=false", content)
        settings = [line for line in content.splitlines() if not line.startswith("#")]
        self.assertFalse([line for line in settings if "${" in line])
        self.assertEqual(mode, 0o600)

    def test_maps_settings_are_optional(self):
        result, content, _ = run()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('MAP_PROVIDER=""', content)
        self.assertIn('OLA_MAPS_API_KEY=""', content)
        for provider in ("ola", "osm"):
            result, content, _ = run(MAP_PROVIDER=provider, OLA_MAPS_API_KEY="ola")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(f'MAP_PROVIDER="{provider}"', content)
            self.assertIn('OLA_MAPS_API_KEY="ola"', content)
        for provider in ("google", "mapbox", "bing"):
            result, _, _ = run(MAP_PROVIDER=provider)
            self.assertNotEqual(result.returncode, 0, provider)

    def test_rejects_missing_or_unsafe_values(self):
        for overrides in (
            {"SECRET_KEY": None},
            {"SECRET_KEY": "too-short"},
            {"SECRET_KEY": "local-development-only-change-before-deployment"},
            {"GOOGLE_CLIENT_IDS": "not-a-client-id"},
            {"GOOGLE_CLIENT_IDS": "a.apps.googleusercontent.com\nEXTRA=1"},
        ):
            with self.subTest(overrides):
                result, content, _ = run(**overrides)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(content, "")


if __name__ == "__main__":
    unittest.main()
