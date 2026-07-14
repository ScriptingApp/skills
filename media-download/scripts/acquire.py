#!/usr/bin/env python3
"""Acquire public media tracks with yt-dlp; finalization is performed by main.ts."""
from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

SKILL_DIR = Path(__file__).resolve().parent.parent
LOCAL_DEPS = SKILL_DIR / "scripts" / ".deps"
if LOCAL_DEPS.is_dir():
    sys.path.insert(0, str(LOCAL_DEPS))

try:
    from yt_dlp import YoutubeDL
    from yt_dlp.utils import DownloadError
except ImportError:
    print(json.dumps({"ok": False, "error": "yt-dlp is unavailable; install it in scripts/.deps", "items": [], "failures": []}))
    raise SystemExit(2)

MAX_URLS = 10
QUALITY_HEIGHTS = {"best": None, "1080p": 1080, "720p": 720}


def fail(url: str, code: str, message: str) -> dict[str, str]:
    return {"url": url, "stage": "acquire", "code": code, "message": message[:500]}


def valid_url(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip(): return "URL must be a non-empty string"
    if any(ord(ch) < 32 for ch in value): return "URL contains control characters"
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname: return "Only absolute public HTTP(S) URLs are supported"
    if parsed.username or parsed.password: return "URLs with embedded credentials are not supported"
    return None


def choose(formats: list[dict[str, Any]], quality: str) -> dict[str, Any] | None:
    max_height = QUALITY_HEIGHTS.get(quality)
    def ok_height(f: dict[str, Any]) -> bool:
        height = f.get("height")
        return max_height is None or not isinstance(height, int) or height <= max_height
    progressive = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("acodec") not in (None, "none") and ok_height(f)]
    progressive.sort(key=lambda f: (f.get("ext") == "mp4", f.get("height") or 0, f.get("tbr") or 0), reverse=True)
    if progressive: return {"kind": "progressive", "media": progressive[0]}
    videos = [f for f in formats if f.get("vcodec") not in (None, "none") and f.get("acodec") in (None, "none") and ok_height(f)]
    audios = [f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]
    videos.sort(key=lambda f: (f.get("height") or 0, f.get("tbr") or 0), reverse=True)
    audios.sort(key=lambda f: (f.get("ext") in {"m4a", "aac"}, f.get("abr") or f.get("tbr") or 0), reverse=True)
    if videos and audios: return {"kind": "adaptive", "video": videos[0], "audio": audios[0]}
    if audios: return {"kind": "audio_only", "audio": audios[0]}
    return None


def downloaded_path(info: dict[str, Any], ydl: YoutubeDL) -> Path | None:
    paths = [Path(x["filepath"]) for x in info.get("requested_downloads") or [] if x.get("filepath")]
    if not paths: paths = [Path(ydl.prepare_filename(info))]
    return next((path.resolve() for path in paths if path.exists() and path.is_file()), None)


def download_selector(url: str, selector: str, target: Path) -> Path:
    opts = {"format": selector, "outtmpl": str(target), "noplaylist": True, "quiet": True, "noprogress": True, "no_warnings": True, "retries": 3, "fragment_retries": 3, "file_access_retries": 3}
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = downloaded_path(info, ydl)
    if not path: raise RuntimeError("yt-dlp finished without a local output file")
    return path


def fixed_input(downloaded: Path, raw_dir: Path, name: str) -> Path:
    downloaded = downloaded.resolve()
    if downloaded.parent != raw_dir.resolve(): raise RuntimeError("yt-dlp output escaped the generated raw directory")
    target = raw_dir / name
    if target.exists(): raise RuntimeError("generated input target already exists")
    downloaded.rename(target)
    return target


