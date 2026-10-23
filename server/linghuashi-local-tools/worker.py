"""CPU inference worker. One subprocess per job permits immediate cancellation."""
import csv
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

os.environ.setdefault("OMP_NUM_THREADS", "2")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")

import numpy as np
from PIL import Image, ImageOps
from models import MODELS, ready

Image.MAX_IMAGE_PIXELS = 16000000
MAX_OUTPUT_PIXELS = 24000000


def open_image(path):
    with Image.open(path) as source:
        if source.format not in ("PNG", "JPEG", "WEBP") or source.width * source.height > 16000000:
            raise ValueError("Use PNG/JPG/WebP within 16 megapixels")
        if max(source.size) > 8192:
            raise ValueError("Input side exceeds 8192 pixels")
        source.load()
        return ImageOps.exif_transpose(source).convert("RGBA")


def opaque(image):
    background = Image.new("RGBA", image.size, "white")
    background.alpha_composite(image)
    return background.convert("RGB")


def tag_image(image, folder, options):
    import onnxruntime as ort
    settings = ort.SessionOptions()
    settings.intra_op_num_threads = 2
    settings.inter_op_num_threads = 1
    session = ort.InferenceSession(str(folder / "model.onnx"), sess_options=settings,
                                  providers=["CPUExecutionProvider"])
    size = session.get_inputs()[0].shape[1]
    rgb = opaque(image)
    edge = max(rgb.size)
    square = Image.new("RGB", (edge, edge), "white")
    square.paste(rgb, ((edge - rgb.width) // 2, (edge - rgb.height) // 2))
    pixels = np.asarray(square.resize((size, size), Image.Resampling.BICUBIC), dtype=np.float32)
    prediction = session.run(None, {session.get_inputs()[0].name: pixels[None, :, :, ::-1]})[0][0]
    with (folder / "selected_tags.csv").open(encoding="utf-8", newline="") as stream:
        labels = list(csv.DictReader(stream))
    if len(labels) != len(prediction):
        raise ValueError("Tag labels do not match model output")
    threshold = float(options.get("threshold", 0.35))
    character_threshold = float(options.get("characterThreshold", 0.85))
    if not 0.05 <= threshold <= 0.95 or not 0.05 <= character_threshold <= 0.99:
        raise ValueError("Invalid confidence threshold")
    tags, characters = [], []
    for label, score in zip(labels, prediction):
        category = int(label["category"])
        if category == 0 and float(score) >= threshold:
            tags.append({"tag": label["name"], "score": round(float(score), 4)})
        elif category == 4 and float(score) >= character_threshold:
            characters.append({"tag": label["name"], "score": round(float(score), 4)})
    tags.sort(key=lambda row: row["score"], reverse=True)
    characters.sort(key=lambda row: row["score"], reverse=True)
    return {"tags": tags[:200], "characters": characters[:40]}


def upscale(image, folder, scale):
    import cv2
    cv2.setNumThreads(2)
    width, height = image.size
    if width * height * scale * scale > MAX_OUTPUT_PIXELS or max(image.size) * scale > 8192:
        raise ValueError("Output exceeds 24 megapixels or 8192 pixels per side; use 2x or a smaller input")
    engine = cv2.dnn_superres.DnnSuperResImpl_create()
    # OpenCV's model file reader on Windows does not accept all Unicode paths.
    with tempfile.TemporaryDirectory(prefix="linghuashi-fsrcnn-") as temporary:
        model = Path(temporary) / "model.pb"
        shutil.copyfile(folder / "model.pb", model)
        model_path = str(model)
        if os.name == "nt" and not model_path.isascii():
            import ctypes
            buffer = ctypes.create_unicode_buffer(32768)
            if ctypes.windll.kernel32.GetShortPathNameW(model_path, buffer, len(buffer)):
                model_path = buffer.value
        engine.readModel(model_path)
    engine.setModel("fsrcnn", scale)
    rgb = np.asarray(opaque(image))[:, :, ::-1].copy()
    output = np.empty((height * scale, width * scale, 3), dtype=np.uint8)
    # Overlap provides the receptive field at tile boundaries without large feature tensors.
    tile, pad = 160, 16
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            left, top = max(0, x - pad), max(0, y - pad)
            right, bottom = min(width, x + tile + pad), min(height, y + tile + pad)
            enlarged = engine.upsample(rgb[top:bottom, left:right])
            w, h = min(tile, width - x), min(tile, height - y)
            output[y * scale:(y + h) * scale, x * scale:(x + w) * scale] = enlarged[
                (y - top) * scale:(y - top + h) * scale, (x - left) * scale:(x - left + w) * scale]
    result = Image.fromarray(output[:, :, ::-1])
    if image.getextrema()[3] != (255, 255):
        result.putalpha(image.getchannel("A").resize(result.size, Image.Resampling.LANCZOS))
    return result


def main():
    source, result, model_root = map(Path, sys.argv[1:4])
    request = json.loads((source.parent / "request.json").read_text(encoding="utf-8"))
    model_id = request["model"]
    if not ready(model_root, model_id):
        raise ValueError("Model is missing or damaged; download it in Components")
    image = open_image(source)
    folder = model_root / model_id
    if MODELS[model_id]["kind"] == "tags":
        result.write_text(json.dumps(tag_image(image, folder, request)), encoding="utf-8")
    else:
        output = upscale(image, folder, MODELS[model_id]["scale"])
        output.save(result, format="PNG")
        if result.stat().st_size > 20 * 1024 * 1024:
            result.unlink()
            raise ValueError("Result exceeds the plugin's 20 MB image limit")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # No paths, images, credentials, or user prompt content in worker errors.
        safe = str(error) if isinstance(error, ValueError) else f"Inference failed ({type(error).__name__})"
        print(safe[:300], file=sys.stderr)
        sys.exit(1)
