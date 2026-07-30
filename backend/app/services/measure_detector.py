"""Measure barline detection and slicing."""

import cv2
import numpy as np


class MeasureDetector:
    """Find vertical barlines within a detected TAB group."""

    def detect(self, binary: np.ndarray, top: int, bottom: int) -> list[int]:
        """Return ordered x boundaries including the visible left and right edges."""

        region = binary[top:bottom]
        height, width = region.shape
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(12, int(height * 0.55))))
        vertical = cv2.morphologyEx(region, cv2.MORPH_OPEN, kernel)
        strength = np.count_nonzero(vertical, axis=0)
        candidates = np.flatnonzero(strength > height * 0.42)
        centers = self._collapse(candidates)
        margin = max(3, width // 200)
        centers = [x for x in centers if margin < x < width - margin]
        boundaries = [0, *centers, width - 1]
        filtered = [boundaries[0]]
        for x in boundaries[1:]:
            if x - filtered[-1] >= max(24, width // 30):
                filtered.append(x)
        if filtered[-1] != width - 1:
            filtered.append(width - 1)
        return filtered

    @staticmethod
    def _collapse(values: np.ndarray) -> list[int]:
        if not len(values):
            return []
        groups: list[list[int]] = [[int(values[0])]]
        for value in values[1:]:
            if int(value) <= groups[-1][-1] + 2:
                groups[-1].append(int(value))
            else:
                groups.append([int(value)])
        return [round(sum(group) / len(group)) for group in groups]

