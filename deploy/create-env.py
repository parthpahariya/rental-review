"""Create the production Compose .env from deploy/production.env.example and CI variables."""

import json
import os
import re
import sys
from pathlib import Path

REQUIRED = ("SECRET_KEY", "GOOGLE_CLIENT_IDS")
# May be left unset; an empty value is written.
OPTIONAL = (
    "MAP_PROVIDER",
    "GOOGLE_MAPS_API_KEY",
    "GOOGLE_MAPS_MAP_ID",
    "HERE_API_KEY",
    "MAPBOX_ACCESS_TOKEN",
    "OLA_MAPS_API_KEY",
)
MAP_PROVIDERS = ("google", "here", "mapbox", "ola", "osm")
NAMES = REQUIRED + OPTIONAL


def check(name, value):
    if not value and name in OPTIONAL:
        return
    if not value:
        raise SystemExit(f"Set {name} in the CI/CD production environment.")
    if "\n" in value or "\r" in value:
        raise SystemExit(f"{name} must be a single-line value.")
    if name == "SECRET_KEY" and (len(value) < 32 or value.startswith("local-development")):
        raise SystemExit("SECRET_KEY must be a private random value of 32+ characters.")
    if name == "GOOGLE_CLIENT_IDS" and not all(
        part.strip().endswith(".apps.googleusercontent.com") for part in value.split(",")
    ):
        raise SystemExit("GOOGLE_CLIENT_IDS must be Google OAuth client ids, comma-separated.")
    if name == "MAP_PROVIDER" and value not in MAP_PROVIDERS:
        raise SystemExit("MAP_PROVIDER must be one of " + ", ".join(MAP_PROVIDERS) + " or unset.")


def main():
    template, output = map(Path, sys.argv[1:])
    values = {}
    for name in NAMES:
        value = os.environ.get(name, "")
        check(name, value)
        # Compose reads escapes inside double quotes; $$ keeps a literal $.
        values[name] = json.dumps(value, ensure_ascii=False).replace("$", "$$")
    replaced = set()

    def substitute(match):
        replaced.add(match[1])
        return values[match[1]]

    content = re.sub(
        r"\$\{(" + "|".join(NAMES) + r")\}", substitute, template.read_text(encoding="utf-8")
    )
    missing = set(NAMES) - replaced
    if missing:
        raise SystemExit("Missing placeholders in the template: " + ", ".join(sorted(missing)))
    os.umask(0o077)
    output.write_text(content, encoding="utf-8")
    output.chmod(0o600)


if __name__ == "__main__":
    main()
