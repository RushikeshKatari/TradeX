"""Number extraction from an image or selected screen area (ROI).

Supports:
1. pytesseract (standard cross-platform OCR) with image preprocessing.
2. Native macOS Vision OCR fallback (zero external binary dependencies on macOS).
"""

import os
import re
import sys
import json
import subprocess
from pathlib import Path
from typing import Optional, Union


def preprocess_image_for_digits(image_path: str, output_path: Optional[str] = None) -> str:
    """Preprocess image using Pillow and OpenCV if available, or native sips/swift.
    Converts to grayscale and enhances contrast for crisp numbers.
    """
    try:
        from PIL import Image, ImageEnhance, ImageFilter
        img = Image.open(image_path)
        img = img.convert("L")  # Grayscale
        # Increase contrast
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(2.0)
        # Resize if image is small to help OCR recognize tiny digits
        if img.width < 300 or img.height < 100:
            img = img.resize((img.width * 2, img.height * 2), Image.Resampling.LANCZOS)
        out = output_path or str(Path(image_path).with_suffix(".preprocessed.png"))
        img.save(out)
        return out
    except ImportError:
        # If Pillow is not installed, return original path
        return image_path


def extract_roi(image_path: str, x: int, y: int, width: int, height: int, output_crop_path: Optional[str] = None) -> str:
    """Crop a bounding box (x, y, width, height) from the input image."""
    try:
        from PIL import Image
        img = Image.open(image_path)
        crop_box = (x, y, x + width, y + height)
        cropped = img.crop(crop_box)
        out = output_crop_path or str(Path(image_path).with_suffix(".roi.png"))
        cropped.save(out)
        return out
    except ImportError:
        # Fallback to macOS native sips tool if Pillow isn't installed yet
        out = output_crop_path or str(Path(image_path).with_suffix(".roi.png"))
        # sips --cropToHeightWidth [height] [width] --cropOffset [y] [x]
        # sips expects offset from top-left
        cmd = ["sips", "-c", str(height), str(width), image_path, "--out", out]
        subprocess.run(cmd, capture_output=True)
        return out if os.path.exists(out) else image_path


def extract_numbers_pytesseract(image_path: str) -> list[float]:
    """Extract numbers using pytesseract with digit whitelisting."""
    import pytesseract
    from PIL import Image

    img = Image.open(image_path)
    # Tesseract config: psm 6 (assume uniform block of text) or 11 (sparse text)
    # Whitelist only digits, decimal point, colon, comma, minus
    custom_config = r'--oem 3 --psm 6 -c tessedit_char_whitelist=0123456789.:,-'
    raw_text = pytesseract.image_to_string(img, config=custom_config)

    # Extract all floating point / integer numbers using regex
    found = re.findall(r"[-+]?(?:\d*\.\d+|\d+)", raw_text)
    return [float(n) for n in found]


def extract_numbers_macos_vision(image_path: str) -> list[float]:
    """Native macOS Vision framework OCR using swift (built into macOS, no pip needed)."""
    swift_script = f'''
import Cocoa
import Vision

let imageURL = URL(fileURLWithPath: "{os.path.abspath(image_path)}")
guard let image = NSImage(contentsOf: imageURL),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {{
    exit(1)
}}

let request = VNRecognizeTextRequest {{ (request, error) in
    guard let observations = request.results as? [VNRecognizedTextObservation] else {{ return }}
    for observation in observations {{
        if let topCandidate = observation.topCandidates(1).first {{
            print(topCandidate.string)
        }}
    }}
}}

request.recognitionLevel = .accurate
request.usesLanguageCorrection = false

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])
'''
    res = subprocess.run(["swift", "-"], input=swift_script, text=True, capture_output=True)
    if res.returncode != 0:
        return []

    raw_text = res.stdout
    found = re.findall(r"[-+]?(?:\d*\.\d+|\d+)", raw_text)
    return [float(n) for n in found]


def extract_numbers(image_path: str, roi: Optional[tuple[int, int, int, int]] = None) -> dict:
    """Extract numbers from an image or a specific ROI (x, y, width, height).

    Returns:
        dict with raw_text, numbers (list of floats), and engine used.
    """
    target_img = image_path
    if roi:
        x, y, w, h = roi
        target_img = extract_roi(image_path, x, y, w, h)

    # Preprocess
    preprocessed_img = preprocess_image_for_digits(target_img)

    numbers = []
    engine = None

    # Try pytesseract first
    try:
        import pytesseract
        numbers = extract_numbers_pytesseract(preprocessed_img)
        engine = "pytesseract"
    except (ImportError, Exception):
        pass

    # Fallback to macOS Vision OCR if on macOS
    if not numbers and sys.platform == "darwin":
        numbers = extract_numbers_macos_vision(preprocessed_img)
        engine = "macos_vision"

    return {
        "engine": engine,
        "image": image_path,
        "roi": roi,
        "numbers": numbers
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python ocr_number_extractor.py <image_path> [x y width height]")
        sys.exit(1)

    img_file = sys.argv[1]
    roi_box = None
    if len(sys.argv) == 6:
        roi_box = (int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]))

    result = extract_numbers(img_file, roi_box)
    print(json.dumps(result, indent=2))
