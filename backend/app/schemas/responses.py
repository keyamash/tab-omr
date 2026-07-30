"""Pydantic response models."""

from pydantic import BaseModel


class ConversionWarning(BaseModel):
    """A recoverable recognition warning."""

    image_index: int
    measure_index: int | None = None
    message: str


class ConversionResponse(BaseModel):
    """Summary returned after conversion."""

    job_id: str
    measure_count: int
    note_count: int
    warning_count: int
    warnings: list[ConversionWarning]
    download_url: str

