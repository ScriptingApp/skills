import { Script } from "scripting"

type Container = "auto" | "mp4" | "mkv" | "original"
type Quality = "best" | "1080p" | "720p" | "audio"
type Kind = "progressive" | "adaptive" | "audio_only"
type Probe = { streamTypes: string[] }
type AcquiredItem = {
  manifestVersion: 2; state: "acquired"; sourceUrl: string; jobId: string; jobDir: string; rawDir: string; resultDir: string; title: string; kind: Kind
  inputs: { mediaPath?: string; videoPath?: string; audioPath?: string }
}
type Failure = { url: string; stage: "acquire" | "mux" | "verify" | "cleanup"; code: string; message: string }

const pathJoin = (...parts: string[]) => parts.join("/").replace(/\/+/g, "/")
const trimSlash = (value: string) => value.replace(/\/+$/, "") || "/"
const canonicalPath = (value: string) => { const normalized = trimSlash(value); return normalized === "/var" || normalized.startsWith("/var/") ? `/private${normalized}` : normalized }
const safeMessage = (value: string) => value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

function invalid(message: string): never { Script.exit({ ok: false, partial: false, items: [], failures: [], error: message }); throw new Error(message) }
function lastJson(output: string): unknown {
  for (const line of output.trim().split("\n").reverse()) {
    const candidate = line.trim()
    if (!candidate.startsWith("{")) continue
    try { return JSON.parse(candidate) } catch { /* keep scanning past tool noise */ }
  }
  throw new Error("Python acquire worker produced no JSON result")
}
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function stringField(object: Record<string, unknown>, key: string): string { if (typeof object[key] !== "string" || !object[key]) throw new Error(`Invalid acquired manifest field: ${key}`); return object[key] as string }

function normalizeInput(value: unknown): { urls: string[]; outputDir: string; quality: Quality; container: Container; allowFallback: boolean; keepRawFiles: boolean } {
  if (!isObject(value) || !Array.isArray(value.urls) || value.urls.length === 0 || value.urls.length > 10 || !value.urls.every(url => typeof url === "string")) invalid("urls must be an array with 1-10 entries")
  if (typeof value.outputDir !== "string" || !value.outputDir.startsWith("/") || value.outputDir.includes("\0") || value.outputDir.split("/").includes("..")) invalid("outputDir must be an absolute path without traversal")
  const quality = value.quality ?? "best"; const container = value.container ?? "auto"
  if (!["best", "1080p", "720p", "audio"].includes(String(quality))) invalid("Invalid quality")
  if (!["auto", "mp4", "mkv", "original"].includes(String(container))) invalid("Invalid container")
  if (value.allowFallback !== undefined && typeof value.allowFallback !== "boolean") invalid("allowFallback must be boolean")
  if (value.keepRawFiles !== undefined && typeof value.keepRawFiles !== "boolean") invalid("keepRawFiles must be boolean")
  return { urls: value.urls as string[], outputDir: canonicalPath(value.outputDir), quality: quality as Quality, container: container as Container, allowFallback: value.allowFallback ?? true, keepRawFiles: value.keepRawFiles ?? false }
}

function acquiredItem(value: unknown, root: string): AcquiredItem {
  if (!isObject(value) || value.manifestVersion !== 2 || value.state !== "acquired") throw new Error("Unsupported acquired manifest")
  const kind = stringField(value, "kind") as Kind; if (!["progressive", "adaptive", "audio_only"].includes(kind)) throw new Error("Invalid acquired kind")
  const jobId = stringField(value, "jobId"); if (!/^[a-f0-9]{32}$/.test(jobId)) throw new Error("Invalid job id")
  const jobDir = stringField(value, "jobDir"), rawDir = stringField(value, "rawDir"), resultDir = stringField(value, "resultDir")
  if (jobDir !== pathJoin(root, jobId) || rawDir !== pathJoin(jobDir, "raw") || resultDir !== pathJoin(jobDir, "result")) throw new Error("Acquired manifest path boundary mismatch")
  if (!isObject(value.inputs)) throw new Error("Invalid acquired inputs")
  const inputs = value.inputs
  const mediaPath = typeof inputs.mediaPath === "string" ? inputs.mediaPath : undefined
  const videoPath = typeof inputs.videoPath === "string" ? inputs.videoPath : undefined
  const audioPath = typeof inputs.audioPath === "string" ? inputs.audioPath : undefined
  if (kind === "progressive" && mediaPath !== pathJoin(rawDir, "input-media")) throw new Error("Invalid progressive input path")
  if (kind === "adaptive" && (videoPath !== pathJoin(rawDir, "input-video") || audioPath !== pathJoin(rawDir, "input-audio"))) throw new Error("Invalid adaptive input paths")
  if (kind === "audio_only" && audioPath !== pathJoin(rawDir, "input-audio")) throw new Error("Invalid audio input path")
  return { manifestVersion: 2, state: "acquired", sourceUrl: stringField(value, "sourceUrl"), jobId, jobDir, rawDir, resultDir, title: stringField(value, "title"), kind, inputs: { mediaPath, videoPath, audioPath } }
}

