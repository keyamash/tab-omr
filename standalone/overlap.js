(function exposeOverlapTools(root) {
  const MIN_OVERLAP_EVENTS = 4;
  const MAX_OVERLAP_EVENTS = 24;

  function cloneNote(note) {
    return {
      ...note,
      techniques: note.techniques ? { ...note.techniques } : undefined,
    };
  }

  function cloneEvent(event) {
    return {
      ...event,
      notes: Array.isArray(event.notes) ? event.notes.map(cloneNote) : [],
    };
  }

  function cloneMeasures(measures) {
    return measures.map((events) => events.map(cloneEvent));
  }

  function isSoundEvent(event) {
    return !event.rest && Array.isArray(event.notes) && event.notes.length > 0;
  }

  function flattenSoundEvents(measures) {
    const refs = [];
    measures.forEach((events, measureIndex) => {
      events.forEach((event, eventIndex) => {
        if (isSoundEvent(event)) {
          refs.push({ measureIndex, eventIndex, event });
        }
      });
    });
    return refs;
  }

  function eventSignature(event) {
    const notes = event.notes
      .map((note) => `${note.string}:${note.fret}`)
      .sort()
      .join("+");
    return `${event.grace ? "g" : "n"}|${notes}`;
  }

  function noteSimilarity(first, second) {
    if (first.string === second.string && first.fret === second.fret) return 1;
    if (
      first.string === second.string &&
      Math.abs(first.fret - second.fret) === 1
    ) {
      return 0.58;
    }
    if (first.fret === second.fret) return 0.32;
    return 0;
  }

  function directionalNoteScore(first, second) {
    if (!first.length || !second.length) return 0;
    return (
      first.reduce(
        (sum, note) =>
          sum +
          second.reduce(
            (best, candidate) =>
              Math.max(best, noteSimilarity(note, candidate)),
            0,
          ),
        0,
      ) / first.length
    );
  }

  function eventSimilarity(first, second) {
    if (eventSignature(first) === eventSignature(second)) return 1;
    const forward = directionalNoteScore(first.notes, second.notes);
    const backward = directionalNoteScore(second.notes, first.notes);
    const graceFactor = Boolean(first.grace) === Boolean(second.grace) ? 1 : 0.65;
    return ((forward + backward) / 2) * graceFactor;
  }

  function findOverlap(previousMeasures, incomingMeasures) {
    const previous = flattenSoundEvents(previousMeasures);
    const incoming = flattenSoundEvents(incomingMeasures);
    const maxLength = Math.min(
      MAX_OVERLAP_EVENTS,
      previous.length,
      incoming.length,
    );
    const candidates = [];
    for (
      let length = MIN_OVERLAP_EVENTS;
      length <= maxLength;
      length += 1
    ) {
      const suffix = previous.slice(previous.length - length);
      const prefix = incoming.slice(0, length);
      const scores = suffix.map((entry, index) =>
        eventSimilarity(entry.event, prefix[index].event),
      );
      const score =
        scores.reduce((sum, value) => sum + value, 0) / scores.length;
      const exactCount = scores.filter((value) => value === 1).length;
      const uniqueCount = new Set(
        prefix.map((entry) => eventSignature(entry.event)),
      ).size;
      const requiredScore = length >= 6 ? 0.8 : 0.9;
      const requiredExact =
        length >= 6 ? Math.max(3, Math.ceil(length * 0.5)) : 3;
      if (
        score >= requiredScore &&
        exactCount >= requiredExact &&
        uniqueCount >= 3
      ) {
        candidates.push({
          length,
          score,
          exactCount,
          quality: score + Math.min(12, length) * 0.015,
        });
      }
    }
    candidates.sort(
      (first, second) =>
        second.quality - first.quality || second.length - first.length,
    );
    if (!candidates.length) return null;
    const best = candidates[0];
    const alternative = candidates.find(
      (candidate) => candidate.length !== best.length,
    );
    return {
      ...best,
      ambiguous:
        Boolean(alternative) &&
        Math.abs(best.quality - alternative.quality) < 0.025 &&
        Math.abs(best.length - alternative.length) >= 2,
    };
  }

  function mergeEventMetadata(target, source) {
    source.notes.forEach((sourceNote) => {
      const exact = target.notes.find(
        (note) =>
          note.string === sourceNote.string && note.fret === sourceNote.fret,
      );
      if (exact) {
        if (sourceNote.techniques) {
          exact.techniques = {
            ...(exact.techniques || {}),
            ...sourceNote.techniques,
          };
        }
        return;
      }
      if (!target.notes.some((note) => note.string === sourceNote.string)) {
        target.notes.push(cloneNote(sourceNote));
      }
    });
    target.grace = Boolean(target.grace || source.grace);
  }

  function normalizeMeasure(events) {
    const soundEvents = events.filter(isSoundEvent).map(cloneEvent);
    const regularCount = soundEvents.filter((event) => !event.grace).length;
    const duration =
      regularCount <= 4 ? 4 : regularCount <= 8 ? 2 : 1;
    let cursor = 0;
    const output = [];
    soundEvents.forEach((event) => {
      if (event.grace) {
        output.push({ ...event, duration: 0 });
        return;
      }
      if (cursor >= 16) return;
      const eventDuration = Math.min(duration, 16 - cursor);
      output.push({ ...event, duration: eventDuration });
      cursor += eventDuration;
    });
    [4, 2, 1].forEach((value) => {
      while (16 - cursor >= value) {
        output.push({ duration: value, notes: [], rest: true });
        cursor += value;
      }
    });
    return output;
  }

  function mergeMatchedImages(previousMeasures, incomingMeasures, match) {
    const previousRefs = flattenSoundEvents(previousMeasures);
    const incomingRefs = flattenSoundEvents(incomingMeasures);
    const previousMatch = previousRefs.slice(-match.length);
    const incomingMatch = incomingRefs.slice(0, match.length);
    previousMatch.forEach((entry, index) => {
      mergeEventMetadata(entry.event, incomingMatch[index].event);
    });

    const previousBoundary = previousMatch.at(-1);
    const incomingBoundary = incomingMatch.at(-1);
    const continuation = incomingMeasures[incomingBoundary.measureIndex]
      .slice(incomingBoundary.eventIndex + 1)
      .filter(isSoundEvent);
    const targetEvents = previousMeasures[previousBoundary.measureIndex].filter(
      isSoundEvent,
    );
    const merged = previousMeasures.slice(0, previousBoundary.measureIndex + 1);
    merged[previousBoundary.measureIndex] = normalizeMeasure([
      ...targetEvents,
      ...continuation,
    ]);
    merged.push(
      ...incomingMeasures
        .slice(incomingBoundary.measureIndex + 1)
        .map((events) => events.map(cloneEvent)),
    );
    return merged;
  }

  function countTechniques(measures) {
    return measures.reduce(
      (total, events) =>
        total +
        events.reduce(
          (eventTotal, event) =>
            eventTotal +
            event.notes.reduce(
              (noteTotal, note) =>
                noteTotal +
                (note.techniques?.hammerStart ? 1 : 0) +
                (note.techniques?.slideStart ? 1 : 0),
              0,
            ),
          0,
        ),
      0,
    );
  }

  function mergeMeasureSets(measureSets) {
    let measures = [];
    let overlapCount = 0;
    const ambiguousImages = [];
    const matches = [];
    measureSets.forEach((set, index) => {
      const incoming = cloneMeasures(set.measures || []);
      if (!incoming.length) return;
      if (!measures.length) {
        measures = incoming;
        return;
      }
      const match = findOverlap(measures, incoming);
      if (!match) {
        measures.push(...incoming);
        return;
      }
      if (match.ambiguous) {
        ambiguousImages.push(set.imageIndex ?? index);
        measures.push(...incoming);
        return;
      }
      measures = mergeMatchedImages(measures, incoming, match);
      overlapCount += 1;
      matches.push({
        imageIndex: set.imageIndex ?? index,
        eventCount: match.length,
        confidence: match.score,
      });
    });
    return {
      measures,
      overlapCount,
      ambiguousImages,
      matches,
      techniqueCount: countTechniques(measures),
    };
  }

  root.TabOverlap = Object.freeze({
    countTechniques,
    eventSignature,
    findOverlap,
    mergeMeasureSets,
  });
})(globalThis);
