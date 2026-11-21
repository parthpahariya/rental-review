"""Create the production Compose .env from deploy/production.env.example and CI variables."""

import json
import os
import re
import sys
from pathlib import Path

REQUIRED = ("SECRET_KEY", "GOOGLE_CLIENT_IDS")


def check(name, value):
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


def main():
    template, output = map(Path, sys.argv[1:])
    values = {}
    for name in REQUIRED:
        value = os.environ.get(name, "")
        check(name, value)
        # Compose reads escapes inside double quotes; $$ keeps a literal $.
        values[name] = json.dumps(value, ensure_ascii=False).replace("$", "$$")
    replaced = set()

    def substitute(match):
        replaced.add(match[1])
        return values[match[1]]

    content = re.sub(
        r"\$\{(" + "|".join(REQUIRED) + r")\}", substitute, template.read_text(encoding="utf-8")
    )
    missing = set(REQUIRED) - replaced
    if missing:
        raise SystemExit("Missing placeholders in the template: " + ", ".join(sorted(missing)))
    os.umask(0o077)
    output.write_text(content, encoding="utf-8")
    output.chmod(0o600)


if __name__ == "__main__":
    main()
