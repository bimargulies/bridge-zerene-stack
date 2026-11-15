// Bridge startup script: Tools > Photoshop > "Convert Folder to TIFF + Auto-Stack in Zerene (PMax + DMap)"
// Converts the current Bridge folder to TIFFs with Photoshop, runs Zerene Stacker headless via its
// documented Batch API (PMax + DMap, 16-bit LZW TIFF), and saves the outputs in the folder.

/**
 * Runs INSIDE PHOTOSHOP (self-contained: it is stringified with toString() and sent via BridgeTalk,
 * so no outer-scope references, no helpers, nothing TypeScript down-levels with a helper). Converts each file to a
 * TIFF in tiffDir, the same thing Image Processor's "Save as TIFF" does, but with
 * no dialog. Returns the converted TIFF paths (one per line, then an optional "WARN:" block), or "ERR:..." if nothing could be converted.
 */
function convertToTiffSide(paths: string[], tiffDir: string): string {
  // @ts-ignore  Photoshop globals
  const A: any = app, DM: any = DialogModes, F: any = File, Fo: any = Folder;
  // @ts-ignore
  const TSO: any = TiffSaveOptions, SO: any = SaveOptions, IC: any = TIFFEncoding;
  const oldDialogs = A.displayDialogs;
  A.displayDialogs = DM.NO;
  const failed: string[] = [];
  const done: string[] = [];
  try {
    const out = new Fo(tiffDir);
    if (!out.exists) { out.create(); }
    for (let i = 0; i < paths.length; i++) {
      try {
        const src = new F(paths[i]);
        const doc = A.open(src);
        // File.name is URL-encoded; avoid regex here (this function is sent as text).
        const nm = decodeURI(src.name);
        const dot = nm.lastIndexOf(".");
        const base = dot > 0 ? nm.substring(0, dot) : nm;
        const opts = new TSO();
        opts.imageCompression = IC.TIFFLZW;
        opts.layers = false;
        opts.embedColorProfile = true;
        const dest = tiffDir + "/" + base + ".tif";
        doc.saveAs(new F(dest), opts, true);
        doc.close(SO.DONOTSAVECHANGES);
        done.push(dest);
      } catch (e) {
        failed.push(paths[i] + " (" + e + ")");
      }
    }
  } finally {
    A.displayDialogs = oldDialogs;
  }
  if (done.length === 0) { return "ERR:" + failed.join("\n"); }
  // Converted TIFF paths, one per line, then an optional WARN: block.
  return done.join("\n") + (failed.length ? "\nWARN:" + failed.join("\n") : "");
}

// Zerene output names look like "2026-11-14-16.38.46 ZS PMax.tif" / "... ZS DMap.tif" / "ZS-OutputImage...".
const ZERENE_OUTPUT = /(^|[ _-])ZS[ _-]/;

const IMAGE_EXT = /\.(dng|cr2|cr3|crw|nef|nrw|arw|orf|raf|rw2|pef|srw|3fr|iiq|tif|tiff|jpg|jpeg|psd|png)$/i;

