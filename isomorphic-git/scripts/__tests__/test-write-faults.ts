import { Script } from 'scripting'
import { createSnapshotStore } from '../snapshot-store'
import { createFS } from '../fs-adapter'
import { createCommandOperationContext } from '../command-operation'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
import { gitAdd } from '../commands'
import { createRepoMapManager, RepoMapDependencies } from '../repo-map'
import { acquireRepositoryLock } from '../repository-lock'
import { gitClone } from '../remote-commands'
declare const require: any
const root = FileManager.temporaryDirectory + '/git-write-fault-' + Date.now() + '-' + Math.random().toString(36).slice(2)
const cases: any[] = []
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
const hash = (data: any) => require('crypto').createHash('sha256').update(data).digest('hex')
function failure() { const e: any = new Error('Injected EIO at native-write boundary'); e.code = 'EIO'; return e }
async function main() {
  let result: any
  try {
    await loadBufferPolyfill(); const git = await loadGit()
    for (const partial of [false, true]) {
      const dir = root + '/index-' + partial + '/work', gd = root + '/index-' + partial + '/git'
      const setup = createFS(gd, dir)
      await FileManager.createDirectory(dir, true); await setup.writeFile(dir + '/a', 'before')
      await git.init({ fs: setup, dir, gitdir: gd }); await gitAdd(git, setup, dir, '.', {}, gd)
      const old = await setup.readFile(gd + '/index'), before = hash(old)
      await setup.writeFile(dir + '/a', 'after')
      const context = createCommandOperationContext('add')
      const fs = createFS(gd, dir, { operation: context.operation }), write = fs.writeFile
      let attempted = 0, error: any
      const writePaths:string[]=[]
      fs.writeFile = async (path: string, data: any, opts: any) => {
        writePaths.push(path)
        if (path === gd + '/index' || path.endsWith('/index') || path==='index') {
          attempted++
          if (partial) await setup.writeFile(path, data.subarray(0, 8))
          throw failure()
        }
        return write(path, data, opts)
      }
      try { await gitAdd(git, fs, dir, '.', {}, gd) } catch (e: any) { error = e }
      context.close()
      const after = await setup.readFile(gd + '/index'), unchanged = hash(after) === before
      assert(!!error && attempted === 1 && error.partial===true && error.phase==='snapshot-target-write', 'index failure metadata/retry guard missing: '+JSON.stringify({attempted,writePaths,error:error?.message}))
      assert(unchanged === !partial, 'unexpected observed index bytes')
      let parserError: any
      if (partial) { try { await git.listFiles({ fs: setup, dir, gitdir: gd }) } catch (e: any) { parserError = e.message }; assert(!!parserError, 'partial index should not parse') }
      const evidence = await createSnapshotStore(gd+'/index','index').inspect()
      const pending=evidence.entries.find(x=>x.id===error.snapshotId)
      assert(evidence.pending&&pending?.backupValid===true&&pending.manifest.oldHash===before,'real add backup invalid')
      let blocked:any;try{await gitAdd(git,setup,dir,'.',{},gd)}catch(e:any){blocked=e}
      assert(blocked?.code==='SNAPSHOT_PENDING','real add next mutation not blocked')
      cases.push({ snapshotId:error.snapshotId, oldBackupValid:true, nextMutationBlocked:true, name: 'index-' + (partial ? 'prefix-write-EIO' : 'pre-write-EIO'), expectedFailureObserved: true,
        writeAttempts:attempted, phase:error.phase, code: error.code || null, error: error.message, reportedPartial: error.partial ?? null,
        oldBytes: old.byteLength, newBytes: after.byteLength, oldIndexUnchanged: unchanged, parserRejectsDamage: !!parserError,
        verdict: partial ? 'UNRECOVERED_PARTIAL_WRITE_RISK' : 'old-index-preserved' })
    }
    for (const partial of [false, true]) {
      const mr = root + '/map-' + partial
      let inject = false
      const deps: RepoMapDependencies = {
        exists: p => FileManager.exists(p), read: p => FileManager.readAsString(p, 'utf8'), lock: acquireRepositoryLock,
        write: async (p, text) => {
          if (inject) { if (partial) await FileManager.writeAsString(p, text.slice(0, 8), 'utf8'); throw failure() }
          await FileManager.writeAsString(p, text, 'utf8')
        },
      }
      const mgr = createRepoMapManager(mr, deps)
      await mgr.resolve('/isolated/a', 'a')
      const before = await FileManager.readAsString(mgr.mapFile, 'utf8')
      inject = true; let error: any
      try { await mgr.resolve('/isolated/b', 'b') } catch (e: any) { error = e }
      const after = await FileManager.readAsString(mgr.mapFile, 'utf8')
      assert(!!error && (before === after) === !partial, 'map fault observation incorrect')
      assert(error?.partial===true&&error?.phase==='snapshot-target-write','map partial report missing')
      assert(!await FileManager.exists(mr + '/scripting-operation.lock'), 'map lock leaked on failure')
      let code: any
      if (partial) { try { await mgr.list() } catch (e: any) { code = e.code }; assert(code === 'REPO_MAP_INVALID', 'map should reject damaged bytes') }
      const evidence=await mgr.inspect()
      assert(evidence.pending&&evidence.entries.find(x=>x.id===error.snapshotId)?.backupValid===true,'map old backup invalid')
      let blocked:any;try{await mgr.resolve('/isolated/c','c')}catch(e:any){blocked=e}
      assert(blocked?.code==='SNAPSHOT_PENDING','map next write not blocked')
      cases.push({ snapshotId:error.snapshotId, oldBackupValid:true, nextMutationBlocked:true, name: 'map-' + (partial ? 'prefix-write-EIO' : 'pre-write-EIO'), expectedFailureObserved: true,
        phase:error.phase, code: error.code || null, reportedPartial: error.partial ?? null, oldMapUnchanged: before === after,
        corruptReadCode: code || null, lockReleased: true, verdict: partial ? 'UNRECOVERED_PARTIAL_WRITE_RISK' : 'old-map-preserved' })
    }
    for (const metadata of [true, false]) {
      const dir = root + '/clone-' + metadata + '/work', gd = root + '/clone-' + metadata + '/git'
      await FileManager.createDirectory(dir, true); await FileManager.createDirectory(gd, true)
      const fs = createFS(gd, dir)
      const marker = metadata ? gd + '/HEAD' : dir + '/user-file'
      await FileManager.writeAsString(marker, 'user-data-preserved', 'utf8')
      let called = false, error: any
      const fake = { clone: async () => { called = true; throw new Error('must not reach network') } }
      try { await gitClone(fake, fs, dir, 'https://example.invalid/repo') } catch (e: any) { error = e }
      assert(!!error && !called && await FileManager.readAsString(marker, 'utf8') === 'user-data-preserved', 'clone touched existing target')
      cases.push({ name: 'clone-existing-' + (metadata ? 'metadata' : 'worktree'), refusedBeforeNetwork: true, dataUnchanged: true, code: error.code || null })
    }
    result = { ok: true, completedCases: cases.length, cases, recoveryPassed: false,
      note: 'Fault-injection assertions completed; partial writes deliberately damage ONLY isolated fixtures. This is risk detection, not successful crash recovery. No killed process or real permission/network fault.' }
  } catch (e: any) { result = { ok: false, error: e.message, cases } }
  finally { try { await FileManager.remove(root); result.cleanup = true } catch (e: any) { result.cleanup = false; result.cleanupError = e.message } }
  const reportPath = FileManager.scriptsDirectory + '/../scripting-skills/isomorphic-git/specs/evidence/write-fault-' + Date.now() + '.json'
  await FileManager.writeAsString(reportPath, JSON.stringify(result, null, 2), 'utf8')
  Script.exit({ ...result, reportPath })
}
main().catch((e: any) => Script.exit({ ok: false, error: e.message }))
