"""Safe image loading and OpenCV preprocessing."""

from dataclasses import dataclass
from io import BytesIO

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError


class ImageProcessingError(ValueError):
    """Raised when an upload cannot be decoded safely."""


@dataclass(slots=True)
class ProcessedImage:
    """Normalized source image and derived representations."""

    color: np.ndarray
    gray: np.ndarray
    binary: np.ndarray
    angle: float


class ImagePreprocessor:
    """Decode, normalize, binarize, denoise, and deskew a score image."""

    def __init__(self, max_pixels: int) -> None:
        self.max_pixels = max_pixels

    def process(self, content: bytes) -> ProcessedImage:
        """Return safe OpenCV images, refusing decompression-bomb-sized input."""

        try:
            with Image.open(BytesIO(content)) as probe:
                width, height = probe.size
                probe.verify()
        except (UnidentifiedImageError, OSError) as exc:
            raise ImageProcessingError("画像を読み込めませんでした") from exc
        if width <= 0 or height <= 0 or width * height > self.max_pixels:
            raise ImageProcessingError("画像のピクセル数が上限を超えています")

        encoded = np.frombuffer(content, dtype=np.uint8)
        color = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if color is None:
            raise ImageProcessingError("画像データをデコードできませんでした")
        gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
        angle = self._estimate_angle(gray)
        if abs(angle) > 0.08:
            color = self._rotate(color, angle)
            gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
        binary = cv2.adaptiveThreshold(
            gray,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY_INV,
            31,
            12,
        )
        binary = cv2.morphologyEx(
            binary, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        )
        return ProcessedImage(color=color, gray=gray, binary=binary, angle=angle)

    @staticmethod
    def _estimate_angle(gray: np.ndarray) -> float:
        edges = cv2.Canny(gray, 50, 150)
        lines = cv2.HoughLinesP(
            edges,
            1,
            np.pi / 1800,
            threshold=max(60, gray.shape[1] // 5),
            minLineLength=gray.shape[1] // 3,
            maxLineGap=20,
        )
        if lines is None:
            return 0.0
        angles = []
        for x1, y1, x2, y2 in lines[:, 0]:
            angle = np.degrees(np.arctan2(y2 - y1, x2 - x1))
            if abs(angle) < 7:
                angles.append(angle)
        return float(np.median(angles)) if angles else 0.0

    @staticmethod
    def _rotate(image: np.ndarray, angle: float) -> np.ndarray:
        height, width = image.shape[:2]
        matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
        return cv2.warpAffine(
            image,
            matrix,
            (width, height),
            flags=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REPLICATE,
        )

