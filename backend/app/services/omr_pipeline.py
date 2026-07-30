"""End-to-end but modular score-image recognition pipeline."""

from dataclasses import dataclass

import numpy as np

from app.models.score import GuitarNote, Measure, NoteEvent
from app.schemas.responses import ConversionWarning

from .duplicate_detector import DuplicateDetector
from .fret_recognizer import OpenCVTemplateFretRecognizer
from .image_preprocessor import ImagePreprocessor
from .measure_detector import MeasureDetector
from .rhythm_detector import RhythmDetector
from .staff_detector import LineGroup, StaffDetector
from .tab_detector import FretCandidate, TabDetector


@dataclass(slots=True)
class PipelineResult:
    """Measures and warnings recovered from one or more images."""

    measures: list[Measure]
    warnings: list[ConversionWarning]


class OMRPipeline:
    """Recognize clear printed standard-notation-plus-TAB screenshots."""

    def __init__(self, max_pixels: int) -> None:
        self.preprocessor = ImagePreprocessor(max_pixels)
        self.staff_detector = StaffDetector()
        self.measure_detector = MeasureDetector()
        self.tab_detector = TabDetector(OpenCVTemplateFretRecognizer())
        self.rhythm_detector = RhythmDetector()
        self.duplicate_detector = DuplicateDetector()

    def process(self, images: list[bytes]) -> PipelineResult:
        """Process images in upload order and return all recoverable measures."""

        measures: list[Measure] = []
        warnings: list[ConversionWarning] = []
        prior_hashes: list[np.ndarray] = []
        for image_index, content in enumerate(images):
            processed = self.preprocessor.process(content)
            image_hash = self.duplicate_detector.hash(processed.gray)
            if any(
                self.duplicate_detector.similarity(image_hash, prior) >= 0.94
                for prior in prior_hashes
            ):
                warnings.append(
                    ConversionWarning(
                        image_index=image_index,
                        message="前の画像と重複している可能性があります",
                    )
                )
            prior_hashes.append(image_hash)
            groups = self.staff_detector.detect(processed.binary)
            tab_groups = [group for group in groups if len(group.lines) == 6]
            if not tab_groups:
                warnings.append(
                    ConversionWarning(
                        image_index=image_index,
                        message="TABの6本線を検出できなかったため、この画像をスキップしました",
                    )
                )
                continue
            if not any(len(group.lines) == 5 for group in groups):
                warnings.append(
                    ConversionWarning(
                        image_index=image_index,
                        message="五線譜を検出できず、TABの間隔から音価を推定しました",
                    )
                )
            for tab_group in tab_groups:
                boundaries = self.measure_detector.detect(
                    processed.binary, tab_group.top, tab_group.bottom
                )
                for left, right in zip(boundaries, boundaries[1:], strict=False):
                    if right - left < 24:
                        continue
                    candidates = self.tab_detector.detect(
                        processed.binary, tab_group, left, right
                    )
                    if self.tab_detector.last_unrecognized_count:
                        warnings.append(
                            ConversionWarning(
                                image_index=image_index,
                                measure_index=len(measures) + 1,
                                message=(
                                    f"{self.tab_detector.last_unrecognized_count}個の"
                                    "フレット番号を確定できなかったため省略しました"
                                ),
                            )
                        )
                    events = self._events_from_candidates(
                        candidates,
                        left,
                        right,
                        image_index,
                    )
                    if not events:
                        continue
                    measure_number = len(measures) + 1
                    low_confidence = sum(
                        1 for event in events if event.confidence < 0.32
                    )
                    if low_confidence:
                        warnings.append(
                            ConversionWarning(
                                image_index=image_index,
                                measure_index=measure_number,
                                message=f"{low_confidence}個のフレット番号の確度が低いため確認してください",
                            )
                        )
                    feature = [note.fret for event in events for note in event.notes]
                    measures.append(
                        Measure(
                            number=measure_number,
                            events=events,
                            source_image_index=image_index,
                            features={"fret_sequence": feature},
                        )
                    )
        if not measures:
            warnings.append(
                ConversionWarning(
                    image_index=0,
                    message="音符を確定できなかったため、空の小節を生成しました",
                )
            )
        return PipelineResult(measures, warnings)

    def _events_from_candidates(
        self,
        candidates: list[FretCandidate],
        left: int,
        right: int,
        image_index: int,
    ) -> list[NoteEvent]:
        if not candidates:
            return []
        clusters: list[list[FretCandidate]] = []
        chord_tolerance = max(4, (right - left) // 120)
        for candidate in sorted(candidates, key=lambda item: item.x):
            if clusters and abs(candidate.x - np.mean([item.x for item in clusters[-1]])) <= chord_tolerance:
                clusters[-1].append(candidate)
            else:
                clusters.append([candidate])
        event_xs = [round(np.mean([candidate.x for candidate in cluster])) for cluster in clusters]
        durations = self.rhythm_detector.assign_durations(event_xs, left, right, 4, 4)
        events: list[NoteEvent] = []
        cursor = 0
        for cluster, duration in zip(clusters, durations, strict=True):
            unique: dict[int, FretCandidate] = {}
            for candidate in cluster:
                if candidate.string not in unique or candidate.confidence > unique[candidate.string].confidence:
                    unique[candidate.string] = candidate
            notes = [
                GuitarNote(candidate.string, candidate.fret)
                for candidate in sorted(unique.values(), key=lambda item: item.string)
            ]
            duration = max(1, min(duration, 16 - cursor))
            events.append(
                NoteEvent(
                    position=cursor,
                    duration=duration,
                    voice=1,
                    notes=notes,
                    confidence=min(candidate.confidence for candidate in unique.values()),
                    source_image_index=image_index,
                )
            )
            cursor += duration
            if cursor >= 16:
                break
        return events