async function shell(command: string, timeout: number): Promise<string> {
  const result = await Shell.run(command, { timeout })
  if (result.timedOut) throw new Error("Media tool timed out")
  if (result.cancelled) throw new Error("Media tool was cancelled")
  if (result.exitCode !== 0) throw new Error(safeMessage(result.output) || `Media tool failed with exit ${result.exitCode}`)
  return result.output
}
async function probe(file: string): Promise<Probe> {
  if (!await FileManager.isFile(file) || await FileManager.isLink(file)) throw new Error("Expected local regular media file is missing")
  const output = await shell(`ffprobe -show_entries stream=codec_type -of csv=p=0 ${shellQuote(file)}`, 60)
  const streamTypes = output.split("\n").map(line => line.trim()).filter(line => line === "video" || line === "audio")
  if (streamTypes.length === 0) throw new Error("Media probe returned no recognizable streams")
  return { streamTypes }
}
function counts(probeResult: Probe) { return { video: probeResult.streamTypes.filter(type => type === "video").length, audio: probeResult.streamTypes.filter(type => type === "audio").length } }
async function inputContainer(file: string): Promise<"mp4" | "mkv" | "original"> {
  const output = await shell(`ffprobe -show_entries format=format_name -of default=nw=1:nk=1 ${shellQuote(file)}`, 60)
  const format = output.split("\n").map(line => line.trim()).find(line => /^(mov|mp4|m4a|3gp|3g2|mj2|matroska|webm)(,|$)/.test(line)) ?? ""
  return /(^|,)matroska|(^|,)webm/.test(format) ? "mkv" : /(^|,)(mov|mp4|m4a|3gp|3g2|mj2)(,|$)/.test(format) ? "mp4" : "original"
}
function extension(_probeResult: Probe): "mp4" | "mkv" | "original" { return "original" }
async function verify(file: string, expected: "video" | "audio" | "av"): Promise<Probe> { const p = await probe(file); const c = counts(p); if ((expected === "video" && c.video < 1) || (expected === "audio" && c.audio < 1) || (expected === "av" && (c.video < 1 || c.audio < 1))) throw new Error("Final media does not contain expected streams"); return p }

async function clearIfExists(file: string) { if (await FileManager.exists(file)) await FileManager.remove(file) }
async function promote(source: string, result: string, rawDir: string, keepRaw: boolean) { await clearIfExists(result); await FileManager.rename(source, result); if (!keepRaw && await FileManager.exists(rawDir)) await FileManager.remove(rawDir) }
async function copyToStage(source: string, stage: string) { await clearIfExists(stage); await FileManager.copyFile(source, stage) }

