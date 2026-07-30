import { useRef, useState } from "react";

interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

export function UploadZone({ onFiles, disabled = false }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => {
    if (!disabled) inputRef.current?.click();
  };

  return (
    <section
      className={`upload-zone ${dragging ? "is-dragging" : ""}`}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") choose();
      }}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) onFiles(Array.from(event.dataTransfer.files));
      }}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label="楽譜画像を選択"
      aria-disabled={disabled}
    >
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        multiple
        disabled={disabled}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.currentTarget.value = "";
        }}
      />
      <div className="upload-mark" aria-hidden="true">
        <span>＋</span>
      </div>
      <div>
        <h2>楽譜画像をここへ</h2>
        <p>ドラッグ＆ドロップ、またはクリックして選択</p>
      </div>
      <span className="file-hint">JPG / PNG / WebP · 1枚10MBまで · 最大20枚</span>
    </section>
  );
}

