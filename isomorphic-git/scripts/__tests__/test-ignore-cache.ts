// @ts-nocheck
/**
 * FS adapter ignore text cache regression tests.
 * Verifies `.gitignore` / `.git/info/exclude` utf8 reads are cached within one adapter lifecycle
 * and invalidated after writes.
 */

import { Script } from "scripting"
import { createFS } from "../fs-adapter"

const TEST_PROJECT_DIR = FileManager.appGroupDocumentsDirectory + "/test-git-ignore-cache"
const GITDIR = FileManager.appGroupDocumentsDirectory + "/git-repos/test-ignore-cache"

let testCount = 0
let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  testCount++
  if (condition) { passCount++; console.log(`  ✅ ${message}`) }
  else { failCount++; console.log(`  ❌ ${message}`) }
}

async function resetDirs() {
  if (await FileManager.exists(TEST_PROJECT_DIR)) await FileManager.remove(TEST_PROJECT_DIR)
  if (await FileManager.exists(GITDIR)) await FileManager.remove(GITDIR)
  await FileManager.createDirectory(TEST_PROJECT_DIR, true)
  await FileManager.createDirectory(GITDIR + "/info", true)
}

async function runTests() {
  try {
    console.log("🚀 开始 ignore cache 回归测试\n")
    await resetDirs()
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/.gitignore", "node_modules/\n", 'utf8')
    await FileManager.writeAsString(GITDIR + "/info/exclude", "*.tmp\n", 'utf8')
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/README.md", "hello\n", 'utf8')

    const counters = { physical: 0, cacheHit: 0 }
    const fs = createFS(GITDIR, TEST_PROJECT_DIR, {
      onPhysicalReadFile(_fp, resolved) {
        if (resolved.endsWith('/.gitignore') || resolved.endsWith('/info/exclude')) counters.physical++
      },
      onReadFileCacheHit(_fp, resolved) {
        if (resolved.endsWith('/.gitignore') || resolved.endsWith('/info/exclude')) counters.cacheHit++
      },
    })

    const a = await fs.readFile('.gitignore', 'utf8')
    const b = await fs.readFile('.gitignore', 'utf8')
    assert(a === b && a.includes('node_modules'), ".gitignore 内容读取正确")
    assert(counters.physical === 1, `.gitignore 第二次读取命中缓存，physical=${counters.physical}`)
    assert(counters.cacheHit === 1, `.gitignore cacheHit=${counters.cacheHit}`)

    const exclude1 = await fs.readFile('info/exclude', 'utf8')
    const exclude2 = await fs.readFile('info/exclude', 'utf8')
    assert(exclude1 === exclude2 && exclude1.includes('*.tmp'), "info/exclude 内容读取正确")
    assert(counters.physical === 2, `info/exclude 第二次读取命中缓存，总 physical=${counters.physical}`)
    assert(counters.cacheHit === 2, `总 cacheHit=${counters.cacheHit}`)

    await fs.writeFile('.gitignore', "dist/\n", 'utf8')
    const updated = await fs.readFile('.gitignore', 'utf8')
    assert(updated.includes('dist/'), "writeFile 后缓存失效并读到新 .gitignore 内容")
    assert(counters.physical === 3, `writeFile 失效后重新物理读取，physical=${counters.physical}`)

    await FileManager.createDirectory(TEST_PROJECT_DIR + "/src", true)
    await fs.writeFile('src/.gitignore', "cache/\n", 'utf8')
    const nested1 = await fs.readFile('src/.gitignore', 'utf8')
    const nested2 = await fs.readFile('src/.gitignore', 'utf8')
    assert(nested1 === nested2 && nested1.includes('cache/'), "嵌套 .gitignore 内容读取正确")
    assert(counters.physical === 4, `嵌套 .gitignore 第二次读取命中缓存，physical=${counters.physical}`)
    assert(counters.cacheHit === 3, `嵌套 .gitignore cacheHit 后总 cacheHit=${counters.cacheHit}`)

    await fs.unlink('src/.gitignore')
    let unlinkInvalidated = false
    try {
      await fs.readFile('src/.gitignore', 'utf8')
    } catch (_e) {
      unlinkInvalidated = true
    }
    assert(unlinkInvalidated, "unlink 后不会返回旧的嵌套 .gitignore 缓存")

    await fs.writeFile('.gitignore', "build/\n", 'utf8')
    await fs.readFile('.gitignore', 'utf8')
    await fs.rename('.gitignore', '.gitignore.bak')
    let renameInvalidated = false
    try {
      await fs.readFile('.gitignore', 'utf8')
    } catch (_e) {
      renameInvalidated = true
    }
    assert(renameInvalidated, "rename 后不会返回旧的 .gitignore 缓存")

    await fs.readFile('README.md', 'utf8')
    await fs.readFile('README.md', 'utf8')
    assert(counters.physical >= 5, "普通文本文件不影响 ignore cache 断言")

    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) Script.exit("✅ ignore cache 回归测试通过")
    else Script.exit(`❌ ${failCount} 个测试失败`)
  } catch (error: any) {
    console.error("\n💥 测试出错:", error?.stack || error?.message || error)
    Script.exit(`💥 测试出错: ${error?.message || error}`)
  }
}

runTests()
