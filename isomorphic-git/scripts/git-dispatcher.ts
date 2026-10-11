/**
 * git.ts - isomorphic-git command entry.
 * Thin Script.queryParameters / Script.exit wrapper; implementation lives in sibling modules.
 */

import { createRevertTransactionStore, assertNoPendingRevert } from './revert-transaction'
import { maintainSnapshots } from './snapshot-maintenance'
import { createSnapshotStore } from './snapshot-store'
import { acquireRepositoryLock } from './repository-lock'
import { createOperationContext } from './operation-context'
import { createCommandOperationContext } from './command-operation'
import { loadBufferPolyfill } from "./polyfills"
import { createFS } from "./fs-adapter"
import { loadGit } from "./git-loader"
import { getGitdir as defaultGetGitdir, GIT_REPOS_DIR as defaultRoot, getExistingGitdir as defaultExisting, gitList as defaultList, gitRemoveRepo as defaultRemove } from "./repo-map"
import { ensureAuth, reauthenticateStoredAuth, AUTH_CANCELLED_ERROR } from "./auth"
import type { GitCommand } from "./types"
import {
  gitInit, gitAdd, gitRemove, gitCommit, gitLog, gitStatus, gitBranch,
  gitCheckout, gitDiff, gitRestore, gitStash, gitRevert, gitTag,
} from "./commands"
import { gitRemote, gitPush, gitPull, gitClone } from "./remote-commands"


