import { useEffect, useRef, useState } from "react";
import { ConversionResult } from "./components/ConversionResult";
import { ImageQueue } from "./components/ImageQueue";
import { ScoreSettings } from "./components/ScoreSettings";
import { UploadZone } from "./components/UploadZone";
import { convertImages } from "./services/api";
import type {
  ConversionResult as ConversionResultType,
  SelectedImage,
} from "./types/conversion";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 20;

function makeId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`;
}

export default function App() {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [tempo, setTempo] = useState(120);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<ConversionResultType | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(
    () => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl)),
    [],
  );

  const addFiles = (files: File[]) => {
    setError("");
    setResult(null);
    const invalid = files.find(
      (file) => !ALLOWED_TYPES.has(file.type) || file.size > MAX_BYTES,
    );
    if (invalid) {
      setError(
        `${invalid.name} は追加できません。JPG・PNG・WebP、10MB以下の画像を選択してください。`,
      );
      return;
    }
    if (images.length + files.length > MAX_FILES) {
      setError("画像は最大20枚までです。");
      return;
    }
    const selected = files.map((file) => ({
      id: makeId(file),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setImages((current) => [...current, ...selected]);
  };

  const moveImage = (from: number, to: number) => {
    if (to < 0 || to >= images.length || from === to) return;
    setImages((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setResult(null);
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
    setResult(null);
  };

  const convert = async () => {
    setError("");
    setResult(null);
    if (!images.length) {
      setError("変換する楽譜画像を1枚以上選択してください。");
      return;
    }
    if (!Number.isInteger(tempo) || tempo < 30 || tempo > 300) {
      setError("テンポは30〜300 BPMの整数で指定してください。");
      return;
    }
    setProcessing(true);
    try {
      setResult(await convertImages(images.map((image) => image.file), tempo));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "変換に失敗しました。");
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
          MVP · STANDARD TAB
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
              disabled={processing || images.length === 0}
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
                画像は変換処理にのみ使用し、
                <br />
                一定時間後に自動削除されます。
              </p>
            </div>
            {result && <ConversionResult result={result} />}
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

