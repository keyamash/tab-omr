"""Conservative duplicate-image detection."""

import cv2
import numpy as np


class DuplicateDetector:
    """Use a compact perceptual hash and warn without deleting content."""

    @staticmethod
    def hash(gray: np.ndarray) -> np.ndarray:
        resized = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
        return (resized[:, 1:] > resized[:, :-1]).flatten()

    @staticmethod
    def similarity(first: np.ndarray, second: np.ndarray) -> float:
        return float(np.mean(first == second))

