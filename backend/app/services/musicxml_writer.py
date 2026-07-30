"""High-quality MusicXML 4.0 partwise output for guitar TAB."""

from xml.etree import ElementTree as ET

from app.models.score import GuitarNote, NoteEvent, Score


PITCH_STEPS = ("C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B")
PITCH_ALTERS = (0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0)


class MusicXMLWriter:
    """Serialize the intermediate score as MusicXML 4.0."""

    def write(self, score: Score) -> bytes:
        """Return a well-formed, TuxGuitar-friendly partwise document."""

        root = ET.Element("score-partwise", version="4.0")
        work = ET.SubElement(root, "work")
        ET.SubElement(work, "work-title").text = score.title
        identification = ET.SubElement(root, "identification")
        encoding = ET.SubElement(identification, "encoding")
        ET.SubElement(encoding, "software").text = "TAB OMR MVP"

        part_list = ET.SubElement(root, "part-list")
        score_part = ET.SubElement(part_list, "score-part", id="P1")
        ET.SubElement(score_part, "part-name").text = "Guitar"
        part = ET.SubElement(root, "part", id="P1")

        for index, measure in enumerate(score.measures):
            node = ET.SubElement(part, "measure", number=str(measure.number))
            if index == 0:
                self._write_attributes(node, score)
                direction = ET.SubElement(node, "direction", placement="above")
                direction_type = ET.SubElement(direction, "direction-type")
                metronome = ET.SubElement(direction_type, "metronome")
                ET.SubElement(metronome, "beat-unit").text = "quarter"
                ET.SubElement(metronome, "per-minute").text = str(score.tempo)
                ET.SubElement(direction, "sound", tempo=str(score.tempo))
            for event in measure.events:
                self._write_event(node, event, score)

        ET.indent(root, space="  ")
        content = ET.tostring(root, encoding="utf-8", xml_declaration=True)
        ET.fromstring(content)
        return content

    @staticmethod
    def _write_attributes(node: ET.Element, score: Score) -> None:
        attributes = ET.SubElement(node, "attributes")
        ET.SubElement(attributes, "divisions").text = str(score.divisions)
        key = ET.SubElement(attributes, "key")
        ET.SubElement(key, "fifths").text = "0"
        time = ET.SubElement(attributes, "time")
        ET.SubElement(time, "beats").text = str(score.beats)
        ET.SubElement(time, "beat-type").text = str(score.beat_type)
        clef = ET.SubElement(attributes, "clef")
        ET.SubElement(clef, "sign").text = "TAB"
        ET.SubElement(clef, "line").text = "5"
        details = ET.SubElement(attributes, "staff-details")
        ET.SubElement(details, "staff-type").text = "alternate"
        ET.SubElement(details, "staff-lines").text = "6"
        # MusicXML staff-tuning line 1 is the bottom/low-E line.
        for line, midi in enumerate(reversed(score.tuning), start=1):
            tuning = ET.SubElement(details, "staff-tuning", line=str(line))
            step, alter, octave = MusicXMLWriter._midi_pitch(midi)
            ET.SubElement(tuning, "tuning-step").text = step
            if alter:
                ET.SubElement(tuning, "tuning-alter").text = str(alter)
            ET.SubElement(tuning, "tuning-octave").text = str(octave)

    def _write_event(self, parent: ET.Element, event: NoteEvent, score: Score) -> None:
        if event.is_rest:
            note = ET.SubElement(parent, "note")
            ET.SubElement(note, "rest")
            self._write_duration_fields(note, event, score)
            return
        for index, guitar_note in enumerate(event.notes):
            note = ET.SubElement(parent, "note")
            if index:
                ET.SubElement(note, "chord")
            midi = score.tuning[guitar_note.string - 1] + guitar_note.fret
            pitch = ET.SubElement(note, "pitch")
            step, alter, octave = self._midi_pitch(midi)
            ET.SubElement(pitch, "step").text = step
            if alter:
                ET.SubElement(pitch, "alter").text = str(alter)
            ET.SubElement(pitch, "octave").text = str(octave)
            self._write_duration_fields(note, event, score)
            notations = ET.SubElement(note, "notations")
            technical = ET.SubElement(notations, "technical")
            ET.SubElement(technical, "string").text = str(guitar_note.string)
            ET.SubElement(technical, "fret").text = str(guitar_note.fret)

    @staticmethod
    def _write_duration_fields(note: ET.Element, event: NoteEvent, score: Score) -> None:
        ET.SubElement(note, "duration").text = str(event.duration)
        ET.SubElement(note, "voice").text = str(event.voice)
        ET.SubElement(note, "type").text = MusicXMLWriter._duration_type(
            event.duration, score.divisions
        )
        ET.SubElement(note, "staff").text = "1"

    @staticmethod
    def _duration_type(duration: int, divisions: int) -> str:
        if duration >= divisions:
            return "quarter"
        if duration >= max(1, divisions // 2):
            return "eighth"
        return "16th"

    @staticmethod
    def _midi_pitch(midi: int) -> tuple[str, int, int]:
        pitch_class = midi % 12
        return PITCH_STEPS[pitch_class], PITCH_ALTERS[pitch_class], midi // 12 - 1

