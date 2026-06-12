export const GIT_REPOS_DIR = FileManager.appGroupDocumentsDirectory + "/git-repos"
export const REPO_MAP_FILE = GIT_REPOS_DIR + "/repo-map.json"

export interface RepoMap {
  [projectDir: string]: string
}

// 获取项目对应的 gitdir 路径
// 写盘策略：仅当（1）显式传入 repoName 且与现有不一致，或（2）首次为该 projectDir 建立映射时，才写 repo-map.json。
export async function getGitdir(projectDir: string, repoName?: string): Promise<string> {
  // 确保 repos 目录存在
  if (!await FileManager.exists(GIT_REPOS_DIR)) {
    await FileManager.createDirectory(GIT_REPOS_DIR, true)
  }
  
  // 加载现有 repo map
  let repoMap: RepoMap = {}
  if (await FileManager.exists(REPO_MAP_FILE)) {
    try {
      const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
      repoMap = JSON.parse(content)
    } catch (e) {
      console.warn("⚠️ 读取 repo-map.json 失败，将重建")
      repoMap = {}
    }
  }
  
  const existing = repoMap[projectDir]
  
  // 显式指定 repoName
  if (repoName) {
    if (existing !== repoName) {
      repoMap[projectDir] = repoName
      await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
    }
    return GIT_REPOS_DIR + "/" + repoName
  }
  
  // 已有映射 → short-circuit，不写盘
  if (existing) {
    return GIT_REPOS_DIR + "/" + existing
  }
  
  // 首次建映射：用目录名生成 safeName
  const dirName = projectDir.split('/').filter(Boolean).pop() || 'unnamed'
  const safeName = dirName.replace(/[^a-zA-Z0-9_-]/g, '_')
  repoMap[projectDir] = safeName
  await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
  return GIT_REPOS_DIR + "/" + safeName
}


export async function gitList(): Promise<any> {
  if (!await FileManager.exists(REPO_MAP_FILE)) {
    return { repos: [] }
  }
  
  const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
  const repoMap: RepoMap = JSON.parse(content)
  
  const repos = Object.entries(repoMap).map(([projectDir, repoName]) => ({
    projectDir,
    repoName,
    gitdir: GIT_REPOS_DIR + "/" + repoName,
  }))
  
  return { repos }
}


export async function gitRemoveRepo(dir: string): Promise<any> {
  if (!await FileManager.exists(REPO_MAP_FILE)) {
    return { message: "No repos found" }
  }
  
  const content = await FileManager.readAsString(REPO_MAP_FILE, 'utf8')
  const repoMap: RepoMap = JSON.parse(content)
  
  if (!repoMap[dir]) {
    return { message: `No repo found for '${dir}'` }
  }
  
  const repoName = repoMap[dir]
  delete repoMap[dir]
  await FileManager.writeAsString(REPO_MAP_FILE, JSON.stringify(repoMap, null, 2), 'utf8')
  
  // 可选：删除 gitdir 目录
  // await FileManager.remove(GIT_REPOS_DIR + "/" + repoName)
  
  return { message: `Removed repo mapping for '${dir}'`, repoName }
}

