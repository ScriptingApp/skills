/**
 * git.ts - isomorphic-git command entry.
 * Thin Script.queryParameters / Script.exit wrapper; implementation lives in sibling modules.
 */

import { Script } from "scripting"
import { loadBufferPolyfill } from "./polyfills"
import { createFS } from "./fs-adapter"
import { loadGit } from "./git-loader"
import { getGitdir, gitList, gitRemoveRepo } from "./repo-map"
import { ensureAuth, AUTH_CANCELLED_ERROR } from "./auth"
import type { GitCommand } from "./types"
import {
  gitInit, gitAdd, gitRemove, gitCommit, gitLog, gitStatus, gitBranch,
  gitCheckout, gitDiff, gitRestore, gitStash, gitRevert, gitTag,
} from "./commands"
import { gitRemote, gitPush, gitPull, gitClone } from "./remote-commands"

async function makeFS(dir: string, name?: string): Promise<any> {
  return createFS(await getGitdir(dir, name), dir)
}

async function main(): Promise<void> {
  const params = Script.queryParameters as unknown as GitCommand
  const { command, dir, name, filepath, message, author, depth, ref, checkout, refA, refB, op, refIdx, url, remote, force, tag, oid, lightweight, singleBranch, noCheckout, auth, maxFiles, summaryOnly } = params

  if (!command) {
    Script.exit({ ok: false, error: "Missing 'command' parameter" })
    return
  }

  try {
    await loadBufferPolyfill()
    const git = await loadGit()
    let result: any

    switch (command) {
      case 'init':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitInit(git, await makeFS(dir, name), dir, name)
        break

      case 'add':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitAdd(git, await makeFS(dir), dir, filepath)
        break

      case 'rm':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRemove(git, await makeFS(dir), dir, filepath)
        break

      case 'commit':
        if (!dir || !message) throw new Error("Missing 'dir' or 'message' parameter")
        result = await gitCommit(git, await makeFS(dir), dir, message, author)
        break

      case 'log':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitLog(git, await makeFS(dir), dir, depth)
        break

      case 'status':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitStatus(git, await makeFS(dir), dir, filepath)
        break

      case 'branch':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitBranch(git, await makeFS(dir), dir, name, checkout)
        break

      case 'checkout':
        if (!dir || !ref) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitCheckout(git, await makeFS(dir), dir, ref, filepath)
        break

      case 'diff':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitDiff(git, await makeFS(dir), dir, filepath, refA, refB, maxFiles, summaryOnly)
        break

      case 'restore':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRestore(git, await makeFS(dir), dir, filepath)
        break

      case 'list':
        result = await gitList()
        break

      case 'remove':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitRemoveRepo(dir)
        break

      case 'stash':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitStash(git, await makeFS(dir), dir, op, message, refIdx)
        break

      case 'revert':
        if (!dir || !ref) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitRevert(git, await makeFS(dir), dir, ref, author)
        break

      case 'remote':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitRemote(git, await makeFS(dir), dir, op || 'list', remote, url)
        break

      case 'push': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pushAuth = await ensureAuth(auth)
        if (!pushAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPush(git, await makeFS(dir), dir, remote, ref, force, pushAuth.username, pushAuth.password)
        break
      }

      case 'pull': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pullAuth = await ensureAuth(auth)
        if (!pullAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPull(git, await makeFS(dir), dir, remote, ref, author, pullAuth.username, pullAuth.password)
        break
      }

      case 'clone': {
        if (!dir || !url) throw new Error("Missing 'dir' or 'url' parameter")
        const cloneAuth = await ensureAuth(auth)
        if (!cloneAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitClone(git, await makeFS(dir, name), dir, url, remote, ref, depth, singleBranch, noCheckout, cloneAuth.username, cloneAuth.password)
        break
      }

      case 'tag':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitTag(git, await makeFS(dir), dir, op || 'list', tag, message, oid, lightweight)
        break

      default:
        throw new Error(`Unknown command: ${command}`)
    }

    Script.exit({ ok: true, result })
  } catch (error: any) {
    console.error("Git command failed:", error.message)
    Script.exit({ ok: false, error: error.message })
  }
}

main()
