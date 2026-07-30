import type { DragEvent } from "react";
import type { SelectedImage } from "../types/conversion";

interface ImageQueueProps {
  images: SelectedImage[];
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}

export function ImageQueue({
  images,
  onMove,
  onRemove,
  disabled = false,
}: ImageQueueProps) {
  const drop = (event: DragEvent<HTMLElement>, to: number) => {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isInteger(from)) onMove(from, to);
  };

  if (!images.length) return null;

  return (
    <section className="queue-panel" aria-labelledby="queue-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">INPUT ORDER</span>
          <h2 id="queue-title">読み込み順</h2>
        </div>
        <span className="count-pill">{images.length} / 20 枚</span>
      </div>
      <p className="queue-help">画像をドラッグ、または矢印ボタンで順番を整えてください。</p>
      <div className="image-queue">
        {images.map((image, index) => (
          <article
            className="image-card"
            key={image.id}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => drop(event, index)}
          >
            <div className="order-number" aria-label={`${index + 1}番目`}>
              {String(index + 1).padStart(2, "0")}
            </div>
            <img src={image.previewUrl} alt={`${image.file.name} のプレビュー`} />
            <div className="image-meta">
              <strong title={image.file.name}>{image.file.name}</strong>
              <span>{(image.file.size / 1024 / 1024).toFixed(1)} MB</span>
            </div>
            <div className="image-actions">
              <button
                type="button"
                className="icon-button"
                aria-label={`${image.file.name} を上へ`}
                disabled={disabled || index === 0}
                onClick={() => onMove(index, index - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`${image.file.name} を下へ`}
                disabled={disabled || index === images.length - 1}
                onClick={() => onMove(index, index + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="icon-button remove-button"
                aria-label={`${image.file.name} を削除`}
                disabled={disabled}
                onClick={() => onRemove(index)}
              >
                ×
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

