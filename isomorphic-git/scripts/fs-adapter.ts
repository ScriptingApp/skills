/**
 * Shared FS adapter for isomorphic-git in Scripting.
 *
 * It routes git-internal paths to the external gitdir and project paths to workdir,
 * so the working directory remains clean while `.git` lives in App Group storage.
 */

declare const Buffer: any
declare const require: any

/**
 * Return a standalone Uint8Array whose underlying ArrayBuffer exactly matches the
 * byte range, with zero byteOffset. FileManager.writeAsBytes rejects sub-views that
 * carry a non-zero byteOffset or share a larger pooled buffer (e.g. Buffer polyfill),
 * surfacing as `invalid "Data" argument`. Copying guarantees a clean, exact buffer.
 */
function toStandaloneBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes
  }
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy
}

/**
 * Physical IO layer.
 *
 * Scripting now ships real Node `fs` / `Buffer`, so we prefer the synchronous Node
 * `fs` API (it round-trips binary correctly and exposes full POSIX stat fields).
 * The legacy `FileManager` bridge is kept as a fallback for older app builds where
 * `require('fs')` is unavailable. This also sidesteps `FileManager.writeAsBytes`
 * rejecting pooled / offset Uint8Array sub-views with `invalid "Data" argument`.
 */
let _nodeFs: any = null
let _nodeFsResolved = false
function nodeFs(): any {
  if (_nodeFsResolved) return _nodeFs
  _nodeFsResolved = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = typeof require === 'function' ? require('fs') : null
    if (fs && typeof fs.writeFileSync === 'function' && typeof fs.readFileSync === 'function') {
      _nodeFs = fs
    }
  } catch (_e) {
    _nodeFs = null
  }
  return _nodeFs
}

const pfs = {
  async readAsString(path: string): Promise<string> {
    const fs = nodeFs()
    if (fs) return fs.readFileSync(path, 'utf8')
    return await FileManager.readAsString(path, 'utf8')
  },
  async readAsBytes(path: string): Promise<Uint8Array> {
    const fs = nodeFs()
    if (fs) return fs.readFileSync(path)
    return await FileManager.readAsBytes(path)
  },
  async writeAsString(path: string, data: string): Promise<void> {
    const fs = nodeFs()
    if (fs) { fs.writeFileSync(path, data, 'utf8'); return }
    await FileManager.writeAsString(path, data, 'utf8')
  },
  async writeAsBytes(path: string, bytes: Uint8Array): Promise<void> {
    const fs = nodeFs()
    if (fs) {
      const buf = typeof Buffer !== 'undefined' ? Buffer.from(bytes) : bytes
      fs.writeFileSync(path, buf)
      return
    }
    await FileManager.writeAsBytes(path, toStandaloneBytes(bytes))
  },
  async exists(path: string): Promise<boolean> {
    const fs = nodeFs()
    if (fs) return fs.existsSync(path)
    return await FileManager.exists(path)
  },
  async createDirectory(path: string, recursive: boolean): Promise<void> {
    const fs = nodeFs()
    if (fs) { fs.mkdirSync(path, { recursive }); return }
    await FileManager.createDirectory(path, recursive)
  },
  async remove(path: string): Promise<void> {
    const fs = nodeFs()
    if (fs) { fs.rmSync(path, { recursive: true, force: true }); return }
    await FileManager.remove(path)
  },
  async readDirectory(path: string): Promise<string[]> {
    const fs = nodeFs()
    if (fs) return fs.readdirSync(path)
    return await FileManager.readDirectory(path)
  },
  async rename(oldPath: string, newPath: string): Promise<void> {
    const fs = nodeFs()
    if (fs) { fs.renameSync(oldPath, newPath); return }
    await FileManager.rename(oldPath, newPath)
  },
  async symlink(target: string, path: string): Promise<void> {
    const fs = nodeFs()
    if (fs) { fs.symlinkSync(target, path); return }
    await FileManager.createLink(path, target)
  },
  async readlink(path: string): Promise<string> {
    const fs = nodeFs()
    if (fs) return fs.readlinkSync(path, 'utf8')
    return await FileManager.destinationOfSymbolicLink(path)
  },
  /** Returns a normalized stat-ish object or throws ENOENT-like error. */
  async statInfo(path: string): Promise<{ isFile: boolean; isDir: boolean; isLink: boolean; size: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number; uid: number; gid: number; mode: number } | null> {
    const fs = nodeFs()
    if (fs) {
      const st = fs.lstatSync(path)
      return {
        isFile: st.isFile(),
        isDir: st.isDirectory(),
        isLink: st.isSymbolicLink(),
        size: st.size || 0,
        mtimeMs: st.mtimeMs || 0,
        ctimeMs: st.ctimeMs || st.mtimeMs || 0,
        dev: st.dev || 0,
        ino: st.ino || 0,
        uid: st.uid || 0,
        gid: st.gid || 0,
        mode: st.mode || (st.isDirectory() ? 0o40000 : 0o100644),
      }
    }
    const st = await FileManager.stat(path)
    const isFile = await FileManager.isFile(path)
    const isDir = await FileManager.isDirectory(path)
    const mtimeMs = (st.modificationDate || 0) * 1000
    const ctimeMs = st.creationDate ? st.creationDate * 1000 : mtimeMs
    return {
      isFile, isDir, isLink: false,
      size: st.size || 0,
      mtimeMs, ctimeMs,
      dev: 0, ino: 0, uid: 0, gid: 0,
      mode: isDir ? 0o40000 : 0o100644,
    }
  },
}

