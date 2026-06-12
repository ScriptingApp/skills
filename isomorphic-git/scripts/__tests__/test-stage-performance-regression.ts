// @ts-nocheck
/**
 * Stage performance regression tests.
 *
 * Covers P0/P1 fixes:
 * 1. Production fs-adapter exposes stable POSIX-like fields to avoid NaN stat cache misses.
 * 2. git.ts command-level add uses parallel:false to avoid unbounded FileManager concurrency.
 * 3. Tests reuse the production fs-adapter and only add instrumentation via adapter hooks.
 */

import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"
import { createFS } from "../fs-adapter"

declare const Buffer: any

const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
const COMMANDS_TS_PATH = SKILL_DIR + "/scripts/commands.ts"
const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
const TEST_PROJECT_DIR = FileManager.appGroupDocumentsDirectory + "/test-git-stage-performance"
const TEST_REPO_NAME = "test-stage-performance"
const GITDIR = GIT_REPOS_DIR + "/" + TEST_REPO_NAME

let testCount = 0
let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  testCount++
  if (condition) {
    passCount++
    console.log(`  ✅ ${message}`)
  } else {
    failCount++
    console.log(`  ❌ ${message}`)
  }
}

function createInstrumentedFS(gitdir: string, workdir: string) {
  const counters = {
    workdirReadFile: 0,
    workdirReadPaths: [] as string[],
    statCalls: 0,
  }

  const fs: any = createFS(gitdir, workdir, {
    onReadFile(_filepath, resolvedPath) {
      if (resolvedPath.startsWith(workdir + '/') && !resolvedPath.endsWith('/.gitignore')) {
        counters.workdirReadFile++
        counters.workdirReadPaths.push(resolvedPath.substring(workdir.length + 1))
      }
    },
    onStat() {
      counters.statCalls++
    },
  })
  fs.counters = counters
  return fs
}

async function loadGit(): Promise<any> {
  const bundlePath = SKILL_DIR + "/vendor/index.umd.min.js"
  const bundleCode = await FileManager.readAsString(bundlePath, 'utf8')
  const wrappedCode = "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    bundleCode + "\n" +
    "return module.exports;\n" +
    "})()"
  const git = eval(wrappedCode)
  if (!git || typeof git.init !== 'function') throw new Error("加载 isomorphic-git 失败")
  return git
}

async function resetTestDirs() {
  if (await FileManager.exists(GITDIR)) await FileManager.remove(GITDIR)
  if (await FileManager.exists(TEST_PROJECT_DIR)) await FileManager.remove(TEST_PROJECT_DIR)
  await FileManager.createDirectory(GIT_REPOS_DIR, true)
  await FileManager.createDirectory(GITDIR, true)
  await FileManager.createDirectory(TEST_PROJECT_DIR, true)
}

async function createManyFiles(count: number) {
  await FileManager.createDirectory(TEST_PROJECT_DIR + "/src", true)
  for (let i = 0; i < count; i++) {
    const subdir = TEST_PROJECT_DIR + "/src/dir" + Math.floor(i / 10)
    if (!await FileManager.exists(subdir)) await FileManager.createDirectory(subdir, true)
    await FileManager.writeAsString(subdir + `/file-${i}.txt`, `file ${i}\n`, 'utf8')
  }
}

async function runTests() {
  try {
    console.log("🚀 开始 stage performance 回归测试\n")
    await loadBufferPolyfill()

    console.log("=== Static regression: production adapter + git.ts P0 patch ===")
    const gitTs = await FileManager.readAsString(SKILL_DIR + "/scripts/git.ts", 'utf8')
    const commandsTs = await FileManager.readAsString(COMMANDS_TS_PATH, 'utf8')
    const adapterTs = await FileManager.readAsString(SKILL_DIR + "/scripts/fs-adapter.ts", 'utf8')
    assert(gitTs.includes('import { createFS } from "./fs-adapter"'), "git.ts 使用共享 fs-adapter")
    assert(!gitTs.includes("function createFS(gitdir"), "git.ts 不再内联 createFS")
    assert(adapterTs.includes("dev: 0"), "fs-adapter stat 返回 dev")
    assert(adapterTs.includes("uid: 0"), "fs-adapter stat 返回 uid")
    assert(adapterTs.includes("gid: 0"), "fs-adapter stat 返回 gid")
    assert(/await\s+git\.add\(\{[^}]*fs,\s*dir,\s*gitdir,\s*filepath,\s*parallel:\s*false[^}]*\}\)/s.test(commandsTs), "commands.ts 主 add 路径调用 git.add(... parallel:false)")

    console.log("\n=== Functional regression: stat cache avoids full workdir reread ===")
    await resetTestDirs()
    await createManyFiles(40)
    const git = await loadGit()
    const fs = createInstrumentedFS(GITDIR, TEST_PROJECT_DIR)

    await git.init({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: '.', parallel: false })
    await git.commit({
      fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR,
      message: 'Initial many files',
      author: { name: 'Test User', email: 'test@example.com' },
    })

    fs.counters.workdirReadFile = 0
    fs.counters.workdirReadPaths = []
    const matrix = await git.statusMatrix({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    const changed = matrix.filter((row: any[]) => !(row[1] === 1 && row[2] === 1 && row[3] === 1))

    assert(changed.length === 0, `无修改 statusMatrix 无变更: ${changed.length}`)
    assert(fs.counters.workdirReadFile < 5, `无修改 statusMatrix 未全量读取工作区文件: read=${fs.counters.workdirReadFile}`)

    await new Promise(resolve => setTimeout(resolve, 1100))
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/src/dir0/file-0.txt", "FILE 0\n", 'utf8')
    fs.counters.workdirReadFile = 0
    fs.counters.workdirReadPaths = []
    const modifiedMatrix = await git.statusMatrix({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    const modifiedRows = modifiedMatrix.filter((row: any[]) => row[0] === 'src/dir0/file-0.txt')
    assert(modifiedRows.length === 1, "同 size 修改文件出现在 statusMatrix")
    assert(modifiedRows[0] && modifiedRows[0][1] === 1 && modifiedRows[0][2] !== modifiedRows[0][3], `同 size 修改被识别为 workdir/index 不一致: ${JSON.stringify(modifiedRows[0])}`)

    const sampleStat = await fs.stat(TEST_PROJECT_DIR + "/src/dir0/file-0.txt")
    assert(Number.isFinite(sampleStat.dev), "stat.dev finite")
    assert(Number.isFinite(sampleStat.ino), "stat.ino finite")
    assert(Number.isFinite(sampleStat.uid), "stat.uid finite")
    assert(Number.isFinite(sampleStat.gid), "stat.gid finite")
    assert(Number.isFinite(sampleStat.mtimeMs), "stat.mtimeMs finite")
    assert(Number.isFinite(sampleStat.ctimeMs), "stat.ctimeMs finite")

    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) {
      Script.exit("✅ stage performance 回归测试通过")
    } else {
      Script.exit(`❌ ${failCount} 个测试失败`)
    }
  } catch (error: any) {
    console.error("\n💥 测试出错:", error?.stack || error?.message || error)
    Script.exit(`💥 测试出错: ${error?.message || error}`)
  }
}

runTests()
