// @ts-nocheck
/**
 * test-local-git.ts (DEPRECATED: 功能已被 scripts/git.ts 覆盖，保留作为参考实现) - 端到端 Git 流程测试
 * 测试 git init → add → commit → log → status 完整流程
 * .git 目录存储在 App Group 目录下，项目文件在测试目录
 */

import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"
import { createFS } from "../fs-adapter"

declare const Buffer: any

// FileManager 是全局可用的
// 不注入全局 Buffer —— 让 isomorphic-git UMD bundle 使用其内部打包的 Buffer

// === 路径配置 ===
const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
const TEST_PROJECT_DIR = FileManager.appGroupDocumentsDirectory + "/test-git-project"
const TEST_REPO_NAME = "test-project"
const GITDIR = GIT_REPOS_DIR + "/" + TEST_REPO_NAME

// === 可读的 Buffer 包装器 ===
// 只添加 toString(encoding, start, end) 方法，不继承完整的 Buffer
// 让 isomorphic-git 内部的 Buffer 模块自己处理 SHA1 等操作
const hexChars = '0123456789abcdef'

class ReadableBytes extends Uint8Array {
  toString(encoding?: string, start?: number, end?: number): string {
    const s = start || 0
    const e = end !== undefined ? end : this.length
    const slice = this.subarray(s, e)
    
    if (encoding === 'hex') {
      let result = ''
      for (let i = 0; i < slice.length; i++) {
        result += hexChars[(slice[i] >> 4) & 0x0f] + hexChars[slice[i] & 0x0f]
      }
      return result
    }
    if (encoding === 'base64') {
      let binary = ''
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i])
      }
      return btoa(binary)
    }
    // utf8 default
    const decoder = new TextDecoder('utf-8')
    return decoder.decode(slice)
  }

  slice(start?: number, end?: number): ReadableBytes {
    const s = Math.max(0, start || 0)
    const e = Math.min(this.length, end !== undefined ? end : this.length)
    if (e <= s) return new ReadableBytes(0)
    return new ReadableBytes(this.buffer, this.byteOffset + s, e - s)
  }
}

// === 加载 isomorphic-git UMD bundle ===
async function loadGit(): Promise<any> {
  const bundlePath = SKILL_DIR + "/vendor/index.umd.min.js"
  
  if (!await FileManager.exists(bundlePath)) {
    throw new Error("isomorphic-git bundle 未找到: " + bundlePath)
  }

  const bundleCode = await FileManager.readAsString(bundlePath, 'utf8')
  
  // UMD bundle 在 CommonJS 环境中使用 module.exports
  // 需要提供 self（UMD 用 self 作为全局对象参数）
  const wrappedCode = "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    bundleCode + "\n" +
    "return module.exports;\n" +
    "})()"
  
  const git = eval(wrappedCode)
  
  if (!git || typeof git.init !== 'function') {
    throw new Error("加载 isomorphic-git 失败")
  }
  
  console.log("✅ isomorphic-git 加载成功，版本:", git.version?.() || 'unknown')
  return git
}

// === 测试 ===
let testCount = 0
let passCount = 0
let failCount = 0

function assert(condition: boolean, message: string) {
  testCount++
  if (condition) { passCount++; console.log(`  ✅ ${message}`) }
  else { failCount++; console.log(`  ❌ ${message}`) }
}

