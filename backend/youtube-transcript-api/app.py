import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    AgeRestricted,
    CouldNotRetrieveTranscript,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)

load_dotenv()


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError:
        value = default
    return max(minimum, min(value, maximum))


API_KEY = os.getenv("TRANSCRIPT_API_KEY", "").strip()
CORS_ALLOW_ORIGIN = os.getenv("CORS_ALLOW_ORIGIN", "*").strip() or "*"
REQUEST_TIMEOUT_SECONDS = env_int("REQUEST_TIMEOUT_SECONDS", 20, 3, 60)
MAX_TRANSCRIPT_CHARS = env_int("MAX_TRANSCRIPT_CHARS", 80000, 1000, 200000)
YTDLP_ENABLED = os.getenv("YTDLP_ENABLED", "true").strip().lower() not in {"0", "false", "no", "off"}
YTDLP_PROXY = os.getenv("YTDLP_PROXY", "").strip()
YTDLP_TIMEOUT_SECONDS = env_int("YTDLP_TIMEOUT_SECONDS", 45, 5, 120)
YTDLP_PREFERRED_LANGS = [
    item.strip() for item in os.getenv("YTDLP_PREFERRED_LANGS", "zh-CN,zh-Hans,zh,en").split(",") if item.strip()
]

def configure_proxy_env() -> None:
    proxy_pairs = (
        ("HTTP_PROXY", "http_proxy"),
        ("HTTPS_PROXY", "https_proxy"),
    )
    values: dict[str, str] = {}
    for upper_name, lower_name in proxy_pairs:
        value = os.getenv(upper_name, "").strip() or os.getenv(lower_name, "").strip()
        if value:
            values[upper_name] = value

    if values.get("HTTP_PROXY") and not values.get("HTTPS_PROXY"):
        values["HTTPS_PROXY"] = values["HTTP_PROXY"]
    if values.get("HTTPS_PROXY") and not values.get("HTTP_PROXY"):
        values["HTTP_PROXY"] = values["HTTPS_PROXY"]

    for proxy_name, proxy_value in values.items():
        os.environ[proxy_name] = proxy_value


configure_proxy_env()


class TimeoutSession(requests.Session):
    def request(self, method: str, url: str, **kwargs: Any) -> requests.Response:
        kwargs.setdefault("timeout", (5, REQUEST_TIMEOUT_SECONDS))
        return super().request(method, url, **kwargs)


class TranscriptRequest(BaseModel):
    videoId: str = Field(..., min_length=6, max_length=32)
    url: str = Field("", max_length=300)
    languages: list[str] = Field(default_factory=lambda: ["zh-CN", "zh", "en"])
    maxChars: int = Field(default=MAX_TRANSCRIPT_CHARS, ge=1000, le=200000)

    @field_validator("languages")
    @classmethod
    def normalize_languages(cls, value: Iterable[str]) -> list[str]:
        result = []
        for item in value or []:
            language = str(item or "").strip()
            if language and language not in result:
                result.append(language)
        return result or ["zh-CN", "zh", "en"]


class TranscriptSegment(BaseModel):
    start: float
    duration: float
    text: str


class ProviderResult(BaseModel):
    provider: str
    ok: bool
    code: str = ""
    message: str = ""
    language: str = ""
    isGenerated: bool | None = None
    text: str = ""
    segments: list[TranscriptSegment] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


app = FastAPI(title="YouTube Transcript Backend", version="1.0.0")

allow_origins = ["*"] if CORS_ALLOW_ORIGIN == "*" else [
    item.strip() for item in CORS_ALLOW_ORIGIN.split(",") if item.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


def require_api_key(authorization: str = Header(default="")) -> None:
    if not API_KEY:
        raise HTTPException(status_code=500, detail="TRANSCRIPT_API_KEY is not configured")
    expected = f"Bearer {API_KEY}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid transcript API key")


