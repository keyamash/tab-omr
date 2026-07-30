export interface BrowserWarning {
  image_index: number;
  measure_index: number | null;
  message: string;
}

export interface BrowserConversion {
  measure_count: number;
  note_count: number;
  warning_count: number;
  warnings: BrowserWarning[];
  xml: Blob;
}

interface GuitarNote {
  string: number;
  fret: number;
}

interface Event {
  duration: number;
  notes: GuitarNote[];
  rest?: boolean;
}

interface LineGroup {
  lines: number[];
  spacing: number;
}

const TUNING = [64, 59, 55, 50, 45, 40];
const STEPS = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const ALTERS = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];

export async function analyzeInBrowser(
  files: File[],
  tempo: number,
): Promise<BrowserConversion> {
  const measures: Event[][] = [];
  const warnings: BrowserWarning[] = [];

  for (let imageIndex = 0; imageIndex < files.length; imageIndex += 1) {
    const bitmap = await createImageBitmap(files[imageIndex]);
    const scale = Math.min(1, 1600 / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("画像解析を初期化できませんでした");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const binary = toBinary(context.getImageData(0, 0, width, height).data);
    const groups = detectLineGroups(binary, width, height);
    const tabs = groups.filter((group) => group.lines.length === 6);
    if (!tabs.length) {
      warnings.push({
        image_index: imageIndex,
        measure_index: null,
        message: "TABの6本線を検出できなかったため、この画像をスキップしました",
      });
      continue;
    }
    if (!groups.some((group) => group.lines.length === 5)) {
      warnings.push({
        image_index: imageIndex,
        measure_index: null,
        message: "五線譜を検出できず、TABの間隔から音価を割り当てました",
      });
    }

    for (const tab of tabs) {
      const boundaries = detectBarlines(binary, width, height, tab);
      for (let index = 0; index < boundaries.length - 1; index += 1) {
        const left = boundaries[index];
        const right = boundaries[index + 1];
        if (right - left < Math.max(28, width / 40)) continue;
        const candidates = detectFrets(binary, width, height, tab, left, right);
        if (!candidates.length) continue;
        measures.push(fillMeasure(clusterEvents(candidates, right - left)));
      }
    }
  }

  if (!measures.length) {
    measures.push(Array.from({ length: 4 }, () => ({ duration: 4, notes: [], rest: true })));
    warnings.push({
      image_index: 0,
      measure_index: 1,
      message: "音符を確定できなかったため、確認用の空小節を生成しました",
    });
  }
  const noteCount = measures.reduce(
    (sum, measure) =>
      sum + measure.reduce((count, event) => count + event.notes.length, 0),
    0,
  );
  return {
    measure_count: measures.length,
    note_count: noteCount,
    warning_count: warnings.length,
    warnings,
    xml: new Blob([createMusicXml(measures, tempo)], {
      type: "application/vnd.recordare.musicxml+xml",
    }),
  };
}

function toBinary(data: Uint8ClampedArray): Uint8Array {
  const luminance = new Uint8Array(data.length / 4);
  let sum = 0;
  for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
    const value = Math.round(
      data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114,
    );
    luminance[index] = value;
    sum += value;
  }
  const threshold = Math.max(105, Math.min(220, sum / luminance.length - 28));
  return luminance.map((value) => (value < threshold ? 1 : 0));
}

function detectLineGroups(
  binary: Uint8Array,
  width: number,
  height: number,
): LineGroup[] {
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) dark += binary[y * width + x];
    if (dark > width * 0.24) rows.push(y);
  }
  const centers = collapse(rows, 2);
  const groups: LineGroup[] = [];
  for (const count of [6, 5]) {
    for (let start = 0; start <= centers.length - count; start += 1) {
      const lines = centers.slice(start, start + count);
      const gaps = lines.slice(1).map((line, index) => line - lines[index]);
      const spacing = median(gaps);
      if (
        spacing >= 4 &&
        spacing <= 70 &&
        Math.max(...gaps) <= spacing * 1.42 &&
        Math.min(...gaps) >= spacing * 0.62
      ) {
        groups.push({ lines, spacing });
      }
    }
  }
  groups.sort((first, second) => second.lines.length - first.lines.length);
  const selected: LineGroup[] = [];
  for (const group of groups) {
    const top = group.lines[0];
    const bottom = group.lines.at(-1)!;
    if (
      !selected.some((other) => {
        const overlap =
          Math.min(bottom, other.lines.at(-1)!) - Math.max(top, other.lines[0]);
        return overlap > (bottom - top) * 0.5;
      })
    ) {
      selected.push(group);
    }
  }
  return selected;
}

