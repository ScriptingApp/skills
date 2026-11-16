---
name: phone-use
description: See and operate the real iPhone screen. Reads the accessibility UI tree of whatever app is in front (text + logical-point frames), taps by label or coordinates, types text, scrolls, launches apps, and captures screenshots when the visual matters. Requires the Loopback script (it owns pairing and the developer tunnel); run "bootstrap" first on a new device and hand the user the install link if it is missing.
runtime: node
entry: scripts/phone.ts
metadata:
  display_name: "Phone Use"
  intent_patterns: "operate the iphone, tap on the phone, look at the phone screen, control another app, read another app's UI, screenshot the phone, swipe, open an app"
  required_tools: "run_shell_command, file_tool"
  input_schema_file: "schema.json"
---

# Purpose

Give the agent eyes and a finger on the real device, through the local developer tunnel that the **Loopback** script prepares.

- **Eyes** = the accessibility (AX) tree: every element with its label and a frame in logical points. About 1.5–3 s per read and ~2–4 KB of text — cheap, precise, and directly tappable.
- **Finger** = the `hid.indigo` digitizer, which reaches *other* apps (the plain `universalhidservice` surface only reaches Scripting itself).
- **Screenshot** = opt-in, only when "what does it look like" matters (costs ~450 ms and ~640 KB).

Use it when the user asks to operate another app, fill a form, press a button, navigate Settings, or verify what the phone shows.

# Requirements

- **The Loopback script must be installed and paired.** It owns the pairing material and the developer tunnel; this skill only asks it for a tunnel. Nothing here works without it.
- Scripting has the `localDevVPN` and `vpn` permissions granted.
- A non-cellular network (Wi-Fi) — on pure cellular the pairing service binds only to loopback, so the tunnel cannot come up.
- iOS 17+; verified on iOS 27.2 (iPhone 15 Pro).

## If Loopback is missing

Every action that needs the tunnel returns `ok:false` plus:

```json
{"needsLoopback":true,"installUrl":"scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fscripts%2Ftree%2Fmain%2FLoopback%22%5D","hint":"..."}
```

When you see that, **show the user the link and stop** — do not retry blindly:

> 需要先安装 Loopback 脚本（负责配对 + 开隧道）：[点这里导入 Loopback](scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fscripts%2Ftree%2Fmain%2FLoopback%22%5D)

After the user imports it, run `{"action":"status"}` — it reports `loopback.installed` and `tunnel` (`ready` / `unavailable`) without needing the tunnel itself.

# Instructions

## 0. First run on this device — always start here

```json
{"action":"bootstrap"}
```

It returns a checklist without needing the tunnel:

```json
{"ok":true,"loopback":{"installed":false,"path":null},
 "needsLoopback":true,
 "installUrl":"scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fscripts%2Ftree%2Fmain%2FLoopback%22%5D",
 "steps":[{"step":"install-loopback","done":false,"url":"scripting://…"}]}
```

`ready:true` means you can go straight to `look`. Otherwise walk the `steps` with the user, showing `installUrl` as a link:

