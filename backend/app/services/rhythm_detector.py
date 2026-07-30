"""Basic rhythm estimation for the constrained MVP."""

import numpy as np


class RhythmDetector:
    """Estimate basic note values from horizontal event spacing."""

    def assign_durations(
        self, event_xs: list[int], left: int, right: int, divisions: int, beats: int
    ) -> list[int]:
        """Quantize event gaps to sixteenth, eighth, or quarter durations."""

        if not event_xs:
            return []
        measure_duration = divisions * beats
        unit_width = max(1.0, (right - left) / measure_duration)
        durations: list[int] = []
        for index, x in enumerate(event_xs):
            next_x = event_xs[index + 1] if index + 1 < len(event_xs) else right
            raw = max(1.0, (next_x - x) / unit_width)
            choices = np.array([max(1, divisions // 4), max(1, divisions // 2), divisions])
            durations.append(int(choices[np.argmin(abs(choices - raw))]))
        return durations

