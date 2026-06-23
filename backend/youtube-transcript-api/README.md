# YouTube transcript backend

Small FastAPI service for the Chrome extension. It fetches public YouTube
transcripts when the extension cannot read captions from the page.

Provider order:

1. `yt-dlp`
2. `youtube-transcript-api`
3. Structured failure, allowing the extension to fall back to metadata

## Setup

```powershell
cd backend\youtube-transcript-api
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Edit `.env`:

```env
TRANSCRIPT_API_KEY=change-me
CORS_ALLOW_ORIGIN=chrome-extension://your-extension-id
HTTP_PROXY=http://127.0.0.1:17890
HTTPS_PROXY=http://127.0.0.1:17890
REQUEST_TIMEOUT_SECONDS=20
MAX_TRANSCRIPT_CHARS=80000
YTDLP_ENABLED=true
YTDLP_PROXY=http://127.0.0.1:17890
YTDLP_TIMEOUT_SECONDS=45
YTDLP_PREFERRED_LANGS=zh-CN,zh-Hans,zh,en
```

Run:

```powershell
uvicorn app:app --host 127.0.0.1 --port 8787
```

## API

`POST /v1/youtube/transcript`

Headers:

```http
Authorization: Bearer <TRANSCRIPT_API_KEY>
Content-Type: application/json
```

Body:

```json
{
  "videoId": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "languages": ["zh-CN", "zh", "en"],
  "maxChars": 80000
}
```

The extension should send only `videoId`, `url`, `languages`, and
`maxChars`. Do not send notes, cookies, form fields, passwords, or LLM API
keys.

## Notes

`yt-dlp` is tried first because it can fetch manual subtitles and automatic
subtitles. It should try one language at a time; broad patterns such as
`en.*` or `--all-subs` can trigger YouTube rate limits.

The default language order prefers Chinese subtitles, then English. If only
English subtitles are available, the extension's LLM prompt still requires a
Simplified Chinese summary.

Both providers use YouTube internals and can be blocked by YouTube,
especially from cloud provider IPs. Configure `YTDLP_PROXY`, `HTTP_PROXY`,
and `HTTPS_PROXY` when needed. The service maps blocked or unavailable cases
to structured errors so the extension can fall back to title, description,
and chapters.
