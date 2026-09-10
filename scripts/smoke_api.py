import sys

import httpx


base_url = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")

with httpx.Client(base_url=base_url, timeout=10) as client:
    checks = [
        "/api/health",
        "/api/system/status",
        "/api/system/workers",
        "/api/system/circuits",
        "/api/jobs?limit=1",
        "/api/files?limit=1",
    ]
    for path in checks:
        response = client.get(path)
        response.raise_for_status()
        print(f"OK {response.status_code} {path}")
