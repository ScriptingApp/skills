// 截屏：com.apple.coredevice.screencaptureservice
// feature: com.apple.coredevice.feature.capturescreenshot
// action : com.apple.coredevice.action.capturescreenshot
// input  : { requestedFormat: "png" }；输出 { image: Data }

import { CoreDevice } from "./coredevice"

export async function captureScreenshot(tunnel: VPNRSDTunnel, servicePort: number): Promise<Uint8Array> {
  const device = await CoreDevice.open(tunnel, servicePort)
  try {
    const output = (await device.invoke(
      "com.apple.coredevice.feature.capturescreenshot",
      { displayUniqueID: null, requestedFormat: "png" } as any,
      "com.apple.coredevice.action.capturescreenshot",
    )) as Record<string, unknown> | undefined
    const image = output?.["image"]
    if (!(image instanceof Uint8Array)) throw new Error(`截图回复里没有 image：${JSON.stringify(Object.keys(output ?? {}))}`)
    return image
  } finally {
    await device.close()
  }
}
