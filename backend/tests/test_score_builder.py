"""Score normalization tests."""

from app.models.score import GuitarNote, Measure, NoteEvent
from app.services.score_builder import ScoreBuilder


def test_builder_fills_underfull_measure_with_rest() -> None:
    score, warnings = ScoreBuilder().build(
        [Measure(1, [NoteEvent(0, 4, 1, [GuitarNote(1, 0)])], source_image_index=0)],
        tempo=120,
        beats=4,
        beat_type=4,
    )
    assert score.measures[0].events[-1].is_rest
    assert sum(event.duration for event in score.measures[0].events) == 16
    assert all(event.duration in {1, 2, 4} for event in score.measures[0].events)
    assert warnings