function detectBarlines(
  binary: Uint8Array,
  width: number,
  height: number,
  tab: LineGroup,
): number[] {
  const top = Math.max(0, Math.round(tab.lines[0] - tab.spacing * 0.6));
  const bottom = Math.min(height - 1, Math.round(tab.lines[5] + tab.spacing * 0.6));
  const columns: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) dark += binary[y * width + x];
    if (dark > (bottom - top) * 0.54) columns.push(x);
  }
  const bars = collapse(columns, 3).filter((x) => x > 2 && x < width - 3);
  const values = [0, ...bars, width - 1];
  return values.filter(
    (value, index) =>
      index === 0 || value - values[index - 1] >= Math.max(26, width / 45),
  );
}

function detectFrets(
  binary: Uint8Array,
  width: number,
  height: number,
  tab: LineGroup,
  left: number,
  right: number,
): Array<GuitarNote & { x: number }> {
  const top = Math.max(0, Math.round(tab.lines[0] - tab.spacing * 0.7));
  const bottom = Math.min(height - 1, Math.round(tab.lines[5] + tab.spacing * 0.7));
  const active: number[] = [];
  for (let x = left + 3; x < right - 3; x += 1) {
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) {
      if (tab.lines.some((line) => Math.abs(line - y) <= 2)) continue;
      dark += binary[y * width + x];
    }
    if (dark >= 2) active.push(x);
  }
  const ranges = collapseRanges(active, Math.max(2, tab.spacing * 0.3));
  const results: Array<GuitarNote & { x: number }> = [];
  for (const [start, end] of ranges) {
    if (end - start < 2 || end - start > tab.spacing * 2.4) continue;
    const points: Array<[number, number]> = [];
    for (let y = top; y <= bottom; y += 1) {
      if (tab.lines.some((line) => Math.abs(line - y) <= 2)) continue;
      for (let x = start; x <= end; x += 1) {
        if (binary[y * width + x]) points.push([x, y]);
      }
    }
    if (points.length < 5) continue;
    const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    let string = 1;
    let distance = Infinity;
    tab.lines.forEach((line, index) => {
      if (Math.abs(line - centerY) < distance) {
        distance = Math.abs(line - centerY);
        string = index + 1;
      }
    });
    if (distance > tab.spacing * 0.82) continue;
    const fret = recognize(points, start, end, top, bottom);
    if (fret !== null) results.push({ x: Math.round((start + end) / 2), string, fret });
  }
  return results;
}

const templates = new Map<string, Uint8Array>();

function recognize(
  points: Array<[number, number]>,
  left: number,
  right: number,
  top: number,
  bottom: number,
): number | null {
  const normalized = normalize(points, left, right, top, bottom);
  let bestValue: number | null = null;
  let bestScore = 0;
  for (let value = 0; value <= 24; value += 1) {
    const template = renderTemplate(String(value));
    let same = 0;
    for (let index = 0; index < template.length; index += 1) {
      if (template[index] === normalized[index]) same += 1;
    }
    const score = same / template.length;
    if (score > bestScore) {
      bestScore = score;
      bestValue = value;
    }
  }
  return bestScore >= 0.49 ? bestValue : null;
}

function normalize(
  points: Array<[number, number]>,
  left: number,
  right: number,
  top: number,
  bottom: number,
): Uint8Array {
  const output = new Uint8Array(28 * 36);
  const scale = Math.min(22 / Math.max(1, right - left + 1), 30 / Math.max(1, bottom - top + 1));
  const offsetX = (28 - (right - left + 1) * scale) / 2;
  const offsetY = (36 - (bottom - top + 1) * scale) / 2;
  for (const [x, y] of points) {
    const targetX = Math.max(0, Math.min(27, Math.round((x - left) * scale + offsetX)));
    const targetY = Math.max(0, Math.min(35, Math.round((y - top) * scale + offsetY)));
    output[targetY * 28 + targetX] = 1;
  }
  return output;
}

