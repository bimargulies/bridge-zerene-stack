# bridge-zerene-stack — context for Claude

## Goal
An Adobe Bridge extension: from the current Bridge folder, convert the images to TIFFs with Photoshop,
run **Zerene Stacker** headless (PMax + DMap, 16-bit LZW TIFF) through its Batch API, save the two
outputs in the stack folder, then delete the temporary TIFF folder. Written in TypeScript. Owner:
Benson Margulies. This repo was split out of `~/work/bridge-load-align` (the sibling project that does
Load Files into Layers + Auto-Align + Auto-Blend inside Photoshop); that repo no longer has any Zerene
code. The README is written for the Zerene Systems people, so keep it accurate and neutral.

## Background decisions
- Bridge cannot host UXP, so this is an **ExtendScript startup script**, compiled with `tsc` to ES5
  (TS 5.9 no longer offers ES3) into one file, `dist/ZereneStack.jsx`. Conventions copied from
  `~/work/c41`: pnpm, `"type": "module"`, tab-indented `package.json`, MIT LICENSE, README ending in
  an "AI usage" section. No vite/vitest.
- Git commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Commit only when
  Benson asks.
- Zerene runs through its **documented Batch API**, not by reverse engineering. Its jar is
  ProGuard-obfuscated (engine and most GUI classes are `a`, `b`, `aa`...; only `MainFrame` and
  `ComputerConfiguration` keep names). We read class-name/string constants only to find preference key
  names; we did not decompile, and a licence check is advisable before going further. Benson wants to
  show this repo to the Zerene people.
- Startup time of Zerene (a JVM) cannot be avoided: there is no socket, single-instance check or
  watched folder. Tested: `open -a /Applications/ZereneStacker.app <folder>` while it runs starts a
  second JVM instead of forwarding. Decided to give up on reducing startup time.

## Layout
- `src/main.ts` — everything. Pieces:
  - `convertToTiffSide(paths, tiffDir)` runs **inside Photoshop**. It is stringified with `toString()`
    and sent via BridgeTalk, so it must be self-contained: no outer-scope references, no helpers, no
    regexes, nothing TS down-levels with a helper (no spread / for-of). Photoshop globals are aliased
    as `any` with `@ts-ignore`. No `globalThis`. Opens each file with dialogs off, saves LZW TIFF.
    Reimplements Image Processor's open/save/close, because `Image Processor.jsx` has no headless entry
    point (dialog-driven).
  - `convertFolderAndAutoStack()` (Bridge side): lists `app.document.presentationPath`, filters image
    extensions, skips Zerene outputs (`ZS` token), creates `<folder>/TIFF-<yyyymmdd-hhmmss>`, sends
    the conversion to Photoshop, and in `onResult` calls `autoStackInZerene`.
  - `autoStackInZerene(stackDir, tiffDir, stamp)`: writes batch XML + a `/bin/sh` runner into
    `Folder.temp` and starts the runner detached (`... &`). The runner launches Zerene using
    `~/Library/Preferences/ZereneStacker/zerenstk.launchcmd` (Zerene rewrites it on every normal
    launch) plus `-noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript`, then moves
    the `ZS PMax`/`ZS DMap` tifs into the stack folder, `rm -rf`s the TIFF dir only if both exist and
    its name starts with `TIFF-`, posts a notification, and logs to
    `~/Library/Logs/BridgeZereneStack.log`.
  - `zereneTaskXml(code)`, `DMAP_CONTRAST_PERCENTILE` (30), `shq`, `xmlEsc`, `writeTextFile`.
- `src/globals.d.ts` — minimal ambient types for Bridge/BridgeTalk/File/Folder.
- `scripts/install.mjs` — copies `dist/ZereneStack.jsx` to every
  `~/Library/Application Support/Adobe/Bridge*/Startup Scripts/`.
- `.claude/settings.local.json` (untracked) allows quitting/opening Bridge 2027 via osascript/open.

## Zerene facts (verified)
- Batch API doc: https://www.zerenesystems.com/cms/stacker/docs/batchapi. Flags: `-batchScript`,
  `-exitOnBatchScriptCompletion`, `-runMinimized`, `-noSplashScreen`; the Java launch command must be
  used directly (not the app launcher, which returns immediately).
- Batch XML: `ZereneStackerBatchScript/BatchQueue/Batches/Batch` with `<Sources><Source value="/dir"/>`,
  `ProjectDispositionCode 101`, and `<Tasks>` of `<Task>` with `OutputImageDispositionCode 2` (save in
  source folder), `<Preferences>`, `TaskIndicatorCode`. **Code 1 = PMax, 2 = DMap** (2 found by trial;
  confirmed by output names). Both tasks in one batch work (~1 min for 4 frames of 6336x9504).
