interface ScoreSettingsProps {
  tempo: number;
  onTempoChange: (tempo: number) => void;
  disabled?: boolean;
}

export function ScoreSettings({
  tempo,
  onTempoChange,
  disabled = false,
}: ScoreSettingsProps) {
  return (
    <section className="settings-panel" aria-labelledby="settings-title">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">SCORE PROFILE</span>
          <h2 id="settings-title">楽譜設定</h2>
        </div>
        <span className="fixed-label">MVP固定</span>
      </div>
      <div className="setting-list">
        <div className="setting-row">
          <span>チューニング</span>
          <strong>E · A · D · G · B · E</strong>
        </div>
        <div className="setting-row">
          <span>拍子</span>
          <strong>4 / 4</strong>
        </div>
        <label className="setting-row tempo-row">
          <span>テンポ</span>
          <span className="tempo-control">
            <input
              aria-label="テンポ"
              type="number"
              min={30}
              max={300}
              value={tempo}
              disabled={disabled}
              onChange={(event) => onTempoChange(Number(event.target.value))}
            />
            <b>BPM</b>
          </span>
        </label>
      </div>
      <p className="setting-note">
        鮮明な印刷譜向け。チョーキング、スライド、連符、変拍子にはまだ対応していません。
      </p>
    </section>
  );
}

