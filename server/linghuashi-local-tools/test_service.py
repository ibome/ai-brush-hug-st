import base64
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from service import Tools, Problem, make_handler, load_config
from diagnostics import environment_report
import socket


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.tools = Tools(self.temp.name)
        self.config = {"token": "fixture-token-with-enough-length", "origins": ["https://tavern.test"]}
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.tools, self.config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tools.close()
        self.temp.cleanup()

    def request(self, path="/v1/status", method="GET", body=None, token=True, origin="https://tavern.test"):
        headers = {"Origin": origin}
        if token:
            headers["Authorization"] = "Bearer " + self.config["token"]
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"http://127.0.0.1:{self.server.server_port}{path}",
                                         data=json.dumps(body).encode() if body is not None else None,
                                         headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read(), error.headers

    def test_auth_cors_and_preflight(self):
        self.assertEqual(self.request(token=False)[0], 401)
        self.assertEqual(self.request(origin="https://foreign.test")[0], 403)
        status, data, headers = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "https://tavern.test")
        self.assertNotIn("fixture-token", data.decode())
        self.assertEqual(self.request(method="OPTIONS", token=False)[0], 204)
        self.assertEqual(self.request(method="OPTIONS", origin="null")[0], 403)
        self.assertEqual(json.loads(data)["protocol"], 1)
        report = json.loads(data)
        self.assertIn("environment", report)
        self.assertIsInstance(report["uptimeSeconds"], int)
        self.assertNotIn(self.temp.name, data.decode())

    def test_environment_report_is_read_only_and_detects_busy_port(self):
        root = Path(self.temp.name) / "not-created" / "data"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            report = environment_report(root, probe.getsockname()[1])
        self.assertFalse(root.exists())
        self.assertFalse(next(row["ok"] for row in report["checks"] if row["id"] == "port"))
        serialized = json.dumps(report)
        self.assertNotIn(self.temp.name, serialized)
        self.assertNotIn("token", report)

    def test_validation_does_not_accept_remote_image_urls_or_arbitrary_models(self):
        for body in ({"kind": "upscale", "model": "https://foreign.test/weights"},
                     {"kind": "tags", "model": ["bad"]}, []):
            self.assertEqual(self.request("/v1/jobs", "POST", body)[0], 400)
        self.assertEqual(self.request("/v1/jobs", "POST", {"kind": "tags", "model": "wd-vit-v3"})[0], 409)
        with patch("service.ready", return_value=True), patch.object(self.tools, "status", return_value={"missingDependencies": []}):
            with self.assertRaises(Problem):
                self.tools.create({"kind": "tags", "model": "wd-vit-v3", "image": "not-base64"})
            with self.assertRaises(Problem):
                self.tools.create({"kind": "tags", "model": "wd-vit-v3", "image": base64.b64encode(b"x").decode(),
                                   "threshold": float("nan")})

    def test_queue_cancel_and_expiry(self):
        gate = threading.Event()
        def fake_download(_root, _id, progress, cancelled):
            while not gate.wait(0.01):
                if cancelled():
                    raise InterruptedError()
            progress(100)
        try:
            with patch("service.download", side_effect=fake_download):
                jobs = [self.tools.create({"kind": "download", "model": key})
                        for key in ("wd-vit-v3", "fsrcnn-x2", "fsrcnn-x4")]
                self.tools.cancel(jobs[0]["id"])
                until = time.time() + 2
                while self.tools.get(jobs[0]["id"])["status"] != "cancelled" and time.time() < until:
                    time.sleep(0.01)
                self.assertEqual(self.tools.get(jobs[0]["id"])["status"], "cancelled")
                with self.assertRaises(Problem):
                    self.tools.create({"kind": "download", "model": "fsrcnn-x2"})
                gate.set()
                self.tools.pool.shutdown(wait=True)
                job = self.tools.get(jobs[1]["id"])
                self.assertEqual(job["status"], "completed")
                job["finishedAt"] = time.time() - 901
                self.tools.prune()
                with self.assertRaises(Problem):
                    self.tools.get(job["id"])
        finally:
            gate.set()

    def test_config_retains_token_and_normalizes_allowed_origin(self):
        root = Path(self.temp.name) / "config"
        first = load_config(root, ["https://Tavern.test/"])
        second = load_config(root, ["http://localhost:8000"])
        self.assertEqual(first["token"], second["token"])
        self.assertIn("https://tavern.test", second["origins"])
        with self.assertRaises(ValueError):
            load_config(root, ["https://tavern.test/private"])

    def test_queue_limit_rejects_fifth_image_without_storing_it(self):
        gate = threading.Event()
        try:
            with patch("service.ready", return_value=True), patch.object(self.tools, "status", return_value={"missingDependencies": []}), \
                 patch.object(self.tools, "run", side_effect=lambda _job: gate.wait(2)):
                body = {"kind": "upscale", "model": "fsrcnn-x2", "image": base64.b64encode(b"fixture").decode()}
                for _ in range(4):
                    self.tools.create(body)
                with self.assertRaises(Problem) as rejected:
                    self.tools.create(body)
                self.assertEqual(rejected.exception.status, 429)
                self.assertEqual(len(list(self.tools.temporary.iterdir())), 4)
                gate.set()
                self.tools.pool.shutdown(wait=True)
        finally:
            gate.set()


if __name__ == "__main__":
    unittest.main()