async function runTests() {
  try {
    console.log("🚀 开始 isomorphic-git 端到端测试\n")
    
    // 0. 加载 Buffer polyfill
    console.log("=== Step 0: 加载 Buffer polyfill ===")
    await loadBufferPolyfill()
    
    // 1. 加载
    console.log("=== Step 1: 加载 isomorphic-git ===")
    const git = await loadGit()
    
    // 2. 准备
    console.log("\n=== Step 2: 准备测试环境 ===")
    if (await FileManager.exists(GITDIR)) await FileManager.remove(GITDIR)
    if (await FileManager.exists(TEST_PROJECT_DIR)) await FileManager.remove(TEST_PROJECT_DIR)
    await FileManager.createDirectory(GIT_REPOS_DIR, true)
    await FileManager.createDirectory(GITDIR, true)
    await FileManager.createDirectory(TEST_PROJECT_DIR, true)
    console.log("  GITDIR:", GITDIR)
    console.log("  WORKDIR:", TEST_PROJECT_DIR)
    
    const fs = createFS(GITDIR, TEST_PROJECT_DIR)
    
    // 3. git init
    console.log("\n=== Step 3: git init ===")
    await git.init({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    assert(await FileManager.exists(GITDIR + "/HEAD"), "HEAD 文件已创建")
    assert(await FileManager.exists(GITDIR + "/config"), "config 文件已创建")
    assert(await FileManager.exists(GITDIR + "/objects"), "objects 目录已创建")
    assert(await FileManager.exists(GITDIR + "/refs"), "refs 目录已创建")
    assert(!await FileManager.exists(TEST_PROJECT_DIR + "/.git"), ".git 不在项目目录下（分离存储）")
    
    // 4. 创建文件
    console.log("\n=== Step 4: 创建测试文件 ===")
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/README.md", "# Test Project\n\nThis is a test.", 'utf8')
    if (!await FileManager.exists(TEST_PROJECT_DIR + "/src")) {
      await FileManager.createDirectory(TEST_PROJECT_DIR + "/src", true)
    }
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/src/main.ts", 'console.log("Hello, World!")', 'utf8')
    console.log("  ✅ 创建文件: README.md, src/main.ts")
    
    // 5. git add
    console.log("\n=== Step 5: git add ===")
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'README.md' })
    console.log("  ✅ git add README.md")
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'src/main.ts' })
    console.log("  ✅ git add src/main.ts")
    
    // 6. git commit
    console.log("\n=== Step 6: git commit ===")
    const commitOid = await git.commit({
      fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR,
      message: 'Initial commit',
      author: { name: 'Test User', email: 'test@example.com' },
    })
    assert(typeof commitOid === 'string' && commitOid.length === 40, `commit OID: ${commitOid}`)
    console.log(`  提交: ${commitOid}`)
    
    // 7. git log
    console.log("\n=== Step 7: git log ===")
    const log = await git.log({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, depth: 5 })
    assert(log.length === 1, `日志 ${log.length} 条`)
    assert(log[0].commit.message.trim() === 'Initial commit', "提交消息正确")
    assert(log[0].commit.author.name === 'Test User', "作者正确")
    
    // 8. git status
    console.log("\n=== Step 8: git status ===")
    const status = await git.status({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'README.md' })
    assert(status === 'unmodified', `README.md 状态: ${status}`)
    
    // 9. 修改并提交
    console.log("\n=== Step 9: 修改文件并提交 ===")
    await FileManager.writeAsString(TEST_PROJECT_DIR + "/README.md", "# Test Project\n\nUpdated content.", 'utf8')
    const modifiedStatus = await git.status({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'README.md' })
    assert(modifiedStatus === '*modified', `修改后状态: ${modifiedStatus}`)
    
    await git.add({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR, filepath: 'README.md' })
    const commitOid2 = await git.commit({
      fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR,
      message: 'Update README',
      author: { name: 'Test User', email: 'test@example.com' },
    })
    assert(typeof commitOid2 === 'string' && commitOid2 !== commitOid, `第二次提交: ${commitOid2}`)
    
    // 10. 完整日志
    console.log("\n=== Step 10: 完整提交历史 ===")
    const fullLog = await git.log({ fs, dir: TEST_PROJECT_DIR, gitdir: GITDIR })
    assert(fullLog.length === 2, `完整日志 ${fullLog.length} 条`)
    for (const entry of fullLog) {
      console.log(`  📝 ${entry.oid.substring(0, 8)} - ${entry.commit.message.trim()}`)
    }
    
    // 总结
    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) {
      console.log("🎉 所有测试通过！isomorphic-git 在 Scripting 应用中完全可用！")
      console.log("\n验证的功能:")
      console.log("  ✅ git init - 初始化仓库")
      console.log("  ✅ git add - 添加文件到暂存区")
      console.log("  ✅ git commit - 提交变更")
      console.log("  ✅ git log - 查看提交历史")
      console.log("  ✅ git status - 查看文件状态")
      console.log("  ✅ .git 目录分离存储在 App Group 目录")
      Script.exit("✅ 所有测试通过！")
    } else {
      Script.exit(`❌ ${failCount} 个测试失败`)
    }
    
  } catch (error: any) {
    console.error("\n💥 测试出错:", error.message || error)
    Script.exit(`💥 测试出错: ${error.message}`)
  }
}

runTests()
