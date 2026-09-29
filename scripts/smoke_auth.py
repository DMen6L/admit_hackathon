import json
import os
import urllib.error
import urllib.request
from uuid import uuid4


base_url = os.environ.get("API_BASE_URL", "http://localhost:8000").rstrip("/")
login = os.environ.get("AUTH_SMOKE_LOGIN", f"smoke_{uuid4().hex[:10]}")
password = os.environ.get("AUTH_SMOKE_PASSWORD", "Spellbound1")


def request(path: str, method: str, body: dict | None = None, token: str | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request_object = urllib.request.Request(f"{base_url}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request_object, timeout=10) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise SystemExit(f"{method} {path} failed with {error.code}: {detail}") from error


registered = request("/api/auth/register", "POST", {"login": login, "password": password})
token = registered["accessToken"]
current_user = request("/api/auth/me", "GET", token=token)
print(f"Created {current_user['login']} with UUID {current_user['id']}")
