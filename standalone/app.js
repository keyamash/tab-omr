(() => {
  const API_BASE = String(globalThis.TAB_OMR_API_BASE || "").replace(/\/$/, "");
  const state = { images: [], resultUrl: "" };
  const $ = (selector) => document.querySelector(selector);
  const input = $("#file-input");
  const dropZone = $("#drop-zone");
  const queue = $("#image-queue");
  const queuePanel = $("#queue-panel");
  const convertButton = $("#convert");

  if (API_BASE) {
    $("#ocr-mode").textContent = "SERVER OCR";
    $("#privacy-copy").textContent = "Cloud Run上のOpenCV認識を使用します。";
    $("#process-note").textContent = "サーバーのOpenCV認識を使用します。";
  }

  dropZone.addEventListener("click", () => input.click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
  input.addEventListener("change", () => addFiles([...input.files]));
  for (const name of ["dragenter", "dragover"]) {
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add("is-dragging");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove("is-dragging");
    });
  }
  dropZone.addEventListener("drop", (event) => addFiles([...event.dataTransfer.files]));
  convertButton.addEventListener("click", convert);

  function addFiles(files) {
    clearError();
    clearResult();
    const invalid = files.find(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) return showError(`${invalid.name} は追加できません。JPG・PNG・WebP、10MB以下の画像を選択してください。`);
    if (state.images.length + files.length > 20) return showError("画像は最大20枚までです。");
    state.images.push(
      ...files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
      })),
    );
    input.value = "";
    renderQueue();
  }

  function renderQueue() {
    queuePanel.hidden = !state.images.length;
    $("#image-count").textContent = `${state.images.length} / 20 枚`;
    convertButton.disabled = !state.images.length;
    queue.replaceChildren();
    state.images.forEach((image, index) => {
      const card = document.createElement("article");
      card.className = "image-card";
      const order = document.createElement("div");
      order.className = "order-number";
      order.textContent = String(index + 1).padStart(2, "0");
      const preview = document.createElement("img");
      preview.src = image.url;
      preview.alt = `${image.file.name} のプレビュー`;
      const meta = document.createElement("div");
      meta.className = "image-meta";
      const title = document.createElement("strong");
      title.textContent = image.file.name;
      const size = document.createElement("span");
      size.textContent = `${(image.file.size / 1024 / 1024).toFixed(1)} MB`;
      meta.append(title, size);
      const actions = document.createElement("div");
      actions.className = "image-actions";
      [
        ["↑", index === 0, () => move(index, index - 1), "上へ"],
        ["↓", index === state.images.length - 1, () => move(index, index + 1), "下へ"],
        ["×", false, () => remove(index), "削除"],
      ].forEach(([text, disabled, action, label], actionIndex) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `icon-button${actionIndex === 2 ? " remove-button" : ""}`;
        button.textContent = text;
        button.disabled = disabled;
        button.setAttribute("aria-label", `${image.file.name} を${label}`);
        button.addEventListener("click", action);
        actions.append(button);
      });
      card.append(order, preview, meta, actions);
      queue.append(card);
    });
  }

  function move(from, to) {
    const [image] = state.images.splice(from, 1);
    state.images.splice(to, 0, image);
    clearResult();
    renderQueue();
  }

  function remove(index) {
    URL.revokeObjectURL(state.images[index].url);
    state.images.splice(index, 1);
    clearResult();
    renderQueue();
  }

  async function convert() {
    const tempo = Number($("#tempo").value);
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300) {
      return showError("テンポは30〜300 BPMの整数で指定してください。");
    }
    clearError();
    clearResult();
    setBusy(true);
    try {
      const result = API_BASE
        ? await convertWithApi(tempo)
        : await convertInBrowser(tempo);
      showResult(result);
    } catch (error) {
      showError(error instanceof Error ? error.message : "変換に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function convertWithApi(tempo) {
    const body = new FormData();
    state.images.forEach((image) => body.append("files", image.file));
    body.append("tempo", tempo);
    body.append("beats", "4");
    body.append("beat_type", "4");
    body.append("tuning", "[64,59,55,50,45,40]");
    const response = await fetch(`${API_BASE}/api/convert`, { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "変換に失敗しました");
    return { ...payload, url: `${API_BASE}${payload.download_url}`, filename: "tab-score.musicxml" };
  }

  async function convertInBrowser(tempo) {
    const measures = [];
    const warnings = [];
    for (let imageIndex = 0; imageIndex < state.images.length; imageIndex += 1) {
      const bitmap = await createImageBitmap(state.images[imageIndex].file);
      const scale = Math.min(1, 1600 / bitmap.width);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const binary = toBinary(context.getImageData(0, 0, width, height).data);
      const groups = detectGroups(binary, width, height);
      const tabs = groups.filter((group) => group.lines.length === 6);
      if (!tabs.length) {
        warnings.push({ image_index: imageIndex, measure_index: null, message: "TABの6本線を検出できませんでした" });
        continue;
      }
      if (!groups.some((group) => group.lines.length === 5)) {
        warnings.push({ image_index: imageIndex, measure_index: null, message: "五線譜を検出できず、TABから音価を推定しました" });
      }
      tabs.forEach((tab) => {
        const bars = detectBars(binary, width, height, tab);
        for (let index = 0; index < bars.length - 1; index += 1) {
          const candidates = detectDigits(binary, width, height, tab, bars[index], bars[index + 1]);
          if (candidates.length) measures.push(fillMeasure(cluster(candidates, bars[index + 1] - bars[index])));
        }
      });
    }
    if (!measures.length) {
      measures.push(Array.from({ length: 4 }, () => ({ duration: 4, notes: [], rest: true })));
      warnings.push({ image_index: 0, measure_index: 1, message: "音符を確定できなかったため、空小節を生成しました" });
    }
    const xml = musicXml(measures, tempo);
    const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
    state.resultUrl = URL.createObjectURL(blob);
    return {
      measure_count: measures.length,
      note_count: measures.flat().reduce((sum, event) => sum + event.notes.length, 0),
      warning_count: warnings.length,
      warnings,
      url: state.resultUrl,
      filename: `tab-score-${timestamp()}.musicxml`,
    };
  }

  function toBinary(data) {
    const values = new Uint8Array(data.length / 4);
    let sum = 0;
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
      values[index] = data[pixel] * 0.299 + data[pixel + 1] * 0.587 + data[pixel + 2] * 0.114;
      sum += values[index];
    }
    const threshold = Math.max(105, Math.min(220, sum / values.length - 28));
    return values.map((value) => (value < threshold ? 1 : 0));
  }

  function detectGroups(binary, width, height) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let dark = 0;
      for (let x = 0; x < width; x += 1) dark += binary[y * width + x];
      if (dark > width * 0.24) rows.push(y);
    }
    const centers = collapse(rows, 2);
    const groups = [];
    [6, 5].forEach((count) => {
      for (let start = 0; start <= centers.length - count; start += 1) {
        const lines = centers.slice(start, start + count);
        const gaps = lines.slice(1).map((line, index) => line - lines[index]);
        const spacing = median(gaps);
        if (spacing >= 4 && spacing <= 70 && Math.max(...gaps) <= spacing * 1.42 && Math.min(...gaps) >= spacing * 0.62) groups.push({ lines, spacing });
      }
    });
    groups.sort((a, b) => b.lines.length - a.lines.length);
    return groups.filter((group, index) => !groups.slice(0, index).some((other) => {
      const overlap = Math.min(group.lines.at(-1), other.lines.at(-1)) - Math.max(group.lines[0], other.lines[0]);
      return overlap > (group.lines.at(-1) - group.lines[0]) * 0.5;
    }));
  }

  function detectBars(binary, width, height, tab) {
    const top = Math.max(0, Math.round(tab.lines[0] - tab.spacing * 0.6));
    const bottom = Math.min(height - 1, Math.round(tab.lines[5] + tab.spacing * 0.6));
    const columns = [];
    for (let x = 0; x < width; x += 1) {
      let dark = 0;
      for (let y = top; y <= bottom; y += 1) dark += binary[y * width + x];
      if (dark > (bottom - top) * 0.54) columns.push(x);
    }
    const values = [0, ...collapse(columns, 3).filter((x) => x > 2 && x < width - 3), width - 1];
    return values.filter((value, index) => index === 0 || value - values[index - 1] >= Math.max(26, width / 45));
  }

  const templateCache = new Map();
  function detectDigits(binary, width, height, tab, left, right) {
    const top = Math.max(0, Math.round(tab.lines[0] - tab.spacing * 0.7));
    const bottom = Math.min(height - 1, Math.round(tab.lines[5] + tab.spacing * 0.7));
    const active = [];
    for (let x = left + 3; x < right - 3; x += 1) {
      let dark = 0;
      for (let y = top; y <= bottom; y += 1) {
        if (!tab.lines.some((line) => Math.abs(line - y) <= 2)) dark += binary[y * width + x];
      }
      if (dark >= 2) active.push(x);
    }
    const candidates = [];
    collapseRanges(active, Math.max(2, tab.spacing * 0.3)).forEach(([start, end]) => {
      if (end - start < 2 || end - start > tab.spacing * 2.4) return;
      const points = [];
      for (let y = top; y <= bottom; y += 1) {
        if (tab.lines.some((line) => Math.abs(line - y) <= 2)) continue;
        for (let x = start; x <= end; x += 1) if (binary[y * width + x]) points.push([x, y]);
      }
      if (points.length < 5) return;
      const centerY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
      let string = 1;
      let distance = Infinity;
      tab.lines.forEach((line, index) => {
        if (Math.abs(line - centerY) < distance) {
          distance = Math.abs(line - centerY);
          string = index + 1;
        }
      });
      if (distance > tab.spacing * 0.82) return;
      const fret = recognize(points, start, end, top, bottom);
      if (fret !== null) candidates.push({ x: Math.round((start + end) / 2), string, fret });
    });
    return candidates;
  }

  function recognize(points, left, right, top, bottom) {
    const normalized = normalize(points, left, right, top, bottom);
    let best = null;
    let bestScore = 0;
    for (let value = 0; value <= 24; value += 1) {
      const template = renderTemplate(String(value));
      let same = 0;
      for (let index = 0; index < template.length; index += 1) if (template[index] === normalized[index]) same += 1;
      if (same / template.length > bestScore) {
        bestScore = same / template.length;
        best = value;
      }
    }
    return bestScore >= 0.49 ? best : null;
  }

  function normalize(points, left, right, top, bottom) {
    const output = new Uint8Array(28 * 36);
    const scale = Math.min(22 / Math.max(1, right - left + 1), 30 / Math.max(1, bottom - top + 1));
    const offsetX = (28 - (right - left + 1) * scale) / 2;
    const offsetY = (36 - (bottom - top + 1) * scale) / 2;
    points.forEach(([x, y]) => {
      const tx = Math.max(0, Math.min(27, Math.round((x - left) * scale + offsetX)));
      const ty = Math.max(0, Math.min(35, Math.round((y - top) * scale + offsetY)));
      output[ty * 28 + tx] = 1;
    });
    return output;
  }

  function renderTemplate(text) {
    if (templateCache.has(text)) return templateCache.get(text);
    const canvas = document.createElement("canvas");
    canvas.width = 28;
    canvas.height = 36;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, 28, 36);
    context.fillStyle = "black";
    context.font = `${text.length === 1 ? 27 : 22}px Arial`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 14, 19);
    const data = context.getImageData(0, 0, 28, 36).data;
    const output = new Uint8Array(28 * 36);
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) output[index] = data[pixel] < 150 ? 1 : 0;
    templateCache.set(text, output);
    return output;
  }

  function cluster(notes, width) {
    const clusters = [];
    const tolerance = Math.max(5, width / 100);
    notes.sort((a, b) => a.x - b.x).forEach((note) => {
      const cluster = clusters.at(-1);
      const center = cluster ? cluster.reduce((sum, item) => sum + item.x, 0) / cluster.length : -Infinity;
      if (cluster && Math.abs(note.x - center) <= tolerance) cluster.push(note);
      else clusters.push([note]);
    });
    const target = 16 / Math.max(1, clusters.length);
    const duration = [1, 2, 4].reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best);
    return clusters.map((items) => ({
      duration,
      notes: [...new Map(items.map((item) => [item.string, { string: item.string, fret: item.fret }])).values()],
    }));
  }

  function fillMeasure(events) {
    const output = [];
    let cursor = 0;
    events.forEach((event) => {
      if (cursor >= 16) return;
      output.push({ ...event, duration: Math.min(event.duration, 16 - cursor) });
      cursor += Math.min(event.duration, 16 - cursor);
    });
    [4, 2, 1].forEach((value) => {
      while (16 - cursor >= value) {
        output.push({ duration: value, notes: [], rest: true });
        cursor += value;
      }
    });
    return output;
  }

  function musicXml(measures, tempo) {
    const tuning = [["E", 2], ["A", 2], ["D", 3], ["G", 3], ["B", 3], ["E", 4]]
      .map(([step, octave], index) => `<staff-tuning line="${index + 1}"><tuning-step>${step}</tuning-step><tuning-octave>${octave}</tuning-octave></staff-tuning>`).join("");
    const body = measures.map((events, index) => {
      const attrs = index === 0 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>${tuning}</staff-details></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>` : "";
      return `<measure number="${index + 1}">${attrs}${events.map(eventXml).join("")}</measure>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Tablature Lens Conversion</work-title></work><identification><encoding><software>Tablature Lens Browser OCR</software></encoding></identification><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
  }

  function eventXml(event) {
    const type = event.duration >= 4 ? "quarter" : event.duration >= 2 ? "eighth" : "16th";
    if (event.rest) return `<note><rest/><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
    const tuning = [64, 59, 55, 50, 45, 40];
    const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    return event.notes.map((note, index) => {
      const midi = tuning[note.string - 1] + note.fret;
      const pc = midi % 12;
      return `<note>${index ? "<chord/>" : ""}<pitch><step>${steps[pc]}</step>${alters[pc] ? `<alter>${alters[pc]}</alter>` : ""}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff><notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations></note>`;
    }).join("");
  }

  function collapse(values, tolerance) {
    return collapseRanges(values, tolerance).map(([start, end]) => Math.round((start + end) / 2));
  }
  function collapseRanges(values, tolerance) {
    if (!values.length) return [];
    const ranges = [[values[0], values[0]]];
    values.slice(1).forEach((value) => {
      const range = ranges.at(-1);
      if (value <= range[1] + tolerance) range[1] = value;
      else ranges.push([value, value]);
    });
    return ranges;
  }
  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] || 0;
  }
  function timestamp() {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  }

  function showResult(result) {
    $("#measure-count").textContent = result.measure_count;
    $("#note-count").textContent = result.note_count;
    $("#warning-count").textContent = result.warning_count;
    $("#warning-metric").classList.toggle("has-warning", Boolean(result.warning_count));
    const warningBox = $("#warnings");
    const list = warningBox.querySelector("ul");
    list.replaceChildren();
    result.warnings.forEach((warning) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `画像 ${warning.image_index + 1}${warning.measure_index ? `・小節 ${warning.measure_index}` : ""}`;
      const message = document.createElement("p");
      message.textContent = warning.message;
      item.append(label, message);
      list.append(item);
    });
    warningBox.hidden = !result.warnings.length;
    const download = $("#download");
    download.href = result.url;
    download.download = result.filename;
    $("#result").hidden = false;
  }
  function clearResult() {
    $("#result").hidden = true;
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = "";
  }
  function showError(message) {
    $("#error p").textContent = message;
    $("#error").hidden = false;
  }
  function clearError() {
    $("#error").hidden = true;
  }
  function setBusy(busy) {
    convertButton.disabled = busy || !state.images.length;
    convertButton.innerHTML = busy
      ? '<span class="spinner" aria-hidden="true"></span>楽譜を解析しています…'
      : 'MusicXMLに変換<span aria-hidden="true">→</span>';
  }
})();

