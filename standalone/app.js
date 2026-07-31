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
    const tuning =
      $("#tuning").value === "half-down"
        ? [63, 58, 54, 49, 44, 39]
        : [64, 59, 55, 50, 45, 40];
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300) {
      return showError("テンポは30〜300 BPMの整数で指定してください。");
    }
    clearError();
    clearResult();
    setBusy(true);
    try {
      const result = API_BASE
        ? await convertWithApi(tempo, tuning)
        : await convertInBrowser(tempo, tuning);
      showResult(result);
    } catch (error) {
      showError(error instanceof Error ? error.message : "変換に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function convertWithApi(tempo, tuning) {
    const body = new FormData();
    state.images.forEach((image) => body.append("files", image.file));
    body.append("tempo", tempo);
    body.append("beats", "4");
    body.append("beat_type", "4");
    body.append("tuning", JSON.stringify(tuning));
    const response = await fetch(`${API_BASE}/api/convert`, { method: "POST", body });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || "変換に失敗しました");
    return {
      ...payload,
      tuning,
      url: `${API_BASE}${payload.download_url}`,
      filename: "tab-score.musicxml",
    };
  }

  async function convertInBrowser(tempo, tuning) {
    const measures = [];
    const warnings = [];
    for (let imageIndex = 0; imageIndex < state.images.length; imageIndex += 1) {
      const bitmap = await createImageBitmap(state.images[imageIndex].file);
      const scale = Math.min(2, 2200 / bitmap.width);
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const binary = toBinary(
        context.getImageData(0, 0, width, height).data,
        width,
        height,
      );
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
          const candidates = detectDigits(
            binary,
            width,
            height,
            tab,
            bars[index],
            bars[index + 1],
            index === 0,
          );
          if (candidates.length) measures.push(fillMeasure(cluster(candidates, bars[index + 1] - bars[index])));
        }
      });
    }
    if (!measures.length) {
      measures.push(Array.from({ length: 4 }, () => ({ duration: 4, notes: [], rest: true })));
      warnings.push({ image_index: 0, measure_index: 1, message: "音符を確定できなかったため、空小節を生成しました" });
    }
    const xml = musicXml(measures, tempo, tuning);
    const blob = new Blob([xml], { type: "application/vnd.recordare.musicxml+xml" });
    state.resultUrl = URL.createObjectURL(blob);
    return {
      measure_count: measures.length,
      note_count: measures.flat().reduce((sum, event) => sum + event.notes.length, 0),
      warning_count: warnings.length,
      warnings,
      measures,
      tempo,
      tuning,
      url: state.resultUrl,
      filename: `tab-score-${timestamp()}.musicxml`,
    };
  }

  function toBinary(data, width, height) {
    const values = new Uint8Array(data.length / 4);
    const histogram = new Uint32Array(256);
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
      const value = Math.round(
        data[pixel] * 0.299 +
          data[pixel + 1] * 0.587 +
          data[pixel + 2] * 0.114,
      );
      values[index] = value;
      histogram[value] += 1;
    }
    let totalSum = 0;
    for (let value = 0; value < 256; value += 1) {
      totalSum += value * histogram[value];
    }
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 170;
    for (let value = 0; value < 256; value += 1) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = values.length - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (totalSum - backgroundSum) / foregroundWeight;
      const variance =
        backgroundWeight *
        foregroundWeight *
        (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = value;
      }
    }
    threshold = Math.max(95, Math.min(225, threshold));
    const output = values.map((value) => (value < threshold ? 1 : 0));
    const radius = 3;
    for (let y = radius; y < height - radius; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (output[index]) continue;
        const localBackground =
          (values[(y - radius) * width + x] +
            values[(y + radius) * width + x]) /
          2;
        if (values[index] < 245 && localBackground - values[index] > 10) {
          output[index] = 1;
        }
      }
    }
    return output;
  }

  function detectGroups(binary, width, height) {
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let dark = 0;
      for (let x = 0; x < width; x += 1) dark += binary[y * width + x];
      if (dark > width * 0.24) rows.push(y);
    }
    const centers = collapse(rows, Math.max(2, Math.round(width / 1200)));
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
    const extensionTop = Math.min(
      height - 1,
      Math.round(tab.lines[5] + tab.spacing * 0.35),
    );
    const extensionBottom = Math.min(
      height - 1,
      Math.round(tab.lines[5] + tab.spacing * 3.2),
    );
    const bars = collapse(columns, 3).filter((x) => {
      if (x <= 2 || x >= width - 3) return false;
      let continuation = 0;
      for (let y = extensionTop; y <= extensionBottom; y += 1) {
        for (let offset = -1; offset <= 1; offset += 1) {
          continuation += binary[y * width + x + offset];
        }
      }
      return continuation < Math.max(8, tab.spacing * 0.6);
    });
    const values = [...bars];
    if (!values.length || values[0] > width * 0.2) values.unshift(0);
    if (!values.length || values.at(-1) < width - 3) values.push(width - 1);
    return values.filter(
      (value, index) =>
        index === 0 ||
        value - values[index - 1] >= Math.max(26, width / 45),
    );
  }

  const templateCache = new Map();
  function detectDigits(binary, width, height, tab, left, right, systemStart) {
    const candidates = [];
    const lineMask = Math.max(1, Math.round(tab.spacing * 0.1));
    const halfBand = Math.max(4, Math.round(tab.spacing * 0.48));
    const notationInset = systemStart
      ? Math.min((right - left) * 0.24, tab.spacing * 3.6)
      : 0;
    const contentLeft = Math.round(left + notationInset);
    tab.lines.forEach((line, stringIndex) => {
      const top = Math.max(0, line - halfBand);
      const bottom = Math.min(height - 1, line + halfBand);
      const active = [];
      for (let x = contentLeft + 4; x < right - 4; x += 1) {
        let dark = 0;
        for (let y = top; y <= bottom; y += 1) {
          if (Math.abs(y - line) > lineMask) dark += binary[y * width + x];
        }
        if (dark >= Math.max(2, Math.round(tab.spacing * 0.12))) active.push(x);
      }
      collapseRanges(active, Math.max(2, tab.spacing * 0.28)).forEach(
        ([start, end]) => {
          const glyphWidth = end - start + 1;
          if (
            glyphWidth < Math.max(4, tab.spacing * 0.22) ||
            glyphWidth > tab.spacing * 2.1
          ) {
            return;
          }
          const points = [];
          for (let y = top; y <= bottom; y += 1) {
            for (let x = start; x <= end; x += 1) {
              if (binary[y * width + x]) points.push([x, y]);
            }
          }
          const pointTop = Math.min(...points.map(([, y]) => y));
          const pointBottom = Math.max(...points.map(([, y]) => y));
          if (
            points.length < Math.max(5, tab.spacing * 0.45) ||
            pointBottom - pointTop + 1 < tab.spacing * 0.42
          ) {
            return;
          }
          const fret = recognize(points);
          if (fret !== null) {
            candidates.push({
              x: Math.round((start + end) / 2),
              string: stringIndex + 1,
              fret,
            });
          }
        },
      );
    });
    return candidates.filter(
      (candidate, index) =>
        !candidates.slice(0, index).some((other) => {
          return (
            other.string === candidate.string &&
            Math.abs(other.x - candidate.x) < tab.spacing * 0.25
          );
        }),
    );
  }

  function recognize(points) {
    const left = Math.min(...points.map(([x]) => x));
    const right = Math.max(...points.map(([x]) => x));
    const top = Math.min(...points.map(([, y]) => y));
    const bottom = Math.max(...points.map(([, y]) => y));
    const width = right - left + 1;
    const height = bottom - top + 1;
    const variants = [normalize(points)];
    if (width / Math.max(1, height) > 1.45) {
      const inset = width * 0.18;
      const innerPoints = points.filter(
        ([x]) => x >= left + inset && x <= right - inset,
      );
      if (innerPoints.length >= 5) variants.unshift(normalize(innerPoints));
    }
    let best = null;
    let bestScore = 0;
    const fonts = [
      "Arial",
      "Helvetica",
      "Verdana",
      "Times New Roman",
      "Georgia",
      "sans-serif",
      "serif",
    ];
    for (let value = 0; value <= 24; value += 1) {
      for (const font of fonts) {
        for (const weight of [400, 600]) {
          const template = renderTemplate(String(value), font, weight);
          for (const normalized of variants) {
            const score = tolerantDice(normalized, template);
            if (score > bestScore) {
              bestScore = score;
              best = value;
            }
          }
        }
      }
    }
    return bestScore >= 0.42 ? best : null;
  }

  function tolerantDice(first, second) {
    let firstCount = 0;
    let secondCount = 0;
    let firstHits = 0;
    let secondHits = 0;
    for (let y = 0; y < 36; y += 1) {
      for (let x = 0; x < 28; x += 1) {
        const index = y * 28 + x;
        if (first[index]) {
          firstCount += 1;
          if (hasInkNear(second, x, y)) firstHits += 1;
        }
        if (second[index]) {
          secondCount += 1;
          if (hasInkNear(first, x, y)) secondHits += 1;
        }
      }
    }
    return (firstHits + secondHits) / Math.max(1, firstCount + secondCount);
  }

  function hasInkNear(image, x, y) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (
          targetX >= 0 &&
          targetX < 28 &&
          targetY >= 0 &&
          targetY < 36 &&
          image[targetY * 28 + targetX]
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function normalize(points) {
    const output = new Uint8Array(28 * 36);
    const left = Math.min(...points.map(([x]) => x));
    const right = Math.max(...points.map(([x]) => x));
    const top = Math.min(...points.map(([, y]) => y));
    const bottom = Math.max(...points.map(([, y]) => y));
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

  function renderTemplate(text, font, weight) {
    const cacheKey = `${font}:${weight}:${text}`;
    if (templateCache.has(cacheKey)) return templateCache.get(cacheKey);
    const canvas = document.createElement("canvas");
    canvas.width = 56;
    canvas.height = 72;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, 56, 72);
    context.fillStyle = "black";
    context.font = `${weight} ${text.length === 1 ? 54 : 44}px ${font}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 28, 38);
    const data = context.getImageData(0, 0, 56, 72).data;
    const points = [];
    for (let pixel = 0, index = 0; pixel < data.length; pixel += 4, index += 1) {
      if (data[pixel] < 170) points.push([index % 56, Math.floor(index / 56)]);
    }
    const output = normalize(points);
    templateCache.set(cacheKey, output);
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

  function musicXml(measures, tempo, tuning) {
    const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    const tuningXml = [...tuning]
      .reverse()
      .map((midi, index) => {
        const pitchClass = midi % 12;
        const alter = alters[pitchClass]
          ? `<tuning-alter>${alters[pitchClass]}</tuning-alter>`
          : "";
        return `<staff-tuning line="${index + 1}"><tuning-step>${steps[pitchClass]}</tuning-step>${alter}<tuning-octave>${Math.floor(midi / 12) - 1}</tuning-octave></staff-tuning>`;
      })
      .join("");
    const body = measures.map((events, index) => {
      const attrs = index === 0 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>TAB</sign><line>5</line></clef><staff-details><staff-lines>6</staff-lines>${tuningXml}</staff-details></attributes><direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>` : "";
      return `<measure number="${index + 1}">${attrs}${events.map((event) => eventXml(event, tuning)).join("")}</measure>`;
    }).join("");
    return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="4.0"><work><work-title>Tablature Lens Conversion</work-title></work><identification><encoding><software>Tablature Lens Browser OCR</software></encoding></identification><part-list><score-part id="P1"><part-name>Guitar</part-name></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
  }

  function eventXml(event, tuning) {
    const type = event.duration >= 4 ? "quarter" : event.duration >= 2 ? "eighth" : "16th";
    if (event.rest) return `<note><rest/><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
    const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    return event.notes.map((note, index) => {
      const midi = tuning[note.string - 1] + note.fret;
      const pc = midi % 12;
      return `<note>${index ? "<chord/>" : ""}<pitch><step>${steps[pc]}</step>${alters[pc] ? `<alter>${alters[pc]}</alter>` : ""}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff><notations><technical><string>${note.string}</string><fret>${note.fret}</fret></technical></notations></note>`;
    }).join("");
  }

  function renderScore(measures, tempo, tuning) {
    const preview = $("#score-preview");
    const pages = $("#score-pages");
    pages.replaceChildren();
    if (!Array.isArray(measures) || !measures.length) {
      preview.hidden = true;
      return;
    }
    for (let start = 0; start < measures.length; start += 4) {
      const systemMeasures = measures.slice(start, start + 4);
      const wrapper = document.createElement("div");
      wrapper.className = "score-system";
      const canvas = document.createElement("canvas");
      canvas.setAttribute(
        "aria-label",
        `小節${start + 1}から${start + systemMeasures.length}の楽譜`,
      );
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = 1080 * ratio;
      canvas.height = 270 * ratio;
      const context = canvas.getContext("2d");
      context.scale(ratio, ratio);
      drawScoreSystem(
        context,
        systemMeasures,
        start,
        tempo,
        Array.isArray(tuning) ? tuning : [64, 59, 55, 50, 45, 40],
      );
      wrapper.append(canvas);
      pages.append(wrapper);
    }
    preview.hidden = false;
  }

  function drawScoreSystem(context, measures, measureOffset, tempo, tuning) {
    const pageWidth = 1080;
    const leftMargin = 72;
    const measureWidth = 245;
    const scoreRight = leftMargin + measureWidth * measures.length;
    const staffTop = 42;
    const staffGap = 9;
    const staffBottom = staffTop + staffGap * 4;
    const tabTop = 146;
    const tabGap = 11;
    const tabBottom = tabTop + tabGap * 5;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, pageWidth, 270);
    context.fillStyle = "#1b1d19";
    context.strokeStyle = "#34362f";
    context.lineWidth = 1;
    context.font = "600 11px Arial, sans-serif";
    context.fillText(
      measureOffset === 0 ? `♩ = ${tempo}   Guitar` : "Guitar",
      24,
      20,
    );
    for (let line = 0; line < 5; line += 1) {
      drawLine(context, leftMargin, staffTop + line * staffGap, scoreRight, staffTop + line * staffGap);
    }
    for (let line = 0; line < 6; line += 1) {
      drawLine(context, leftMargin, tabTop + line * tabGap, scoreRight, tabTop + line * tabGap);
    }
    context.font = "42px Georgia, serif";
    context.fillText("𝄞", 26, staffBottom + 7);
    context.font = "700 15px Arial, sans-serif";
    context.fillText("TAB", 25, tabTop + tabGap * 3 + 4);
    if (measureOffset === 0) {
      context.font = "700 16px Georgia, serif";
      context.fillText("4", 57, staffTop + 14);
      context.fillText("4", 57, staffTop + 31);
    }
    measures.forEach((events, measureIndex) => {
      const measureLeft = leftMargin + measureIndex * measureWidth;
      const measureRight = measureLeft + measureWidth;
      context.lineWidth = measureIndex === 0 ? 1.4 : 1;
      drawLine(context, measureLeft, staffTop, measureLeft, staffBottom);
      drawLine(context, measureLeft, tabTop, measureLeft, tabBottom);
      drawLine(context, measureRight, staffTop, measureRight, staffBottom);
      drawLine(context, measureRight, tabTop, measureRight, tabBottom);
      context.fillStyle = "#77796f";
      context.font = "10px Arial, sans-serif";
      context.fillText(String(measureOffset + measureIndex + 1), measureLeft + 7, 34);
      let cursor = 0;
      events.forEach((event) => {
        const eventX =
          measureLeft + 22 + (cursor / 16) * (measureWidth - 44);
        if (!event.rest && event.notes.length) {
          drawStandardNotes(
            context,
            event.notes,
            eventX,
            event.duration,
            staffTop,
            staffGap,
            tuning,
          );
          drawTabNotes(context, event.notes, eventX, tabTop, tabGap);
        } else if (event.rest && event.duration >= 4) {
          context.fillStyle = "#1b1d19";
          context.fillRect(eventX - 5, staffTop + 17, 10, 4);
        }
        cursor += event.duration;
      });
    });
  }

  function drawStandardNotes(
    context,
    notes,
    x,
    duration,
    staffTop,
    staffGap,
    tuning,
  ) {
    const stepByPitchClass = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
    const accidentalPitchClasses = new Set([1, 3, 6, 8, 10]);
    const positions = notes.map((note) => {
      const writtenMidi = tuning[note.string - 1] + note.fret + 12;
      const pitchClass = writtenMidi % 12;
      const octave = Math.floor(writtenMidi / 12) - 1;
      const diatonic = octave * 7 + stepByPitchClass[pitchClass];
      const bottomLineDiatonic = 4 * 7 + 2;
      return {
        y: staffTop + staffGap * 4 - (diatonic - bottomLineDiatonic) * (staffGap / 2),
        sharp: accidentalPitchClasses.has(pitchClass),
      };
    });
    positions.forEach(({ y, sharp }) => {
      drawLedgerLines(context, x, y, staffTop, staffGap);
      if (sharp) {
        context.fillStyle = "#1b1d19";
        context.font = "13px Georgia, serif";
        context.fillText("♯", x - 14, y + 4);
      }
      context.save();
      context.translate(x, y);
      context.rotate(-0.28);
      context.beginPath();
      context.ellipse(0, 0, 6.5, 4.5, 0, 0, Math.PI * 2);
      context.fillStyle = "#1b1d19";
      context.fill();
      context.restore();
    });
    const averageY =
      positions.reduce((sum, position) => sum + position.y, 0) /
      positions.length;
    const stemUp = averageY > staffTop + staffGap * 2;
    const stemX = x + (stemUp ? 6 : -6);
    const noteY = stemUp
      ? Math.min(...positions.map((position) => position.y))
      : Math.max(...positions.map((position) => position.y));
    const stemEnd = noteY + (stemUp ? -28 : 28);
    drawLine(context, stemX, noteY, stemX, stemEnd);
    if (duration < 4) {
      context.beginPath();
      context.moveTo(stemX, stemEnd);
      context.quadraticCurveTo(
        stemX + (stemUp ? 10 : -10),
        stemEnd + (stemUp ? 7 : -7),
        stemX + (stemUp ? 7 : -7),
        stemEnd + (stemUp ? 15 : -15),
      );
      context.stroke();
    }
  }

  function drawLedgerLines(context, x, y, staffTop, staffGap) {
    const staffBottom = staffTop + staffGap * 4;
    if (y < staffTop - 1) {
      for (let lineY = staffTop - staffGap; lineY >= y - 1; lineY -= staffGap) {
        drawLine(context, x - 10, lineY, x + 10, lineY);
      }
    } else if (y > staffBottom + 1) {
      for (let lineY = staffBottom + staffGap; lineY <= y + 1; lineY += staffGap) {
        drawLine(context, x - 10, lineY, x + 10, lineY);
      }
    }
  }

  function drawTabNotes(context, notes, x, tabTop, tabGap) {
    notes.forEach((note) => {
      const y = tabTop + (note.string - 1) * tabGap;
      const text = String(note.fret);
      context.font = "700 12px Arial, sans-serif";
      const width = context.measureText(text).width + 6;
      context.fillStyle = "#fff";
      context.fillRect(x - width / 2, y - 7, width, 14);
      context.fillStyle = "#1b1d19";
      context.textAlign = "center";
      context.fillText(text, x, y + 4);
      context.textAlign = "start";
    });
  }

  function drawLine(context, x1, y1, x2, y2) {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
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
    renderScore(
      result.measures,
      result.tempo || Number($("#tempo").value),
      result.tuning,
    );
  }
  function clearResult() {
    $("#result").hidden = true;
    $("#score-preview").hidden = true;
    $("#score-pages").replaceChildren();
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
