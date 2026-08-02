from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse
import json
import mimetypes
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timedelta, timezone


ROOT = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT / "public"
DATA_DIR = ROOT / "data"
CAPTURE_DIR = DATA_DIR / "captures"
MANIFEST_PATH = DATA_DIR / "captures.json"
STATE_PATH = DATA_DIR / "state.json"


def load_env_file(path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file(ROOT / ".env")

RETENTION_DAYS = 15
PIR_GPIO_PIN = int(os.environ.get("SECURITY_PIR_GPIO", "17"))
CAPTURE_SECONDS = int(os.environ.get("SECURITY_CAPTURE_SECONDS", "15"))
RECORD_COOLDOWN_SECONDS = int(os.environ.get("SECURITY_RECORD_COOLDOWN_SECONDS", "10"))
VIDEO_DEVICE = os.environ.get("SECURITY_VIDEO_DEVICE", "/dev/video0")
AUDIO_DEVICE = os.environ.get("SECURITY_AUDIO_DEVICE", "default")
INPUT_FORMAT = os.environ.get("SECURITY_INPUT_FORMAT", "").strip()
VIDEO_SIZE = os.environ.get("SECURITY_VIDEO_SIZE", "640x480")
FRAMERATE = os.environ.get("SECURITY_FRAMERATE", "15")

state_lock = threading.Lock()
recording_lock = threading.Lock()
recording_active = False
last_recording_started_at = 0
last_recording_error = None
last_recording_finished_at = None
last_motion_at = None
motion_sensor = None
motion_sensor_status = {
    "enabled": False,
    "pin": PIR_GPIO_PIN,
    "error": None,
}


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


def parse_utc_datetime(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        return datetime.now(timezone.utc)


def capture_path(capture):
    return CAPTURE_DIR / safe_filename(capture.get("filename", ""))


def list_captures():
    captures = read_json(MANIFEST_PATH, [])
    return [
        {**capture, "favorite": bool(capture.get("favorite"))}
        for capture in captures
        if capture_path(capture).is_file()
    ]


def prune_old_captures():
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    kept = []
    changed = False

    for capture in read_json(MANIFEST_PATH, []):
        target = capture_path(capture)
        if not target.is_file():
            changed = True
            continue

        created_at = parse_utc_datetime(capture.get("createdAt"))
        if not capture.get("favorite") and created_at < cutoff:
            target.unlink(missing_ok=True)
            changed = True
            continue

        kept.append({**capture, "favorite": bool(capture.get("favorite"))})

    if changed:
        write_json(MANIFEST_PATH, kept)

    return kept


def update_capture_favorite(capture_id, favorite):
    captures = prune_old_captures()
    for capture in captures:
        if capture.get("id") == capture_id:
            capture["favorite"] = bool(favorite)
            write_json(MANIFEST_PATH, captures)
            return capture
    return None


def delete_capture(capture_id):
    captures = prune_old_captures()
    kept = []
    deleted = None

    for capture in captures:
        if capture.get("id") == capture_id:
            deleted = capture
            capture_path(capture).unlink(missing_ok=True)
            continue
        kept.append(capture)

    if deleted:
        write_json(MANIFEST_PATH, kept)

    return deleted


def safe_filename(name):
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]+", "-", name).strip(".-")
    return cleaned or "capture.webm"


def unique_capture_name(extension=".webm"):
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    extension = extension if extension.startswith(".") else f".{extension}"
    candidate = f"{timestamp}{extension}"
    index = 2
    while (CAPTURE_DIR / candidate).exists():
        candidate = f"{timestamp}-{index}{extension}"
        index += 1
    return candidate


def is_armed():
    return bool(read_json(STATE_PATH, {"armed": False}).get("armed"))


def add_capture_record(filename, trigger):
    target = CAPTURE_DIR / filename
    record = {
        "id": Path(filename).stem,
        "filename": filename,
        "url": f"/captures/{filename}",
        "createdAt": utc_now(),
        "size": target.stat().st_size,
        "favorite": False,
        "trigger": trigger,
    }

    captures = prune_old_captures()
    captures.insert(0, record)
    write_json(MANIFEST_PATH, captures[:200])
    return record


def build_recording_command(target):
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-thread_queue_size",
        "512",
        "-f",
        "v4l2",
    ]
    if INPUT_FORMAT:
        command.extend(["-input_format", INPUT_FORMAT])

    command.extend(
        [
        "-framerate",
        FRAMERATE,
        "-video_size",
        VIDEO_SIZE,
        "-i",
        VIDEO_DEVICE,
        "-thread_queue_size",
        "512",
        "-f",
        "alsa",
        "-i",
        AUDIO_DEVICE,
        "-t",
        str(CAPTURE_SECONDS),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        str(target),
        ]
    )
    return command


def set_recording_error(message):
    global last_recording_error, last_recording_finished_at

    last_recording_error = message
    last_recording_finished_at = utc_now()
    print(message)


