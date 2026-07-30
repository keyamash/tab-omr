"""Synthetic clear-score recognition smoke test."""

from app.services.image_preprocessor import ImagePreprocessor
from app.services.measure_detector import MeasureDetector
from app.services.omr_pipeline import OMRPipeline
from app.services.staff_detector import StaffDetector


def test_detects_staff_tab_barlines_and_frets(score_image: bytes) -> None:
    processed = ImagePreprocessor(40_000_000).process(score_image)
    groups = StaffDetector().detect(processed.binary)
    assert any(len(group.lines) == 5 for group in groups)
    tab = next(group for group in groups if len(group.lines) == 6)
    boundaries = MeasureDetector().detect(processed.binary, tab.top, tab.bottom)
    assert len(boundaries) >= 4

    result = OMRPipeline(40_000_000).process([score_image])
    frets = [
        note.fret
        for measure in result.measures
        for event in measure.events
        for note in event.notes
    ]
    assert 3 in frets
    assert 0 in frets

