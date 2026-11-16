// 截图瘦身：设备截图是 1179×2556 的 PNG，动辄 630 KB（曾出现过 3.3 MB 让 Scripting 卡死）。
// 模型看 UI 不需要原分辨率，缩到 ~900 宽再转 JPEG，体积能降到 1/3 左右。
//
// 缩放用 `UIImage.preparingThumbnail`，编码用 `toJPEGData`/`toPNGData`；
// 目标尺寸的计算抽成纯函数，方便离线单测。

export interface ShrinkOptions {
  /** 最大宽度（像素），0 表示不缩放。 */
  maxWidth?: number
  /** JPEG 质量 0..1。 */
  quality?: number
  format?: "jpeg" | "png"
}

export interface ShrinkResult {
  width: number
  height: number
  format: "jpeg" | "png"
  bytes?: number
}

/** 按最大宽度等比缩放后的目标尺寸；不放大。 */
export function computeThumbSize(
  width: number,
  height: number,
  maxWidth = 0,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  if (!maxWidth || maxWidth <= 0 || width <= maxWidth) {
    return { width: Math.round(width), height: Math.round(height) }
  }
  const scale = maxWidth / width
  return { width: Math.round(maxWidth), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * 读一个图片文件、缩放并重编码到目标路径。
 * 失败（解码不了 / 编码不了）返回 null，调用方自己回退到原图。
 */
export function shrinkImageFile(
  srcPath: string,
  destPath: string,
  options: ShrinkOptions = {},
): ShrinkResult | null {
  const format: "jpeg" | "png" = options.format === "png" ? "png" : "jpeg"
  const image = UIImage.fromFile(srcPath)
  if (!image) return null

  const target = computeThumbSize(image.width, image.height, options.maxWidth ?? 0)
  const scaled = target.width > 0 && target.width !== image.width
    ? (image.preparingThumbnail({ width: target.width, height: target.height }) ?? image)
    : image

  const data = format === "png" ? scaled.toPNGData() : scaled.toJPEGData(clampQuality(options.quality))
  if (!data) return null

  FileManager.writeAsDataSync(destPath, data)
  return { width: scaled.width, height: scaled.height, format, bytes: data.size }
}

function clampQuality(quality?: number): number {
  if (!Number.isFinite(quality)) return 0.7
  return Math.min(1, Math.max(0.1, Number(quality)))
}
