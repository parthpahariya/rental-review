"""Verify the assembled web -> Nginx -> FastAPI -> PostgreSQL path."""
import json
import sys
import urllib.request

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080"


def get(path):
    with urllib.request.urlopen(base + path, timeout=10) as response:
        assert response.status == 200, path
        return response.read()


assert b'<div id="root">' in get("/")
assert json.loads(get("/api/health/ready"))["database"] == "ok"
locations = json.loads(get("/api/v1/locations"))["data"]
assert locations, "Expected fictional seed locations"
assert any(row["summary"]["tenant_review_count"] == 0 and row["summary"]["interaction_review_count"] > 0
           for row in locations), "Interaction-only locations must appear"
for location in locations:
    flats = json.loads(get(f'/api/v1/locations/{location["id"]}/flats'))["data"]
    for flat in flats:
        for kind in ("tenant-reviews", "interactions"):
            result = json.loads(get(f'/api/v1/flats/{flat["id"]}/{kind}'))
            assert "data" in result and "page" in result
print("Compose smoke test passed: UI, API, database, map locations, and both review tabs.")
