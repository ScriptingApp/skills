// @ts-nocheck
/** Real isomorphic-git 1.38.1 vendor test. Uses random isolated worktree/gitdir. */
import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"
import { loadGit } from "../git-loader"
import { createFS } from "../fs-adapter"
import { gitDiff } from "../commands"

const token = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`
const root = FileManager.temporaryDirectory + `/isogit-ref-diff-${token}`
const gitdir = FileManager.temporaryDirectory + `/isogit-ref-diff-git-${token}`
function assert(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
  console.log(`  ✅ ${message}`)
}
async function run() {
  let result = "✅ 真实 vendor ref-diff 测试通过"
  try {
    await loadBufferPolyfill()
    const git = await loadGit()
    const fs = createFS(gitdir, root)
    await FileManager.createDirectory(root + "/src/deep", true)
    await FileManager.createDirectory(root + "/src/deep2", true)
    await FileManager.createDirectory(root + "/src/other", true)
    await FileManager.writeAsString(root + "/src/deep/a.txt", "one\n", "utf8")
    await FileManager.writeAsString(root + "/src/deep2/prefix.txt", "one\n", "utf8")
    await FileManager.writeAsString(root + "/src/other/b.txt", "one\n", "utf8")
    await git.init({ fs, dir: root, gitdir })
    await git.add({ fs, dir: root, gitdir, filepath: ".", parallel: false })
    const c1 = await git.commit({ fs, dir: root, gitdir, message: "one", author: { name: "T", email: "t@example.com" } })
    await FileManager.writeAsString(root + "/src/deep/a.txt", "two\n", "utf8")
    await FileManager.writeAsString(root + "/src/deep/new.txt", "new\n", "utf8")
    await FileManager.writeAsString(root + "/src/other/b.txt", "two\n", "utf8")
    await git.add({ fs, dir: root, gitdir, filepath: ".", parallel: false })
    const c2 = await git.commit({ fs, dir: root, gitdir, message: "two", author: { name: "T", email: "t@example.com" } })

    const diff = await gitDiff(git, fs, root, "src/deep", c1, c2, 20, false, gitdir)
    assert(!diff.truncated && diff.incomplete === false, "真实 vendor ref-diff 完整结束")
    assert(diff.changes.length === 2, "deep subtree 返回两个变更")
    assert(diff.changes.every((x: any) => x.filepath.startsWith("src/deep/")), "deep subtree 不混入其他目录")
    assert(!diff.changes.some((x: any) => x.filepath.startsWith("src/deep2/")), "前缀相似目录不误匹配")

    const seenUndefined: string[] = []
    await git.walk({
      fs, dir: root, gitdir,
      trees: [git.TREE({ ref: c1 }), git.TREE({ ref: c2 })],
      map: async (fp: string) => {
        if (fp === "src/other") return undefined
        seenUndefined.push(fp)
      },
      iterate: async (walkChildren: any, children: any[]) => {
        const out = []
        for (const child of children) out.push(await walkChildren(child))
        return out
      },
    })
    assert(seenUndefined.includes("src/other/b.txt"), "vendor 验证：map 返回 undefined 不剪枝")

    const seenNull: string[] = []
    await git.walk({
      fs, dir: root, gitdir,
      trees: [git.TREE({ ref: c1 }), git.TREE({ ref: c2 })],
      map: async (fp: string) => {
        if (fp === "src/other") return null
        seenNull.push(fp)
      },
      iterate: async (walkChildren: any, children: any[]) => {
        const out = []
        for (const child of children) out.push(await walkChildren(child))
        return out
      },
    })
    assert(!seenNull.includes("src/other/b.txt"), "vendor 验证：map 返回 null 剪枝")
  } catch (e: any) {
    result = `❌ ${e?.stack || e?.message || e}`
  } finally {
    await FileManager.remove(root).catch(() => {})
    await FileManager.remove(gitdir).catch(() => {})
  }
  Script.exit(result)
}
run()
