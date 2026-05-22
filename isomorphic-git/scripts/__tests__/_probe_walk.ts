// @ts-nocheck
import { Script } from "scripting"
import { loadBufferPolyfill } from "../polyfills"

async function main() {
  console.log("step 1: polyfill")
  await loadBufferPolyfill()
  console.log("step 2: read bundle")
  const SKILL_DIR = FileManager.scriptsDirectory + "/../scripting-skills/isomorphic-git"
  const code = await FileManager.readAsString(SKILL_DIR + "/vendor/index.umd.min.js", "utf8")
  console.log("step 3: bundle len =", code.length)
  const wrapped = "(function() {\n" +
    "var self = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});\n" +
    "var module = { exports: {} };\n" +
    "var exports = module.exports;\n" +
    code + "\n" +
    "return module.exports;\n" +
    "})()"
  console.log("step 4: eval")
  const g = eval(wrapped)
  console.log("step 5: probe types")
  const info = {
    TREE: typeof g.TREE,
    walk: typeof g.walk,
    WORKDIR: typeof g.WORKDIR,
    STAGE: typeof g.STAGE,
    readBlob: typeof g.readBlob,
  }
  console.log("RESULT:", JSON.stringify(info))
  Script.exit("ok")
}
main().catch(e => { console.error("ERR:", e.message); Script.exit("err") })