> 需要先安装 Loopback 脚本（负责配对 + 开隧道）：[点这里导入 Loopback](scripting://import_scripts?urls=%5B%22https%3A%2F%2Fgithub.com%2FScriptingApp%2Fscripts%2Ftree%2Fmain%2FLoopback%22%5D)

Then ask them to open Loopback once and approve pairing. Re-run `bootstrap` until `ready:true`.

Every action runs through `run_shell_command`:

```
scripting-ts run <skill_dir>/scripts/phone.ts --queryparameters '{"action":"look"}' --timeout 240
```

`--timeout` must be generous: one call can spend 1–2 s opening the tunnel plus a few seconds per read.

## 1. Look

```json
{"action":"look"}
```

```json
{"ok":true,"source":"ax","app":{"pid":28468,"tree":"additional"},"screen":{"width":393,"height":852},
 "count":14,
 "elements":[
  {"i":0,"t":1,"x":0,"y":0,"w":393,"h":852,"text":"设置"},
  {"i":1,"t":6,"x":16,"y":117,"w":65,"h":41,"text":"设置"},
  {"i":2,"t":2,"x":16,"y":165,"w":361,"h":90,"text":"Thom Fang、Apple账户、iCloud等"},
  {"i":4,"t":3,"x":16,"y":353,"w":361,"h":52,"text":"飞行模式"}],
 "ms":1548}
```

Read the `elements` array — that *is* the screen. `x/y/w/h` are logical points, origin at the top-left.

If the reply contains `"locked":true`, the phone is on the lock screen and gestures do nothing. Ask the user to unlock it, then retry — don't guess coordinates.

`t` is Apple's element type code. Empirically: `1` app root, `2` button / tappable row, `3` switch, `4` image, `6` text heading, `7` icon, `14` static text, `19` collection cell. Treat it as a hint, not a contract.

Useful options:

```json
{"action":"look","limit":40}
{"action":"look","filter":"电池"}
{"action":"look","filter":"/关|开/"}
{"action":"look","includeUnlabeled":true}
{"action":"look","format":"text"}
{"action":"look","screenshot":true}
```

`filter` keeps only elements whose label/identifier matches (substring, or `/regex/`) — the cheapest way to answer “is X on screen”.

`format:"text"` returns a `table` string instead of the `elements` array — one line per element (`#12 t2 16,693 361x52 无障碍`), roughly a third fewer tokens for the same information. `includeUnlabeled` exposes controls that carry no text (switches, empty cells). `screenshot` adds `screenshot: "<path>"` — read that path with your image capability when the layout itself matters (charts, colours, canvas, photo pickers). Screenshots are **shrunk automatically**: 900 px wide JPEG at quality 0.7 (about a third of the PNG size). Tune with `maxWidth` / `quality`, or pass `imageFormat:"png", maxWidth:0` for lossless full size.

Inside a `sequence`, add `"diff":true` to a step to get `{summary, added, removed, moved, unchanged}` comparing the screen with the previous look in that sequence — much cheaper than re-reading a long list.

## 2. Act

Tap by label (recommended — no coordinates to guess):

```json
{"action":"tap","text":"电池"}
{"action":"tap","text":"关闭","ifNotFound":"skip"}
```

Matching is case-insensitive and tiered: exact label first, then prefix, then substring. Within a tier a tappable row (`t:2`) wins, largest first; otherwise the smallest match wins (that is the inner text, not the whole list). **A built-in alias table covers wording drift** (无障碍/辅助功能/Accessibility, 无线局域网/WLAN/Wi-Fi, 电池/Battery, 返回/Back …): if the literal word is not on screen, equivalent terms are tried before giving up. Tiers exist because substring alone is treacherous on Settings-style rows whose label is `标题、值` — searching `关闭` would otherwise hit `个人热点、关闭`. `ifNotFound:"skip"` turns a miss into `{skipped:true,visible:[...]}` instead of an error — useful when a step is optional (closing a sheet that may not be there).

Tap by element index from a fresh look, or by raw points:

```json
{"action":"tap","index":9}
{"action":"tap","x":196,"y":640}
```

Hit a specific part of a control instead of its centre (`align`) — the row centre is often the label, while the toggle or the chevron is at one end:

```json
{"action":"tap","text":"蓝牙","align":"right"}
{"action":"tap","text":"电池","align":"right","dx":-24}
{"action":"tap","text":"通知","align":"left","dx":36,"dy":-2}
```

`align` is `left / center / right` inside the element's own frame (left/right are inset 8 pt so the point stays on the control), and `dx`/`dy` add a point offset on top.

Tap and verify in one call:

```json
{"action":"tap","text":"电池","observe":true}
{"action":"tap","text":"电池","observe":true,"retryNext":2}
```

`observe` re-reads the tree and returns it as `after`, plus `changed: true|false`. **`changed:false` means the tap did not move the UI** — re-look and pick a different target instead of assuming success. `retryNext` automates that: when nothing changed it taps the next-best candidate (same word often matches a heading, a row and a switch) and reports `attempts`.

Swipe / scroll (`observe` works here too):

```json
{"action":"swipe","x1":196,"y1":700,"x2":196,"y2":300,"steps":12}
```

Drag with a real press-and-hold first (reorder icons, drag a slider, drag a file). A quick drag just scrolls; a held drag is what apps read as “pick this up”:

```json
{"action":"drag","x1":196,"y1":300,"x2":196,"y2":700,"holdMs":700,"observe":true}
```

`holdMs` (default 600) is how long the finger stays put before moving; `segments` (default 20) is how many interpolated moves follow. Lower `holdMs` toward 100 to get a slow scroll instead of a grab.

Find something that is inside a list but off-screen (`scrollTo`):

```json
{"action":"scrollTo","text":"辅助功能","tap":true,"observe":true}
{"action":"scrollTo","text":"通用","direction":"up","maxScrolls":3}
```

Read a whole list, not just the visible part (`readList`):

```json
{"action":"readList"}
{"action":"readList","maxPages":6,"format":"text","limit":120}
{"action":"readList","filter":"未读"}
{"action":"readList","direction":"up","includeUnlabeled":true}
```

It swipes a screen at a time, merges each page into one ordered list and stops when the screen stops moving (or at `maxPages`). Returns `{pages, reachedEnd, count, shown, items:[{i,t,x,y,w,h,text}]}` — `format:"text"` swaps `items` for the compact `table` string. Pages are aligned by “tail of what I have == head of the new screen”, so repeated labels (a column of 「赞」「回复」) are not swallowed as duplicates; when the two do not line up it falls back to a multiset difference instead of appending the screen twice. Use it for chat history, long settings lists, contact lists — anything where “what is on screen” is not the answer. **The `i` here is a merged index, so you cannot `tap` by it for rows that are scrolled off screen**; tap by text after `scrollTo`.

`scrollTo` looks at the current view first, then swipes up to `maxScrolls` times, checking the tree after each swipe. When the first direction fails it taps the status bar (iOS's scroll-to-top) and sweeps the other way, unless `tryBoth:false`. It returns `{found, scrolls, element}`; `tap:true` also taps the element, `observe:true` re-reads afterwards. When nothing is found it returns `visible` (labels with their y positions) so you can see what the list actually contains.

Wait for the UI to settle (`waitFor`) — use this instead of guessing with `wait`:

```json
{"action":"waitFor","text":"已连接","timeoutMs":8000}
{"action":"waitFor","text":"载入中","absent":true}
{"action":"waitFor","text":"允许","tap":true}
```

Returns `{matched, waitedMs, element?}` or `{matched:false, timedOut:true, visible:[...]}`. `tap:true` clicks the element the moment it appears.

Assert instead of wait (`expect`) — fails the whole step with the visible list when the screen is not what you assumed:

```json
{"action":"expect","text":"电池"}
{"action":"expect","text":"载入中","absent":true}
```

Long press (context menus, drag handles):

```json
{"action":"press","text":"照片","holdMs":800,"observe":true}
```

Hardware buttons:

```json
{"action":"button","name":"volumeUp"}
{"action":"button","name":"home"}
```

`name` is one of `home / lock / siri / volumeUp / volumeDown`. `lock` really locks the phone — unlock it before continuing.

Go back (`back`) — it taps the screen's own back button when there is one and only falls back to the left-edge swipe:

```json
{"action":"back"}
{"action":"back","observe":true}
{"action":"back","edgeOnly":true,"y":620}
```

Measured on iOS 27.2: the left-edge gesture alone is **not** accepted by the system here (even with `edge:left` in the digitizer event), while the bottom edge works for `home`. So the button path is the reliable one; `edgeOnly:true` forces the gesture.

Hardware-key shortcuts (`keyCombo`) — useful for select-all / copy / paste and for tabbing around:

```json
{"action":"keyCombo","mods":"cmd","key":"a"}
{"action":"keyCombo","mods":"cmd","key":"v"}
{"action":"keyCombo","mods":"shift+cmd","key":"z"}
{"action":"keyCombo","mods":"cmd","usage":80}
```

`mods` accepts `cmd / shift / alt / ctrl` (default `cmd`); `key` is one ASCII character, or pass `usage` for keys that have no character (0x50 ←, 0x4f →, 0x2a backspace). Modifiers are held down, the key is tapped, then they are released in reverse. It is a real HID chord — whether an app honours it is up to the app.

Type text (HID keyboard, works in any app):

```json
{"action":"type","field":"搜索栏","text":"wifi","observe":true}
{"action":"type","text":"hello","enter":true}
{"action":"type","field":"搜索栏","backspaces":9,"text":"dianchi"}
{"action":"type","backspaces":20}
```

`backspaces:N` presses Backspace N times **before** typing, which is how you clear a field that already has a value (`text` may be omitted when you only want to clear). Backspace is a real HID key press, not a UI button.

Chinese text (or emoji, or a long paragraph) — put it on the clipboard and paste it:

```json
{"action":"paste","field":"搜索栏","text":"电池健康"}
{"action":"paste","x":196,"y":420,"text":"我明天到，麻烦留个门 🙏"}
```

`paste` writes the system clipboard, focuses the field (by `field` or `x/y`), long-presses to raise the edit bubble and taps 「粘贴」. It returns `{pasted, via, at, menuAt, field}` where `via` is `menu` (the bubble) or `cmd-v` (keyboard fallback). This is **the intended way to enter anything that is not plain ASCII**, and it is much faster than typing character by character.

Two gotchas it already handles: a screen can carry two elements with the same label (the real field and a toolbar copy — it taps, checks whether anything changed, and moves on if not), and after focusing the field often **moves** (Settings' search field jumps from y≈786 to y≈431), so the anchor is re-read before pressing. The keyboard's shortcut bar also has an element named 「粘贴」 (`t:7`) which does nothing — those are ignored.

**Known caveat (verified on iOS 27.2):** the edit bubble is a system overlay; its AX node can be reported at a position where a synthetic tap does not land, so `paste` occasionally reports `via:"menu"` without the text arriving. Always confirm with a `look`/`expect` afterwards. If it did not take, `ime` (pinyin) or `type` (ASCII) still work.

Alternate route, pinyin + candidate chip (needs the Chinese keyboard installed):

```json
{"action":"ime","field":"搜索栏","pinyin":"dianchi","expect":"电池","observe":true}
```

The keyboard only accepts HID usage codes, so `ime` types the pinyin letters, reads the candidate bar above the keyboard, taps the chip containing `expect`, and returns `{committed, candidate}`. It needs 简体拼音 enabled in Keyboard settings. When it returns `committed:false`, the candidate bar did not show up — fall back to ASCII or ask the user to type.

`field` taps that element first to focus it; omit it to type into whatever already has focus. For `type`, only **ASCII** characters can be sent — non-ASCII is reported in `skipped` because the HID keyboard has no IME of its own (use `ime` for Chinese).

Launch an app, go Home, or check health:

```json
{"action":"launch","bundleId":"com.apple.Preferences","settleMs":1500}
{"action":"home"}
{"action":"status"}
```

List the apps that are installed (so you never have to guess a bundle id):

```json
{"action":"apps","limit":20}
{"action":"apps","filter":"微信"}
{"action":"apps","format":"text","limit":0}
{"action":"apps","bundleId":"ph.telegra.Telegraph"}
```

Returns `{count, shown, apps:[{bundleId,name,version,build,source}]}` where `source` is `appStore / testFlight / development / distribution / other`. `format:"text"` gives one compact line per app (`Telegram  13.2.1(36542) · App Store · ph.telegra.Telegraph`) — cheapest for a long list. `limit` defaults to 40; the reply tells you how many were left out. With `bundleId` you get that single app's detail instead: version, `minOS`, `schemes` (its URL schemes) and how many Info.plist fields exist.

It goes through `installation_proxy`, which answers in ~70 ms for the whole list (71 apps on this device). The CoreDevice `listapps` feature also exists but hangs on this build, so don't reach for it.

## 3. Sequence — use this for any multi-step task

**Running the script brings Scripting itself to the foreground.** So a bare `look` inspects Scripting's own UI, not the app you care about. Every task must therefore start with `launch` (or `home`) inside the same run:

```json
{"action":"sequence","steps":[
  {"action":"launch","bundleId":"com.apple.Preferences","settleMs":1500},
  {"action":"tap","text":"电池","observe":true},
  {"action":"look","limit":20}
]}
```

A multi-step task in one `sequence` also reuses one tunnel, which is much faster than separate calls. Steps inherit top-level parameters; each step's own fields override them.

**Put `bundleId` at the top level too.** The foreground can drift back to Scripting on long runs; with `bundleId` present the skill notices the pid change and re-launches the app before acting, instead of swiping Scripting's own UI. Step results carry `app:{pid,name,self}` so you can see which app actually answered.

## 4. Macros — record once, replay by name

A finished sequence is worth keeping. Save it under a name; it lives in the app's storage, so it survives restarts:

```json
{"action":"macro","save":true,"name":"check-in","steps":[
  {"action":"launch","bundleId":"com.apple.Preferences"},
  {"action":"tap","text":"电池"}
]}
{"action":"macro","name":"check-in"}
{"action":"macro","list":true}
{"action":"macro","delete":true,"name":"check-in"}
```

Running a macro is exactly a `sequence`, so the same rules apply (top-level `bundleId` for self-healing, steps inherit top-level params). The reply carries `macro` and `steps` alongside the normal sequence result.

## 5. Loop

1. `look` → read `elements` → pick the target.
2. `tap` with `observe:true` → check `changed` and the new `after.elements`. If the screen is mid-animation, `waitFor` the expected text instead of `wait`.
3. `changed:false` → the target was not tappable (often a heading rather than the row). Re-look, choose another element, try `x/y` at the row centre, or swipe to bring the row into view.
4. Prefer text over coordinates. Use coordinates only when the tree has nothing usable (canvas, image, game) — then `look` with `screenshot:true` and measure in pixels, dividing by `scale` to get points.
5. Before irreversible actions (payment, delete, send, purchase confirm) ask the user.
6. Verify with evidence: the proof of a step is a changed tree (`changed:true`) or a screenshot that differs — never `ok:true` alone.

## 6. Service mode (optional) — for many calls in a row

Each `phone.ts` call pays for a process start plus a fresh tunnel (about **1.5 s** on top of the tree read). If you are going to make more than a handful of calls, start the resident server once and use `curl`:

```
scripting-ts run <skill_dir>/scripts/serve.ts --queryparameters '{"port":7777}' --timeout 900
```

Run that as a **background** shell job, then:

```
curl -s http://127.0.0.1:7777/health
curl -s -X POST http://127.0.0.1:7777/action -d '{"action":"look","limit":10}'
curl -s -X POST http://127.0.0.1:7777/action -d '{"action":"sequence","steps":[{"action":"launch","bundleId":"com.apple.Preferences"},{"action":"expect","text":"通用"}]}'
curl -s http://127.0.0.1:7777/cancel          # stop the running waitFor/readList/scrollTo
curl -s http://127.0.0.1:7777/tunnel
```

Measured: the first request is the same speed as a CLI call, later ones drop from ~3.4 s to ~1.8 s because the tunnel and the service list are cached (4-minute TTL; `"refresh":true` forces a new one). The endpoint takes exactly the same JSON as `phone.ts`, so every recipe above works unchanged.

Requests are **serialized** (one at a time) — two at once would interleave reads on the same tunnel connection and corrupt frames. `GET /health` reports `queued`. `GET /cancel` raises a cancel flag that `waitFor`, `readList` and `scrollTo` check between rounds, so a 30-second wait can be cut short.

Notes:

- The server keeps the app alive with `BackgroundKeeper.keepAlive("audio")`; verified to still answer `curl` while another app was frontmost. iOS may still suspend it eventually, and the job self-exits after `minutes` (default 120).
- Close the shell job when you are done; otherwise the port stays bound and the tunnel stays open.
- `/tunnel` returns `serverAddress` and `rsdPort` — the raw developer channel, not needed for normal work.

# Limits

- Scripting is **backgrounded** while it drives another app; iOS suspends scripts after a while. Keep automation in short bursts started by the user. (In service mode the process survives backgrounding, but not forever.)
- **If the phone locks itself**, `look` answers `locked:true` (with `lockReason`) and every gesture is ignored. Unlock it, or set Settings → Display & Brightness → Auto-Lock → Never while a long task runs. The flag requires the lock screen's big clock and bottom torch/camera controls, so a home screen with a Camera icon is **not** reported as locked.
- One tree read ≈ **1.2–1.8 s** at the default `graceMs:300` (the device generates the tree; the tunnel costs ~15 ms). A tap that resolves text costs one extra read. `readList` costs one read per screen, so a 10-screen list is ~15–20 s — ask for `maxPages` honestly.
- Some screens genuinely do not scroll (everything fits, or the content is one canvas). `readList` then returns one page with `reachedEnd:true` — that is a fact about the screen, not a failure.
- Typing is sent as HID keyboard events: ASCII only for `type`, about 40 ms per character. For anything else use `paste` (clipboard — reliable, any language, any length). `ime` (pinyin letters + candidate chip) is the fallback and depends on the Chinese keyboard being installed.
- Some surfaces answer with an empty tree (passcode/lock screen, camera preview, SpringBoard transition). The skill retries twice; if it stays empty, fall back to `screenshot`.
- Landscape, split view and iPad layouts are unverified; frames assume the current orientation.
- Elements without a label are hidden unless `includeUnlabeled:true`, so switches and sliders may need it.
- `apps` does **not** report disk usage: that number has to be computed per app on the device and takes ~30 s for a full library. Ask for it only if the user actually wants sizes.

# Troubleshooting

| Symptom | Meaning |
|---|---|
| `没有可用的 RSD 隧道` | Loopback is missing, unpaired, or the network is cellular-only. Check `status`. |
| `needsLoopback:true` | Loopback 未安装：把 `installUrl` 当链接发给用户，装完再重试。 |
| `设备没有提供 remoteAXService` | Accessibility service missing; check `"/status"` and Loopback's self-check page. |
| `AX 没有推任何树` | Screen locked, or nothing is frontmost. Unlock the phone, then retry; the skill already retries twice and unsubscribes cleanly. |
| `没找到「X」。当前可见：…` | The text is not on screen; the error lists what is. Scroll, or use a shorter substring. |
| `changed:false` | The tap landed on something non-interactive (a heading, a label inside the row). |
| `locked:true` | The phone locked itself. Unlock it; gestures are ignored on the lock screen. |
| Element text not found though you can see it | This OS build may use different wording (iOS 27 calls 辅助功能 **无障碍**). Read the `visible` list in the error/`scrollTo` result and copy the exact wording. |
| Coordinates do nothing | You passed pixels instead of points, or the layout scrolled since the look. |