def write_manifest(job: Path, item: dict[str, Any]) -> None:
    temporary = job / "manifest.json.tmp"
    temporary.write_text(json.dumps(item, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(job / "manifest.json")


def run(payload: dict[str, Any]) -> dict[str, Any]:
    urls, output_dir, quality = payload.get("urls"), payload.get("outputDir"), payload.get("quality", "best")
    if not isinstance(urls, list) or not (1 <= len(urls) <= MAX_URLS): return {"ok": False, "items": [], "failures": [], "error": f"urls must contain 1-{MAX_URLS} entries"}
    if not isinstance(output_dir, str) or not Path(output_dir).is_absolute(): return {"ok": False, "items": [], "failures": [], "error": "outputDir must be an absolute workspace path"}
    if quality not in QUALITY_HEIGHTS and quality != "audio": return {"ok": False, "items": [], "failures": [], "error": "quality must be best, 1080p, 720p, or audio"}
    root = Path(output_dir).resolve(); root.mkdir(parents=True, exist_ok=True)
    items: list[dict[str, Any]] = []; failures: list[dict[str, str]] = []
    for raw in urls:
        url = raw.strip() if isinstance(raw, str) else str(raw)
        problem = valid_url(url)
        if problem: failures.append(fail(url, "INVALID_URL", problem)); continue
        job = root / uuid.uuid4().hex; raw_dir, result_dir = job / "raw", job / "result"
        raw_dir.mkdir(parents=True); result_dir.mkdir()
        try:
            with YoutubeDL({"skip_download": True, "noplaylist": True, "quiet": True, "no_warnings": True}) as ydl:
                info = ydl.extract_info(url, download=False)
            if info.get("_type") == "playlist": raise RuntimeError("Playlists are not supported in this MVP; provide an individual media URL")
            formats = info.get("formats") or []
            choice = choose(formats, quality) if quality != "audio" else None
            if quality == "audio":
                audios = [f for f in formats if f.get("acodec") not in (None, "none") and f.get("vcodec") in (None, "none")]
                audios.sort(key=lambda f: (f.get("abr") or f.get("tbr") or 0), reverse=True)
                choice = {"kind": "audio_only", "audio": audios[0]} if audios else None
            title = info.get("title") or info.get("id") or "media"
            base: dict[str, Any] = {"manifestVersion": 2, "state": "acquired", "sourceUrl": url, "jobId": job.name, "jobDir": str(job), "rawDir": str(raw_dir), "resultDir": str(result_dir), "title": title}
            if quality != "audio" and (not choice or choice["kind"] == "video_only"):
                path = fixed_input(download_selector(url, "best[ext=mp4]/best", raw_dir / "download.%(ext)s"), raw_dir, "input-media")
                item = {**base, "kind": "progressive", "inputs": {"mediaPath": str(path)}, "expectedStreams": {"video": 1, "audio": 1}}
            elif choice and choice["kind"] == "progressive":
                path = fixed_input(download_selector(url, str(choice["media"]["format_id"]), raw_dir / "download.%(ext)s"), raw_dir, "input-media")
                item = {**base, "kind": "progressive", "inputs": {"mediaPath": str(path)}, "expectedStreams": {"video": 1, "audio": 1}}
            elif not choice:
                raise RuntimeError("No compatible media format was found")
            elif choice["kind"] == "adaptive":
                video = fixed_input(download_selector(url, str(choice["video"]["format_id"]), raw_dir / "download-video.%(ext)s"), raw_dir, "input-video")
                audio = fixed_input(download_selector(url, str(choice["audio"]["format_id"]), raw_dir / "download-audio.%(ext)s"), raw_dir, "input-audio")
                item = {**base, "kind": "adaptive", "inputs": {"videoPath": str(video), "audioPath": str(audio)}, "expectedStreams": {"video": 1, "audio": 1}}
            else:
                audio = fixed_input(download_selector(url, str(choice["audio"]["format_id"]), raw_dir / "download-audio.%(ext)s"), raw_dir, "input-audio")
                item = {**base, "kind": "audio_only", "inputs": {"audioPath": str(audio)}, "expectedStreams": {"audio": 1}}
            write_manifest(job, item); items.append(item)
        except Exception as exc:
            failures.append(fail(url, "ACQUIRE_FAILED", str(exc).replace("ERROR: ", "")))
    return {"ok": bool(items), "partial": bool(items) and bool(failures), "items": items, "failures": failures}

if __name__ == "__main__":
    try:
        payload = json.loads(os.environ["SCRIPTING_QUERY_PARAMETERS"])
        if not isinstance(payload, dict): raise ValueError("input must be an object")
        print(json.dumps(run(payload), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "items": [], "failures": [], "error": str(exc)[:500]}, ensure_ascii=False)); raise SystemExit(2)
