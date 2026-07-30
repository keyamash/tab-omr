"""API behavior and validation tests."""

from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}


def test_missing_images(client: TestClient) -> None:
    assert client.post("/api/convert", data={"tempo": 120}).status_code == 422


def test_invalid_image_type(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files=[("files", ("score.txt", b"not an image", "text/plain"))],
        data={"tempo": 120, "beats": 4, "beat_type": 4, "tuning": "[64,59,55,50,45,40]"},
    )
    assert response.status_code == 415


def test_invalid_image_content(client: TestClient) -> None:
    response = client.post(
        "/api/convert",
        files=[("files", ("score.png", b"not an image", "image/png"))],
        data={"tempo": 120, "beats": 4, "beat_type": 4, "tuning": "[64,59,55,50,45,40]"},
    )
    assert response.status_code == 400


def test_mime_must_match_image_content(client: TestClient, score_image: bytes) -> None:
    response = client.post(
        "/api/convert",
        files=[("files", ("score.jpg", score_image, "image/jpeg"))],
        data={"tempo": 120, "beats": 4, "beat_type": 4, "tuning": "[64,59,55,50,45,40]"},
    )
    assert response.status_code == 400


def test_convert_and_download(client: TestClient, score_image: bytes) -> None:
    response = client.post(
        "/api/convert",
        files=[("files", ("score.png", score_image, "image/png"))],
        data={"tempo": 120, "beats": 4, "beat_type": 4, "tuning": "[64,59,55,50,45,40]"},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["measure_count"] >= 1
    download = client.get(payload["download_url"])
    assert download.status_code == 200
    assert "attachment" in download.headers["content-disposition"]
    assert b"score-partwise" in download.content
