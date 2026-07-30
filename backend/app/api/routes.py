"""Health, conversion, and download endpoints."""

from pathlib import Path
from io import BytesIO
import json

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError

from app.core.config import settings
from app.core.job_store import JobStore
from app.models.score import STANDARD_TUNING_MIDI
from app.schemas.responses import ConversionResponse
from app.services.image_preprocessor import ImageProcessingError
from app.services.musicxml_writer import MusicXMLWriter
from app.services.omr_pipeline import OMRPipeline
from app.services.score_builder import ScoreBuilder


router = APIRouter(prefix="/api")
job_store = JobStore(settings.temp_dir, settings.job_ttl_seconds)
pipeline = OMRPipeline(settings.max_pixels)
score_builder = ScoreBuilder()
xml_writer = MusicXMLWriter()

ALLOWED_TYPES = {
    "image/jpeg": {".jpg", ".jpeg"},
    "image/png": {".png"},
    "image/webp": {".webp"},
}


@router.get("/health")
def health() -> dict[str, str]:
    """Return a lightweight liveness response."""

    return {"status": "ok"}


@router.post("/convert", response_model=ConversionResponse)
async def convert(
    files: list[UploadFile] = File(...),
    tempo: int = Form(120),
    beats: int = Form(4),
    beat_type: int = Form(4),
    tuning: str = Form("[64,59,55,50,45,40]"),
) -> ConversionResponse:
    """Validate uploads, run recognition, and create a temporary MusicXML job."""

    if not files:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "画像を1枚以上選択してください")
    if len(files) > settings.max_files:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "画像は最大20枚です")
    if not 30 <= tempo <= 300:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "テンポは30〜300 BPMで指定してください")
    if beats != 4 or beat_type != 4:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "MVPでは4/4拍子のみ対応しています")
    parsed_tuning = _parse_tuning(tuning)

    contents: list[bytes] = []
    for upload in files:
        suffix = Path(upload.filename or "").suffix.lower()
        allowed_extensions = ALLOWED_TYPES.get(upload.content_type or "")
        if allowed_extensions is None or suffix not in allowed_extensions:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                "JPEG、PNG、WebPのみアップロードできます",
            )
        content = await upload.read(settings.max_file_bytes + 1)
        await upload.close()
        if len(content) > settings.max_file_bytes:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "1画像は10MB以下にしてください")
        if not content:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "空の画像ファイルです")
        try:
            with Image.open(BytesIO(content)) as probe:
                actual_format = (probe.format or "").upper()
        except (UnidentifiedImageError, OSError) as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "画像を読み込めませんでした") from exc
        expected_format = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/webp": "WEBP",
        }[upload.content_type or ""]
        if actual_format != expected_format:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "画像の内容とMIMEタイプが一致しません",
            )
        contents.append(content)

    try:
        recognized = pipeline.process(contents)
    except ImageProcessingError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:
        detail = f"解析中にエラーが発生しました: {exc}" if settings.debug else "画像を解析できませんでした"
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail) from exc

    score, timing_warnings = score_builder.build(
        recognized.measures,
        tempo=tempo,
        beats=beats,
        beat_type=beat_type,
        tuning=parsed_tuning,
    )
    warnings = [*recognized.warnings, *timing_warnings]
    content = xml_writer.write(score)
    stored = job_store.create(content)
    note_count = sum(
        len(event.notes)
        for measure in score.measures
        for event in measure.events
        if not event.is_rest
    )
    return ConversionResponse(
        job_id=stored.job_id,
        measure_count=len(score.measures),
        note_count=note_count,
        warning_count=len(warnings),
        warnings=warnings,
        download_url=f"/api/download/{stored.job_id}",
    )


@router.get("/download/{job_id}")
def download(job_id: str) -> FileResponse:
    """Download a live generated MusicXML job."""

    stored = job_store.get(job_id)
    if stored is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ファイルが見つからないか、保存期限が切れました")
    return FileResponse(
        stored.path,
        media_type="application/vnd.recordare.musicxml+xml",
        filename=stored.filename,
    )


def _parse_tuning(value: str) -> list[int]:
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "チューニングが不正です") from exc
    if parsed != STANDARD_TUNING_MIDI:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "MVPでは標準チューニング E A D G B E のみ対応しています",
        )
    return parsed
