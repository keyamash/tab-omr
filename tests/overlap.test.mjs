import assert from "node:assert/strict";
import test from "node:test";

await import(
  new URL(
    `../standalone/overlap.js?test=${process.pid}-${Date.now()}`,
    import.meta.url,
  )
);

const { eventSignature, mergeMeasureSets } = globalThis.TabOverlap;

function sound(string, fret, techniques) {
  return {
    duration: 2,
    notes: [
      {
        string,
        fret,
        ...(techniques ? { techniques } : {}),
      },
    ],
  };
}

function measure(events) {
  return [
    ...events,
    { duration: 2, notes: [], rest: true },
  ];
}

const overlap = [
  sound(6, 0),
  sound(5, 3),
  sound(4, 5),
  sound(3, 7),
  sound(2, 8),
  sound(1, 10),
  sound(2, 12),
];

test("merges a partial measure shared by consecutive images", () => {
  const extension = sound(3, 14);
  const result = mergeMeasureSets([
    {
      imageIndex: 0,
      measures: [
        measure([sound(6, 2), sound(5, 4), sound(4, 6), sound(3, 8)]),
        measure(overlap),
      ],
    },
    {
      imageIndex: 1,
      measures: [
        measure([...overlap, extension]),
        measure([sound(4, 9), sound(3, 11), sound(2, 13)]),
      ],
    },
  ]);

  assert.equal(result.overlapCount, 1);
  assert.equal(result.measures.length, 3);
  const mergedEvents = result.measures[1].filter((event) => !event.rest);
  assert.equal(mergedEvents.length, 8);
  assert.equal(
    eventSignature(mergedEvents.at(-1)),
    eventSignature(extension),
  );
});

test("allows a small OCR error while preserving technique connections", () => {
  const incomingOverlap = overlap.map((event) => ({
    ...event,
    notes: event.notes.map((note) => ({ ...note })),
  }));
  incomingOverlap[3].notes[0].fret += 1;
  incomingOverlap.at(-1).notes[0].techniques = { hammerStart: true };
  const extension = sound(3, 14, { hammerStop: true });
  const result = mergeMeasureSets([
    { imageIndex: 0, measures: [measure(overlap)] },
    {
      imageIndex: 1,
      measures: [
        measure([...incomingOverlap, extension]),
        measure([sound(5, 2), sound(4, 4)]),
      ],
    },
  ]);

  assert.equal(result.overlapCount, 1);
  assert.equal(result.techniqueCount, 1);
  const merged = result.measures[0].filter((event) => !event.rest);
  assert.equal(merged.at(-2).notes[0].techniques.hammerStart, true);
  assert.equal(merged.at(-1).notes[0].techniques.hammerStop, true);
});

test("does not merge a short or unrelated repeated fragment", () => {
  const result = mergeMeasureSets([
    { imageIndex: 0, measures: [measure(overlap.slice(0, 3))] },
    { imageIndex: 1, measures: [measure(overlap.slice(0, 3))] },
  ]);

  assert.equal(result.overlapCount, 0);
  assert.equal(result.measures.length, 2);
});

test("stitches the two supplied screenshot sequences into five measures", () => {
  const shared = [
    sound(5, 9),
    sound(2, 12),
    sound(3, 9),
    sound(4, 11),
    sound(1, 9),
    sound(2, 12),
    sound(3, 9),
  ];
  const result = mergeMeasureSets([
    {
      imageIndex: 0,
      measures: [
        measure([sound(3, 11), sound(4, 0), sound(1, 12), sound(2, 10)]),
        measure([sound(3, 9), sound(1, 9), sound(1, 7), sound(2, 9)]),
        measure(shared),
      ],
    },
    {
      imageIndex: 1,
      measures: [
        measure([...shared, sound(4, 11)]),
        measure([sound(5, 9), sound(3, 11), sound(2, 9), sound(2, 10)]),
        measure([sound(4, 0), sound(3, 6), sound(3, 9), sound(3, 11)]),
      ],
    },
  ]);

  assert.equal(result.overlapCount, 1);
  assert.equal(result.measures.length, 5);
  assert.equal(
    result.measures[2].filter((event) => !event.rest).length,
    8,
  );
});