/** Quote a string for /bin/sh. */
function shq(v: string): string { return "'" + v.replace(/'/g, "'\\''") + "'"; }

/** Escape a string for use inside an XML attribute. */
function xmlEsc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function writeTextFile(path: string, text: string): void {
  const f = new File(path);
  f.encoding = "UTF-8";
  // ExtendScript writes Mac (CR) line endings by default, which breaks /bin/sh scripts.
  f.lineFeed = "Unix";
  if (!f.open("w")) { throw new Error("Cannot write " + path); }
  f.write(text);
  f.close();
}

// DMap contrast threshold, as a percentile. Without a fixed value Zerene stops to ask (default 30).
const DMAP_CONTRAST_PERCENTILE = 30;

/** One Zerene batch task: save 16-bit LZW TIFF. Task codes: 1 = Align+Stack All (PMax), 2 = (DMap). */
function zereneTaskXml(code: number): string {
  const dmap = code === 2
    ? '              <DepthMapControl.UseFixedContrastThresholdPercentile value="true" />\n' +
      '              <DepthMapControl.ContrastThresholdPercentile value="' + DMAP_CONTRAST_PERCENTILE + '.0" />\n'
    : "";
  return '          <Task>\n' +
    '            <OutputImageDispositionCode value="2" />\n' +
    '            <Preferences>\n' +
    '              <SaveImage.FileType value="tif" />\n' +
    '              <SaveImage.BitsPerColor value="16" />\n' +
    '              <SaveImage.CompressionType value="LZW" />\n' +
    dmap +
    '            </Preferences>\n' +
    '            <TaskIndicatorCode value="' + code + '" />\n' +
    '          </Task>\n';
}

/**
 * Run Zerene headless on tiffDir (PMax then DMap, 16-bit LZW TIFFs), wait for it to exit, then
 * move both outputs up into stackDir and delete tiffDir. Runs as a detached shell script so
 * Bridge's UI is not blocked. tiffDir is only deleted if both outputs were produced.
 */
function autoStackInZerene(stackDir: string, tiffDir: string, stamp: string): void {
  const cfg = new File("~/Library/Preferences/ZereneStacker/zerenstk.launchcmd");
  let cmd = "";
  if (cfg.exists && cfg.open("r")) { cmd = cfg.read().replace(/[\r\n]+$/, ""); cfg.close(); }
  if (cmd === "") { alert("Zerene's launch command file was not found; start Zerene once normally, then retry."); return; }

  const tmp = Folder.temp.fsName;
  const xmlPath = tmp + "/zs-batch-" + stamp + ".xml";
  const shPath = tmp + "/zs-run-" + stamp + ".sh";
  writeTextFile(xmlPath,
    '<?xml version="1.0" encoding="UTF-8"?>\n<ZereneStackerBatchScript>\n  <BatchQueue>\n    <Batches length="1">\n' +
    '      <Batch>\n        <Sources length="1">\n          <Source value="' + xmlEsc(tiffDir) + '" />\n' +
    '        </Sources>\n        <ProjectDispositionCode value="101" />\n        <Tasks length="2">\n' +
    zereneTaskXml(1) + zereneTaskXml(2) +
    '        </Tasks>\n      </Batch>\n    </Batches>\n  </BatchQueue>\n</ZereneStackerBatchScript>\n');

  const notify = function (msg: string): string {
    return "osascript -e 'display notification \"" + msg + "\" with title \"Zerene Stacker\"'";
  };
  const lines = [
    "#!/bin/sh",
    // Keep everything (including Zerene's console output) in a log so failures are diagnosable.
    'exec >>"$HOME/Library/Logs/BridgeZereneStack.log" 2>&1',
    'echo "=== $(date) auto-stack start"',
    "STACK=" + shq(stackDir),
    "DIR=" + shq(tiffDir),
    // Safety: only ever delete a folder this tool created.
    'case "$(basename "$DIR")" in TIFF-*) ;; *) exit 1;; esac',
    cmd + " -noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript " + shq(xmlPath) +
      " </dev/null",
    'echo "zerene exit status: $?"',
    'P=$(ls "$DIR"/*" ZS PMax.tif" 2>/dev/null | head -n 1)',
    'D=$(ls "$DIR"/*" ZS DMap.tif" 2>/dev/null | head -n 1)',
    'if [ -n "$P" ] && [ -n "$D" ] && mv "$P" "$D" "$STACK"/; then',
    '  rm -rf "$DIR"',
    "  " + notify("PMax and DMap saved in the stack folder"),
    "else",
    "  " + notify("Stacking failed; the TIFF folder was kept"),
    "fi",
    'echo "=== $(date) done"',
    "rm -f " + shq(xmlPath) + ' "$0"',
    ""
  ];
  writeTextFile(shPath, lines.join("\n"));
  app.system("/bin/sh " + shq(shPath) + " >/dev/null 2>&1 &");
}

function convertFolderAndAutoStack(): void {
  const dir = app.document.presentationPath;
  const folder = new Folder(dir);
  const files: string[] = [];
  const all = folder.getFiles();
  for (let i = 0; i < all.length; i++) {
    const f = all[i];
    const nm = decodeURI(f.name);  // File.name is URL-encoded ("%20" for a space)
    if (f instanceof File && IMAGE_EXT.test(nm) && !ZERENE_OUTPUT.test(nm) && nm.charAt(0) !== ".") { files.push(f.fsName); }
  }
  if (files.length < 2) { alert("Fewer than two image files in " + folder.fsName); return; }
  // New, uniquely named output folder every run (never reuse one that may hold old files).
  const d = new Date();
  const p2 = function (n: number): string { return (n < 10 ? "0" : "") + n; };
  const stamp = d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" +
    p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const tiffDir = folder.fsName + "/TIFF-" + stamp;

  const bt = new BridgeTalk();
  bt.target = "photoshop";
  bt.body = "(" + convertToTiffSide.toString() + ")(" + (files as any).toSource() + ", " +
    (tiffDir as any).toSource() + ");";
  bt.onError = function (m) { alert("Photoshop error:\n" + m.body); };
  bt.onResult = function (m) {
    if (m.body.indexOf("ERR:") === 0) { alert("TIFF conversion failed:\n" + m.body); return; }
    const lines = m.body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("WARN:") === 0) { alert("Some files were skipped:\n" + lines.slice(i).join("\n")); break; }
    }
    try {
      autoStackInZerene(folder.fsName, tiffDir, stamp);
    } catch (e) {
      alert("Could not start Zerene auto-stack: " + e);
    }
  };
  if (!BridgeTalk.isRunning("photoshop")) { BridgeTalk.launch("photoshop"); }
  bt.send(3600);
}

if (BridgeTalk.appName === "bridge") {
  const item = MenuElement.create(
    "command",
    "Convert Folder to TIFF + Auto-Stack in Zerene (PMax + DMap)",
    "at the end of Tools/Photoshop",
    "zereneAutoStack"
  );
  item.onSelect = convertFolderAndAutoStack;
}
