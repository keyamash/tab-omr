"""Replaceable fret-number recognition."""

from typing import Protocol

import cv2
import numpy as np


class FretNumberRecognizer(Protocol):
    """Interface for future template, Tesseract, ONNX, or PyTorch recognizers."""

    def recognize(self, image: np.ndarray) -> tuple[int | None, float]:
        """Return a fret number and confidence."""


class OpenCVTemplateFretRecognizer:
    """Recognize fret numbers 0-24 using generated OpenCV glyph templates."""

    def __init__(self) -> None:
        self.templates = {value: self._render(value) for value in range(25)}

    def recognize(self, image: np.ndarray) -> tuple[int | None, float]:
        """Compare a normalized binary crop with every generated template."""

        if image.size == 0:
            return None, 0.0
        normalized = self._normalize(image)
        best_value: int | None = None
        best_score = -1.0
        for value, template in self.templates.items():
            score = float(cv2.matchTemplate(normalized, template, cv2.TM_CCOEFF_NORMED)[0, 0])
            if score > best_score:
                best_value, best_score = value, score
        if best_score < 0.18:
            return None, max(0.0, best_score)
        return best_value, min(1.0, best_score)

    @staticmethod
    def _render(value: int) -> np.ndarray:
        canvas = np.zeros((42, 56), dtype=np.uint8)
        text = str(value)
        scale = 1.0 if value < 10 else 0.78
        thickness = 2
        (width, height), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
        origin = ((56 - width) // 2, (42 + height) // 2)
        cv2.putText(
            canvas,
            text,
            origin,
            cv2.FONT_HERSHEY_SIMPLEX,
            scale,
            255,
            thickness,
            cv2.LINE_AA,
        )
        return OpenCVTemplateFretRecognizer._normalize(canvas)

    @staticmethod
    def _normalize(image: np.ndarray) -> np.ndarray:
        if image.ndim == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        _, image = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        points = cv2.findNonZero(image)
        if points is not None:
            x, y, width, height = cv2.boundingRect(points)
            image = image[y : y + height, x : x + width]
        target = np.zeros((42, 56), dtype=np.uint8)
        scale = min(48 / max(1, image.shape[1]), 34 / max(1, image.shape[0]))
        resized = cv2.resize(
            image,
            (
                max(1, int(image.shape[1] * scale)),
                max(1, int(image.shape[0] * scale)),
            ),
        )
        y_offset = (42 - resized.shape[0]) // 2
        x_offset = (56 - resized.shape[1]) // 2
        target[y_offset : y_offset + resized.shape[0], x_offset : x_offset + resized.shape[1]] = resized
        return target