async function finalize(item: AcquiredItem, policy: ReturnType<typeof normalizeInput>) {
  const failBase = { url: item.sourceUrl }
  try {
    const stageMp4 = pathJoin(item.resultDir, ".assembling.mp4"), stageMkv = pathJoin(item.resultDir, ".assembling.mkv")
    if (item.kind === "audio_only") {
      const source = item.inputs.audioPath!; await verify(source, "audio"); const final = pathJoin(item.resultDir, "audio")
      const stage = pathJoin(item.resultDir, ".assembling.audio"); await copyToStage(source, stage); await verify(stage, "audio"); await promote(stage, final, item.rawDir, policy.keepRawFiles)
      return { jobId: item.jobId, title: item.title, state: "completed", kind: "audio", container: "original", mediaPath: final, rawFilesRetained: policy.keepRawFiles, finalizationMethod: "preserved-original" }
    }
    if (item.kind === "progressive") {
      const source = item.inputs.mediaPath!; await verify(source, "av"); const sourceContainer = await inputContainer(source)
      if (policy.container === "mp4" && sourceContainer !== "mp4") {
        await shell(`ffmpeg -nostdin -hide_banner -loglevel error -n -i ${shellQuote(source)} -map 0:v:0 -map 0:a:0 -c:v h264_videotoolbox -b:v 8M -c:a aac -b:a 192k -movflags +faststart ${shellQuote(stageMp4)}`, 900)
        await verify(stageMp4, "av"); await promote(stageMp4, pathJoin(item.resultDir, "media.mp4"), item.rawDir, policy.keepRawFiles)
        return { jobId: item.jobId, title: item.title, state: "completed", kind: "video", container: "mp4", mediaPath: pathJoin(item.resultDir, "media.mp4"), rawFilesRetained: policy.keepRawFiles, finalizationMethod: "transcode-mp4" }
      }
      if (policy.container === "mkv" && sourceContainer !== "mkv") throw new Error("Requested MKV requires a separate remux operation not available for progressive input")
      const final = pathJoin(item.resultDir, sourceContainer === "mp4" ? "media.mp4" : sourceContainer === "mkv" ? "media.mkv" : "media")
      const stage = pathJoin(item.resultDir, ".assembling.media"); await copyToStage(source, stage); await verify(stage, "av"); await promote(stage, final, item.rawDir, policy.keepRawFiles)
      return { jobId: item.jobId, title: item.title, state: "completed", kind: "video", container: sourceContainer, mediaPath: final, rawFilesRetained: policy.keepRawFiles, finalizationMethod: "preserved-original" }
    }
    const video = item.inputs.videoPath!, audio = item.inputs.audioPath!; await verify(video, "video"); await verify(audio, "audio")
    const mux = async (stage: string, target: "mp4" | "mkv", transcode = false) => {
      await clearIfExists(stage)
      const codec = transcode ? "-c:v h264_videotoolbox -b:v 8M -c:a aac -b:a 192k" : "-c copy"
      const fastStart = target === "mp4" ? " -movflags +faststart" : ""
      await shell(`ffmpeg -nostdin -hide_banner -loglevel error -n -i ${shellQuote(video)} -i ${shellQuote(audio)} -map 0:v:0 -map 1:a:0 ${codec}${fastStart} ${shellQuote(stage)}`, 900)
      await verify(stage, "av")
    }
    if (policy.container === "original") return { jobId: item.jobId, title: item.title, state: "completed", kind: "tracks", container: "original", videoPath: video, audioPath: audio, rawFilesRetained: true, finalizationMethod: "preserved-tracks" }
    const attempt = async (target: "mp4" | "mkv", transcode = false) => { const stage = target === "mp4" ? stageMp4 : stageMkv; await mux(stage, target, transcode); const final = pathJoin(item.resultDir, `media.${target}`); await promote(stage, final, item.rawDir, policy.keepRawFiles); return { jobId: item.jobId, title: item.title, state: "completed", kind: "video", container: target, mediaPath: final, rawFilesRetained: policy.keepRawFiles, finalizationMethod: transcode ? "transcode-mp4" : `copy-${target}` } }
    if (policy.container === "mkv") return await attempt("mkv")
    if (policy.container === "mp4") { try { return await attempt("mp4") } catch { await clearIfExists(stageMp4); return await attempt("mp4", true) } }
    try { return await attempt("mp4") } catch (first) { await clearIfExists(stageMp4); if (!policy.allowFallback) throw first; return await attempt("mkv") }
  } catch (error) {
    try { await clearIfExists(pathJoin(item.resultDir, ".assembling.mp4")); await clearIfExists(pathJoin(item.resultDir, ".assembling.mkv")); await clearIfExists(pathJoin(item.resultDir, ".assembling.media")); await clearIfExists(pathJoin(item.resultDir, ".assembling.audio")) } catch { /* preserve primary error */ }
    const message = error instanceof Error ? error.message : String(error)
    return { failure: { ...failBase, stage: message.includes("expected") || message.includes("duration") ? "verify" : "mux", code: "FINALIZE_FAILED", message: safeMessage(message) } satisfies Failure }
  }
}

async function main() {
  const policy = normalizeInput(Script.queryParameters)
  const response = await Python.runFile(pathJoin(Script.directory, "scripts/acquire.py"), { queryParameters: { urls: policy.urls, outputDir: policy.outputDir, quality: policy.quality }, cwd: Script.directory })
  if (response.exitCode !== 0) { Script.exit({ ok: false, partial: false, items: [], failures: [], error: "Media acquisition worker failed", detail: safeMessage(response.output) }); return }
  try {
    const acquired = lastJson(response.output) as { items?: unknown[]; failures?: Failure[] }
    const items: unknown[] = []; const failures: Failure[] = Array.isArray(acquired.failures) ? acquired.failures : []
    for (const value of acquired.items ?? []) {
      try { const result = await finalize(acquiredItem(value, policy.outputDir), policy); if ("failure" in result && result.failure) failures.push(result.failure); else items.push(result) }
      catch (error) { failures.push({ url: "", stage: "verify", code: "INVALID_MANIFEST", message: safeMessage(error instanceof Error ? error.message : String(error)) }) }
    }
    Script.exit({ ok: items.length > 0, partial: items.length > 0 && failures.length > 0, items, failures, requestedContainer: policy.container, allowFallback: policy.allowFallback, keepRawFiles: policy.keepRawFiles })
  } catch (error) { Script.exit({ ok: false, partial: false, items: [], failures: [], error: "Invalid acquisition manifest", detail: safeMessage(error instanceof Error ? error.message : String(error)) }) }
}
void main()
