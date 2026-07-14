---
name: media-download
description: Download public audio or video that the user is authorized to save from supported web media pages, returning verified local files and an inline player.
runtime: node
entry: scripts/main.ts
metadata:
  display_name: "Media Download"
  intent_patterns: "download video, download audio, download YouTube video, download X video, save public media, 下载视频, 下载音频, 下载 YouTube 视频, 下载媒体"
  required_tools: "run_shell_command"
  input_schema_file: "schema.json"
---

# Purpose

Download public web media that the requester owns or is authorized to save. The skill does not accept or use authentication, DRM bypass, browser cookies, tokens, custom headers, proxies, arbitrary yt-dlp selectors, or arbitrary FFmpeg arguments.

# Input

Provide the schema-defined JSON object. `outputDir` must be an absolute directory inside the current workspace, normally `<workspace>/downloads/media`.

- `urls`: 1–10 public `http`/`https` media-page URLs.
- `quality`: `best` (default), `1080p`, `720p`, or `audio`.
- `container`: `auto` (default), `mp4`, `mkv`, or `original`.
- `allowFallback`: only for `auto`; permit a lossless MKV fallback if MP4 stream copy fails.
- `keepRawFiles`: retain acquired source files after final publication. Default false.

# Processing contract

1. Confirm the requester is authorized to save the public content. Reject private, login-gated, DRM-protected, or otherwise inaccessible media; never request credentials or bypass controls.
2. Run `scripts/main.ts` with the JSON input. It invokes Python/yt-dlp only for Acquire, then performs all Finalize and Verify work inside the Scripting runtime.
3. Every acquired job uses a new UUID directory with fixed local input names. Remote titles and URLs are never used as file paths or shell syntax.
4. `ffprobe` verifies each raw input before use. The skill invokes only fixed local FFmpeg/ffprobe templates and checks `exitCode`, `timedOut`, and `cancelled` after every command.
5. Adaptive audio/video handling:
   - `auto`: stream-copy MP4; if that fails and `allowFallback=true`, stream-copy MKV.
   - `mkv`: stream-copy MKV only.
   - `mp4`: stream-copy MP4 first; only on failure, transcode to H.264 VideoToolbox + AAC.
   - `original`: keep separately verified video and audio tracks; do not falsely label two tracks as a single original container.
6. FFmpeg only writes known staging paths in the job `result/` directory. Final output is accepted only after `ffprobe` confirms expected streams, then the staging file is renamed to its final path. Raw input is removed only after that successful publication when `keepRawFiles=false`.
7. The result contains only final verified paths. Preserve successful items if other URLs fail, and report failures by `acquire`, `mux`, or `verify` stage without returning full tool output.
8. Report each successful file using a direct Markdown link. For successful videos, also render:

````markdown
```scripting-file
{
  "path": "/var/mobile/Library/Mobile Documents/iCloud~com~thomfang~Scripting/Documents/scripting-skills/media-download/views/DownloadedVideoView.tsx",
  "props": {
    "videoPath": "/absolute/path/to/final-video.mp4",
    "title": "Media title"
  }
}
```
````

# Runtime notes

- Install the pinned acquisition dependency locally before first use: `pip3 install --target scripts/.deps -r requirements.txt`. The generated `scripts/.deps/` directory is intentionally ignored by Git.
- `Shell.run()` directly executes commands; it does not provide shell-builtin semantics. Use actual executables such as `ffprobe` and `ffmpeg`, not `true` or `command -v` probes.
- The embedded Python runtime is used for yt-dlp Acquire and is not responsible for launching FFmpeg.
- FFmpeg processing can consume battery, storage and time. The skill uses a finite per-command timeout and no arbitrary command parameters.
