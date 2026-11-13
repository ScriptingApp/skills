import { createSnapshotStore } from './snapshot-store'
import { assertNoPendingRevert } from './revert-transaction'
import { acquireRepositoryLock } from './repository-lock'
export const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + '/git-repos'
export const REPO_MAP_FILE = GIT_REPOS_DIR + '/repo-map.json'
export interface RepoMap { [projectDir: string]: string }
function fail(code: string, message: string): never { const e: any = new Error(message); e.code = code; throw e }
function validateDir(dir: string) {
  if (typeof dir !== 'string' || !dir.startsWith('/') || dir.includes('\0') || dir.split('/').includes('..')) fail('INVALID_PROJECT_PATH', 'Expected an absolute project path without traversal')
}
function validateName(name: string) {
  // Project folder names commonly contain spaces (for example, "Daily Money").
  // Git stores these names in the App Group git-repos directory, so spaces are
  // safe; reject only path separators, traversal, control characters, and
  // empty/unsupported punctuation.
  if (typeof name !== 'string' || !/^[a-zA-Z0-9 _-]+$/.test(name) || name.trim().length === 0 || name.includes('..')) fail('INVALID_REPOSITORY_NAME', 'Use letters, digits, spaces, underscore or dash for repository name')
}
/**
 * iOS exposes the same tree as /var and /private/var, and repo-map keys are literal
 * strings captured from whatever path the caller used at init/clone time. Lookups
 * therefore try the canonical form, the legacy trailing-slash form, and the other
 * prefix, so one directory never ends up with two mappings.
 */
export function pathVariants(dir: string): string[] {
  const clean = dir.length > 1 ? dir.replace(/\/+$/, '') : dir
  const out: string[] = []
  const push = (value: string) => { if (value && !out.includes(value)) out.push(value) }
  push(clean)
  push(clean + '/')
  if (clean.startsWith('/var/')) push('/private' + clean)
  else if (clean.startsWith('/private/var/')) push(clean.slice('/private'.length))
  return out
}

export function lookupRepo(map: RepoMap, dir: string): { key: string; name: string } | undefined {
  for (const key of pathVariants(dir)) {
    const name = map[key]
    if (name) return { key, name }
  }
  return undefined
}

function sameProjectPath(a: string, b: string): boolean {
  return a === b || pathVariants(a).includes(b) || pathVariants(b).includes(a)
}

