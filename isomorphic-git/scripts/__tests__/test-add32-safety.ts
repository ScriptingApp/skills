import { Script } from 'scripting'
import { createFS } from '../fs-adapter'
import { createOperationContext } from '../operation-context'
import { loadGit } from '../git-loader'
import { loadBufferPolyfill } from '../polyfills'
import { gitAdd } from '../commands'
declare const require: any
const root = FileManager.temporaryDirectory + '/git-add32-safety-' + Date.now()
const cases: any[] = []
function assert(ok: boolean, message: string) { if (!ok) throw new Error(message) }
async function main() {
  let result: any
  try {
    await loadBufferPolyfill(); const git = await loadGit()
    for (const name of ['read-failure', 'byte-budget', 'deadline', 'symlink-parent', 'link-bytes']) {
      const dir = root + '/' + name + '/work', gd = root + '/' + name + '/git'
      const setup = createFS(gd, dir)
      await FileManager.createDirectory(dir + '/src', true)
      await setup.writeFile(dir + '/src/a', 'before')
      await git.init({ fs: setup, dir, gitdir: gd })
      await gitAdd(git, setup, dir, '.', {}, gd)
      const sha = (b: any) => require('crypto').createHash('sha256').update(b).digest('hex')
      const before = sha(await setup.readFile(gd + '/index'))
      let clock = 0
      const context = createOperationContext({ yieldAfterMs: 32, ...(name === 'deadline' ? { deadlineMs: 5, now: () => clock } : {}) })
      const fs = createFS(gd, dir, { operation: context.operation })
      let writes = 0
      const write = fs.writeFile
      fs.writeFile = async (p: string, ...a: any[]) => { if (p.endsWith('/index')) writes++; return write(p, ...a) }
      await setup.writeFile(dir + '/src/a', 'after')
      let path = '.', options: any = {}, expected: string | undefined
      if (name === 'read-failure' || name === 'deadline') {
        const read = fs.readFile
        fs.readFile = async (p: any, ...a: any[]) => {
          if (p === dir + '/src/a') {
            if (name === 'deadline') clock = 10
            else { const e: any = new Error('Injected underlying read failure'); e.code = 'EIO'; throw e }
          }
          return read(p, ...a)
        }
        expected = name === 'deadline' ? 'ETIMEDOUT' : 'EIO'
      }
      if (name === 'byte-budget') { options.maxFileBytes = 2; expected = 'STAGE_LIMIT' }
      if (name === 'symlink-parent') {
        const outside = root + '/outside'
        await FileManager.createDirectory(outside, true)
        await FileManager.writeAsString(outside + '/secret', 'not-to-stage', 'utf8')
        await setup.symlink(outside, dir + '/link')
        path = 'link/secret'
      }
      if (name === 'link-bytes') { await setup.symlink('target-with-long-name', dir + '/link'); path = 'link'; options.maxFileBytes = 2; expected = 'STAGE_LIMIT' }
      let error: any
      try { await gitAdd(git, fs, dir, path, options, gd) } catch (e: any) { error = e }
      assert(!!error, name + ' should reject')
      if (expected) assert(error.code === expected, name + ': expected ' + expected + ', got ' + error.code)
      else assert(error.message.includes('symbolic-link parent'), 'must reject parent link')
      assert(writes === 0 && before === sha(await setup.readFile(gd + '/index')), name + ' changed index')
      assert(context.stats.openFiles === 0, name + ' leaked operation resources')
      cases.push({ name, passed: true, code: error.code || null, indexUnchanged: true, indexWrites: writes, simulatedClock: name === 'deadline' })
      context.close()
      if(name==='link-bytes') {
        const successContext=createOperationContext({yieldAfterMs:32})
        const linkFS=createFS(gd,dir,{operation:successContext.operation})
        await gitAdd(git,linkFS,dir,'link',{},gd)
        const listed:string[]=await git.listFiles({fs:linkFS,dir,gitdir:gd})
        assert(listed.includes('link'),'dangling link missing from index')
        const oid=await git.commit({fs:linkFS,dir,gitdir:gd,message:'stage link itself',author:{name:'Test',email:'test@example.invalid'}})
        const blob=await git.readBlob({fs:linkFS,dir,gitdir:gd,oid,filepath:'link'})
        assert(new TextDecoder().decode(blob.blob)==='target-with-long-name','link target bytes not preserved')
        const tree=await git.readTree({fs:linkFS,dir,gitdir:gd,oid})
        assert(tree.tree.find((e:any)=>e.path==='link')?.mode==='120000','link must retain Git symlink mode')
        successContext.close();cases.push({name:'dangling-link-stage',passed:true,targetBytesPreserved:true,mode:'120000'})
      }
    }
    result = { ok: true, passed: cases.length, cases, note: 'Fault/clock injection uses real production gitAdd and vendor. Does not prove crash-atomic write or real native permission failure.' }
  } catch (e: any) { result = { ok: false, error: e.message, cases } }
  finally { try { await FileManager.remove(root); result.cleanup = true } catch (e: any) { result.cleanup = false; result.cleanupError = e.message } }
  Script.exit(result)
}
main()