const GIT_INTERNAL_PATTERNS = [
  'HEAD', 'config', 'index', 'COMMIT_EDITMSG', 'MERGE_HEAD',
  'FETCH_HEAD', 'ORIG_HEAD', 'packed-refs',
  'objects/', 'refs/', 'info/', 'hooks/', 'logs/',
  'description', 'shallow', 'deepen'
]

export interface ScriptingGitFSOptions {
  onReadFile?: (filepath: string, resolvedPath: string) => void
  onPhysicalReadFile?: (filepath: string, resolvedPath: string) => void
  onReadFileCacheHit?: (filepath: string, resolvedPath: string) => void
  onStat?: (filepath: string, resolvedPath: string) => void
}

export function isGitInternalPath(filepath: string): boolean {
  if (filepath.startsWith('.git/') || filepath === '.git') return true
  for (const pattern of GIT_INTERNAL_PATTERNS) {
    if (filepath === pattern || filepath.startsWith(pattern)) return true
  }
  return false
}

export function createFS(gitdir: string, workdir: string, options: ScriptingGitFSOptions = {}) {
  const textReadCache = new Map<string, string>()

  function shouldCacheTextRead(resolvedPath: string): boolean {
    return resolvedPath.endsWith('/.gitignore') || resolvedPath === gitdir + '/info/exclude'
  }

  function invalidateTextReadCache() {
    textReadCache.clear()
  }

  function createNoEntryError(operation: string, filepath: any): any {
    const err = new Error(`ENOENT: no such file or directory, ${operation} '${String(filepath)}'`)
    ;(err as any).code = 'ENOENT'
    return err
  }

  function resolvePath(filepath: string): string {
    if (typeof filepath !== 'string') throw createNoEntryError('resolve', filepath)
    if (filepath.startsWith('/')) return filepath
    const cleanPath = filepath.startsWith('.git/') ? filepath.substring(5) : filepath
    if (isGitInternalPath(cleanPath)) {
      return gitdir + '/' + cleanPath
    }
    return workdir + '/' + filepath
  }

  return {
    resolvePath,

    async readFile(filepath: string, opts?: any): Promise<any> {
      try {
        const resolved = resolvePath(filepath)
        options.onReadFile?.(filepath, resolved)
        // 处理 opts 是字符串的情况（如 'utf8'）或对象的情况（如 { encoding: 'utf8' }）
        const encoding = typeof opts === 'string' ? opts : opts?.encoding
        if (encoding === 'utf8') {
          if (shouldCacheTextRead(resolved)) {
            const cached = textReadCache.get(resolved)
            if (cached !== undefined) {
              options.onReadFileCacheHit?.(filepath, resolved)
              return cached
            }
            options.onPhysicalReadFile?.(filepath, resolved)
            const text = await pfs.readAsString(resolved)
            textReadCache.set(resolved, text)
            return text
          }
          options.onPhysicalReadFile?.(filepath, resolved)
          return await pfs.readAsString(resolved)
        }
        options.onPhysicalReadFile?.(filepath, resolved)
        const bytes = await pfs.readAsBytes(resolved)
        // Scripting iOS 原生桥返回的 Uint8Array 底层 ArrayBuffer 是只读的
        // isomorphic-git 内部会修改 buffer（delta 压缩、packfile 生成），必须复制到可写内存
        const writable = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(writable).set(bytes)
        return Buffer.from(writable)
      } catch (e: any) {
        const err = new Error(`ENOENT: no such file or directory, open '${String(filepath)}'`)
        ;(err as any).code = 'ENOENT'
        throw err
      }
    },

    async writeFile(filepath: string, data: any, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      invalidateTextReadCache()
      const parentDir = resolved.substring(0, resolved.lastIndexOf('/'))
      try {
        if (!await pfs.exists(parentDir)) {
          await pfs.createDirectory(parentDir, true)
        }
      } catch (_e) { /* 忽略 */ }
      if (typeof data === 'string') {
        await pfs.writeAsString(resolved, data)
        return
      }
      // 规范化二进制为准确范围的 Uint8Array
      // 顺序重要：Buffer extends Uint8Array，必须先检查 Buffer.isBuffer / ArrayBuffer
      let bytes: Uint8Array
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      } else if (data instanceof ArrayBuffer) {
        bytes = new Uint8Array(data)
      } else if (data instanceof Uint8Array) {
        // 明确带 byteOffset/byteLength 以防 sub-view
        bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      } else {
        bytes = new Uint8Array(data)
      }
      await pfs.writeAsBytes(resolved, bytes)
    },

    async mkdir(filepath: string, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      try { await pfs.createDirectory(resolved, true) } catch (_e) { /* 已存在 */ }
    },

    async rmdir(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      invalidateTextReadCache()
      try { await pfs.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async unlink(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      invalidateTextReadCache()
      try { await pfs.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async exists(filepath: string): Promise<boolean> {
      try { return typeof filepath === 'string' && await pfs.exists(resolvePath(filepath)) } catch (_e) { return false }
    },

    async readdir(filepath: string): Promise<string[]> {
      return await pfs.readDirectory(resolvePath(filepath))
    },

    async stat(filepath: string): Promise<any> {
      const resolved = resolvePath(filepath)
      options.onStat?.(filepath, resolved)
      try {
        const info = await pfs.statInfo(resolved)
        if (!info) throw createNoEntryError('stat', filepath)
        // isomorphic-git 的 index stat cache 会比较 dev/ino/uid/gid/mode/ctime/mtime/size。
        // 必须填稳定值，否则 undefined % 2^32 会变 NaN，NaN !== NaN 导致误判 stat changed。
        return {
          type: info.isFile ? 'file' : info.isDir ? 'dir' : 'symlink',
          mode: info.mode,
          size: info.size,
          dev: info.dev,
          ino: info.ino,
          uid: info.uid,
          gid: info.gid,
          mtimeMs: info.mtimeMs,
          ctimeMs: info.ctimeMs,
          isFile: () => info.isFile,
          isDirectory: () => info.isDir,
          isSymbolicLink: () => info.isLink,
        }
      } catch (e) {
        const err = new Error(`ENOENT: no such file or directory, stat '${String(filepath)}'`)
        ;(err as any).code = 'ENOENT'
        throw err
      }
    },

    async lstat(filepath: string): Promise<any> {
      return this.stat(filepath)
    },

    async readlink(filepath: string): Promise<string> {
      return await pfs.readlink(resolvePath(filepath))
    },

    async symlink(target: string, filepath: string): Promise<void> {
      invalidateTextReadCache()
      await pfs.symlink(target, resolvePath(filepath))
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      invalidateTextReadCache()
      await pfs.rename(resolvePath(oldPath), resolvePath(newPath))
    },
  }
}
