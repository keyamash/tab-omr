"""Horizontal staff-line detection."""

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True, slots=True)
class LineGroup:
    """A probable five-line staff or six-line TAB group."""

    lines: tuple[int, ...]
    top: int
    bottom: int
    spacing: float


class StaffDetector:
    """Detect long horizontal lines and group them by regular spacing."""

    def detect(self, binary: np.ndarray) -> list[LineGroup]:
        """Return probable 5- and 6-line groups from top to bottom."""

        width = binary.shape[1]
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(20, width // 8), 1))
        horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
        strength = np.count_nonzero(horizontal, axis=1)
        candidates = np.flatnonzero(strength > width * 0.18)
        centers = self._collapse(candidates)
        groups: list[LineGroup] = []
        for count in (6, 5):
            for start in range(0, len(centers) - count + 1):
                selection = centers[start : start + count]
                gaps = np.diff(selection)
                if len(gaps) and np.median(gaps) >= 3 and np.max(gaps) <= np.median(gaps) * 1.45:
                    spacing = float(np.median(gaps))
                    groups.append(
                        LineGroup(
                            tuple(int(v) for v in selection),
                            max(0, int(selection[0] - spacing * 2)),
                            min(binary.shape[0], int(selection[-1] + spacing * 2)),
                            spacing,
                        )
                    )
        # Prefer longer TAB candidates and remove overlapping alternatives.
        groups.sort(key=lambda group: (-len(group.lines), group.top))
        selected: list[LineGroup] = []
        for group in groups:
            if not any(
                min(group.bottom, other.bottom) - max(group.top, other.top)
                > min(group.bottom - group.top, other.bottom - other.top) * 0.55
                for other in selected
            ):
                selected.append(group)
        return sorted(selected, key=lambda group: group.top)

    @staticmethod
    def _collapse(values: np.ndarray) -> list[int]:
        if not len(values):
            return []
        runs: list[list[int]] = [[int(values[0])]]
        for value in values[1:]:
            if int(value) <= runs[-1][-1] + 1:
                runs[-1].append(int(value))
            else:
                runs.append([int(value)])
        return [round(sum(run) / len(run)) for run in runs]