def clean_text(value: str) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def to_raw_segments(transcript: Any) -> list[dict[str, Any]]:
    if hasattr(transcript, "to_raw_data"):
        return transcript.to_raw_data()
    return [
        {
            "text": getattr(snippet, "text", ""),
            "start": getattr(snippet, "start", 0.0),
            "duration": getattr(snippet, "duration", 0.0),
        }
        for snippet in transcript
    ]


def map_error(exc: Exception) -> tuple[int, str, str]:
    if isinstance(exc, RequestBlocked):
        return 502, "REQUEST_BLOCKED", "YouTube blocked transcript request from this IP"
    if isinstance(exc, IpBlocked):
        return 502, "IP_BLOCKED", "YouTube blocked the backend IP"
    if isinstance(exc, TranscriptsDisabled):
        return 404, "TRANSCRIPTS_DISABLED", "Transcripts are disabled for this video"
    if isinstance(exc, NoTranscriptFound):
        return 404, "NO_TRANSCRIPT_FOUND", "No transcript found for requested languages"
    if isinstance(exc, VideoUnavailable):
        return 404, "VIDEO_UNAVAILABLE", "Video is unavailable"
    if isinstance(exc, AgeRestricted):
        return 403, "AGE_RESTRICTED", "Video is age restricted"
    if isinstance(exc, CouldNotRetrieveTranscript):
        return 502, "UPSTREAM_ERROR", "Could not retrieve transcript from YouTube"
    return 500, "INTERNAL_ERROR", "Unexpected transcript backend error"


def build_watch_url(payload: TranscriptRequest) -> str:
    if payload.url:
        return payload.url
    return f"https://www.youtube.com/watch?v={payload.videoId}"


def expand_language_preferences(languages: Iterable[str]) -> list[str]:
    result: list[str] = []
    for language in [*YTDLP_PREFERRED_LANGS, *list(languages or [])]:
        value = str(language or "").strip()
        if not value:
            continue
        aliases = [value]
        if value in {"zh", "zh-CN", "zh_CN"}:
            aliases = ["zh-CN", "zh-Hans", "zh", "zh-Hans-en"]
        elif value in {"zh-TW", "zh-HK", "zh-Hant"}:
            aliases = ["zh-Hant", "zh-TW", "zh-Hant-en"]
        elif value.lower().startswith("en"):
            aliases = ["en"]
        for alias in aliases:
            if alias not in result:
                result.append(alias)
    return result or ["zh-CN", "zh-Hans", "zh", "en"]


def parse_timestamp(value: str) -> float:
    main = value.strip().replace(",", ".")
    parts = main.split(":")
    try:
        if len(parts) == 3:
            hours, minutes, seconds = parts
            return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
        if len(parts) == 2:
            minutes, seconds = parts
            return int(minutes) * 60 + float(seconds)
    except ValueError:
        return 0.0
    return 0.0


def parse_vtt_segments(content: str) -> list[TranscriptSegment]:
    segments: list[TranscriptSegment] = []
    lines = content.replace("\r", "\n").split("\n")
    index = 0

    while index < len(lines):
        line = lines[index].strip()
        if not line or line == "WEBVTT" or line.startswith(("Kind:", "Language:", "NOTE", "STYLE", "REGION")):
            index += 1
            continue

        if re.match(r"^\d+$", line):
            index += 1
            continue

        if "-->" not in line:
            index += 1
            continue

        start_raw, end_raw = line.split("-->", 1)
        start = parse_timestamp(start_raw)
        end = parse_timestamp(end_raw.split()[0])
        index += 1
        text_lines: list[str] = []

        while index < len(lines):
            text_line = lines[index].strip()
            if not text_line:
                break
            if "-->" in text_line:
                index -= 1
                break
            text_lines.append(text_line)
            index += 1

        text = clean_text(" ".join(text_lines))
        if text and (not segments or segments[-1].text != text):
            segments.append(TranscriptSegment(start=start, duration=max(0.0, end - start), text=text))
        index += 1

    return segments