export async function dispatchGit(params:GitCommand, repo?:{root:string;resolve:any;existing:any;list:any;remove:any}): Promise<any> {
  const getGitdir=repo?.resolve||defaultGetGitdir, getExistingGitdir=repo?.existing||defaultExisting, gitList=repo?.list||defaultList, gitRemoveRepo=repo?.remove||defaultRemove, GIT_REPOS_DIR=repo?.root||defaultRoot
  const transportOptions = { maxTransferBytes: params.maxTransferBytes, timeoutMs: params.timeoutMs }
  const { command, dir, name, filepath, message, author, depth, ref, checkout, refA, refB, op, refIdx, url, remote, force, tag, oid, lightweight, singleBranch, noCheckout, auth, maxFiles, summaryOnly } = params

  if (!command) {
    return { ok: false, error: "Missing 'command' parameter" }
  }

  let releaseLock: (() => Promise<void>) | undefined
  let operationContext: ReturnType<typeof createOperationContext> | undefined
  const commandFS: any[] = []
  let resolvedGitdir: string | undefined
  const commandMakeFS = async (workdir: string, repoName?: string): Promise<any> => {
    if (!resolvedGitdir || workdir !== dir) throw new Error('Command repository was not resolved once before FS creation')
    const fs = createFS(resolvedGitdir, workdir, { backend: 'auto', operation: operationContext?.operation })
    commandFS.push(fs)
    return fs
  }
  try {
    const knownCommands = ['recover','prune','inspect','init','add','rm','commit','log','status','branch','checkout','diff','restore','list','remove','stash','revert','remote','push','pull','clone','tag']
    if (!knownCommands.includes(command)) throw new Error(`Unknown command: ${command}`)
    if (command !== 'list' && !(['inspect','recover','prune'].includes(command) && params.scope === 'map') && !dir) throw new Error("Missing 'dir' parameter")
    if (['add','rm','status','restore'].includes(command) && !filepath) throw new Error("Missing 'filepath' parameter")
    if (command === 'commit' && !message) throw new Error("Missing 'message' parameter")
    if ((command==='checkout'||(command==='revert'&&!['cancel','recover'].includes(op||'')&&!params.transactionId)) && !ref) throw new Error("Missing 'ref' parameter")
    if (command === 'clone' && !url) throw new Error("Missing 'url' parameter")
    operationContext = createCommandOperationContext(params.command, { deadlineMs: params.timeoutMs, backend: 'auto' })
    if (!['list', 'remove', 'inspect','recover','prune'].includes(command)) {
      if (!dir) throw new Error("Missing 'dir' parameter")
      const readOnly = ['status', 'log', 'diff'].includes(command) || (['add','revert'].includes(command) && params.dryRun)
      resolvedGitdir = readOnly || command==='revert' ? await getExistingGitdir(dir) : await getGitdir(dir, command === 'init' || command === 'clone' ? name : undefined)
      if (!resolvedGitdir)throw new Error('Repository resolver returned no path')
      if (!readOnly) {
        releaseLock = await acquireRepositoryLock(resolvedGitdir)
        if(!(command==='revert'&&(['cancel','recover'].includes(op||'')||(op==='apply'&&params.transactionId))))await assertNoPendingRevert(resolvedGitdir,dir,operationContext.operation)
        await createSnapshotStore(resolvedGitdir + '/index','index',undefined,operationContext.operation).assertReady()
      }
    }
    await loadBufferPolyfill()
    const git = await loadGit()
    let result: any

    switch (command) {
      case 'recover':
      case 'prune': {
        if (params.scope !== 'map' && params.scope !== 'index') throw new Error("maintenance requires scope 'map' or 'index'")
        const target = params.scope === 'map' ? GIT_REPOS_DIR + '/repo-map.json' : await getExistingGitdir(dir!) + '/index'
        result = await maintainSnapshots(command,params.scope,target,params,git,dir,operationContext.operation)
        break
      }
      case 'inspect': {
        if(params.scope==='revert'){
          if(!dir)throw new Error("inspect scope revert needs dir")
          result=await createRevertTransactionStore(await getExistingGitdir(dir),dir,undefined,operationContext.operation).inspect()
          break
        }
        if (params.scope !== 'map' && params.scope !== 'index') throw new Error("inspect requires scope 'map', 'index' or 'revert'")
        const target = params.scope === 'map' ? GIT_REPOS_DIR + '/repo-map.json' : await getExistingGitdir(dir!) + '/index'
        result = await createSnapshotStore(target,params.scope,undefined,operationContext.operation).inspect()
        break
      }
      case 'init':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitInit(git, await commandMakeFS(dir, name), dir, name)
        break

      case 'add':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitAdd(git, await commandMakeFS(dir), dir, filepath, params, resolvedGitdir)
        break

      case 'rm':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRemove(git, await commandMakeFS(dir), dir, filepath)
        break

      case 'commit':
        if (!dir || !message) throw new Error("Missing 'dir' or 'message' parameter")
        result = await gitCommit(git, await commandMakeFS(dir), dir, message, author)
        break

      case 'log':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitLog(git, await commandMakeFS(dir), dir, depth)
        break

      case 'status':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitStatus(git, await commandMakeFS(dir), dir, filepath)
        break

      case 'branch':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitBranch(git, await commandMakeFS(dir), dir, name, checkout)
        break

      case 'checkout':
        if (!dir || !ref) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitCheckout(git, await commandMakeFS(dir), dir, ref, filepath)
        break

      case 'diff':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitDiff(git, await commandMakeFS(dir), dir, filepath, refA, refB, maxFiles, summaryOnly)
        break

      case 'restore':
        if (!dir || !filepath) throw new Error("Missing 'dir' or 'filepath' parameter")
        result = await gitRestore(git, await commandMakeFS(dir), dir, filepath)
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
        result = await gitStash(git, await commandMakeFS(dir), dir, op, message, refIdx)
        break

      case 'revert':
        if (!dir || (!ref&&!['cancel','recover'].includes(op||'')&&!params.transactionId)) throw new Error("Missing 'dir' or 'ref' parameter")
        result = await gitRevert(git, await commandMakeFS(dir), dir, ref||'', author, params)
        break

      case 'remote':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitRemote(git, await commandMakeFS(dir), dir, op || 'list', remote, url)
        break

      case 'push': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pushAuth = await ensureAuth(auth)
        if (!pushAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPush(git, await commandMakeFS(dir), dir, remote, ref, force, pushAuth.username, pushAuth.password, {...transportOptions,onAuthenticationFailure:auth?.password?undefined:reauthenticateStoredAuth})
        break
      }

      case 'pull': {
        if (!dir) throw new Error("Missing 'dir' parameter")
        const pullAuth = await ensureAuth(auth)
        if (!pullAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitPull(git, await commandMakeFS(dir), dir, remote, ref, author, pullAuth.username, pullAuth.password, {...transportOptions,onAuthenticationFailure:auth?.password?undefined:reauthenticateStoredAuth})
        break
      }

      case 'clone': {
        if (!dir || !url) throw new Error("Missing 'dir' or 'url' parameter")
        const cloneAuth = await ensureAuth(auth)
        if (!cloneAuth) throw new Error(AUTH_CANCELLED_ERROR)
        result = await gitClone(git, await commandMakeFS(dir, name), dir, url, remote, ref, depth, singleBranch, noCheckout, cloneAuth.username, cloneAuth.password, {...transportOptions,onAuthenticationFailure:auth?.password?undefined:reauthenticateStoredAuth})
        break
      }

      case 'tag':
        if (!dir) throw new Error("Missing 'dir' parameter")
        result = await gitTag(git, await commandMakeFS(dir), dir, op || 'list', tag, message, oid, lightweight)
        break

      default:
        throw new Error(`Unknown command: ${command}`)
    }

    for (const fs of commandFS) fs.assertHealthy?.()
    if (params.includeStats && result && typeof result === 'object' && !Array.isArray(result)) result = { ...result, operationStats: operationContext.close() }
    else operationContext.close()
    if (releaseLock) { await releaseLock(); releaseLock = undefined }
    return { ok: true, result }
  } catch (error: any) {
    operationContext?.close()
    if (releaseLock) {
      try { await releaseLock(); releaseLock = undefined }
      catch (cleanup: any) { console.error('Repository lock cleanup failed:', cleanup.message) }
    }
      const errorMessage = String(error.message || error).replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
      console.error("Git command failed:", errorMessage)
    return ({ ok: false, error: errorMessage, ...(error.code ? { code: error.code } : {}), ...(error.phase ? { phase: error.phase } : {}), ...(error.partial !== undefined ? { partial: error.partial } : {}), ...(error.affectedOids?{affectedOids:error.affectedOids}:{}), ...(error.mutationAttempts!==undefined?{mutationAttempts:error.mutationAttempts}:{}), ...(error.transactionId?{transactionId:error.transactionId}:{}), ...(error.transactionIds?{transactionIds:error.transactionIds}:{}), ...(error.conflicts?{conflicts:error.conflicts}:{}), ...(error.paths?{paths:error.paths}:{}), ...(error.attemptId ? {attemptId:error.attemptId}:{}), ...(error.removed ? {removed:error.removed}:{}), ...(error.quarantined ? {quarantined:error.quarantined}:{}), ...(error.failedSnapshotId ? {failedSnapshotId:error.failedSnapshotId}:{}), ...(error.snapshotId ? { snapshotId:error.snapshotId } : {}), ...(error.snapshotIds ? { snapshotIds:error.snapshotIds } : {}), ...(error.stats ? { stats: error.stats } : {}) })
  } finally {
    if (releaseLock) await releaseLock()
  }
}

