// @ts-nocheck
/**
 * Isolated API tests for ref resolution and guarded working-tree diff.
 * No repository, repo-map, or user workspace is touched.
 */
import { Script } from "scripting"
import { resolveReflike } from "../commands"
import { workingTreeDiffWithGuard } from "../diff-utils"

let tests = 0
let passed = 0
function assert(value: boolean, message: string) {
  tests++
  if (value) { passed++; console.log(`  ✅ ${message}`) }
  else console.log(`  ❌ ${message}`)
}

async function expectReject(task: () => Promise<any>, fragment: string) {
  try { await task(); return false }
  catch (e: any) { return String(e?.message || e).includes(fragment) }
}

async function run() {
  const commits: Record<string, any> = {
    c3: { oid: "c3", commit: { parent: ["c2"] } },
    c2: { oid: "c2", commit: { parent: ["c1"] } },
    c1: { oid: "c1", commit: { parent: [] } },
  }
  const git = {
    resolveRef: async ({ ref }: any) => ref === "HEAD" ? "c3" : ref,
    readCommit: async ({ oid }: any) => commits[oid],
  }
  const fs = {}
  assert(await resolveReflike(git, fs, "/isolated", "/isolated-gitdir", "HEAD~2") === "c1", "HEAD~N 串行解析祖先")
  assert(await resolveReflike(git, fs, "/isolated", "/isolated-gitdir", "HEAD^1") === "c2", "HEAD^N 解析父提交")
  assert(await expectReject(() => resolveReflike(git, fs, "/isolated", "/isolated-gitdir", "HEAD~-1"), "invalid ancestor selector"), "拒绝负 ancestor")
  assert(await expectReject(() => resolveReflike(git, fs, "/isolated", "/isolated-gitdir", "HEAD~999999"), "invalid ancestor selector"), "拒绝过大 ancestor")

  const matrix = [["a.txt", 1, 0, 1], ["b.txt", 1, 1, 2], ["c.txt", 0, 2, 0]]
  const guardedGit = { statusMatrix: async ({ filter }: any) => matrix.filter(row => filter(row[0])) }
  const result = await workingTreeDiffWithGuard({ git: guardedGit, fs, dir: "/isolated", gitdir: "/isolated-gitdir", maxFiles: 0, summaryOnly: true })
  assert(result.truncated === false, "summaryOnly 不截断")
  assert(result.changes === undefined, "summaryOnly 不返回 changes")
  assert(result.summary['*deleted'] === 1 && result.summary['*added'] === 1, "summaryOnly 正确聚合状态")
  assert(await expectReject(() => workingTreeDiffWithGuard({ git: guardedGit, fs, dir: "/isolated", gitdir: "/isolated-gitdir", maxFiles: -1 }), "Invalid maxFiles"), "拒绝负 maxFiles")

  console.log(`\n📊 隔离 API 测试: ${passed}/${tests} 通过`)
  Script.exit(passed === tests ? "✅ 隔离 API 测试通过" : `❌ ${tests - passed} 个测试失败`)
}
run().catch((e) => Script.exit(`💥 测试出错: ${e?.message || e}`))
