# Tablature Lens

ギターの五線譜＋TAB譜が写った鮮明な画像を解析し、TuxGuitarで読み込める
MusicXML 4.0（partwise）へ変換するMVPです。画像認識とMusicXML生成は分離してあり、
数字認識器は将来ONNX・PyTorch・Tesseractへ差し替えられます。

## 現在対応しているもの

- 6弦ギター、標準チューニング E2–A2–D3–G3–B3–E4
- 五線譜とTAB譜を上下に併記した、傾きの少ない印刷譜
- JPG / PNG / WebP（1枚10MB、最大20枚、最大4,000万ピクセル）
- 4/4拍子、30〜300 BPM、単一パート
- フレット0〜24、単音、同じ横位置にある複数弦の和音
- 四分・八分・十六分音符の基本的な推定
- 四分・八分相当を含む不足拍の休符補完
- 複数画像の順序保持と、dHashによる重複可能性の警告

未対応: 手書き譜、PDF、変拍子、ドロップチューニング、連符、タイ、付点、
チョーキング、スライド、ハンマリング、プリング、ビブラート、ミュート、
ゴーストノート、複数パート、Web上での楽譜編集・音声再生。

## すぐに起動する

Docker Desktopを起動して、リポジトリ直下で実行します。

```bash
docker compose up --build
```

- UI: http://localhost:5173
- API: http://localhost:8000
- OpenAPI: http://localhost:8000/docs

フロントエンドとバックエンドのソースはボリュームでマウントされ、どちらも
ホットリロードします。

## Dockerを使わずに起動する

Python 3.12とNode.js 22以上を用意します。ターミナルを2つ開いてください。

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

## テスト

```bash
cd backend
pytest
```

```bash
cd frontend
npm test
npm run build
```

バックエンドテストにはhealth API、画像形式・画像なしの拒否、変換・ダウンロード、
単音、和音、休符、標準チューニング、well-formed XML、拍不足の補完を含みます。
フロントエンドテストには画像選択、複数表示、削除、並べ替え、API呼び出し、
エラー、ダウンロード表示を含みます。

## API

### `GET /api/health`

```json
{"status": "ok"}
```

### `POST /api/convert`

`multipart/form-data`:

- `files`: JPG / PNG / WebPを1〜20個
- `tempo`: 30〜300の整数
- `beats`: `4`
- `beat_type`: `4`
- `tuning`: `[64,59,55,50,45,40]`

返り値:

```json
{
  "job_id": "UUID",
  "measure_count": 12,
  "note_count": 146,
  "warning_count": 1,
  "warnings": [
    {
      "image_index": 0,
      "measure_index": 4,
      "message": "不足している拍を休符で補いました"
    }
  ],
  "download_url": "/api/download/UUID"
}
```

### `GET /api/download/{job_id}`

MusicXMLを添付ファイルとして返します。ファイル名は
`tab-score-YYYYMMDD-HHmmss.musicxml` です。既定では生成1時間後に失効します。

## 画像認識の流れ

1. Pillowで形式・ピクセル数を検査し、OpenCVで安全にデコード
2. グレースケール化、適応二値化、ノイズ除去、Hough線による傾き補正
3. 水平モルフォロジーと投影で5本の五線・6本のTAB線を検出
4. 垂直モルフォロジーで小節線を検出し、小節領域を分割
5. TAB線を一時的に除去し、連結成分から数字候補を切り出す
6. OpenCVで生成した0〜24の数字テンプレートと照合
7. 数字中心のY座標から弦、X座標の近接から和音を判定
8. イベント間隔を四分・八分・十六分へ量子化
9. `Score → Measure → NoteEvent → GuitarNote` の中間モデルへ変換
10. 拍不足を休符で補い、MusicXMLを生成後に再パースして構文検証

`FretNumberRecognizer` Protocolが認識器の境界です。現在の
`OpenCVTemplateFretRecognizer`を同じ`recognize(image)`シグネチャの
ONNX認識器へ置き換えられます。

## ディレクトリ構成

```text
frontend/
  src/
    components/       画像キュー、設定、結果UI
    services/         APIクライアント
    types/            TypeScript API型
  Dockerfile
  Dockerfile.prod
backend/
  app/
    api/              HTTPルート
    core/             設定、一時ジョブ
    models/           MusicXMLに依存しない中間Score
    schemas/          APIレスポンス
    services/         前処理、線・小節・TAB・音価認識、XML出力
  tests/
  Dockerfile
docker-compose.yml
```

## セキュリティと保存期間

MIMEタイプと拡張子の両方を検査します。アップロード画像は公開ディレクトリへ
保存せずメモリ内で処理します。MusicXMLだけを予測不能なUUIDディレクトリへ保存し、
取得時・次回変換時に期限切れを削除します。CORS、上限値、TTL、デバッグ出力は
環境変数で変更できます。本番では`APP_DEBUG=false`にしてください。

## 本番ビルド

フロントエンド:

```bash
docker build -f frontend/Dockerfile.prod -t tab-omr-web frontend
```

バックエンド:

```bash
docker build -t tab-omr-api backend
```

### Google Cloud Run

Artifact Registryへバックエンドイメージをpushし、Cloud Runへデプロイします。
Cloud Runが渡す`PORT`に自動対応します。`CORS_ORIGINS`にはFirebase Hostingの
本番オリジンを設定してください。一時ファイルはコンテナのエフェメラル領域なので、
複数インスタンス・長期保持が必要になったらCloud Storageへ`JobStore`を差し替えます。

### Firebase Hosting

`frontend/Dockerfile.prod`相当の`npm run build`で生成した`frontend/dist`をHostingへ
公開します。`VITE_API_BASE_URL`をCloud RunのHTTPS URLに設定する方法、または
`firebase.json`のHosting rewriteで`/api/**`をCloud Runサービスへ転送する方法が
使えます。後者なら同一オリジンになり、フロント側のAPI URLは空のままです。

## 認識精度の限界と次の改善

現在の数字テンプレートはフォント差、線との接触、低解像度に弱く、音価は五線譜の
符尾・連桁を完全には読まずイベント間隔も併用します。そのため出力は必ずTuxGuitarで
確認してください。認識不能でも処理全体を止めず、空小節・休符補完・警告を返します。

次の優先項目は、(1) 実譜面で学習したONNX数字分類器、(2) 符頭・符尾・連桁からの
音価認識、(3) 五線譜とTABの段対応の強化、(4) 小節単位の重複比較、
(5) Cloud Storageによるジョブ共有、(6) TuxGuitar実機での互換性回帰テストです。
