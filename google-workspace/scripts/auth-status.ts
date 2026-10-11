import { Script } from "scripting"
import { safeStatus } from "./lib/auth"

Script.exit({ ok: true, status: safeStatus() })
