// @ts-nocheck
/**
 * Working-tree diff guard regression tests.
 * Covers diff-utils guard behavior with production fs-adapter.
 */

import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"
import { createFS } from "../fs-adapter"
import { workingTreeDiffWithGuard } from "../diff-utils"

const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
const TEST_PROJECT_DIR = FileManager.appGroupDocumentsDirectory + "/test-git-diff-guard"
const REPO_NAME = "test-diff-guard"
const GITDIR = GIT_REPOS_DIR + "/" + REPO_NAME

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

async function resetProject() {
  if (await FileManager.exists(GITDIR)) await FileManager.remove(GITDIR)
  if (await FileManager.exists(TEST_PROJECT_DIR)) await FileManager.remove(TEST_PROJECT_DIR)
  await FileManager.createDirectory(GIT_REPOS_DIR, true)
  await FileManager.createDirectory(GITDIR, true)
  await FileManager.createDirectory(TEST_PROJECT_DIR, true)
}

async function createFiles(count: number) {
  await FileManager.createDirectory(TEST_PROJECT_DIR + "/src", true)
  for (let i = 0; i < count; i++) {
    await FileManager.writeAsString(TEST_PROJECT_DIR + `/src/file-${i}.txt`, `file ${i}\n`, 'utf8')
  }
}

async function runTests() {
  try {
    console.log("🚀 开始 diff guard 回归测试\n")
    await loadBufferPolyfill()
    await resetProject()
    await createFiles(8)

    const git = await loadGit()
    const fs = createFS(GITDIR, TEST_PROJECT_DIR)
    await git.init({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: '.', parallel: false })
    await git.commit({
      fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR,
      message: 'init',
      author: { name: 'Test User', email: 'test@example.com' },
    })

    await FileManager.writeAsString(TEST_PROJECT_DIR + "/src/file-0.txt", "changed 0\n", 'utf8')
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/src/file-1.txt", "changed 1\n", 'utf8')

    const truncated = await workingTreeDiffWithGuard({ git, fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, maxFiles: 1 })
    assert(truncated?.truncated === true, "diff maxFiles 触发 truncated")
    assert(typeof truncated?.warning === 'string' && truncated.warning.includes('maxFiles'), "diff truncated 返回 warning")

    let invalidMaxFilesRejected = false
    try {
      await workingTreeDiffWithGuard({ git, fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, maxFiles: -1 })
    } catch (e: any) {
      invalidMaxFilesRejected = String(e?.message || e).includes('Invalid maxFiles')
    }
    assert(invalidMaxFilesRejected, "diff 拒绝负数 maxFiles")

    const summary = await workingTreeDiffWithGuard({ git, fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, summaryOnly: true, maxFiles: 0 })
    assert(summary?.truncated === false, "diff summaryOnly 未截断")
    assert(summary?.changes === undefined, "summaryOnly 不返回完整 changes")
    assert(summary?.summary && Object.values(summary.summary).reduce((a: any, b: any) => a + b, 0) >= 2, "summaryOnly 返回状态计数")

    const full = await workingTreeDiffWithGuard({ git, fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, maxFiles: 0 })
    assert(full?.truncated === false, "diff maxFiles:0 未截断")
    assert(Array.isArray(full?.changes) && full.changes.length >= 2, "diff maxFiles:0 返回完整 changes")

    const subtree = await workingTreeDiffWithGuard({ git, fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'src', maxFiles: 0 })
    assert(subtree?.truncated === false, "目录 filepath 子树 diff 未截断")
    assert(Array.isArray(subtree?.changes) && subtree.changes.every((c: any) => c.filepath.startsWith('src/')), "目录 filepath 子树 diff 只返回子树路径")

    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) Script.exit("✅ diff guard 回归测试通过")
    else Script.exit(`❌ ${failCount} 个测试失败`)
  } catch (error: any) {
    console.error("\n💥 测试出错:", error?.stack || error?.message || error)
    Script.exit(`💥 测试出错: ${error?.message || error}`)
  }
}

runTests()