def clear_recording_error():
    global last_recording_error

    last_recording_error = None


def record_from_pi_camera(trigger="motion"):
    global recording_active, last_recording_started_at

    with recording_lock:
        now = time.monotonic()
        if recording_active or now - last_recording_started_at < RECORD_COOLDOWN_SECONDS:
            return False
        if trigger == "motion" and not is_armed():
            return False
        recording_active = True
        last_recording_started_at = now
        clear_recording_error()

    def worker():
        global recording_active, last_recording_finished_at

        filename = unique_capture_name(".mp4")
        target = CAPTURE_DIR / filename

        try:
            result = subprocess.run(
                build_recording_command(target),
                capture_output=True,
                text=True,
                timeout=CAPTURE_SECONDS + 15,
            )
            if result.returncode != 0:
                target.unlink(missing_ok=True)
                error = result.stderr.strip() or "ffmpeg exited without an error message."
                set_recording_error(f"Recording failed: {error}")
                return
            if not target.exists() or target.stat().st_size == 0:
                target.unlink(missing_ok=True)
                set_recording_error("Recording failed: no video file was created.")
                return

            with state_lock:
                add_capture_record(filename, trigger)
            last_recording_finished_at = utc_now()
        except FileNotFoundError:
            target.unlink(missing_ok=True)
            set_recording_error("Recording failed: ffmpeg is not installed or is not on PATH.")
        except subprocess.TimeoutExpired:
            target.unlink(missing_ok=True)
            set_recording_error("Recording failed: ffmpeg timed out.")
        finally:
            with recording_lock:
                recording_active = False

    threading.Thread(target=worker, daemon=True).start()
    return True


def handle_motion_detected():
    global last_motion_at

    last_motion_at = utc_now()
    if is_armed():
        record_from_pi_camera("motion")


def setup_motion_sensor():
    global motion_sensor

    try:
        from gpiozero import MotionSensor

        motion_sensor = MotionSensor(PIR_GPIO_PIN)
        motion_sensor.when_motion = handle_motion_detected
        motion_sensor_status.update({"enabled": True, "error": None})
        print(f"HC-SR501 motion sensor listening on GPIO{PIR_GPIO_PIN}.")
    except Exception as error:
        motion_sensor_status.update({"enabled": False, "error": str(error)})
        print(f"Motion sensor disabled: {error}")


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
                prune_old_captures()
                state = read_json(STATE_PATH, {"armed": False})
                captures = list_captures()
            with recording_lock:
                is_recording = recording_active
                recording_error = last_recording_error
                recording_finished_at = last_recording_finished_at
            self.send_json(
                {
                    "armed": bool(state.get("armed")),
                    "captures": captures,
                    "recording": is_recording,
                    "recordingError": recording_error,
                    "lastRecordingFinishedAt": recording_finished_at,
                    "lastMotionAt": last_motion_at,
                    "sensor": motion_sensor_status,
                    "captureSeconds": CAPTURE_SECONDS,
                    "videoDevice": VIDEO_DEVICE,
                    "audioDevice": AUDIO_DEVICE,
                    "inputFormat": INPUT_FORMAT,
                }
            )
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

            filename = unique_capture_name(".webm")
            target = CAPTURE_DIR / filename

            remaining = length
            with target.open("wb") as file:
                while remaining:
                    chunk = self.rfile.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    file.write(chunk)
                    remaining -= len(chunk)

            with state_lock:
                record = add_capture_record(filename, "dashboard-upload")

            self.send_json(record, status=201)
            return

        self.send_error(404, "Not found")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/captures/"):
            capture_id = unquote(parsed.path.removeprefix("/api/captures/"))
            try:
                payload = self.read_request_json()
            except (json.JSONDecodeError, UnicodeDecodeError):
                self.send_json({"error": "Invalid JSON body."}, status=400)
                return

            with state_lock:
                capture = update_capture_favorite(capture_id, payload.get("favorite"))

            if not capture:
                self.send_json({"error": "Capture not found."}, status=404)
                return

            self.send_json(capture)
            return

        self.send_error(404, "Not found")

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/captures/"):
            capture_id = unquote(parsed.path.removeprefix("/api/captures/"))

            with state_lock:
                capture = delete_capture(capture_id)

            if not capture:
                self.send_json({"error": "Capture not found."}, status=404)
                return

            self.send_json({"deleted": True, "id": capture_id})
            return

        self.send_error(404, "Not found")


def main():
    ensure_storage()
    with state_lock:
        prune_old_captures()
    setup_motion_sensor()
    host = "0.0.0.0"
    port = 8000
    httpd = ThreadingHTTPServer((host, port), SecurityHandler)
    print(f"Room security dashboard running at http://localhost:{port}")
    print("Use http://localhost:8000 on this computer for webcam access.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
