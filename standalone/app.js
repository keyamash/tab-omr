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

  let techniqueWorkerPromise = null;

  async function getTechniqueWorker() {
    if (!globalThis.Tesseract) return null;
    if (!techniqueWorkerPromise) {
      techniqueWorkerPromise = globalThis.Tesseract
        .createWorker("eng")
        .then(async (worker) => {
          await worker.setParameters({
            tessedit_char_whitelist: "0123456789HhPpslSL.()-",
            tessedit_pageseg_mode: globalThis.Tesseract.PSM.SPARSE_TEXT,
          });
          return worker;
        })
        .catch(() => null);
    }
    return techniqueWorkerPromise;
  }

  async function recognizeTechniqueHints(canvas, tab) {
    const worker = await getTechniqueWorker();
    if (!worker) return [];
    convertButton.innerHTML =
      '<span class="spinner" aria-hidden="true"></span>奏法記号を確認しています…';
    try {
      const recognizeBand = async (
        top,
        bottom,
        whitelist,
        scale = 1,
        left = 0,
        right = canvas.width,
      ) => {
        const crop = document.createElement("canvas");
        crop.width = Math.max(1, Math.round((right - left) * scale));
        crop.height = Math.max(1, Math.round((bottom - top) * scale));
        const context = crop.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, crop.width, crop.height);
        context.drawImage(
          canvas,
          left,
          top,
          right - left,
          bottom - top,
          0,
          0,
          crop.width,
          crop.height,
        );
        await worker.setParameters({
          tessedit_char_whitelist: whitelist,
          tessedit_pageseg_mode: globalThis.Tesseract.PSM.SPARSE_TEXT,
        });
        const { data } = await worker.recognize(crop);
        return (data.words || []).map((word) => ({
          ...word,
          bbox: {
            ...word.bbox,
            x0: word.bbox.x0 / scale + left,
            x1: word.bbox.x1 / scale + left,
            y0: word.bbox.y0 / scale + top,
            y1: word.bbox.y1 / scale + top,
          },
        }));
      };
      const labelTop = Math.max(
        0,
        Math.round(tab.lines[0] - tab.spacing * 3.6),
      );
      const labelBottom = Math.min(
        canvas.height,
        Math.round(tab.lines[0] + tab.spacing * 0.45),
      );
      const numberTop = Math.max(
        0,
        Math.round(tab.lines[0] - tab.spacing * 0.65),
      );
      const numberBottom = Math.min(
        canvas.height,
        Math.round(tab.lines[5] + tab.spacing * 1.45),
      );
      const broadTop = Math.max(
        0,
        Math.round(tab.lines[0] - tab.spacing * 3.4),
      );
      const broadBottom = Math.min(
        canvas.height,
        Math.round(tab.lines[5] + tab.spacing * 3.4),
      );
      const labelWords = await recognizeBand(
        labelTop,
        labelBottom,
        "HhslSL.",
      );
      const targetedNumberWords = [];
      for (const word of labelWords) {
        if (!/^sl\.?$/i.test(String(word.text || "").replace(/\s+/g, ""))) {
          continue;
        }
        const labelX = (word.bbox.x0 + word.bbox.x1) / 2;
        targetedNumberWords.push(
          ...(await recognizeBand(
            Math.max(0, Math.round(tab.lines[2] - tab.spacing * 0.7)),
            Math.min(
              canvas.height,
              Math.round(tab.lines[2] + tab.spacing * 0.75),
            ),
            "0123456789",
            0.75,
            Math.max(0, Math.round(labelX - tab.spacing * 5.2)),
            Math.min(
              canvas.width,
              Math.round(labelX + tab.spacing * 5.2),
            ),
          )),
        );
      }
      const words = [
        ...labelWords,
        ...(await recognizeBand(
          numberTop,
          numberBottom,
          "0123456789()-",
        )),
        ...targetedNumberWords,
        ...(await recognizeBand(
          broadTop,
          broadBottom,
          "0123456789HhPpslSL.()-",
          0.58,
        )),
      ];
      const hints = [];
      for (const word of words) {
        const text = String(word.text || "").replace(/\s+/g, "");
        const x0 = word.bbox.x0;
        const x1 = word.bbox.x1;
        const y0 = word.bbox.y0;
        const y1 = word.bbox.y1;
        const x = (x0 + x1) / 2;
        const y = (y0 + y1) / 2;
        if (/^H$/i.test(text) && word.confidence >= 45) {
          hints.push({ type: "hammer", x, y, label: "H" });
          continue;
        }
        if (/^sl\.?$/i.test(text) && word.confidence >= 40) {
          hints.push({ type: "slide", x, y, label: "sl." });
          continue;
        }
        const sequence = text.match(/^\(?(\d{1,2})\)?-(\d{1,2})$/);
        if (sequence) {
          const first = Number(sequence[1]);
          const second = Number(sequence[2]);
          if (first <= 24 && second <= 24) {
            hints.push({
              type: "sequence",
              x,
              y,
              x0,
              x1,
              first,
              second,
            });
            hints.push({ type: "hammer", x, y, label: "H" });
          }
          continue;
        }
        const grace = text.match(/^\((\d{1,2})\)$/);
        if (grace && Number(grace[1]) <= 24) {
          hints.push({
            type: "grace",
            x,
            y,
            x0,
            x1,
            fret: Number(grace[1]),
          });
          continue;
        }
        if (
          /^\d{3,8}$/.test(text) &&
          x1 - x0 >= tab.spacing * 1.5
        ) {
          hints.push({
            type: "numberRun",
            x,
            y,
            x0,
            x1,
            digits: text,
          });
        }
      }
      return hints.filter(
        (hint, index) =>
          !hints.slice(0, index).some(
            (previous) =>
              previous.type === hint.type &&
              Math.abs(previous.x - hint.x) < tab.spacing * 0.65 &&
              Math.abs(previous.y - hint.y) < tab.spacing * 0.9,
          ),
      );
    } catch {
      return [];
    }
  }

  async function convertInBrowser(tempo, tuning) {
    const measures = [];
    const imageMeasureSets = [];
    const warnings = [];
    let techniqueCount = 0;
    let overlapCount = 0;
    for (let imageIndex = 0; imageIndex < state.images.length; imageIndex += 1) {
      const imageMeasures = [];
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
      for (const tab of tabs) {
        const hints = await recognizeTechniqueHints(canvas, tab);
        const bars = detectBars(binary, width, height, tab);
        const tabMeasures = [];
        for (let index = 0; index < bars.length - 1; index += 1) {
          if (bars[index + 1] - bars[index] < tab.spacing * 4) {
            continue;
          }
          let candidates = detectDigits(
            binary,
            width,
            height,
            tab,
            bars[index],
            bars[index + 1],
            index === 0,
            hints,
          );
          candidates = applyFretSequenceHints(
            candidates,
            hints,
            tab,
            bars[index],
            bars[index + 1],
          );
          if (candidates.length) {
            tabMeasures.push(
              fillMeasure(
                cluster(candidates, bars[index + 1] - bars[index]),
              ),
            );
          }
        }
        const techniqueResult = applyTechniqueHints(tabMeasures, hints, tab);
        techniqueResult.unmatched.forEach((label) => {
          warnings.push({
            image_index: imageIndex,
            measure_index: null,
            message: `${label}記号の接続先を確定できなかったため確認してください`,
          });
        });
        imageMeasures.push(...tabMeasures);
      }
      if (imageMeasures.length) {
        imageMeasureSets.push({ imageIndex, measures: imageMeasures });
      }
    }
    if (globalThis.TabOverlap) {
      const overlapResult =
        globalThis.TabOverlap.mergeMeasureSets(imageMeasureSets);
      measures.push(...overlapResult.measures);
      techniqueCount = overlapResult.techniqueCount;
      overlapCount = overlapResult.overlapCount;
      overlapResult.ambiguousImages.forEach((imageIndex) => {
        warnings.push({
          image_index: imageIndex,
          measure_index: null,
          message:
            "重複候補が複数あったため自動統合しませんでした。画像の順番と認識結果を確認してください",
        });
      });
    } else {
      imageMeasureSets.forEach((set) => measures.push(...set.measures));
      techniqueCount = imageMeasureSets.reduce(
        (sum, set) =>
          sum +
          set.measures.reduce(
            (measureSum, events) =>
              measureSum +
              events.reduce(
                (eventSum, event) =>
                  eventSum +
                  event.notes.reduce(
                    (noteSum, note) =>
                      noteSum +
                      (note.techniques?.hammerStart ? 1 : 0) +
                      (note.techniques?.slideStart ? 1 : 0),
                    0,
                  ),
                0,
              ),
            0,
          ),
        0,
      );
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
      technique_count: techniqueCount,
      overlap_count: overlapCount,
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
  function detectDigits(
    binary,
    width,
    height,
    tab,
    left,
    right,
    systemStart,
    hints,
  ) {
    const candidates = [];
    const lineMask = Math.max(1, Math.round(tab.spacing * 0.1));
    const halfBand = Math.max(4, Math.round(tab.spacing * 0.48));
    const contentLeft = left;
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
          const pointWidth = end - start + 1;
          const pointHeight = pointBottom - pointTop + 1;
          if (
            points.length < Math.max(5, tab.spacing * 0.45) ||
            pointHeight < tab.spacing * 0.42 ||
            pointWidth / Math.max(1, pointHeight) < 0.28
          ) {
            return;
          }
          const centerX = Math.round((start + end) / 2);
          const centerY = (pointTop + pointBottom) / 2;
          const nearHammer = hints.some(
            (hint) =>
              hint.type === "hammer" &&
              Math.abs(hint.x - centerX) <= tab.spacing * 2.1,
          );
          if (nearHammer && glyphWidth > tab.spacing * 1.35) {
            const split = recognizeSplit(points, start, end);
            if (split) {
              candidates.push(
                {
                  x: split.firstX,
                  string: stringIndex + 1,
                  fret: split.first,
                  score: split.score,
                },
                {
                  x: split.secondX,
                  string: stringIndex + 1,
                  fret: split.second,
                  score: split.score,
                },
              );
              return;
            }
          }
          const recognition = recognizeDetailed(points);
          if (recognition.score >= 0.42 && recognition.value !== null) {
            candidates.push({
              x: centerX,
              string: stringIndex + 1,
              fret: recognition.value,
              score: recognition.score,
            });
          }
        },
      );
    });
    let filtered = candidates.filter(
      (candidate, index) =>
        !candidates.slice(0, index).some((other) => {
          return (
            other.string === candidate.string &&
            Math.abs(other.x - candidate.x) < tab.spacing * 0.25
          );
        }),
    );
    if (systemStart) {
      const earlyLimit = left + tab.spacing * 3.2;
      const early = filtered
        .filter((candidate) => candidate.x <= earlyLimit)
        .sort((first, second) => first.x - second.x);
      const notationXs = new Set();
      for (let index = 0; index < early.length; index += 1) {
        const cluster = early.filter(
          (candidate) =>
            Math.abs(candidate.x - early[index].x) <= tab.spacing * 0.55,
        );
        if (new Set(cluster.map((candidate) => candidate.string)).size >= 2) {
          cluster.forEach((candidate) => notationXs.add(candidate));
        }
      }
      filtered = filtered.filter((candidate) => !notationXs.has(candidate));
    }
    return filtered;
  }

  function recognize(points) {
    const result = recognizeDetailed(points);
    return result.score >= 0.42 ? result.value : null;
  }

  function recognizeSplit(points, left, right) {
    let best = null;
    for (const fraction of [0.42, 0.48, 0.54, 0.6]) {
      const splitX = left + (right - left) * fraction;
      const firstPoints = points.filter(([x]) => x < splitX);
      const secondPoints = points.filter(([x]) => x >= splitX);
      if (firstPoints.length < 5 || secondPoints.length < 5) continue;
      const first = recognizeDetailed(firstPoints);
      const second = recognizeDetailed(secondPoints);
      const score = Math.min(first.score, second.score);
      if (
        first.value !== null &&
        second.value !== null &&
        first.value <= 24 &&
        second.value <= 24 &&
        score >= 0.42 &&
        (!best || score > best.score)
      ) {
        best = {
          first: first.value,
          second: second.value,
          firstX: Math.round((left + splitX) / 2),
          secondX: Math.round((splitX + right) / 2),
          score,
        };
      }
    }
    return best;
  }

  function recognizeDetailed(points) {
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
    return { value: best, score: bestScore };
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

  function applyFretSequenceHints(candidates, hints, tab, left, right) {
    const output = [...candidates];
    for (const hint of hints) {
      if (
        hint.type !== "sequence" ||
        hint.x < left ||
        hint.x >= right
      ) {
        continue;
      }
      const stringIndex = tab.lines.reduce(
        (best, line, index) =>
          Math.abs(line - hint.y) < Math.abs(tab.lines[best] - hint.y)
            ? index
            : best,
        0,
      );
      const string = stringIndex + 1;
      const padding = tab.spacing * 0.45;
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (
          output[index].x >= hint.x0 - padding &&
          output[index].x <= hint.x1 + padding &&
          (output[index].string === string ||
            (Math.abs(output[index].string - string) === 1 &&
              (output[index].score || 0) < 0.72))
        ) {
          output.splice(index, 1);
        }
      }
      const width = hint.x1 - hint.x0;
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (
          output[index].string !== string &&
          output[index].x >= hint.x0 - padding * 0.35 &&
          output[index].x <= hint.x1 + padding * 0.35 &&
          (output[index].score || 0) < 0.72
        ) {
          output.splice(index, 1);
        }
      }
      output.push(
        {
          x: Math.round(hint.x0 + width * 0.22),
          string,
          fret: hint.first,
          score: 1,
        },
        {
          x: Math.round(hint.x1 - width * 0.22),
          string,
          fret: hint.second,
          score: 1,
        },
      );
    }
    for (const hint of hints) {
      if (
        hint.type !== "numberRun" ||
        hint.x < left ||
        hint.x >= right ||
        !hints.some(
          (label) =>
            (label.type === "hammer" || label.type === "slide") &&
            Math.abs(label.x - hint.x) <= tab.spacing * 4.5,
        )
      ) {
        continue;
      }
      const stringIndex = tab.lines.reduce(
        (best, line, index) =>
          Math.abs(line - hint.y) < Math.abs(tab.lines[best] - hint.y)
            ? index
            : best,
        0,
      );
      const string = stringIndex + 1;
      const padding = tab.spacing * 0.55;
      const nearby = output
        .filter(
          (candidate) =>
            candidate.string === string &&
            candidate.x >= hint.x0 - padding &&
            candidate.x <= hint.x1 + padding,
        )
        .sort((first, second) => first.x - second.x);
      const consolidated = [];
      for (const candidate of nearby) {
        const previous = consolidated.at(-1);
        if (
          previous &&
          candidate.x - previous.x < tab.spacing * 0.85
        ) {
          if ((candidate.score || 0) > (previous.score || 0)) {
            consolidated[consolidated.length - 1] = candidate;
          }
        } else {
          consolidated.push(candidate);
        }
      }
      if (consolidated.length < 2) continue;
      const nearbyHammer = hints
        .filter((label) => label.type === "hammer")
        .sort(
          (first, second) =>
            Math.abs(first.x - hint.x) - Math.abs(second.x - hint.x),
        )[0];
      const values = partitionFretRun(
        hint.digits,
        consolidated.map((candidate) => candidate.fret),
        nearbyHammer &&
          Math.abs(nearbyHammer.x - hint.x) <= tab.spacing * 4.5
          ? (nearbyHammer.x - hint.x0) / Math.max(1, hint.x1 - hint.x0)
          : null,
      );
      if (!values) continue;
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (
          output[index].x >= hint.x0 - padding &&
          output[index].x <= hint.x1 + padding &&
          (output[index].string === string ||
            (Math.abs(output[index].string - string) === 1 &&
              (output[index].score || 0) < 0.72))
        ) {
          output.splice(index, 1);
        }
      }
      consolidated.slice(0, values.length).forEach((candidate, index) => {
        output.push({
          x: candidate.x,
          string,
          fret: values[index],
          score: 1,
        });
      });
    }
    for (const hint of hints) {
      if (
        hint.type !== "grace" ||
        hint.x < left ||
        hint.x >= right
      ) {
        continue;
      }
      const stringIndex = tab.lines.reduce(
        (best, line, index) =>
          Math.abs(line - hint.y) < Math.abs(tab.lines[best] - hint.y)
            ? index
            : best,
        0,
      );
      const string = stringIndex + 1;
      const padding = tab.spacing * 0.5;
      for (let index = output.length - 1; index >= 0; index -= 1) {
        if (
          output[index].string === string &&
          output[index].x >= hint.x0 - padding &&
          output[index].x <= hint.x1 + padding
        ) {
          output.splice(index, 1);
        }
      }
      output.push({
        x: Math.round(hint.x),
        string,
        fret: hint.fret,
        score: 1,
        grace: true,
      });
    }
    return output;
  }

  function partitionFretRun(digits, observed, hammerPosition = null) {
    const candidates = [];
    const walk = (offset, values) => {
      if (values.length > observed.length) return;
      if (offset === digits.length) {
        if (values.length >= 2) candidates.push(values);
        return;
      }
      for (const length of [1, 2]) {
        const token = digits.slice(offset, offset + length);
        if (
          token.length !== length ||
          (token.length > 1 && token.startsWith("0"))
        ) {
          continue;
        }
        const value = Number(token);
        if (value <= 24) walk(offset + length, [...values, value]);
      }
    };
    walk(0, []);
    if (!candidates.length) return null;
    candidates.sort((first, second) => {
      const score = (values) => {
        const observedScore = values.reduce((sum, value, index) => {
          const observedIndex = Math.round(
            (index / Math.max(1, values.length - 1)) *
              Math.max(0, observed.length - 1),
          );
          return (
            sum +
            Math.min(18, Math.abs(value - observed[observedIndex]))
          );
        }, 0);
        let techniquePenalty = 0;
        if (Number.isFinite(hammerPosition)) {
          let hammerIndex = 0;
          let closest = Infinity;
          for (let index = 0; index < values.length - 1; index += 1) {
            const midpoint = (index + 0.5) / (values.length - 1);
            const distance = Math.abs(midpoint - hammerPosition);
            if (distance < closest) {
              closest = distance;
              hammerIndex = index;
            }
          }
          if (values[hammerIndex + 1] <= values[hammerIndex]) {
            techniquePenalty += 32;
          }
        }
        return observedScore + values.length * 3 + techniquePenalty;
      };
      const firstScore = score(first);
      const secondScore = score(second);
      return firstScore - secondScore;
    });
    return candidates[0];
  }

  function applyTechniqueHints(measures, hints, tab) {
    const unmatched = [];
    let count = 0;
    const byString = new Map();
    measures.forEach((events) => {
      events.forEach((event) => {
        if (event.rest || !Number.isFinite(event.x)) return;
        event.notes.forEach((note) => {
          if (!byString.has(note.string)) byString.set(note.string, []);
          byString.get(note.string).push({ event, note, x: event.x });
        });
      });
    });
    byString.forEach((notes) => notes.sort((first, second) => first.x - second.x));
    const usedHammerPairs = new Set();
    for (const hint of hints.filter((item) => item.type === "hammer")) {
      const pairs = [];
      byString.forEach((notes, string) => {
        for (let index = 0; index < notes.length - 1; index += 1) {
          const first = notes[index];
          const second = notes[index + 1];
          const gap = second.x - first.x;
          if (
            gap <= 0 ||
            gap > tab.spacing * 4.5 ||
            second.note.fret <= first.note.fret
          ) {
            continue;
          }
          const midpoint = (first.x + second.x) / 2;
          const distance = Math.abs(midpoint - hint.x);
          if (distance <= tab.spacing * 3.2) {
            pairs.push({ first, second, string, distance, midpoint });
          }
        }
      });
      pairs.sort((first, second) => first.distance - second.distance);
      const pair = pairs[0];
      if (!pair) {
        unmatched.push("H");
        continue;
      }
      const key = `${pair.string}:${pair.first.x}:${pair.second.x}`;
      if (usedHammerPairs.has(key)) continue;
      usedHammerPairs.add(key);
      markTechnique(pair.first.note, "hammerStart");
      markTechnique(pair.second.note, "hammerStop");
      count += 1;
    }
    for (const hint of hints.filter((item) => item.type === "slide")) {
      const pairs = [];
      byString.forEach((notes, string) => {
        for (let index = 0; index < notes.length - 1; index += 1) {
          const first = notes[index];
          const second = notes[index + 1];
          const gap = second.x - first.x;
          if (
            gap <= 0 ||
            gap > tab.spacing * 5 ||
            second.note.fret >= first.note.fret
          ) {
            continue;
          }
          const midpoint = (first.x + second.x) / 2;
          const distance = Math.abs(midpoint - hint.x);
          if (distance <= tab.spacing * 2.7) {
            pairs.push({ first, second, string, distance, midpoint });
          }
        }
      });
      pairs.sort((first, second) => first.distance - second.distance);
      const selected = pairs.slice(0, 2);
      if (!selected.length) {
        unmatched.push("sl.");
        continue;
      }
      selected.forEach((pair) => {
        markTechnique(pair.first.note, "slideStart");
        markTechnique(pair.second.note, "slideStop");
        count += 1;
      });
    }
    return { count, unmatched: [...new Set(unmatched)] };
  }

  function markTechnique(note, name) {
    if (!note.techniques) note.techniques = {};
    note.techniques[name] = true;
  }

  function cluster(notes, width) {
    const clusters = [];
    const tolerance = Math.max(5, width / 100);
    notes.sort((a, b) => a.x - b.x).forEach((note) => {
      const cluster = clusters.at(-1);
      const center = cluster ? cluster.reduce((sum, item) => sum + item.x, 0) / cluster.length : -Infinity;
      const sameGraceKind =
        cluster &&
        Boolean(note.grace) === cluster.every((item) => Boolean(item.grace));
      if (
        cluster &&
        sameGraceKind &&
        Math.abs(note.x - center) <= tolerance
      ) {
        cluster.push(note);
      }
      else clusters.push([note]);
    });
    const regularCount = clusters.filter(
      (items) => !items.every((item) => item.grace),
    ).length;
    const target = 16 / Math.max(1, regularCount);
    const duration = [1, 2, 4].reduce((best, value) => Math.abs(value - target) < Math.abs(best - target) ? value : best);
    return clusters.map((items) => {
      const grace = items.every((item) => item.grace);
      return {
        x: Math.round(
          items.reduce((sum, item) => sum + item.x, 0) / items.length,
        ),
        duration: grace ? 0 : duration,
        grace,
        notes: [
          ...new Map(
            items.map((item) => [
              item.string,
              { string: item.string, fret: item.fret },
            ]),
          ).values(),
        ],
      };
    });
  }

  function fillMeasure(events) {
    const output = [];
    let cursor = 0;
    events.forEach((event) => {
      if (event.grace) {
        output.push(event);
        return;
      }
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
    const type = event.grace
      ? "eighth"
      : event.duration >= 4
        ? "quarter"
        : event.duration >= 2
          ? "eighth"
          : "16th";
    if (event.rest) return `<note><rest/><duration>${event.duration}</duration><voice>1</voice><type>${type}</type><staff>1</staff></note>`;
    const steps = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
    const alters = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    return event.notes.map((note, index) => {
      const midi = tuning[note.string - 1] + note.fret;
      const pc = midi % 12;
      const technique = note.techniques || {};
      const hammer = [
        technique.hammerStart
          ? '<hammer-on type="start" number="1">H</hammer-on>'
          : "",
        technique.hammerStop
          ? '<hammer-on type="stop" number="1"/>'
          : "",
      ].join("");
      const slide = [
        technique.slideStart
          ? '<slide type="start" number="1">sl.</slide>'
          : "",
        technique.slideStop ? '<slide type="stop" number="1"/>' : "",
      ].join("");
      const slur = [
        technique.hammerStart ? '<slur type="start" number="1"/>' : "",
        technique.hammerStop ? '<slur type="stop" number="1"/>' : "",
      ].join("");
      const grace = event.grace ? '<grace slash="yes"/>' : "";
      const duration = event.grace ? "" : `<duration>${event.duration}</duration>`;
      return `<note>${index ? "<chord/>" : ""}${grace}<pitch><step>${steps[pc]}</step>${alters[pc] ? `<alter>${alters[pc]}</alter>` : ""}<octave>${Math.floor(midi / 12) - 1}</octave></pitch>${duration}<voice>1</voice><type>${type}</type><staff>1</staff><notations>${slide}${slur}<technical><string>${note.string}</string><fret>${note.fret}</fret>${hammer}</technical></notations></note>`;
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
      const openHammers = new Map();
      const openSlides = new Map();
      events.forEach((event) => {
        const eventX =
          measureLeft +
          22 +
          (cursor / 16) * (measureWidth - 44) -
          (event.grace ? 9 : 0);
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
          event.notes.forEach((note) => {
            const technique = note.techniques || {};
            const y = tabTop + (note.string - 1) * tabGap;
            if (technique.hammerStop && openHammers.has(note.string)) {
              drawTechniqueSpan(
                context,
                openHammers.get(note.string),
                eventX,
                y,
                "hammer",
              );
              openHammers.delete(note.string);
            }
            if (technique.hammerStart) {
              openHammers.set(note.string, eventX);
            }
            if (technique.slideStop && openSlides.has(note.string)) {
              drawTechniqueSpan(
                context,
                openSlides.get(note.string),
                eventX,
                y,
                "slide",
              );
              openSlides.delete(note.string);
            }
            if (technique.slideStart) {
              openSlides.set(note.string, eventX);
            }
          });
        } else if (event.rest && event.duration >= 4) {
          context.fillStyle = "#1b1d19";
          context.fillRect(eventX - 5, staffTop + 17, 10, 4);
        }
        cursor += event.duration;
      });
    });
  }

  function drawTechniqueSpan(context, startX, endX, y, type) {
    if (endX <= startX) return;
    context.save();
    context.strokeStyle = "#1b1d19";
    context.fillStyle = "#1b1d19";
    context.lineWidth = 1.2;
    context.font = "italic 9px Arial, sans-serif";
    context.textAlign = "center";
    if (type === "hammer") {
      context.beginPath();
      context.moveTo(startX + 4, y - 7);
      context.quadraticCurveTo(
        (startX + endX) / 2,
        y - 18,
        endX - 4,
        y - 7,
      );
      context.stroke();
      context.fillText("H", (startX + endX) / 2, y - 13);
    } else {
      context.beginPath();
      context.moveTo(startX + 5, y - 7);
      context.lineTo(endX - 5, y - 2);
      context.stroke();
      context.fillText("sl.", (startX + endX) / 2, y - 10);
    }
    context.restore();
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
    $("#technique-count").textContent = result.technique_count || 0;
    $("#warning-count").textContent = result.warning_count;
    $("#warning-metric").classList.toggle("has-warning", Boolean(result.warning_count));
    const overlapNote = $("#overlap-note");
    const overlapCount = Number(result.overlap_count || 0);
    overlapNote.textContent = `重複する画像${overlapCount}箇所を自動統合しました`;
    overlapNote.hidden = overlapCount === 0;
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
