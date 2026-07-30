"use client";

import { useEffect, useRef, useState } from "react";
import { ImageQueue } from "../frontend/src/components/ImageQueue";
import { ScoreSettings } from "../frontend/src/components/ScoreSettings";
import { UploadZone } from "../frontend/src/components/UploadZone";
import type { SelectedImage } from "../frontend/src/types/conversion";
import { analyzeInBrowser, type BrowserWarning } from "./browser-omr";

interface Result {
  measure_count: number;
  note_count: number;
  warning_count: number;
  warnings: BrowserWarning[];
  downloadUrl: string;
  filename: string;
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const REMOTE_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

export function TabOmrApp() {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [tempo, setTempo] = useState(120);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const imagesRef = useRef(images);
  const resultRef = useRef(result);
  imagesRef.current = images;
  resultRef.current = result;

  useEffect(
    () => () => {
      imagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl),
      );
      if (resultRef.current && !REMOTE_API_BASE) {
        URL.revokeObjectURL(resultRef.current.downloadUrl);
      }
    },
    [],
  );

  const clearResult = () => {
    if (result && !REMOTE_API_BASE) URL.revokeObjectURL(result.downloadUrl);
    setResult(null);
  };

  const addFiles = (files: File[]) => {
    setError("");
    clearResult();
    const invalid = files.find(
      (file) => !ALLOWED_TYPES.has(file.type) || file.size > MAX_BYTES,
    );
    if (invalid) {
      setError(
        `${invalid.name} は追加できません。JPG・PNG・WebP、10MB以下の画像を選択してください。`,
      );
      return;
    }
    if (images.length + files.length > 20) {
      setError("画像は最大20枚までです。");
      return;
    }
    setImages((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${crypto.randomUUID()}`,
        file,
        previewUrl: URL.createObjectURL(file),
      })),
    ]);
  };

  const moveImage = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    setImages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    clearResult();
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
    clearResult();
  };

  const convert = async () => {
    setError("");
    clearResult();
    if (!images.length) return;
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300) {
      setError("テンポは30〜300 BPMの整数で指定してください。");
      return;
    }
    setProcessing(true);
    try {
      if (REMOTE_API_BASE) {
        const body = new FormData();
        images.forEach((image) => body.append("files", image.file));
        body.append("tempo", String(tempo));
        body.append("beats", "4");
        body.append("beat_type", "4");
        body.append("tuning", "[64,59,55,50,45,40]");
        const response = await fetch(`${REMOTE_API_BASE}/api/convert`, {
          method: "POST",
          body,
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail ?? "変換に失敗しました");
        }
        setResult({
          ...payload,
          downloadUrl: `${REMOTE_API_BASE}${payload.download_url}`,
          filename: "tab-score.musicxml",
        });
      } else {
        const conversion = await analyzeInBrowser(
          images.map((image) => image.file),
          tempo,
        );
        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        setResult({
          ...conversion,
          downloadUrl: URL.createObjectURL(conversion.xml),
          filename: `tab-score-${timestamp}.musicxml`,
        });
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "変換に失敗しました",
      );
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Tablature Lens ホーム">
          <span className="brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            <b>Tablature</b>
            <b>Lens</b>
          </span>
        </a>
        <div className="mvp-badge">
          <span />
          {REMOTE_API_BASE ? "SERVER OCR" : "PRIVATE BROWSER OCR"}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="kicker">IMAGE TO MUSICXML</span>
            <h1>
              そのTAB譜を、
              <br />
              <em>演奏データ</em>へ。
            </h1>
            <p>
              五線譜＋TAB譜のスクリーンショットを解析し、TuxGuitarで開けるMusicXMLに変換します。
            </p>
            {!REMOTE_API_BASE && (
              <p className="privacy-callout">
                現在は端末内で処理する公開MVPです。画像はアップロードされません。
              </p>
            )}
          </div>
          <div className="hero-notation" aria-hidden="true">
            <div className="staff-lines">
              <span />
              <span />
              <span />
              <span />
              <span />
              <b className="note note-one">●</b>
              <b className="note note-two">●</b>
            </div>
            <div className="tab-lines">
              <span />
              <span />
              <span />
              <span />
              <span />
              <span />
              <b className="fret fret-one">3</b>
              <b className="fret fret-two">0</b>
              <b className="fret fret-three">2</b>
            </div>
          </div>
        </section>

        <div className="workflow-grid">
          <div className="primary-column">
            <UploadZone onFiles={addFiles} disabled={processing} />
            <ImageQueue
              images={images}
              onMove={moveImage}
              onRemove={removeImage}
              disabled={processing}
            />
          </div>
          <aside className="control-column">
            <ScoreSettings
              tempo={tempo}
              onTempoChange={setTempo}
              disabled={processing}
            />
            {error && (
              <div className="error-banner" role="alert">
                <span aria-hidden="true">!</span>
                <p>{error}</p>
              </div>
            )}
            <button
              type="button"
              className="convert-button"
              onClick={convert}
              disabled={processing || !images.length}
            >
              {processing ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  楽譜を解析しています…
                </>
              ) : (
                <>
                  MusicXMLに変換
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
            <div className="process-note">
              <span aria-hidden="true">◎</span>
              <p>
                {REMOTE_API_BASE
                  ? "サーバーのOpenCV認識を使用します。"
                  : "画像はこの端末内だけで処理されます。"}
              </p>
            </div>
            {result && (
              <section className="result-panel" aria-live="polite">
                <div className="result-heading">
                  <div className="success-mark">✓</div>
                  <div>
                    <span className="eyebrow">CONVERSION COMPLETE</span>
                    <h2>MusicXMLを生成しました</h2>
                  </div>
                </div>
                <div className="metrics">
                  <div>
                    <strong>{result.measure_count}</strong>
                    <span>小節</span>
                  </div>
                  <div>
                    <strong>{result.note_count}</strong>
                    <span>音符</span>
                  </div>
                  <div className={result.warning_count ? "has-warning" : ""}>
                    <strong>{result.warning_count}</strong>
                    <span>警告</span>
                  </div>
                </div>
                {result.warnings.length > 0 && (
                  <div className="warnings">
                    <h3>確認してほしい箇所</h3>
                    <ul>
                      {result.warnings.map((warning, index) => (
                        <li key={`${warning.image_index}-${index}`}>
                          <span>画像 {warning.image_index + 1}</span>
                          {warning.measure_index
                            ? `・小節 ${warning.measure_index}`
                            : ""}
                          <p>{warning.message}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <a
                  className="download-button"
                  href={result.downloadUrl}
                  download={result.filename}
                >
                  <span>↓</span>
                  MusicXMLをダウンロード
                </a>
                <p className="download-note">
                  TuxGuitarで開き、認識結果を確認・修正してください。
                </p>
              </section>
            )}
          </aside>
        </div>
      </main>
      <footer>
        <span>TABLATURE LENS · 2026</span>
        <p>Clear scores in. Editable music out.</p>
      </footer>
    </div>
  );
}

