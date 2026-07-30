"""TAB digit candidate extraction and string assignment."""

from dataclasses import dataclass

import cv2
import numpy as np

from .fret_recognizer import FretNumberRecognizer
from .staff_detector import LineGroup


@dataclass(frozen=True, slots=True)
class FretCandidate:
    """A recognized fret at an image coordinate."""

    x: int
    string: int
    fret: int
    confidence: float


class TabDetector:
    """Remove TAB lines, locate glyphs, and recognize fret numbers."""

    def __init__(self, recognizer: FretNumberRecognizer) -> None:
        self.recognizer = recognizer
        self.last_unrecognized_count = 0

    def detect(
        self, binary: np.ndarray, group: LineGroup, left: int, right: int
    ) -> list[FretCandidate]:
        """Return recognized fret candidates inside one measure."""

        self.last_unrecognized_count = 0
        padding = max(2, round(group.spacing * 0.55))
        top = max(0, group.lines[0] - padding)
        bottom = min(binary.shape[0], group.lines[-1] + padding + 1)
        region = binary[top:bottom, left:right].copy()
        for line in group.lines:
            local_y = line - top
            cv2.line(region, (0, local_y), (region.shape[1] - 1, local_y), 0, 2)
        edge_width = max(2, round(group.spacing * 0.22))
        region[:, :edge_width] = 0
        region[:, -edge_width:] = 0
        region = cv2.morphologyEx(
            region,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(
                cv2.MORPH_RECT, (2, max(3, round(group.spacing * 0.25)))
            ),
        )
        count, _, stats, centroids = cv2.connectedComponentsWithStats(region, 8)
        boxes: list[tuple[int, int, int, int, int, int]] = []
        min_height = max(4, int(group.spacing * 0.35))
        max_height = max(12, int(group.spacing * 1.8))
        for label in range(1, count):
            x, y, width, height, area = (int(v) for v in stats[label])
            center_x, center_y = centroids[label]
            if (
                min_height <= height <= max_height
                and 1 <= width <= group.spacing * 2.2
                and area >= 3
            ):
                boxes.append((x, y, width, height, round(center_x), round(center_y)))
        boxes.sort(key=lambda box: box[0])
        boxes = self._join_adjacent_digits(boxes, group.spacing)

        candidates: list[FretCandidate] = []
        for x, y, width, height, center_x, center_y in boxes:
            crop = region[max(0, y - 2) : y + height + 2, max(0, x - 2) : x + width + 2]
            fret, confidence = self.recognizer.recognize(crop)
            if fret is None:
                self.last_unrecognized_count += 1
                continue
            absolute_y = top + center_y
            nearest_line = min(range(6), key=lambda index: abs(group.lines[index] - absolute_y))
            if abs(group.lines[nearest_line] - absolute_y) > group.spacing * 0.75:
                continue
            # Top line is string 1 in ordinary TAB notation.
            candidates.append(FretCandidate(left + center_x, nearest_line + 1, fret, confidence))
        return candidates

    @staticmethod
    def _join_adjacent_digits(
        boxes: list[tuple[int, int, int, int, int, int]], spacing: float
    ) -> list[tuple[int, int, int, int, int, int]]:
        joined: list[tuple[int, int, int, int, int, int]] = []
        index = 0
        while index < len(boxes):
            current = boxes[index]
            if index + 1 < len(boxes):
                following = boxes[index + 1]
                same_line = abs(current[5] - following[5]) < spacing * 0.4
                close = 0 <= following[0] - (current[0] + current[2]) < spacing * 0.45
                if same_line and close:
                    x1 = current[0]
                    y1 = min(current[1], following[1])
                    x2 = following[0] + following[2]
                    y2 = max(current[1] + current[3], following[1] + following[3])
                    joined.append((x1, y1, x2 - x1, y2 - y1, (x1 + x2) // 2, (y1 + y2) // 2))
                    index += 2
                    continue
            joined.append(current)
            index += 1
        return joined
