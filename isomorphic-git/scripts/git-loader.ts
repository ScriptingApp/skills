export const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"

// 加载 isomorphic-git
export async function loadGit(): Promise<any> {
  const bundlePath = SKILL_DIR + "/vendor/index.umd.min.js"
  
  if (!await FileManager.exists(bundlePath)) {
    throw new Error("isomorphic-git bundle 未找到: " + bundlePath)
  }

  const bundleCode = await FileManager.readAsString(bundlePath, 'utf8')
  
  const wrappedCode = "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    bundleCode + "\n" +
    "return module.exports;\n" +
    "})()"
  
  const git = eval(wrappedCode)
  
  if (!git || typeof git.init !== 'function') {
    throw new Error("加载 isomorphic-git 失败")
  }
  
  return git
}