def find_subtitle_files(directory: Path) -> list[Path]:
    suffixes = {".vtt", ".srt", ".ttml", ".srv1", ".srv2", ".srv3", ".json3"}
    return sorted(
        [item for item in directory.rglob("*") if item.is_file() and item.suffix.lower() in suffixes],
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )


def map_ytdlp_error(stderr: str, returncode: int) -> tuple[str, str]:
    output = stderr.strip()
    if "HTTP Error 429" in output or "Too Many Requests" in output:
        return "RATE_LIMITED", "yt-dlp was rate limited by YouTube"
    if "timed out" in output.lower() or returncode == -9:
        return "TIMEOUT", "yt-dlp transcript request timed out"
    if "No subtitles" in output or "There are no subtitles" in output:
        return "NO_TRANSCRIPT_FOUND", "yt-dlp found no subtitles for requested language"
    if "Sign in to confirm" in output or "confirm you" in output:
        return "REQUEST_BLOCKED", "YouTube requires verification for yt-dlp request"
    if "Unsupported URL" in output:
        return "UNSUPPORTED_URL", "yt-dlp does not support this URL"
    return "YTDLP_ERROR", output[-500:] or f"yt-dlp exited with {returncode}"


def run_ytdlp_once(payload: TranscriptRequest, language: str, automatic: bool) -> ProviderResult:
    tmpdir = Path(tempfile.mkdtemp(prefix="yt-transcript-"))
    mode_flag = "--write-auto-subs" if automatic else "--write-sub"
    provider_name = "yt-dlp-auto" if automatic else "yt-dlp"
    url = build_watch_url(payload)

    command = [
        sys.executable,
        "-m",
        "yt_dlp",
        "--socket-timeout",
        str(min(YTDLP_TIMEOUT_SECONDS, 60)),
        "--retries",
        "1",
        "--no-playlist",
        "--skip-download",
        mode_flag,
        "--sub-langs",
        language,
        "--sub-format",
        "vtt",
        "-o",
        str(tmpdir / "%(id)s.%(ext)s"),
        url,
    ]

    if YTDLP_PROXY:
        command[3:3] = ["--proxy", YTDLP_PROXY]

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=YTDLP_TIMEOUT_SECONDS,
            check=False,
            env={
                **os.environ,
                "PYTHONPATH": os.pathsep.join([item for item in sys.path if item]),
            },
        )
        files = find_subtitle_files(tmpdir)
        if files:
            content = files[0].read_text(encoding="utf-8", errors="replace")
            segments = parse_vtt_segments(content)
            text = clean_text("\n".join(segment.text for segment in segments))
            if text:
                return ProviderResult(
                    provider=provider_name,
                    ok=True,
                    language=language,
                    isGenerated=automatic,
                    text=text,
                    segments=segments,
                    warnings=["yt-dlp exited non-zero after writing a subtitle file."] if completed.returncode != 0 else [],
                )

        code, message = map_ytdlp_error(completed.stderr + "\n" + completed.stdout, completed.returncode)
        return ProviderResult(provider=provider_name, ok=False, code=code, message=f"{language}: {message}")
    except subprocess.TimeoutExpired:
        return ProviderResult(provider=provider_name, ok=False, code="TIMEOUT", message=f"{language}: yt-dlp timed out")
    except Exception as exc:
        return ProviderResult(provider=provider_name, ok=False, code="YTDLP_ERROR", message=f"{language}: {exc}")
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


def fetch_with_ytdlp(payload: TranscriptRequest) -> ProviderResult:
    if not YTDLP_ENABLED:
        return ProviderResult(provider="yt-dlp", ok=False, code="DISABLED", message="yt-dlp provider is disabled")

    languages = expand_language_preferences(payload.languages)
    errors: list[str] = []

    for automatic in (False, True):
        for language in languages:
            result = run_ytdlp_once(payload, language, automatic)
            if result.ok:
                return result
            errors.append(f"{result.provider}:{result.code}:{result.message}")

    return ProviderResult(
        provider="yt-dlp",
        ok=False,
        code="YTDLP_UNAVAILABLE",
        message="; ".join(errors[-6:]) or "yt-dlp did not return subtitles",
    )


