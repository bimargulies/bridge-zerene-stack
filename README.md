# bridge-zerene-stack

An Adobe Bridge extension that takes a folder of focus-stack frames (RAW, DNG, JPEG, ...), converts
them to TIFFs with Photoshop, runs [Zerene Stacker](https://www.zerenesystems.com/cms/stacker)
unattended on the result — **PMax and DMap** — and leaves the two output images next to the originals.
Zerene Stacker is started headless through its documented
[Batch API](https://www.zerenesystems.com/cms/stacker/docs/batchapi) and exits when it is done.

This is an independent hobby project. It is not affiliated with or endorsed by Zerene Systems.

## What you get

In Bridge, open a stack folder and choose **Tools › Zerene Stacker › Convert Folder to TIFF +
Auto-Stack (PMax + DMap)**. You end up with, in the same folder:

- `<date-time> ZS PMax.tif`
- `<date-time> ZS DMap.tif`

Both are 16-bit, LZW-compressed TIFFs, named by Zerene's own default scheme. The temporary TIFF
folder is deleted once both outputs are in place, and a macOS notification tells you when it is done.
Bridge and Photoshop stay usable while Zerene runs.

To add frames to a stack you are already working on, select them and choose **Tools › Zerene Stacker ›
Add Selection to Existing Zerene Folder**. They are converted to TIFFs in the `zerene` subfolder of
the current folder. Frames already there are skipped, never overwritten, and Zerene is not started or
told about the new files.

## How it works

Bridge extensions are ExtendScript startup scripts; this one is written in TypeScript and compiled to
a single ES5 `.jsx` file.

1. **Collect** the image files in the current Bridge folder, skipping anything that looks like a
   Zerene output (a `ZS` token in the name), so a re-run never feeds old results back in.
2. **Convert** them in Photoshop (sent over BridgeTalk): each file is opened with dialogs suppressed
   and saved as an LZW TIFF into a fresh `TIFF-<timestamp>` subfolder. (Photoshop's *Image Processor*
   has no way to run without its dialog, so this does the same open / save-as-TIFF / close itself.)
3. **Stack**: write a Zerene batch script (`ZereneStackerBatchScript` XML) and a small shell script to
   a temp folder, then run them detached. The shell script launches Zerene with the command saved in
   `~/Library/Preferences/ZereneStacker/zerenstk.launchcmd` plus
   `-noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript <file>`.
4. **Tidy**: when Zerene exits, set the IPTC Description (Caption-Abstract, plus XMP `dc:description`)
   of both outputs to the last two components of the stack path, e.g. `2026-11-14/stack-021`. This
   uses `exiftool` if it is installed (otherwise the step is skipped and logged), and can be turned off in
   the settings dialog. Then move the `ZS PMax` and `ZS DMap` outputs up into the stack folder and
   delete the `TIFF-<timestamp>` folder — only if both outputs exist, and only if the folder's name
   starts with `TIFF-`. On failure the folder is kept and the notification says so. Everything the
   script does, including Zerene's console output, is logged to
   `~/Library/Logs/BridgeZereneStack.log`.

### Optional: an external DNG converter

By default Photoshop does the conversion. If you have a command-line DNG-to-TIFF converter, enter its
path under **Tools › Zerene Stacker › Settings...**, optionally with a `.dcp` camera profile
matching your camera. It is called as:

```
<converter> [-dcp <profile.dcp>] -out <dir> file.dng ...
```

and must write one `<name>.tif` per input and exit 0. It runs in the background, with a progress window counting the TIFFs as they appear. Photoshop converts the
whole set instead (with a notification and a line in the log) if any frame is not a DNG or the converter
fails, so a stack never mixes two renderers. A non-DNG file with the same name as a DNG in the folder is
treated as an earlier conversion of that frame and ignored. Leave the setting empty to always use Photoshop.

### What it relies on in Zerene

From the Batch API page: `-batchScript`, `-exitOnBatchScriptCompletion`, `-runMinimized`,
`-noSplashScreen`, a folder as `<Source>`, `ProjectDispositionCode` 101 (temporary project),
`OutputImageDispositionCode` 2 (save in the source folder), `TaskIndicatorCode` 1 (PMax), and
per-task `<Preferences>`.

Found by experiment (not in the docs page, so worth checking if you are a Zerene developer):

- `TaskIndicatorCode` **2** is *Align and Stack All (DMap)*.
- `SaveImage.FileType=tif`, `SaveImage.BitsPerColor=16` and `SaveImage.CompressionType=LZW` work as
  task preferences.
- Without `DepthMapControl.UseFixedContrastThresholdPercentile=true` and
  `DepthMapControl.ContrastThresholdPercentile=<n>` a DMap task stops to ask for the contrast threshold,
  which defeats unattended use. These are set per task and are not written back to `zerenstk.cfg`.

## Requirements

- macOS, Adobe Bridge and Photoshop (developed against the 2027 versions), Zerene Stacker
- Optional: a DNG-to-TIFF command-line converter (see above)
- Node.js and [pnpm](https://pnpm.io/) to build

## Development

```bash
pnpm install
pnpm run build        # writes dist/ZereneStack.jsx
pnpm run install-ext  # build, then copy into each Bridge version's Startup Scripts folder
```

Restart Bridge, open a folder of frames, and use the menu item above.

## License

[MIT](./LICENSE).

## AI usage

I used Claude while developing this.
