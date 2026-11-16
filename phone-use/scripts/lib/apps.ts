// 列已安装的 App（走 installation_proxy，不是 CoreDevice 的 appservice）。
//
// CoreDevice 的 `com.apple.coredevice.feature.listapps` 在这台设备上会挂着不回
// （参数齐全也不回），而 installation_proxy 这条老路 68 ms 就回 71 个 App。
//
// 请求格式（idevice installation_proxy.rs）：
//   Lookup {ClientOptions: {ApplicationType, BundleIDs?, ReturnAttributes}} → LookupResult
// 回包节点数有上限（单条最多 16384 个节点），所以先只取 bundle ID，再每 50 个一批取详情。

import { PlistService, type PlistXml } from "./plistservice"

export const INSTALLATION_PROXY_SERVICE = "com.apple.mobile.installation_proxy.shim.remote"

/** 只要这几项：不限定的话每个 App 会把整份 Info.plist 带回来，几十个 App 就是几 MB。 */
export const BASIC_ATTRIBUTES = [
  "CFBundleIdentifier",
  "CFBundleDisplayName",
  "CFBundleName",
  "CFBundleShortVersionString",
  "CFBundleVersion",
  "SignerIdentity",
  "ProfileValidated",
  "Entitlements",
]

const LIST_CHUNK = 50

export type AppSource = "appStore" | "testFlight" | "development" | "distribution" | "other"

export const SOURCE_LABEL: Record<AppSource, string> = {
  appStore: "App Store",
  testFlight: "TestFlight",
  development: "开发签",
  distribution: "企业/AdHoc",
  other: "其他",
}

export interface AppInfo {
  bundleId: string
  name: string
  version: string
  build: string
  source: AppSource
  signer: string
}

type Dict = Record<string, unknown>

function dict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {}
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

const APP_STORE_SIGNER = "Apple iPhone OS Application Signing"

/**
 * 安装来源。都是公开工具的通行判法，不是官方定义：
 * TestFlight 的 entitlements 带 beta-reports-active（它也是 Apple 重签，所以先判）；
 * App Store 由 Apple 重签，SignerIdentity 固定；带 get-task-allow 的是开发证书。
 */
export function classifyApp(raw: Dict): AppSource {
  const entitlements = dict(raw.Entitlements)
  if (entitlements["beta-reports-active"] === true) return "testFlight"
  if (str(raw.SignerIdentity) === APP_STORE_SIGNER) return "appStore"
  if (entitlements["get-task-allow"] === true) return "development"
  if (/Distribution/i.test(str(raw.SignerIdentity)) || raw.ProfileValidated !== undefined) return "distribution"
  return "other"
}

export function toAppInfo(bundleId: string, raw: Dict): AppInfo {
  return {
    bundleId: str(raw.CFBundleIdentifier) || bundleId,
    name: str(raw.CFBundleDisplayName) || str(raw.CFBundleName) || bundleId,
    version: str(raw.CFBundleShortVersionString),
    build: str(raw.CFBundleVersion),
    source: classifyApp(raw),
    signer: str(raw.SignerIdentity),
  }
}

function lookupResult(reply: Dict): Dict {
  const result = reply.LookupResult ?? reply.LookupResults
  return dict(result)
}

/** 只取 bundle ID：每个 App 才两三个节点，一定不撞上限。 */
async function listBundleIds(service: PlistService, applicationType: string): Promise<string[]> {
  const reply = await service.request({
    Command: "Lookup",
    ClientOptions: {
      ApplicationType: applicationType,
      ReturnAttributes: ["CFBundleIdentifier"],
    },
  })
  return Object.keys(lookupResult(reply))
}

export interface ListAppsOptions {
  /** User = 用户装的（默认）；System = 系统自带；Any = 全部。 */
  applicationType?: "User" | "System" | "Any"
  /** 过滤：名字或 bundle id 包含这个串（不区分大小写）。 */
  filter?: string
  /** 最多返回几个（过滤之后）。 */
  limit?: number
}

/** 应用列表（不含占用空间：那个要按 App 现算，慢得多）。 */
export async function listApps(service: PlistService, options: ListAppsOptions = {}): Promise<AppInfo[]> {
  const applicationType = options.applicationType ?? "User"
  const ids = await listBundleIds(service, applicationType)

  const merged: Dict = {}
  for (let offset = 0; offset < ids.length; offset += LIST_CHUNK) {
    const reply = await service.request({
      Command: "Lookup",
      ClientOptions: {
        ApplicationType: applicationType,
        BundleIDs: ids.slice(offset, offset + LIST_CHUNK),
        ReturnAttributes: BASIC_ATTRIBUTES,
      },
    })
    Object.assign(merged, lookupResult(reply))
  }

  let apps = ids.map(bundleId => toAppInfo(bundleId, dict(merged[bundleId])))
  const filter = options.filter?.trim().toLowerCase() ?? ""
  if (filter) {
    apps = apps.filter(
      app => app.name.toLowerCase().includes(filter) || app.bundleId.toLowerCase().includes(filter),
    )
  }
  apps.sort((a, b) => a.name.localeCompare(b.name))
  if (options.limit && options.limit > 0) apps = apps.slice(0, options.limit)
  return apps
}

/** 单个 App 的完整 Info.plist（不限定字段，所以有 URL scheme、最低系统这些）。 */
export async function appDetail(service: PlistService, bundleId: string): Promise<Dict> {
  const reply = await service.request({
    Command: "Lookup",
    ClientOptions: { BundleIDs: [bundleId] },
  })
  const detail = dict(lookupResult(reply)[bundleId])
  if (Object.keys(detail).length === 0) throw new Error(`设备没有返回 ${bundleId} 的信息`)
  return detail
}

export function appLine(app: AppInfo): string {
  const version = !app.version
    ? app.build || "—"
    : app.build && app.build !== app.version
      ? `${app.version}(${app.build})`
      : app.version
  return `${app.name}  ${version} · ${SOURCE_LABEL[app.source]} · ${app.bundleId}`
}

/** 「App 名 + bundle id」的紧凑表，给模型看最省 token。 */
export function appsTable(apps: AppInfo[]): string {
  return apps.map(app => appLine(app)).join("\n")
}

/** 这个 App 对外注册的 URL scheme（做跳转要用）。 */
export function urlSchemes(detail: Dict): string[] {
  const types = detail.CFBundleURLTypes
  if (!Array.isArray(types)) return []
  const out: string[] = []
  for (const entry of types) {
    const schemes = dict(entry).CFBundleURLSchemes
    if (!Array.isArray(schemes)) continue
    for (const scheme of schemes) if (typeof scheme === "string") out.push(scheme)
  }
  return Array.from(new Set(out))
}

export type { PlistXml }
