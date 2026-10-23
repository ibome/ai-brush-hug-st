"""Opt-in real model integration check. Downloads weights to the supplied test directory."""
import argparse
import base64
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
import threading
import time
import urllib.request

import numpy as np
from PIL import Image
from service import Tools, make_handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    tools = Tools(args.data)
    config = {"token": "local-integration-fixture-only-token", "origins": ["https://fixture.test"]}
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(tools, config))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    report = []
    def call(path, body=None, method=None, binary=False):
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/v1/{path}",
            method=method or ("POST" if body else "GET"),
            data=json.dumps(body).encode() if body else None,
            headers={"Origin": "https://fixture.test", "Authorization": "Bearer " + config["token"],
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as response:
            raw = response.read()
            return raw if binary else json.loads(raw)
    def job(body):
        task = call("jobs", body)
        started = time.monotonic()
        last_progress = -1
        while task["status"] not in ("completed", "failed", "cancelled"):
            if task["kind"] == "download" and task["progress"] // 25 != last_progress:
                last_progress = task["progress"] // 25
                print(json.dumps({"model": task["model"], "progress": task["progress"]}), flush=True)
            if time.monotonic() - started > 600:
                raise RuntimeError("Integration test timed out")
            time.sleep(0.3)
            task = call("jobs/" + task["id"])
        assert task["status"] == "completed", task
        return task
    try:
        for model in ("fsrcnn-x2", "fsrcnn-x4", "wd-vit-v3"):
            task = job({"kind": "download", "model": model})
            call("jobs/" + task["id"], method="DELETE")
            report.append({"model": model, "downloadVerified": True})
        with Image.open(args.image) as source:
            image = source.convert("RGBA")
            image.thumbnail((256, 256))
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
        encoded = base64.b64encode(buffer.getvalue()).decode()
        for model, scale in (("fsrcnn-x2", 2), ("fsrcnn-x4", 4)):
            task = job({"kind": "upscale", "model": model, "image": encoded})
            data = call(f"jobs/{task['id']}/result", binary=True)
            result = Image.open(io.BytesIO(data)).convert("RGBA")
            assert result.size == (image.width * scale, image.height * scale)
            alpha = image.getchannel("A").resize(result.size, Image.Resampling.LANCZOS)
            assert np.array_equal(np.asarray(alpha), np.asarray(result.getchannel("A")))
            assert np.std(np.asarray(result)[:, :, :3]) > 5
            white = Image.new("RGBA", image.size, "white")
            white.alpha_composite(image)
            baseline = white.convert("RGB").resize(result.size, Image.Resampling.LANCZOS)
            difference = np.abs(np.asarray(result.convert("RGB"), dtype=float) - np.asarray(baseline, dtype=float)).mean()
            assert difference > 0.1, "Super-resolution must run the model, not only resize"
            (args.data / f"real-{model}.png").write_bytes(data)
            call("jobs/" + task["id"], method="DELETE")
            report.append({"model": model, "inferenceVerified": True, "size": result.size,
                           "differenceFromResize": round(float(difference), 3)})
        task = job({"kind": "tags", "model": "wd-vit-v3", "image": encoded,
                    "threshold": 0.35, "characterThreshold": 0.85})
        tags = call(f"jobs/{task['id']}/result")
        assert isinstance(tags["tags"], list) and len(tags["tags"]) > 0, tags
        assert all(0 <= row["score"] <= 1 for row in tags["tags"])
        call("jobs/" + task["id"], method="DELETE")
        report.append({"model": "wd-vit-v3", "inferenceVerified": True,
                       "tagCount": len(tags["tags"]), "topTags": tags["tags"][:8]})
        task = call("jobs", {"kind": "tags", "model": "wd-vit-v3", "image": encoded})
        call("jobs/" + task["id"], method="DELETE")
        for _ in range(100):
            current = call("jobs/" + task["id"])
            if current["status"] == "cancelled":
                break
            time.sleep(0.05)
        assert current["status"] == "cancelled", current
        report.append({"cancelledInference": True, "resultDiscarded": True})
        (args.data / "smoke-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
        tools.close()


if __name__ == "__main__":
    main()
