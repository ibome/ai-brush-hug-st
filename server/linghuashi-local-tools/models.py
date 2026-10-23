"""Pinned upstream model files; weights are downloaded only on request."""
import hashlib
from pathlib import Path
import urllib.request

WD_REV = "790b0e92cefd2a0221451604e7831fe643ab7c4f"
FS_REV = "6a4812c4ef1c4f5947d79beafa32a05a6eb4a94d"
MODELS = {
    "wd-vit-v3": {
        "title": "WD ViT Tagger v3", "kind": "tags", "license": "Apache-2.0",
        "files": [
            ("model.onnx", f"https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/{WD_REV}/model.onnx",
             378536310, "35f23693620b668f4d53fd3c62bf65e40af739bc52c7eb0fbc49258b58d065b6"),
            ("selected_tags.csv", f"https://huggingface.co/SmilingWolf/wd-vit-tagger-v3/resolve/{WD_REV}/selected_tags.csv",
             308468, "298633d94d0031d2081c0893f29c82eab7f0df00b08483ba8f29d1e979441217"),
        ],
    },
    "fsrcnn-x2": {
        "title": "FSRCNN 2x", "kind": "upscale", "scale": 2, "license": "Apache-2.0",
        "files": [("model.pb", f"https://raw.githubusercontent.com/Saafke/FSRCNN_Tensorflow/{FS_REV}/models/FSRCNN_x2.pb",
                   38973, "366b33f0084c7b3f2bf6724f0a2c77bca94fcec9d7b6d72389d330073b380d5c")],
    },
    "fsrcnn-x4": {
        "title": "FSRCNN 4x", "kind": "upscale", "scale": 4, "license": "Apache-2.0",
        "files": [("model.pb", f"https://raw.githubusercontent.com/Saafke/FSRCNN_Tensorflow/{FS_REV}/models/FSRCNN_x4.pb",
                   41661, "5c68d18db561aed8ead4ffedf1b897ea615baaf60ebf6c35f8e641f8fa4a21bf")],
    },
}
_verified = {}


def valid_file(path, size, digest):
    try:
        stat = path.stat()
        signature = (str(path.resolve()), stat.st_size, stat.st_mtime_ns)
        if stat.st_size != size:
            return False
        if signature not in _verified:
            with path.open("rb") as stream:
                _verified[signature] = hashlib.file_digest(stream, "sha256").hexdigest() == digest
        return _verified[signature]
    except OSError:
        return False


def ready(root, model_id):
    return all(valid_file(Path(root) / model_id / name, size, digest)
               for name, _, size, digest in MODELS[model_id]["files"])


def download(root, model_id, progress, cancelled):
    files = MODELS[model_id]["files"]
    total = sum(row[2] for row in files)
    done = 0
    directory = Path(root) / model_id
    directory.mkdir(parents=True, exist_ok=True)
    for name, url, size, digest in files:
        target = directory / name
        if valid_file(target, size, digest):
            done += size
            continue
        partial = target.with_suffix(target.suffix + ".part")
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Linghuashi-Local-Tools/1"})
            with urllib.request.urlopen(request, timeout=30) as response, partial.open("wb") as output:
                received = 0
                while block := response.read(256 * 1024):
                    if cancelled():
                        raise InterruptedError()
                    received += len(block)
                    if received > size:
                        raise ValueError("Model download exceeded expected size")
                    output.write(block)
                    progress(round((done + received) / total * 100))
            if cancelled():
                raise InterruptedError()
            if not valid_file(partial, size, digest):
                raise ValueError("Model checksum mismatch; retry the download")
            partial.replace(target)
            done += size
        finally:
            partial.unlink(missing_ok=True)
