import { Script } from "scripting"
import { dispatchGit } from "./git-dispatcher"
import type { GitCommand } from "./types"
dispatchGit(Script.queryParameters as unknown as GitCommand).then(result=>Script.exit(result))
