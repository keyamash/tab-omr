"""Shared test fixtures."""

from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.api import routes
from app.core.job_store import JobStore
from app.main import app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    root = Path.cwd() / ".test-jobs"
    monkeypatch.setattr(routes, "job_store", JobStore(root, 3600))
    return TestClient(app)


@pytest.fixture
def score_image() -> bytes:
    canvas = np.full((500, 900, 3), 255, dtype=np.uint8)
    for y in (80, 92, 104, 116, 128):
        cv2.line(canvas, (40, y), (860, y), (0, 0, 0), 2)
    for y in (240, 258, 276, 294, 312, 330):
        cv2.line(canvas, (40, y), (860, y), (0, 0, 0), 2)
    for x in (40, 440, 860):
        cv2.line(canvas, (x, 235), (x, 335), (0, 0, 0), 2)
    cv2.putText(canvas, "3", (170, 283), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    cv2.putText(canvas, "0", (580, 265), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    ok, encoded = cv2.imencode(".png", canvas)
    assert ok
    return encoded.tobytes()
