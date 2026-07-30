import { downloadUrl } from "../services/api";
import type { ConversionResult as Result } from "../types/conversion";

export function ConversionResult({ result }: { result: Result }) {
  return (
    <section className="result-panel" aria-live="polite" aria-labelledby="result-title">
      <div className="result-heading">
        <div className="success-mark" aria-hidden="true">
          ✓
        </div>
        <div>
          <span className="eyebrow">CONVERSION COMPLETE</span>
          <h2 id="result-title">MusicXMLを生成しました</h2>
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
              <li key={`${warning.image_index}-${warning.measure_index}-${index}`}>
                <span>画像 {warning.image_index + 1}</span>
                {warning.measure_index ? `・小節 ${warning.measure_index}` : ""}
                <p>{warning.message}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <a className="download-button" href={downloadUrl(result.download_url)}>
        <span aria-hidden="true">↓</span>
        MusicXMLをダウンロード
      </a>
      <p className="download-note">TuxGuitarで開き、認識結果を確認・修正してください。</p>
    </section>
  );
}

