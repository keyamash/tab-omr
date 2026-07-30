"""Intermediate score model shared by recognition and MusicXML output."""

from dataclasses import dataclass, field
from typing import Any


STANDARD_TUNING_MIDI = [64, 59, 55, 50, 45, 40]  # Strings 1 through 6.


@dataclass(frozen=True, slots=True)
class GuitarNote:
    """A fretted guitar note."""

    string: int
    fret: int

    def __post_init__(self) -> None:
        if not 1 <= self.string <= 6:
            raise ValueError("string must be between 1 and 6")
        if not 0 <= self.fret <= 24:
            raise ValueError("fret must be between 0 and 24")


@dataclass(slots=True)
class NoteEvent:
    """A note, chord, or rest at a position within a measure."""

    position: int
    duration: int
    voice: int
    notes: list[GuitarNote] = field(default_factory=list)
    is_rest: bool = False
    confidence: float = 1.0
    source_image_index: int | None = None

    def __post_init__(self) -> None:
        if self.position < 0 or self.duration <= 0:
            raise ValueError("position must be non-negative and duration positive")
        if self.is_rest and self.notes:
            raise ValueError("a rest cannot contain guitar notes")
        if not self.is_rest and not self.notes:
            raise ValueError("a note event must contain at least one note")


@dataclass(slots=True)
class Measure:
    """A numbered measure and its ordered events."""

    number: int
    events: list[NoteEvent]
    source_image_index: int | None = None
    features: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Score:
    """A single-part guitar score."""

    title: str
    tempo: int
    beats: int
    beat_type: int
    divisions: int
    tuning: list[int]
    measures: list[Measure]

    @property
    def measure_duration(self) -> int:
        """Return the expected measure duration in divisions."""

        return self.beats * self.divisions * 4 // self.beat_type

