from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import json
import mimetypes
import re
import threading
from datetime import datetime, timezone


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"
CAPTURE_DIR = DATA_DIR / "captures"
MANIFEST_PATH = DATA_DIR / "captures.json"
STATE_PATH = DATA_DIR / "state.json"

state_lock = threading.Lock()


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ensure_storage():
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(exist_ok=True)
    if not MANIFEST_PATH.exists():
        MANIFEST_PATH.write_text("[]", encoding="utf-8")
    if not STATE_PATH.exists():
        STATE_PATH.write_text(json.dumps({"armed": False}, indent=2), encoding="utf-8")


def read_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return fallback


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def list_captures():
    captures = read_json(MANIFEST_PATH, [])
    return [
        capture
        for capture in captures
        if (CAPTURE_DIR / safe_filename(capture.get("filename", ""))).is_file()
    ]


def safe_filename(name):
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip(".-")
    return cleaned or "capture.webm"


def unique_capture_name(original_name):
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    original = safe_filename(original_name)
    stem = Path(original).stem[:50] or "capture"
    suffix = Path(original).suffix.lower() or ".webm"
    candidate = f"{timestamp}-{stem}{suffix}"
    index = 2
    while (CAPTURE_DIR / candidate).exists():
        candidate = f"{timestamp}-{stem}-{index}{suffix}"
        index += 1
    return candidate


class SecurityHandler(SimpleHTTPRequestHandler):
    server_version = "RoomSecurityHTTP/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_request_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        body = self.rfile.read(length)
        return json.loads(body.decode("utf-8"))

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            with state_lock:
                state = read_json(STATE_PATH, {"armed": False})
                captures = list_captures()
            self.send_json({"armed": bool(state.get("armed")), "captures": captures})
            return

        if parsed.path.startswith("/captures/"):
            filename = safe_filename(unquote(parsed.path.removeprefix("/captures/")))
            target = CAPTURE_DIR / filename
            if not target.exists() or not target.is_file():
                self.send_error(404, "Capture not found")
                return
            content_type = mimetypes.guess_type(target.name)[0] or "video/webm"
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(target.stat().st_size))
            self.end_headers()
            with target.open("rb") as file:
                self.wfile.write(file.read())
            return

        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/status":
            try:
                payload = self.read_request_json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_json({"error": "Invalid JSON body."}, status=400)
                return

            with state_lock:
                state = {"armed": bool(payload.get("armed"))}
                write_json(STATE_PATH, state)
            self.send_json(state)
            return

        if parsed.path == "/api/captures":
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                self.send_json({"error": "No video data received."}, status=400)
                return

            original_name = self.headers.get("X-Capture-Name", "motion.webm")
            filename = unique_capture_name(original_name)
            target = CAPTURE_DIR / filename

            remaining = length
            with target.open("wb") as file:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    file.write(chunk)
                    remaining -= len(chunk)

            record = {
                "id": Path(filename).stem,
                "filename": filename,
                "url": f"/captures/{filename}",
                "createdAt": utc_now(),
                "size": target.stat().st_size,
            }

            with state_lock:
                captures = read_json(MANIFEST_PATH, [])
                captures.insert(0, record)
                write_json(MANIFEST_PATH, captures[:200])

            self.send_json(record, status=201)
            return

        self.send_error(404, "Not found")


def main():
    ensure_storage()
    host = "0.0.0.0"
    port = 8000
    httpd = ThreadingHTTPServer((host, port), SecurityHandler)
    print(f"Room security dashboard running at http://localhost:{port}")
    print("Use http://localhost:8000 on this computer for webcam access.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
