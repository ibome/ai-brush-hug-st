"""Small, shareable environment check; does not load inference libraries or secrets."""
import argparse
from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path
import platform
import shutil
import socket
import sys
import tempfile

DEPENDENCIES = ("numpy", "Pillow", "onnxruntime", "opencv-contrib-python-headless")


def environment_report(data, port=None):
    directory = Path(data)
    while not directory.exists() and directory != directory.parent:
        directory = directory.parent
    dependencies = []
    for name in DEPENDENCIES:
        try:
            version = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            version = ""
        dependencies.append({"name": name, "installed": bool(version), "version": version})
    try:
        with tempfile.TemporaryFile(dir=directory):
            pass
        writable = True
    except OSError:
        writable = False
    try:
        free_bytes = shutil.disk_usage(directory).free
    except OSError:
        free_bytes = None
    checks = [
        {"id": "python", "ok": (3, 10) <= sys.version_info[:2] <= (3, 12)},
        {"id": "dependencies", "ok": all(row["installed"] for row in dependencies)},
        {"id": "data-writable", "ok": writable},
        {"id": "disk-space", "ok": free_bytes is not None and free_bytes >= 1024 * 1024 * 1024},
    ]
    if port is not None:
        free = False
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
                free = True
        except OSError:
            pass
        checks.append({"id": "port", "ok": free})
    return {"type": "linghuashi-local-tools-environment", "formatVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "python": platform.python_version(), "system": platform.system(),
            "architecture": platform.machine(), "virtualenv": sys.prefix != sys.base_prefix,
            "dependencies": dependencies, "freeBytes": free_bytes, "port": port,
            "checks": checks,
            "limits": "No paths, tokens, origins, images, prompts or environment variables are included."}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path(__file__).resolve().parent / "data")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Port must be within 1-65535")
    result = json.dumps(environment_report(args.data, args.port), ensure_ascii=True, indent=2)
    if args.output:
        args.output.write_text(result + "\n", encoding="utf-8")
    print(result)


if __name__ == "__main__":
    main()
