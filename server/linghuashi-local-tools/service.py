"""Optional, authenticated local image tools. No dependency on the Tavern backend."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.metadata
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid

from models import MODELS, download, ready
from diagnostics import environment_report

VERSION = "1.1.0"
MAX_BODY = 17 * 1024 * 1024
MAX_FILE = 12 * 1024 * 1024
TTL = 15 * 60
TERMINAL = ("completed", "failed", "cancelled")
DEPENDENCIES = ("numpy", "Pillow", "onnxruntime", "opencv-contrib-python-headless")


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def normalize_origin(value):
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.netloc or url.username or url.password:
        raise ValueError("Origin must be http(s)://host[:port]")
    if url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Origin must not include a path, query, or fragment")
    return f"{url.scheme}://{url.netloc.lower()}"


def load_config(root, origins):
    root.mkdir(parents=True, exist_ok=True)
    path = root / "secrets.json"
    if path.exists():
        config = json.loads(path.read_text(encoding="utf-8"))
    else:
        config = {"token": secrets.token_urlsafe(32), "origins": []}
    config["origins"] = sorted(set(config.get("origins", []) + [normalize_origin(row) for row in origins]))
    if len(config.get("token", "")) < 24:
        raise ValueError("Component token must contain at least 24 characters")
    path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, 0o600)
    return config


class Tools:
    def __init__(self, root):
        self.root = Path(root)
        self.started = time.monotonic()
        self.models = self.root / "models"
        self.temporary = Path(tempfile.mkdtemp(prefix="linghuashi-tools-"))
        self.jobs = {}
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1)
        self.closed = threading.Event()
        self.janitor = threading.Thread(target=self.clean_periodically, daemon=True)
        self.janitor.start()

    def clean_periodically(self):
        while not self.closed.wait(30):
            self.prune()

    def status(self):
        self.prune()
        with self.lock:
            task_counts = {key: sum(job["status"] == key for job in self.jobs.values())
                           for key in ("queued", "running", "failed")}
        missing = []
        for dependency in DEPENDENCIES:
            try:
                importlib.metadata.version(dependency)
            except importlib.metadata.PackageNotFoundError:
                missing.append(dependency)
        return {"type": "linghuashi-local-tools", "protocol": 1, "version": VERSION,
                "device": "CPU", "missingDependencies": missing,
                "environment": environment_report(self.root),
                "uptimeSeconds": int(time.monotonic() - self.started),
                "tasks": task_counts,
                "limits": {"inputBytes": MAX_FILE, "inputPixels": 16000000,
                           "outputPixels": 24000000, "maxSide": 8192},
                "models": [{"id": key, "title": value["title"], "kind": value["kind"],
                            "bytes": sum(row[2] for row in value["files"]), "ready": ready(self.models, key)}
                           for key, value in MODELS.items()]}

    @staticmethod
    def public(job):
        return {key: job[key] for key in ("id", "kind", "model", "status", "progress", "error", "createdAt")}

    def prune(self):
        with self.lock:
            for job_id, job in list(self.jobs.items()):
                if job["status"] in TERMINAL and time.time() - job["finishedAt"] > TTL:
                    shutil.rmtree(job["directory"], ignore_errors=True)
                    del self.jobs[job_id]

    def get(self, job_id):
        self.prune()
        with self.lock:
            if job_id not in self.jobs:
                raise Problem("Task expired or does not exist", 404)
            return self.jobs[job_id]

    def create(self, request, model_id=None):
        self.prune()
        model_id = model_id or request.get("model")
        if not isinstance(model_id, str) or model_id not in MODELS:
            raise Problem("Unknown model")
        kind = "download" if request.get("kind") == "download" else MODELS[model_id]["kind"]
        if kind != "download" and request.get("kind") != kind:
            raise Problem("Task kind does not match model")
        raw = None
        if kind != "download":
            if not ready(self.models, model_id):
                raise Problem("Model not downloaded; download it in Components", 409)
            missing = self.status()["missingDependencies"]
            if missing:
                raise Problem("Run the installer to install missing dependencies", 409)
            encoded = request.get("image")
            if not isinstance(encoded, str) or len(encoded) > MAX_FILE * 4 / 3 + 8:
                raise Problem("Image must be within 12 MB", 413)
            try:
                raw = base64.b64decode(encoded, validate=True)
            except ValueError:
                raise Problem("Invalid base64 image")
            if not raw or len(raw) > MAX_FILE:
                raise Problem("Image must be within 12 MB", 413)
            if kind == "tags":
                for field, default, maximum in (("threshold", 0.35, 0.95), ("characterThreshold", 0.85, 0.99)):
                    value = request.get(field, default)
                    if isinstance(value, bool) or not isinstance(value, (int, float)) or not 0.05 <= value <= maximum:
                        raise Problem("Invalid confidence threshold")
        with self.lock:
            terminal = sorted((job for job in self.jobs.values() if job["status"] in TERMINAL),
                              key=lambda row: row["finishedAt"])
            while len(self.jobs) >= 16 and terminal:
                oldest = terminal.pop(0)
                shutil.rmtree(oldest["directory"], ignore_errors=True)
                del self.jobs[oldest["id"]]
            if sum(job["status"] not in TERMINAL for job in self.jobs.values()) >= 4:
                raise Problem("Queue full (maximum 4 tasks); wait or cancel a task", 429)
            if kind == "download" and any(job["model"] == model_id and job["kind"] == kind
                                          and job["status"] not in TERMINAL for job in self.jobs.values()):
                raise Problem("This model is already downloading", 409)
            job_id = uuid.uuid4().hex
            directory = self.temporary / job_id
            directory.mkdir()
            if raw:
                (directory / "input").write_bytes(raw)
            clean_request = {"model": model_id, **{key: request[key] for key in
                             ("threshold", "characterThreshold") if key in request}}
            (directory / "request.json").write_text(json.dumps(clean_request), encoding="utf-8")
            job = {"id": job_id, "kind": kind, "model": model_id, "status": "queued", "progress": 0,
                   "error": "", "createdAt": int(time.time() * 1000), "finishedAt": 0,
                   "directory": directory, "cancel": threading.Event()}
            self.jobs[job_id] = job
            self.pool.submit(self.run, job)
            return self.public(job)

    def run(self, job):
        directory = job["directory"]
        try:
            if job["cancel"].is_set():
                raise InterruptedError()
            job["status"] = "running"
            if job["kind"] == "download":
                download(self.models, job["model"], lambda value: job.update(progress=value), job["cancel"].is_set)
            else:
                job["progress"] = 10
                log = directory / "worker-error"
                with log.open("wb") as stderr:
                    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("worker.py")),
                                                str(directory / "input"), str(directory / "result"),
                                                str(self.models)], stdout=subprocess.DEVNULL, stderr=stderr)
                    started = time.monotonic()
                    try:
                        while process.poll() is None:
                            if job["cancel"].wait(0.15):
                                raise InterruptedError()
                            if time.monotonic() - started > 600:
                                raise Problem("Inference exceeded 10 minutes; try a smaller image")
                        if process.returncode:
                            message = log.read_text(encoding="utf-8", errors="replace").strip()
                            raise Problem(message[-300:] or "Inference failed; check dependencies")
                    finally:
                        if process.poll() is None:
                            process.terminate()
                            process.wait(timeout=10)
                job["progress"] = 95
            if job["cancel"].is_set():
                raise InterruptedError()
            job.update(status="completed", progress=100)
        except InterruptedError:
            job.update(status="cancelled")
        except Problem as error:
            job.update(status="failed", error=str(error))
        except Exception as error:
            job.update(status="failed", error=f"Operation failed ({type(error).__name__}); check network, disk and dependencies")
        finally:
            job["finishedAt"] = time.time()
            for name in ("input", "request.json", "worker-error"):
                (directory / name).unlink(missing_ok=True)
            if job["status"] != "completed":
                (directory / "result").unlink(missing_ok=True)

    def cancel(self, job_id):
        job = self.get(job_id)
        job["cancel"].set()
        if job["status"] in TERMINAL:
            (job["directory"] / "result").unlink(missing_ok=True)
            job["status"] = "cancelled"
            job["finishedAt"] = time.time()
        return self.public(job)

    def result(self, job_id):
        job = self.get(job_id)
        if job["status"] != "completed" or job["kind"] == "download":
            raise Problem("Result is not available", 409)
        path = job["directory"] / "result"
        if not path.exists():
            raise Problem("Result expired", 404)
        return path.read_bytes(), "image/png" if job["kind"] == "upscale" else "application/json"

    def close(self):
        self.closed.set()
        self.janitor.join(timeout=2)
        for job in list(self.jobs.values()):
            job["cancel"].set()
        self.pool.shutdown(wait=True)
        shutil.rmtree(self.temporary, ignore_errors=True)


def make_handler(tools, config):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.0"

        def log_message(self, *_):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def allowed_origin(self):
            origin = self.headers.get("Origin")
            return not origin or origin in config["origins"]

        def send(self, value, status=200, mime="application/json"):
            data = value if isinstance(value, bytes) else json.dumps(value).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Vary", "Origin")
            if self.allowed_origin() and self.headers.get("Origin"):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.end_headers()
            self.wfile.write(data)

        def do_OPTIONS(self):
            if not self.allowed_origin():
                return self.send({"error": "Origin not allowed; add the Tavern origin at startup"}, 403)
            self.send_response(204)
            if self.headers.get("Origin"):
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
            self.end_headers()

        def dispatch(self):
            try:
                if not self.allowed_origin():
                    raise Problem("Origin not allowed; add the Tavern origin at startup", 403)
                expected = "Bearer " + config["token"]
                if not hmac.compare_digest(self.headers.get("Authorization", "").encode(), expected.encode()):
                    raise Problem("Component token is missing or incorrect", 401)
                path = urlsplit(self.path).path.rstrip("/")
                if self.command == "GET" and path == "/v1/status":
                    return self.send(tools.status())
                if self.command == "POST" and path == "/v1/jobs":
                    if "application/json" not in self.headers.get("Content-Type", ""):
                        raise Problem("Expected application/json", 415)
                    if self.headers.get("Transfer-Encoding"):
                        raise Problem("Chunked uploads are not supported")
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                    except ValueError:
                        raise Problem("Invalid Content-Length")
                    if not 0 < length <= MAX_BODY:
                        raise Problem("Request too large or empty", 413)
                    raw = self.rfile.read(length)
                    if len(raw) != length:
                        raise Problem("Incomplete request")
                    try:
                        request = json.loads(raw)
                    except (ValueError, UnicodeError):
                        raise Problem("Invalid JSON")
                    if not isinstance(request, dict):
                        raise Problem("Expected JSON object")
                    return self.send(tools.create(request), 202)
                parts = path.split("/")
                if len(parts) in (4, 5) and parts[:3] == ["", "v1", "jobs"]:
                    job_id = parts[3]
                    if len(parts) == 5 and parts[4] == "result" and self.command == "GET":
                        data, mime = tools.result(job_id)
                        return self.send(data, mime=mime)
                    if len(parts) == 4:
                        if self.command == "GET":
                            return self.send(tools.public(tools.get(job_id)))
                        if self.command == "DELETE":
                            return self.send(tools.cancel(job_id))
                raise Problem("Unknown endpoint", 404)
            except Problem as error:
                self.send({"error": str(error)}, error.status)
            except (OSError, TimeoutError):
                pass
            except Exception:
                self.send({"error": "Component internal error; restart the component"}, 500)

        do_GET = do_POST = do_DELETE = dispatch
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parent / "data")
    parser.add_argument("--allow-origin", action="append", default=[])
    parser.add_argument("--show-token", action="store_true", help="Print the component token and exit")
    args = parser.parse_args()
    config = load_config(args.data, args.allow_origin)
    if args.show_token:
        print(config["token"])
        return
    if not config["origins"]:
        parser.error("Add --allow-origin https://your-tavern.example (the browser page origin)")
    tools = Tools(args.data)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(tools, config))
    print(f"Linghuashi local tools {VERSION}: http://{args.host}:{args.port}", flush=True)
    print("Token saved in data/secrets.json. Use --show-token to view it.", flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        tools.close()


if __name__ == "__main__":
    main()