- Task preferences that work: `SaveImage.FileType=tif`, `SaveImage.BitsPerColor=16`,
  `SaveImage.CompressionType=LZW` (Zerene's log shows "LZW selected", 48 pixel bits). They are not
  persisted to `zerenstk.cfg`.
- **DMap prompts for a contrast threshold unless** `DepthMapControl.UseFixedContrastThresholdPercentile=true`
  and `DepthMapControl.ContrastThresholdPercentile=<n>` are set on the DMap task (default 30). Other
  keys seen in the jar: `ContrastThresholdLevel`, `UseFixedContrastThresholdLevel`, `EstimationRadius`,
  `SmoothingRadius`, `UsedPixelFractionThreshold`, `SaveDepthMapImage`, `SaveUsedPixelImages`.
- Zerene output names: `<yyyy-mm-dd-hh.mm.ss> ZS PMax.tif` / `... ZS DMap.tif`. A stack folder looks
  like `~/Bridge/New/<date>/stack-NNN/` holding DNGs (Benson's older stacks used a `TIFF` subfolder).
- Zerene logs: `~/Library/Preferences/ZereneStacker/LastNormalLog.txt`, written only on exit.
- `/Applications/Adobe Acrobat DC/ZereneStacker.app` is a stray second copy; `open -a ZereneStacker`
  can pick it. Always use `/Applications/ZereneStacker.app`.

## ExtendScript pitfalls (all hit for real)
- `File.write` uses **CR line endings by default** on macOS: set `f.lineFeed = "Unix"` for shell
  scripts. This made the first runner silently do nothing (sh read one long line, output was
  discarded). Hence the runner now logs.
- Bridge `File.name`/`Folder.name` are **URL-encoded** (`%20`): `decodeURI` before testing names.
- **Regexes inside a function sent to Photoshop as text get mangled**; use string methods there.
- `app.system()` returns the exit status (x256), not output; shell env has the user's `HOME`/`PATH`.
- Non-ASCII in menu labels gets mangled; keep the `.jsx` ASCII. Menu location
  `at the end of Tools/Photoshop` may not exist in every Bridge version; fallback is
  `at the end of Tools`.
- Exceptions in a BridgeTalk `onResult` handler can vanish silently; wrap in try/catch + `alert`.

## Testing / debugging without clicking the menu
- Photoshop 2027 and Bridge 2027 are the installed versions (the `Adobe Photoshop 2026` folder is an
  empty shell). Use an AppleScript *file*: `tell application "Adobe Photoshop 2027" to do javascript
  (read POSIX file "x.jsx")`. Bridge has no AppleScript `do javascript`.
- To run code **inside Bridge**: send it from Photoshop with BridgeTalk
  (`BridgeTalk.getSpecifier("bridge")`, `bt.send(20)` is synchronous, result in `onResult`). Global
  functions from the startup script (e.g. `autoStackInZerene`) are callable that way. Caveat: `\n`
  escapes in the probe text arrive literally; use `String.fromCharCode(10)`.
- The tool shell cannot list Bridge's temp folder (`.../T/TemporaryItems`, EPERM); read it from inside
  Bridge instead.
- Headless Zerene by hand: `CMD=$(cat ~/Library/Preferences/ZereneStacker/zerenstk.launchcmd)` then
  `sh -c "$CMD -noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript x.xml </dev/null
  >/dev/null 2>&1"`. If a dialog ever appears in this mode the run hangs invisibly; always use a timeout
  when testing. Check whether the user's own Zerene is running first (`pgrep -f stacker.gui.MainFrame`)
  and never kill it.
- Restart Bridge after `pnpm run install-ext`: quit via
  `osascript -e 'tell application "Adobe Bridge 2027" to quit'`, then `open -a "Adobe Bridge 2027"`.

## Commands
- `pnpm install`, `pnpm run build`, `pnpm run install-ext` (build + install), then restart Bridge.
- Use: open a stack folder in Bridge, then Tools > Photoshop > "Convert Folder to TIFF + Auto-Stack in
  Zerene (PMax + DMap)".

## Status
- Works end to end on Benson's real stacks (verified by Benson after the line-ending and DMap-threshold
  fixes). The DMap threshold fix was tested headless on a copy and is installed; Benson had not yet
  re-run it from the menu at the time of the split.
- **NEXT (agreed with Benson, option 3):** make the DMap contrast percentile controllable.
  - A ScriptUI dialog (`new Window("dialog")`) shown at the start of each run, prefilled with the last
    value, with an "Ask each time" checkbox; Cancel aborts the run.
  - Persist settings in a small JSON file, e.g. `~/Library/Application Support/Adobe/BridgeZereneStack.json`
    (read on each run, default 30); do not rely on Bridge's own preferences store.
  - Optionally a separate "Zerene Settings..." menu item that opens the same dialog and saves.
  - Ask Benson which other settings belong in the dialog (ideas: estimation radius, smoothing radius,
    PMax/DMap choice, keep-the-TIFF-folder option). ScriptUI in Bridge 2027 is untried.
- Possible later: batch several stack folders into one Zerene launch (one JVM startup for many
  stacks); a Windows port; saved Zerene batch scripts instead of the generated XML.
- Leftover `TIFF-20261115-*` test folders in `~/Bridge/New/2026-11-14/stack-021` are safe for Benson
  to delete; do not delete them for him.
- Bridge still uses ExtendScript; Photoshop's ExtendScript/BridgeTalk support may be deprecated in
  favor of UXP over time — check before relying long-term.
