"""Build resilient intermediate score data from recognized events."""

from collections.abc import Iterable

from app.models.score import GuitarNote, Measure, NoteEvent, Score, STANDARD_TUNING_MIDI
from app.schemas.responses import ConversionWarning


class ScoreBuilder:
    """Normalize recognized measures and fill underfull bars with rests."""

    def build(
        self,
        measures: Iterable[Measure],
        *,
        tempo: int,
        beats: int,
        beat_type: int,
        tuning: list[int] | None = None,
    ) -> tuple[Score, list[ConversionWarning]]:
        """Create a valid score and return recoverable timing warnings."""

        divisions = 4
        normalized: list[Measure] = []
        warnings: list[ConversionWarning] = []
        expected = beats * divisions * 4 // beat_type
        for number, source in enumerate(measures, start=1):
            events = sorted(source.events, key=lambda event: event.position)
            cursor = 0
            final_events: list[NoteEvent] = []
            for event in events:
                if event.position > cursor:
                    final_events.extend(
                        self._rests(
                            cursor,
                            event.position - cursor,
                            divisions,
                            source.source_image_index,
                        )
                    )
                if cursor + event.duration > expected:
                    event.duration = max(1, expected - cursor)
                    warnings.append(
                        ConversionWarning(
                            image_index=source.source_image_index or 0,
                            measure_index=number,
                            message="小節末を超える音価を短く補正しました",
                        )
                    )
                final_events.append(event)
                cursor = max(cursor, event.position) + event.duration
                if cursor >= expected:
                    break
            if cursor < expected:
                final_events.extend(
                    self._rests(
                        cursor,
                        expected - cursor,
                        divisions,
                        source.source_image_index,
                    )
                )
                if events:
                    warnings.append(
                        ConversionWarning(
                            image_index=source.source_image_index or 0,
                            measure_index=number,
                            message="不足している拍を休符で補いました",
                        )
                    )
            normalized.append(
                Measure(
                    number=number,
                    events=final_events,
                    source_image_index=source.source_image_index,
                    features=source.features,
                )
            )
        if not normalized:
            normalized.append(
                Measure(
                    1,
                    self._rests(0, expected, divisions, None),
                )
            )
        return (
            Score(
                title="TAB OMR Conversion",
                tempo=tempo,
                beats=beats,
                beat_type=beat_type,
                divisions=divisions,
                tuning=tuning or list(STANDARD_TUNING_MIDI),
                measures=normalized,
            ),
            warnings,
        )

    @staticmethod
    def _rests(
        position: int,
        duration: int,
        divisions: int,
        source_image_index: int | None,
    ) -> list[NoteEvent]:
        """Split a gap into supported quarter, eighth, and sixteenth rests."""

        values = (divisions, max(1, divisions // 2), max(1, divisions // 4))
        rests: list[NoteEvent] = []
        cursor = position
        remaining = duration
        for value in values:
            while remaining >= value:
                rests.append(
                    NoteEvent(
                        position=cursor,
                        duration=value,
                        voice=1,
                        is_rest=True,
                        source_image_index=source_image_index,
                    )
                )
                cursor += value
                remaining -= value
        return rests
