/**
 * Shared FS adapter for isomorphic-git in Scripting.
 *
 * It routes git-internal paths to the external gitdir and project paths to workdir,
 * so the working directory remains clean while `.git` lives in App Group storage.
 */

declare const Buffer: any

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
            const text = await FileManager.readAsString(resolved, 'utf8')
            textReadCache.set(resolved, text)
            return text
          }
          options.onPhysicalReadFile?.(filepath, resolved)
          return await FileManager.readAsString(resolved, 'utf8')
        }
        options.onPhysicalReadFile?.(filepath, resolved)
        const bytes = await FileManager.readAsBytes(resolved)
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
        if (!await FileManager.exists(parentDir)) {
          await FileManager.createDirectory(parentDir, true)
        }
      } catch (_e) { /* 忽略 */ }
      if (typeof data === 'string') {
        await FileManager.writeAsString(resolved, data, 'utf8')
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
      await FileManager.writeAsBytes(resolved, bytes)
    },

    async mkdir(filepath: string, _opts?: any): Promise<void> {
      const resolved = resolvePath(filepath)
      try { await FileManager.createDirectory(resolved, true) } catch (_e) { /* 已存在 */ }
    },

    async rmdir(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      invalidateTextReadCache()
      try { await FileManager.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async unlink(filepath: string): Promise<void> {
      const resolved = resolvePath(filepath)
      invalidateTextReadCache()
      try { await FileManager.remove(resolved) } catch (_e) { /* may not exist */ }
    },

    async exists(filepath: string): Promise<boolean> {
      try { return typeof filepath === 'string' && await FileManager.exists(resolvePath(filepath)) } catch (_e) { return false }
    },

    async readdir(filepath: string): Promise<string[]> {
      return await FileManager.readDirectory(resolvePath(filepath))
    },

    async stat(filepath: string): Promise<any> {
      const resolved = resolvePath(filepath)
      options.onStat?.(filepath, resolved)
      try {
        const st = await FileManager.stat(resolved)
        const isFile = await FileManager.isFile(resolved)
        const isDir = await FileManager.isDirectory(resolved)
        const mtimeMs = (st.modificationDate || 0) * 1000
        // isomorphic-git 的 index stat cache 会比较 dev/ino/uid/gid/mode/ctime/mtime/size。
        // Scripting FileManager.stat() 不提供完整 POSIX 字段时必须填稳定默认值，
        // 否则 undefined % 2^32 会变成 NaN，导致 NaN !== NaN，进而让未修改文件
        // 被误判为 stat changed，并退化为 readFile + hash 全量重算。
        const ctimeMs = st.creationDate ? st.creationDate * 1000 : mtimeMs
        return {
          type: isFile ? 'file' : isDir ? 'dir' : 'symlink',
          mode: isDir ? 0o40000 : 0o100644,
          size: st.size || 0,
          dev: 0,
          ino: 0,
          uid: 0,
          gid: 0,
          mtimeMs,
          ctimeMs,
          isFile: () => isFile,
          isDirectory: () => isDir,
          isSymbolicLink: () => false,
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
      return FileManager.destinationOfSymbolicLink(resolvePath(filepath))
    },

    async symlink(target: string, filepath: string): Promise<void> {
      invalidateTextReadCache()
      await FileManager.createLink(resolvePath(filepath), target)
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      invalidateTextReadCache()
      await FileManager.rename(resolvePath(oldPath), resolvePath(newPath))
    },
  }
}