export function validateRepoMapContent(text:string): RepoMap {
  let value:any
  try {value=JSON.parse(text)}catch{fail('REPO_MAP_INVALID','Invalid repository map JSON')}
  if(!value||typeof value!=='object'||Array.isArray(value))fail('REPO_MAP_INVALID','Invalid repository map structure')
  const result:RepoMap=Object.create(null)
  for(const [dir,name]of Object.entries(value)){try{validateDir(dir);validateName(name as string)}catch{fail('REPO_MAP_INVALID','Invalid repository map entry')}result[dir]=name as string}
  return result
}
export interface RepoMapDependencies {
  exists(path: string): Promise<boolean>
  read(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  lock(root: string): Promise<() => Promise<void>>
}
const nativeDependencies: RepoMapDependencies = {
  exists: path => FileManager.exists(path),
  read: path => FileManager.readAsString(path, 'utf8'),
  write: (path, text) => FileManager.writeAsString(path, text, 'utf8'),
  // One map lock at the repos root; long repo operations use locks in children.
  lock: root => acquireRepositoryLock(root),
}
/** Same implementation for production and tests. Tests supply an isolated root. */
export function createRepoMapManager(root: string, deps: RepoMapDependencies = nativeDependencies) {
  const mapFile = root + '/repo-map.json'
  async function load(): Promise<RepoMap> {
    if (!await deps.exists(mapFile)) return Object.create(null)
    let value: any
    try { value = JSON.parse(await deps.read(mapFile)) }
    catch { fail('REPO_MAP_INVALID', 'Cannot read valid repo-map.json; refusing to rebuild or overwrite') }
    return validateRepoMapContent(JSON.stringify(value))
  }
  async function save(map: RepoMap): Promise<void> {
    try { await createSnapshotStore(mapFile,'map').protectedWrite(new TextEncoder().encode(JSON.stringify(map, null, 2)),()=>deps.write(mapFile, JSON.stringify(map, null, 2))) }
    catch (error: any) {
      error.phase = error.phase || 'repo-map-write'
      error.partial = error.partial ?? true
      throw error
    }
  }
  async function transaction<T>(body: () => Promise<T>): Promise<T> {
    const started = Date.now()
    let release: (() => Promise<void>) | undefined
    while (!release) {
      try { release = await deps.lock(root) }
      catch (e: any) {
        if (e?.code !== 'REPOSITORY_BUSY') throw e
        if (Date.now() - started >= 3000) fail('REPO_MAP_BUSY', 'Repository map is busy or has a stale lock; do not auto-delete its owner lock')
        await new Promise<void>(r => setTimeout(r, 20))
      }
    }
    try { await createSnapshotStore(mapFile,'map').assertReady(); return await body() } finally { await release() }
  }
  async function existing(dir: string): Promise<string> {
    validateDir(dir)
    const map = await load(), hit = lookupRepo(map, dir)
    if (!hit) fail('REPOSITORY_NOT_FOUND', 'No existing repository mapping; initialize first')
    return root + '/' + hit.name
  }
  async function resolve(dir: string, name?: string): Promise<string> {
    validateDir(dir); if (name !== undefined) validateName(name)
    // Every potentially mutating resolver observes the map under the short lock.
    // Read-only callers use existing(), which never creates a lock/map.
    return transaction(async () => {
      const map = await load(), hit = lookupRepo(map, dir)
      if (hit) {
        if (name !== undefined && name !== hit.name) fail('REPO_REBIND_REQUIRED', 'Mapping established concurrently with another name')
        return root + '/' + hit.name
      }
      const selected = name ?? (dir.split('/').filter(Boolean).pop() || 'unnamed').replace(/[^a-zA-Z0-9_-]/g, '_')
      validateName(selected)
      if (Object.entries(map).some(([other, value]) => !sameProjectPath(other, dir) && value === selected)) fail('REPO_NAME_CONFLICT', 'Repository name already belongs to another project; choose a different name')
      if (await deps.exists(root + '/' + selected)) fail('REPO_NAME_CONFLICT', 'An unmapped gitdir already exists with this name; refusing to attach another project to its metadata')
      map[pathVariants(dir)[0]] = selected
      await save(map)
      return root + '/' + selected
    })
  }
  async function list() {
    const map = await load()
    return { repos: Object.entries(map).map(([projectDir, repoName]) => ({ projectDir, repoName, gitdir: root + '/' + repoName })) }
  }
  async function remove(dir: string) {
    validateDir(dir)
    if (!await deps.exists(mapFile)) return { message: 'No repos found' }
    return transaction(async () => {
      const map = await load(), hit = lookupRepo(map, dir)
      if (!hit) return { message: `No repo found for '${dir}'` }
      const release=await acquireRepositoryLock(root+'/'+hit.name)
      try{
        await assertNoPendingRevert(root+'/'+hit.name,dir)
        delete map[hit.key]
        await save(map)
      }finally{await release()}
      return { message: `Removed repo mapping for '${dir}'`, repoName: hit.name }
    })
  }
  return { resolve, existing, list, remove, mapFile, inspect:()=>createSnapshotStore(mapFile,'map').inspect() }
}
const productionMap = createRepoMapManager(GIT_REPOS_DIR)
export const getGitdir = productionMap.resolve
export const getExistingGitdir = productionMap.existing
export const gitList = productionMap.list
export const gitRemoveRepo = productionMap.remove

/** Use the dispatcher-pinned gitdir; library callers may still resolve once here. */
export async function getCommandGitdir(fs: any, dir: string, name?: string): Promise<string> {
  const binding = fs?.repositoryBinding
  if (binding) {
    if (binding.dir !== dir) fail('REPOSITORY_BINDING_MISMATCH', 'FS is bound to a different working directory')
    if (name !== undefined && binding.gitdir.split('/').pop() !== name) fail('REPOSITORY_BINDING_MISMATCH', 'FS gitdir does not match requested repository name')
    return binding.gitdir
  }
  return getGitdir(dir, name)
}