function renderTemplate(text: string): Uint8Array {
  const cached = templates.get(text);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 28;
  canvas.height = 36;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.fillStyle = "white";
  context.fillRect(0, 0, 28, 36);
  context.fillStyle = "black";
  context.font = `${text.length === 1 ? 27 : 22}px Arial`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 14, 19);
  const pixels = context.getImageData(0, 0, 28, 36).data;
  const output = new Uint8Array(28 * 36);
  for (let pixel = 0, index = 0; pixel < pixels.length; pixel += 4, index += 1) {
    output[index] = pixels[pixel] < 150 ? 1 : 0;
  }
  templates.set(text, output);
  return output;
}

function clusterEvents(notes: Array<GuitarNote & { x: number }>, width: number): Event[] {
  const clusters: Array<Array<GuitarNote & { x: number }>> = [];
  const tolerance = Math.max(5, width / 100);
  for (const note of notes.sort((first, second) => first.x - second.x)) {
    const cluster = clusters.at(-1);
    const center = cluster
      ? cluster.reduce((sum, item) => sum + item.x, 0) / cluster.length
      : -Infinity;
    if (cluster && Math.abs(note.x - center) <= tolerance) cluster.push(note);
    else clusters.push([note]);
  }
  const target = 16 / Math.max(1, clusters.length);
  const duration = [1, 2, 4].reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best,
  );
  return clusters.map((cluster) => ({
    duration,
    notes: Array.from(
      new Map(cluster.map((note) => [note.string, { string: note.string, fret: note.fret }])).values(),
    ),
  }));
}

function fillMeasure(events: Event[]): Event[] {
  const output: Event[] = [];
  let cursor = 0;
  for (const event of events) {
    if (cursor >= 16) break;
    const duration = Math.min(event.duration, 16 - cursor);
    output.push({ ...event, duration });
    cursor += duration;
  }
  for (const value of [4, 2, 1]) {
    while (16 - cursor >= value) {
      output.push({ duration: value, notes: [], rest: true });
      cursor += value;
    }
  }
  return output;
}

function createMusicXml(measures: Event[][], tempo: number): string {
  const tuning = [["E", 2], ["A", 2], ["D", 3], ["G", 3], ["B", 3], ["E", 4]]
    .map(
      ([step, octave], index) =>
        `<staff-tuning line="${index + 1}"><tuning-step>${step}</tuning-step><tuning-octave>${octave}</tuning-octave></staff-tuning>`,
    )
    .join("");
  const measureXml = measures
    .map((events, index) => {
      const attributes =
        index === 0
          ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>${tuning}</staff-details></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`
          : "";
      return `<measure number="${index + 1}">${attributes}${events.map(eventXml).join("")}</measure>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Tablature Lens Conversion</work-title></work><identification><encoding><software>Tablature Lens Browser OCR</software></encoding></identification><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1">${measureXml}</part></score-partwise>`;
}

function eventXml(event: Event): string {
  const type = event.duration >= 4 ? "quarter" : event.duration >= 2 ? "eighth" : "16th";
  if (event.rest) {
    return `<note><rest/><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
  }
  return event.notes
    .map((note, index) => {
      const midi = TUNING[note.string - 1] + note.fret;
      const pitchClass = midi % 12;
      const alter = ALTERS[pitchClass] ? `<alter>${ALTERS[pitchClass]}</alter>` : "";
      return `<note>${index ? "<chord/>" : ""}<pitch><step>${STEPS[pitchClass]}</step>${alter}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff><notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations></note>`;
    })
    .join("");
}

function collapse(values: number[], tolerance: number): number[] {
  return collapseRanges(values, tolerance).map(([start, end]) => Math.round((start + end) / 2));
}

function collapseRanges(values: number[], tolerance: number): Array<[number, number]> {
  if (!values.length) return [];
  const ranges: Array<[number, number]> = [[values[0], values[0]]];
  for (const value of values.slice(1)) {
    const range = ranges.at(-1)!;
    if (value <= range[1] + tolerance) range[1] = value;
    else ranges.push([value, value]);
  }
  return ranges;
}

function median(values: number[]): number {
  const sorted = [...values].sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