def fetch_with_youtube_transcript_api(payload: TranscriptRequest) -> ProviderResult:
    api = YouTubeTranscriptApi(http_client=TimeoutSession())

    try:
        transcript = api.fetch(payload.videoId, languages=payload.languages)
        raw_segments = to_raw_segments(transcript)
    except Exception as exc:
        _status, code, message = map_error(exc)
        return ProviderResult(provider="youtube-transcript-api", ok=False, code=code, message=message)

    segments: list[TranscriptSegment] = []
    for item in raw_segments:
        text = clean_text(item.get("text", ""))
        if not text:
            continue
        segments.append(
            TranscriptSegment(
                start=float(item.get("start") or 0.0),
                duration=float(item.get("duration") or 0.0),
                text=text,
            )
        )

    full_text = clean_text("\n".join(segment.text for segment in segments))
    return ProviderResult(
        provider="youtube-transcript-api",
        ok=bool(full_text),
        code="" if full_text else "NO_TRANSCRIPT_FOUND",
        message="" if full_text else "youtube-transcript-api returned empty transcript",
        language=getattr(transcript, "language_code", ""),
        isGenerated=getattr(transcript, "is_generated", None),
        text=full_text,
        segments=segments,
    )


def serialize_attempt(result: ProviderResult) -> dict[str, Any]:
    return {
        "provider": result.provider,
        "ok": result.ok,
        "code": result.code,
        "message": result.message,
        "language": result.language,
        "isGenerated": result.isGenerated,
    }


def successful_response(payload: TranscriptRequest, result: ProviderResult, attempts: list[dict[str, Any]]) -> dict[str, Any]:
    full_text = clean_text(result.text)
    max_chars = min(payload.maxChars, MAX_TRANSCRIPT_CHARS)
    warnings = list(result.warnings)
    if len(full_text) > max_chars:
        full_text = full_text[:max_chars].rstrip()
        warnings.append("Transcript was truncated by maxChars.")

    return {
        "success": True,
        "videoId": payload.videoId,
        "provider": result.provider,
        "source": result.provider,
        "language": result.language,
        "isGenerated": result.isGenerated,
        "text": full_text,
        "segments": [segment.model_dump() for segment in result.segments],
        "warnings": warnings,
        "attempts": attempts,
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "source": "yt-dlp,youtube-transcript-api",
        "hasApiKey": bool(API_KEY),
        "proxyConfigured": bool(os.getenv("HTTP_PROXY") or os.getenv("HTTPS_PROXY")),
        "ytdlpEnabled": YTDLP_ENABLED,
        "ytdlpProxyConfigured": bool(YTDLP_PROXY),
    }


@app.post("/v1/youtube/transcript", dependencies=[Depends(require_api_key)])
def get_transcript(payload: TranscriptRequest) -> dict[str, Any]:
    attempts: list[dict[str, Any]] = []

    ytdlp_result = fetch_with_ytdlp(payload)
    attempts.append(serialize_attempt(ytdlp_result))
    if ytdlp_result.ok:
        return successful_response(payload, ytdlp_result, attempts)

    transcript_api_result = fetch_with_youtube_transcript_api(payload)
    attempts.append(serialize_attempt(transcript_api_result))
    if transcript_api_result.ok:
        return successful_response(payload, transcript_api_result, attempts)

    return JSONResponse(
        status_code=502,
        content={
            "success": False,
            "code": "TRANSCRIPT_UNAVAILABLE",
            "message": "All transcript providers failed",
            "attempts": attempts,
            "fallbackAllowed": True,
        },
    )
