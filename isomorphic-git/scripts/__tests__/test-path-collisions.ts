// @ts-nocheck
/**
 * Path collision regression tests.
 * Ensures workdir files whose names resemble git internals (config/HEAD/refs/*)
 * are committed from the workdir, not from the external gitdir.
 */

import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"
import { createFS } from "../fs-adapter"

const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
const TEST_PROJECT_DIR = FileManager.appGroupDocumentsDirectory + "/test-git-path-collisions"
const GITDIR = GIT_REPOS_DIR + "/test-path-collisions"

let testCount = 0
let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  testCount++
  if (condition) { passCount++; console.log(`  ✅ ${message}`) }
  else { failCount++; console.log(`  ❌ ${message}`) }
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

async function resetDirs() {
  if (await FileManager.exists(TEST_PROJECT_DIR)) await FileManager.remove(TEST_PROJECT_DIR)
  if (await FileManager.exists(GITDIR)) await FileManager.remove(GITDIR)
  await FileManager.createDirectory(TEST_PROJECT_DIR + "/refs", true)
  await FileManager.createDirectory(GITDIR, true)
}

async function readBlobText(git: any, fs: any, oid: string, filepath: string): Promise<string> {
  const blob = await git.readBlob({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, oid, filepath })
  return Buffer.from(blob.blob).toString('utf8')
}

async function runTests() {
  try {
    console.log("🚀 开始 path collision 回归测试\n")
    await loadBufferPolyfill()
    await resetDirs()
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/config", "WORKDIR_CONFIG_CONTENT\n", 'utf8')
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/HEAD", "WORKDIR_HEAD_CONTENT\n", 'utf8')
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/refs/file.txt", "WORKDIR_REFS_CONTENT\n", 'utf8')

    const git = await loadGit()
    const fs = createFS(GITDIR, TEST_PROJECT_DIR)
    await git.init({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'config', parallel: false })
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'HEAD', parallel: false })
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'refs/file.txt', parallel: false })
    const oid = await git.commit({
      fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR,
      message: 'path collision regression',
      author: { name: 'Test User', email: 'test@example.com' },
    })

    assert(await readBlobText(git, fs, oid, 'config') === "WORKDIR_CONFIG_CONTENT\n", "workdir config 内容被提交")
    assert(await readBlobText(git, fs, oid, 'HEAD') === "WORKDIR_HEAD_CONTENT\n", "workdir HEAD 内容被提交")
    assert(await readBlobText(git, fs, oid, 'refs/file.txt') === "WORKDIR_REFS_CONTENT\n", "workdir refs/file.txt 内容被提交")

    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) Script.exit("✅ path collision 回归测试通过")
    else Script.exit(`❌ ${failCount} 个测试失败`)
  } catch (error: any) {
    console.error("\n💥 测试出错:", error?.stack || error?.message || error)
    Script.exit(`💥 测试出错: ${error?.message || error}`)
  }
}

runTests()
