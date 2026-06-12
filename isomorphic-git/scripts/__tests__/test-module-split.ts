// @ts-nocheck
/**
 * Module split regression tests.
 * Verifies git.ts remains a thin entry and core implementation lives in split modules.
 */

import { Script } from "scripting"
import { getGitdir, gitList, gitRemoveRepo, GIT_REPOS_DIR, REPO_MAP_FILE } from "../repo-map"
import { loadGit } from "../git-loader"
import { gitAdd, gitCommit, gitDiff, gitInit } from "../commands"
import { gitRemote, gitPush, gitPull, gitClone } from "../remote-commands"
import { ensureAuth, AUTH_CANCELLED_ERROR } from "../auth"

const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
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
    console.log("🚀 开始 module split 回归测试\n")
    assert(typeof getGitdir === 'function', "repo-map 导出 getGitdir")
    assert(typeof gitList === 'function', "repo-map 导出 gitList")
    assert(typeof gitRemoveRepo === 'function', "repo-map 导出 gitRemoveRepo")
    assert(typeof GIT_REPOS_DIR === 'string' && GIT_REPOS_DIR.includes('/git-repos'), "repo-map 导出 GIT_REPOS_DIR")
    assert(typeof REPO_MAP_FILE === 'string' && REPO_MAP_FILE.endsWith('/repo-map.json'), "repo-map 导出 REPO_MAP_FILE")

    assert(typeof loadGit === 'function', "git-loader 导出 loadGit")
    assert(typeof gitInit === 'function', "commands 导出 gitInit")
    assert(typeof gitAdd === 'function', "commands 导出 gitAdd")
    assert(typeof gitCommit === 'function', "commands 导出 gitCommit")
    assert(typeof gitDiff === 'function', "commands 导出 gitDiff")
    assert(typeof gitRemote === 'function', "remote-commands 导出 gitRemote")
    assert(typeof gitPush === 'function', "remote-commands 导出 gitPush")
    assert(typeof gitPull === 'function', "remote-commands 导出 gitPull")
    assert(typeof gitClone === 'function', "remote-commands 导出 gitClone")
    assert(typeof ensureAuth === 'function', "auth 导出 ensureAuth")
    assert(typeof AUTH_CANCELLED_ERROR === 'string' && AUTH_CANCELLED_ERROR.length > 0, "auth 导出 AUTH_CANCELLED_ERROR")

    const gitTs = await FileManager.readAsString(SKILL_DIR + "/scripts/git.ts", 'utf8')
    assert(gitTs.includes('from "./commands"'), "git.ts 从 commands.ts 导入命令")
    assert(gitTs.includes('from "./remote-commands"'), "git.ts 从 remote-commands.ts 导入远程命令")
    assert(gitTs.includes('from "./repo-map"'), "git.ts 从 repo-map.ts 导入 repo helper")
    assert(!/async function gitAdd\s*\(/.test(gitTs), "git.ts 不再内联 gitAdd 实现")
    assert(!/function createHttpTransport\s*\(/.test(gitTs), "git.ts 不再内联 HTTP transport")

    console.log("\n" + "=".repeat(50))
    console.log(`📊 测试结果: ${passCount}/${testCount} 通过, ${failCount} 失败`)
    if (failCount === 0) Script.exit("✅ module split 回归测试通过")
    else Script.exit(`❌ ${failCount} 个测试失败`)
  } catch (error: any) {
    console.error("\n💥 测试出错:", error?.stack || error?.message || error)
    Script.exit(`💥 测试出错: ${error?.message || error}`)
  }
}

runTests()
