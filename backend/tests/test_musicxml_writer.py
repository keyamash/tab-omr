"""MusicXML notes, chords, rests, tuning, and syntax tests."""

from xml.etree import ElementTree as ET

from app.models.score import GuitarNote, Measure, NoteEvent, Score, STANDARD_TUNING_MIDI
from app.services.musicxml_writer import MusicXMLWriter


def make_score(events: list[NoteEvent]) -> Score:
    return Score("Test", 120, 4, 4, 4, list(STANDARD_TUNING_MIDI), [Measure(1, events)])


def test_single_note_musicxml_is_well_formed() -> None:
    content = MusicXMLWriter().write(
        make_score([NoteEvent(0, 4, 1, [GuitarNote(1, 3)])])
    )
    root = ET.fromstring(content)
    assert root.tag == "score-partwise"
    assert root.findtext(".//technical/string") == "1"
    assert root.findtext(".//technical/fret") == "3"


def test_chord_marks_second_note() -> None:
    root = ET.fromstring(
        MusicXMLWriter().write(
            make_score([NoteEvent(0, 4, 1, [GuitarNote(1, 0), GuitarNote(2, 1)])])
        )
    )
    notes = root.findall(".//measure/note")
    assert notes[0].find("chord") is None
    assert notes[1].find("chord") is not None


def test_rest_and_standard_tuning() -> None:
    root = ET.fromstring(
        MusicXMLWriter().write(make_score([NoteEvent(0, 4, 1, is_rest=True)]))
    )
    assert root.find(".//note/rest") is not None
    tunings = root.findall(".//staff-tuning")
    assert [node.findtext("tuning-step") for node in tunings] == ["E", "A", "D", "G", "B", "E"]
    assert [node.findtext("tuning-octave") for node in tunings] == ["2", "2", "3", "3", "3", "4"]

