"""FastAPI application entrypoint."""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.core.config import settings


app = FastAPI(
    title="TAB OMR API",
    description="Convert clear printed guitar staff + TAB images to MusicXML 4.0.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
app.include_router(router)


@app.exception_handler(Exception)
async def unhandled_exception(_: Request, exc: Exception) -> JSONResponse:
    """Avoid leaking internals in production responses."""

    detail = str(exc) if settings.debug else "サーバー内部でエラーが発生しました"
    return JSONResponse(status_code=500, content={"detail": detail})

