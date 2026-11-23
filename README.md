# bridge-zerene-stack

An Adobe Bridge extension for macOS that prepares focus-stack frames for
[Zerene Stacker](https://www.zerenesystems.com/cms/stacker). It converts images to TIFF, then either
stacks a whole folder unattended (**PMax and DMap**) or sets the frames up for you to work on in
Zerene's own interface.

This is an independent hobby project. It is not affiliated with or endorsed by Zerene Systems, let
alone Adobe.

## Commands

All the commands appear under **Tools › Zerene Stacker** in Bridge.

### Convert Folder to TIFF + Auto-Stack (PMax + DMap)

Converts all the images in the current Bridge folder to TIFF files in a temporary `TIFF-<timestamp>`
folder. It leaves out earlier Zerene outputs (files with a `ZS` token in the name). The folder needs
at least two images. Zerene runs headless through its documented
[Batch API](https://www.zerenesystems.com/cms/stacker/docs/batchapi) and exits when it is done. The
folder ends up with two new files:

- `<date-time> ZS PMax.tif`
- `<date-time> ZS DMap.tif`

Both are 16-bit, LZW-compressed TIFFs, named by Zerene's own default scheme.

The temporary `TIFF-<timestamp>` folder is deleted once both outputs are in place. If stacking
fails, that folder is kept. A macOS notification reports the result, and Bridge and Photoshop stay
usable while Zerene runs.

### Selection to TIFF in Zerene Folder + Open Zerene

Converts the two or more images selected in Bridge to TIFFs in a `zerene` subfolder of their folder,
then opens Zerene normally with those frames as a new project. Nothing further is automated.

If the `zerene` folder already exists, you choose one of:

- **Replace** moves it to the Trash and makes fresh TIFFs of the selection.
- **Use as-is** opens Zerene on the TIFFs already there, leaving out earlier Zerene outputs.
- **Cancel** does nothing.

### Add Selection to Existing Zerene Folder

Converts the selected images to TIFFs and adds them to the existing `zerene` subfolder of their
folder. A selected image whose name already has a TIFF there is skipped and reported, so existing
frames are never overwritten. Zerene is not started or told about the new files, so add them to any
open project yourself. If there is no `zerene` folder, the command says so and stops.

### Settings...

| Setting                 | Effect                                                                                                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMap contrast threshold | Percentile from 0 to 100 used by auto-stacking. The default is 30.                                                                                                                                         |
| Set IPTC Description    | Writes the last two components of the stack path, such as `2026-11-14/stack-021`, to the IPTC Caption-Abstract and XMP `dc:description`. Needs `exiftool`; without it, the step is skipped. On by default. |
| Ask each time           | Shows this dialog at the start of each auto-stack run. On by default.                                                                                                                                      |
| DNG converter           | Optional external converter, described below. Empty means Photoshop.                                                                                                                                       |
| Camera profile          | Optional `.dcp` file passed to the external converter.                                                                                                                                                     |

Settings are saved in `~/Library/Application Support/Adobe/BridgeZereneStack.json`. The description
goes on the two outputs when auto-stacking, and on the newly converted TIFFs for the two selection
commands.

## Image formats and conversion

The extension accepts DNG, the common camera raw formats (CR2, CR3, CRW, NEF, NRW, ARW, ORF, RAF,
RW2, PEF, SRW, 3FR, IIQ), TIFF, JPEG, PSD and PNG.

The full workflow has been used on real stacks only with **DNG** frames. NEF, JPEG, PNG, TIFF and
PSD files have been checked through the conversion step but not stacked in Zerene, and the other raw
formats have not been tested. Raw files depend on Photoshop's Camera Raw supporting the camera. An
8-bit source stays 8-bit when converted, even though Zerene's final output is saved as 16-bit.

By default, Photoshop does the conversion, opening each file with dialogs suppressed and saving an
LZW TIFF. A frame that cannot be converted is reported and the run continues with the rest. Two
frames with the same base name cannot both be converted, so the second is skipped and reported.

### Optional: an external DNG converter

The DNG-to-TIFF conversion available via Bridge was observed to corrupt some images. The word
'corrupt' might be the source of some debate: subtle details in a background were dropped. The same
image read into Photoshop and saved as a TIFF was fine.

If you have a command-line DNG-to-TIFF converter, you can enter its path in **Settings...**,
optionally with a `.dcp` camera profile matching your camera. It is called as:

```
<converter> [-dcp <profile.dcp>] -out <dir> file.dng ...
```

It must write one `<name>.tif` per input and exit 0. It runs in the background, with a progress
window counting the TIFFs as they appear.

Photoshop converts the whole set instead, with a notification and a line in the log, if any frame is
not a DNG or the converter fails. This way a stack never mixes two renderers. A non-DNG file with
the same name as a DNG in the same set is treated as an earlier conversion of that frame and
ignored.

## How this plugin works

Bridge extensions are ExtendScript startup scripts. This one is written in TypeScript and compiled
to a single ES5 `.jsx` file.

1. **Collect** the image files in the current Bridge folder, skipping Zerene outputs.
2. **Convert** them into a fresh `TIFF-<timestamp>` subfolder. Photoshop receives the work over
   BridgeTalk. Its _Image Processor_ has no way to run without its dialog, so the extension does the
   same open, save-as-TIFF and close itself.
3. **Stack**: write a Zerene batch script (`ZereneStackerBatchScript` XML) and a small shell script
   to a temp folder, then run them detached. The shell script launches Zerene with the command saved
   in `~/Library/Preferences/ZereneStacker/zerenstk.launchcmd` plus
   `-noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript <file>`.
4. **Tidy**: when Zerene exits, set the description if enabled, move the `ZS PMax` and `ZS DMap`
   outputs up into the stack folder, and delete the `TIFF-<timestamp>` folder. The folder is deleted
   only if Zerene exited cleanly, both outputs exist and were moved, and its name starts with
   `TIFF-`.

Background steps, including Zerene's console output, are logged to
`~/Library/Logs/BridgeZereneStack.log`.

### What it relies on in Zerene

From the Batch API page: `-batchScript`, `-exitOnBatchScriptCompletion`, `-runMinimized`,
`-noSplashScreen`, a folder as `<Source>`, `ProjectDispositionCode` 101 (temporary project),
`OutputImageDispositionCode` 2 (save in the source folder), `TaskIndicatorCode` 1 (PMax), and
per-task `<Preferences>`.

Found by experiment (not in the docs page, so worth checking if you are a Zerene developer):

- `TaskIndicatorCode` **2** is _Align and Stack All (DMap)_.
- `SaveImage.FileType=tif`, `SaveImage.BitsPerColor=16` and `SaveImage.CompressionType=LZW` work as
  task preferences.
- Without `DepthMapControl.UseFixedContrastThresholdPercentile=true` and
  `DepthMapControl.ContrastThresholdPercentile=<n>` a DMap task stops to ask for the contrast
  threshold, which defeats unattended use. These are set per task and are not written back to
  `zerenstk.cfg`.

## Requirements

- macOS, Adobe Bridge and Photoshop (developed against the 2027 versions)
- Zerene Stacker, started normally at least once so that it writes its launch command file
- Optional: `exiftool`, to set the description
- Optional: a DNG-to-TIFF command-line converter
- The **Replace** choice needs the macOS `/usr/bin/trash` command. Without it, the folder is left
  alone and the command reports the failure.
- Node.js and [pnpm](https://pnpm.io/) to build
- To run `pnpm run lint`: [ShellCheck](https://www.shellcheck.net/) and `xmllint`

## Development

```bash
pnpm install
pnpm run build        # writes dist/ZereneStack.jsx
pnpm run lint         # type checks, ESLint, and checks on the build and generated scripts
pnpm run install-ext  # build, then copy into each Bridge version's Startup Scripts folder
```

Restart Bridge after installing. The commands appear under **Tools › Zerene Stacker**.

## License

[MIT](./LICENSE).

## AI usage

I used Claude while developing this.
