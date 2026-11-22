// Bridge startup script: adds a Tools > Zerene Stacker submenu.
// Converts the current Bridge folder to TIFFs with Photoshop, runs Zerene Stacker headless via its
// documented Batch API (PMax + DMap, 16-bit LZW TIFF), and saves the outputs in the folder.

/**
 * Runs INSIDE PHOTOSHOP (self-contained: it is stringified with toString() and sent via BridgeTalk,
 * so no outer-scope references, no helpers, nothing TypeScript down-levels with a helper). Converts each file to a
 * TIFF in tiffDir, the same thing Image Processor's "Save as TIFF" does, but with
 * no dialog. Returns the converted TIFF paths (one per line, then an optional "WARN:" block), or "ERR:..." if nothing could be converted.
 */
function convertToTiffSide(paths: string[], tiffDir: string): string {
  const A: any = app, DM: any = DialogModes, F: any = File, Fo: any = Folder;
  const TSO: any = TiffSaveOptions, SO: any = SaveOptions, IC: any = TIFFEncoding;
  const oldDialogs = A.displayDialogs;
  A.displayDialogs = DM.NO;
  const failed: string[] = [];
  const done: string[] = [];
  const saved: { [k: string]: boolean } = {};
  try {
    // encodeURI: the File/Folder constructors decode %XX, which would corrupt a literal "%20" in a path.
    // Bridge creates tiffDir first: Folder.create() here decodes again and would make a stray folder.
    if (!new Fo(encodeURI(tiffDir)).exists) { return "ERR:Output folder is missing: " + tiffDir; }
    for (let i = 0; i < paths.length; i++) {
      let doc: any = null;
      try {
        const src = new F(encodeURI(paths[i]));
        // File.name is URL-encoded; avoid regex here (this function is sent as text).
        const nm = decodeURI(src.name);
        const dot = nm.lastIndexOf(".");
        const base = dot > 0 ? nm.substring(0, dot) : nm;
        // a.dng and a.tif would both become a.tif; never let one frame silently overwrite another.
        if (saved["k" + base.toLowerCase()]) {
          failed.push(paths[i] + " (same name as a frame already converted)");
          continue;
        }
        doc = A.open(src);
        const opts = new TSO();
        opts.imageCompression = IC.TIFFLZW;
        opts.layers = false;
        opts.embedColorProfile = true;
        const dest = tiffDir + "/" + base + ".tif";
        doc.saveAs(new F(encodeURI(dest)), opts, true);
        saved["k" + base.toLowerCase()] = true;
        done.push(dest);
      } catch (e) {
        failed.push(paths[i] + " (" + e + ")");
      } finally {
        // Also on a failed save, so a bad frame does not leave a full-size document open.
        if (doc) { try { doc.close(SO.DONOTSAVECHANGES); } catch (e2) { /* already closed */ } }
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

/** File/Folder for a literal path. The constructors decode %XX, so a literal "%" must be encoded first. */
function fileAt(path: string): File { return new File(encodeURI(path)); }
function folderAt(path: string): Folder { return new Folder(encodeURI(path)); }

// Shell lines that send a script's output to the log, starting a new log past 10 MB (keeps one old log).
const LOG_SETUP =
  'L="$HOME/Library/Logs/BridgeZereneStack.log"; ' +
  'if [ -f "$L" ] && [ "$(wc -c <"$L")" -gt 10485760 ]; then mv -f "$L" "$L.1"; fi; exec >>"$L" 2>&1';

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
const DEFAULT_PERCENTILE = 30;

interface Settings {
  percentile: number;
  askEachTime: boolean;
  addDescription: boolean;
  /** Optional external DNG-to-TIFF executable. Empty means convert with Photoshop. */
  dngConverter: string;
  /** Optional .dcp camera profile passed to the converter with -dcp. */
  dngProfile: string;
}

const SETTINGS_PATH = "~/Library/Application Support/Adobe/BridgeZereneStack.json";

/** Encode a string as a JSON string literal. */
function jsonStr(v: string): string { return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

/** Read a top-level string value from the settings text ("" if absent). */
function readJsonStr(text: string, key: string): string {
  const m = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(text);
  return m ? m[1].replace(/\\(.)/g, "$1") : "";
}

function trimStr(v: string): string { return v.replace(/^\s+|\s+$/g, ""); }

function loadSettings(): Settings {
  const s: Settings = {
    percentile: DEFAULT_PERCENTILE, askEachTime: true, addDescription: true, dngConverter: "", dngProfile: ""
  };
  try {
    const f = new File(SETTINGS_PATH);
    if (f.exists && f.open("r")) {
      const text = f.read();
      f.close();
      const p = /"percentile"\s*:\s*([0-9.eE+-]+)/.exec(text);
      if (p) {
        const v = parseFloat(p[1]);
        if (v >= 0 && v <= 100) { s.percentile = v; }
      }
      const a = /"askEachTime"\s*:\s*(true|false)/.exec(text);
      if (a) { s.askEachTime = a[1] === "true"; }
      const d = /"addDescription"\s*:\s*(true|false)/.exec(text);
      if (d) { s.addDescription = d[1] === "true"; }
      s.dngConverter = readJsonStr(text, "dngConverter");
      s.dngProfile = readJsonStr(text, "dngProfile");
    }
  } catch (e) { /* fall back to defaults */ }
  return s;
}

function saveSettings(s: Settings): void {
  writeTextFile(SETTINGS_PATH,
    '{\n  "percentile": ' + s.percentile + ',\n  "askEachTime": ' + (s.askEachTime ? "true" : "false") +
    ',\n  "addDescription": ' + (s.addDescription ? "true" : "false") +
    ',\n  "dngConverter": ' + jsonStr(s.dngConverter) + ',\n  "dngProfile": ' + jsonStr(s.dngProfile) + '\n}\n');
}

/** Modal dialog for the settings. Returns the new (already saved) settings, or null if cancelled. */
function showSettingsDialog(cur: Settings, okLabel: string): Settings | null {
  const w: any = new Window("dialog", "Zerene Stacker settings");
  w.orientation = "column";
  w.alignChildren = "left";
  const row = w.add("group");
  row.add("statictext", undefined, "DMap contrast threshold (percentile, 0-100):");
  const field = row.add("edittext", undefined, String(cur.percentile));
  field.characters = 6;
  field.active = true;
  const desc = w.add("checkbox", undefined, "Set IPTC Description to DATE/stack-nnn (needs exiftool)");
  desc.value = cur.addDescription;
  const ask = w.add("checkbox", undefined, "Ask each time");
  ask.value = cur.askEachTime;
  w.add("statictext", undefined, "DNG converter executable (optional; empty = use Photoshop):");
  const conv = w.add("edittext", undefined, cur.dngConverter);
  conv.characters = 50;
  w.add("statictext", undefined, "Camera profile for the converter, .dcp (optional):");
  const prof = w.add("edittext", undefined, cur.dngProfile);
  prof.characters = 50;
  const buttons = w.add("group");
  buttons.alignment = "right";
  const okBtn = buttons.add("button", undefined, okLabel, { name: "ok" });
  const cancelBtn = buttons.add("button", undefined, "Cancel", { name: "cancel" });
  // Close explicitly: the implicit close of "ok"/"cancel" buttons left the dialog on screen in Bridge.
  let result: Settings | null = null;
  okBtn.onClick = function () {
    const typed = trimStr(field.text);
    const v = typed === "" ? NaN : Number(typed);  // Number, not parseFloat: reject "30abc"
    if (isNaN(v) || v < 0 || v > 100) { alert("Enter a number between 0 and 100."); return; }
    const dngConverter = trimStr(conv.text);
    const dngProfile = trimStr(prof.text);
    if (dngConverter !== "" && !fileAt(dngConverter).exists) { alert("DNG converter not found:\n" + dngConverter); return; }
    if (dngProfile !== "" && !fileAt(dngProfile).exists) { alert("Camera profile not found:\n" + dngProfile); return; }
    result = { percentile: v, askEachTime: !!ask.value, addDescription: !!desc.value, dngConverter: dngConverter, dngProfile: dngProfile };
    w.close(1);
  };
  cancelBtn.onClick = function () { w.close(0); };
  w.show();
  if (result !== null) {
    try { saveSettings(result); } catch (e) { alert("Could not save settings: " + e); }
  }
  return result;
}

/** Shell command posting a macOS notification. msg must not contain quotes. */
function notifyCmd(msg: string): string {
  return "osascript -e 'display notification \"" + msg + "\" with title \"Zerene Stacker\"'";
}

/** Convert with Photoshop, then call onDone. Partial failures are reported and the run continues. */
function convertWithPhotoshop(files: string[], tiffDir: string, onDone: () => void): void {
  if (Number(app.system("/bin/mkdir -p " + shq(tiffDir))) !== 0) { alert("Could not create " + tiffDir); return; }
  const bt = new BridgeTalk();
  bt.target = "photoshop";
  bt.body = "(" + convertToTiffSide.toString() + ")(" + (files as any).toSource() + ", " +
    (tiffDir as any).toSource() + ");";
  bt.onError = function (m) { alert("Photoshop error:\n" + m.body); };
  bt.onResult = function (m) {
    try {
      if (m.body.indexOf("ERR:") === 0) { alert("TIFF conversion failed:\n" + m.body); return; }
      const lines = m.body.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf("WARN:") === 0) { alert("Some files were skipped:\n" + lines.slice(i).join("\n")); break; }
      }
      onDone();
    } catch (e) {
      alert("Could not start Zerene: " + e);
    }
  };
  if (!BridgeTalk.isRunning("photoshop")) { BridgeTalk.launch("photoshop"); }
  bt.send(3600);
}

/**
 * The files to give the DNG converter, or null if it cannot handle this set. A non-DNG file is
 * tolerated only when it shares its name with a DNG (an earlier TIFF of the same frame); any other
 * file means Photoshop converts everything, so one stack never mixes two renderers.
 */
function dngConverterInputs(files: string[]): string[] | null {
  const stems: { [k: string]: boolean } = {};
  const dngs: string[] = [];
  for (let i = 0; i < files.length; i++) {
    if (/\.dng$/i.test(files[i])) {
      dngs.push(files[i]);
      stems["k" + files[i].replace(/\.dng$/i, "").toLowerCase()] = true;
    }
  }
  if (dngs.length === 0) { return null; }
  for (let i = 0; i < files.length; i++) {
    if (!/\.dng$/i.test(files[i]) && !stems["k" + files[i].replace(/\.[^.\/]+$/, "").toLowerCase()]) { return null; }
  }
  return dngs;
}

/** Log why the configured converter was not used, and tell the user. reason must not contain quotes. */
function noteConverterFallback(reason: string): void {
  const line = "echo " + shq("DNG converter not used: " + reason) + ' >>"$HOME/Library/Logs/BridgeZereneStack.log"; ' +
    notifyCmd("Using Photoshop: " + reason);
  app.system("/bin/sh -c " + shq(line) + " >/dev/null 2>&1 &");
}

interface DngJob { donePath: string; files: string[]; tiffDir: string; onDone: () => void; }
const dngJobs: { [id: string]: DngJob } = {};
let dngJobCounter = 0;

/**
 * Run the DNG converter detached so Bridge stays responsive; pollDngConverter picks up the result.
 * The runner accepts the output only if the tool succeeded and wrote one TIFF per input; otherwise
 * it removes what was written so the Photoshop fallback starts clean.
 */
function startDngConverter(inputs: string[], files: string[], tiffDir: string, s: Settings, onDone: () => void): void {
  dngJobCounter++;
  const id = "j" + new Date().getTime() + "-" + dngJobCounter;
  const tmp = Folder.temp.fsName;
  const shPath = tmp + "/zs-dng-" + id + ".sh";
  const donePath = tmp + "/zs-dng-" + id + ".done";
  const quoted: string[] = [];
  for (let i = 0; i < inputs.length; i++) { quoted.push(shq(inputs[i])); }
  const profile = s.dngProfile === "" ? "" : " -dcp " + shq(fileAt(s.dngProfile).fsName);
  writeTextFile(shPath, [
    "#!/bin/sh",
    LOG_SETUP,
    'echo "=== $(date) DNG converter start (' + inputs.length + ' files)"',
    "OUT=" + shq(tiffDir),
    "DONE=" + shq(donePath),
    'mkdir -p "$OUT"',
    shq(fileAt(s.dngConverter).fsName) + profile + ' -out "$OUT" ' + quoted.join(" ") + " </dev/null",
    "ST=$?",
    'N=$(ls "$OUT"/*.tif 2>/dev/null | wc -l | tr -d " ")',
    'if [ "$ST" = 0 ] && [ "$N" = "' + inputs.length + '" ]; then R=ok; else R=failed; rm -f "$OUT"/*.tif; fi',
    'echo "DNG converter: $R (status $ST, $N TIFFs)"',
    'printf %s "$R" > "$DONE.tmp" && mv "$DONE.tmp" "$DONE"',
    'rm -f "$0"',
    ""
  ].join("\n"));
  dngJobs[id] = { donePath: donePath, files: files, tiffDir: tiffDir, onDone: onDone };
  app.system("/bin/sh " + shq(shPath) + " >/dev/null 2>&1 &");
  app.scheduleTask('pollDngConverter("' + id + '")', 500, false);
}

function pollDngConverter(id: string): void {
  const job = dngJobs[id];
  if (!job) { return; }
  const f = new File(job.donePath);
  if (!f.exists) { app.scheduleTask('pollDngConverter("' + id + '")', 500, false); return; }
  let status = "";
  if (f.open("r")) { status = f.read(); f.close(); }
  f.remove();
  delete dngJobs[id];
  if (status === "ok") {
    try { job.onDone(); } catch (e) { alert("Could not start Zerene: " + e); }
    return;
  }
  noteConverterFallback("the DNG converter failed, see the log");
  convertWithPhotoshop(job.files, job.tiffDir, job.onDone);
}

/** Convert with the configured DNG converter when it can handle these files, otherwise with Photoshop. */
function convertToTiffs(files: string[], tiffDir: string, s: Settings, onDone: () => void): void {
  if (s.dngConverter === "") { convertWithPhotoshop(files, tiffDir, onDone); return; }
  const inputs = dngConverterInputs(files);
  if (inputs === null) {
    noteConverterFallback("not every frame is a DNG");
    convertWithPhotoshop(files, tiffDir, onDone);
    return;
  }
  startDngConverter(inputs, files, tiffDir, s, onDone);
}

/** One Zerene batch task: save 16-bit LZW TIFF. Task codes: 1 = Align+Stack All (PMax), 2 = (DMap). */
function zereneTaskXml(code: number, percentile: number): string {
  const dmap = code === 2
    ? '              <DepthMapControl.UseFixedContrastThresholdPercentile value="true" />\n' +
      '              <DepthMapControl.ContrastThresholdPercentile value="' + percentile.toFixed(1) + '" />\n'
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
function autoStackInZerene(stackDir: string, tiffDir: string, stamp: string, percentile: number, addDescription: boolean): void {
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
    zereneTaskXml(1, percentile) + zereneTaskXml(2, percentile) +
    '        </Tasks>\n      </Batch>\n    </Batches>\n  </BatchQueue>\n</ZereneStackerBatchScript>\n');

  // Description: the last two path components of the stack folder, e.g. "2026-11-14/stack-021".
  const parts = stackDir.split("/");
  const description = parts.slice(Math.max(0, parts.length - 2)).join("/");

  const lines = [
    "#!/bin/sh",
    // Keep everything (including Zerene's console output) in a log so failures are diagnosable.
    LOG_SETUP,
    'echo "=== $(date) auto-stack start"',
    "STACK=" + shq(stackDir),
    "DIR=" + shq(tiffDir),
    // Safety: only ever delete a folder this tool created.
    'case "$(basename "$DIR")" in TIFF-*) ;; *) exit 1;; esac',
    cmd + " -noSplashScreen -exitOnBatchScriptCompletion -runMinimized -batchScript " + shq(xmlPath) +
      " </dev/null",
    "ZST=$?",
    'echo "zerene exit status: $ZST"',
    'P=$(ls "$DIR"/*" ZS PMax.tif" 2>/dev/null | head -n 1)',
    'D=$(ls "$DIR"/*" ZS DMap.tif" 2>/dev/null | head -n 1)',
    // Description (IPTC Caption-Abstract + XMP dc:description) = "DATE/stack-nnn", via exiftool if installed.
    "DESC=" + shq(description),
    "WANT_DESC=" + (addDescription ? "1" : "0"),
    'EXIFTOOL=$(command -v exiftool || ls /opt/homebrew/bin/exiftool /usr/local/bin/exiftool 2>/dev/null | head -n 1)',
    'if [ "$WANT_DESC" != 1 ]; then',
    '  :',
    'elif [ -n "$EXIFTOOL" ] && [ -n "$P" ] && [ -n "$D" ]; then',
    '  "$EXIFTOOL" -overwrite_original -IPTC:Caption-Abstract="$DESC" -XMP-dc:Description="$DESC" "$P" "$D" ||',
    '    echo "exiftool failed; description not set"',
    'elif [ -z "$EXIFTOOL" ]; then',
    '  echo "exiftool not found; description not set"',
    "fi",
    // A non-zero exit can leave a truncated output, so keep the source TIFFs in that case.
    'if [ "$ZST" = 0 ] && [ -n "$P" ] && [ -n "$D" ] && mv "$P" "$D" "$STACK"/; then',
    '  rm -rf "$DIR"',
    "  " + notifyCmd("PMax and DMap saved in the stack folder"),
    "else",
    "  " + notifyCmd("Stacking failed; the TIFF folder was kept"),
    "fi",
    'echo "=== $(date) done"',
    "rm -f " + shq(xmlPath) + ' "$0"',
    ""
  ];
  writeTextFile(shPath, lines.join("\n"));
  app.system("/bin/sh " + shq(shPath) + " >/dev/null 2>&1 &");
}

function convertFolderAndAutoStack(): void {
  let settings = loadSettings();
  if (settings.askEachTime) {
    const chosen = showSettingsDialog(settings, "Start");
    if (chosen === null) { return; }  // Cancel aborts the run
    settings = chosen;
  }
  // Let the dialog finish closing and repaint before the work below blocks Bridge's UI thread.
  // Exceptions in a scheduled task vanish silently, so report them here.
  app.scheduleTask("try { convertFolderNow(" + settings.percentile + ", " + settings.addDescription +
    '); } catch (e) { alert("Zerene Stacker: " + e); }', 300, false);
}

function convertFolderNow(percentile: number, addDescription: boolean): void {
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

  convertToTiffs(files, tiffDir, loadSettings(), function () {
    autoStackInZerene(folder.fsName, tiffDir, stamp, percentile, addDescription);
  });
}

/**
 * Plain launch of Zerene with a folder on its command line (documented: "If image files or
 * directories are specified on the command line, then a new project will be immediately opened").
 * Uses Zerene's own launch command; nothing is automated. (`open -a` does not pass files through.)
 */
function launchZerene(dir: string, description: string, frames?: string[]): void {
  const cfg = new File("~/Library/Preferences/ZereneStacker/zerenstk.launchcmd");
  let cmd = "";
  if (cfg.exists && cfg.open("r")) { cmd = cfg.read().replace(/[\r\n]+$/, ""); cfg.close(); }
  if (cmd === "") { alert("Zerene's launch command file was not found; start Zerene once normally, then retry."); return; }
  // Optional: stamp the TIFFs' description (IPTC Caption-Abstract + XMP dc:description) first, via exiftool if installed.
  const tag = description === "" ? "" :
    'EXIFTOOL=$(command -v exiftool || ls /opt/homebrew/bin/exiftool /usr/local/bin/exiftool 2>/dev/null | head -n 1); ' +
    'if [ -n "$EXIFTOOL" ]; then "$EXIFTOOL" -overwrite_original -ext tif -ext tiff -IPTC:Caption-Abstract=' + shq(description) +
    " -XMP-dc:Description=" + shq(description) + " " + shq(dir) + "; fi; ";
  // An explicit frame list when some of the folder's files must be left out; otherwise the folder.
  const quotedFrames: string[] = [];
  if (frames) { for (let i = 0; i < frames.length; i++) { quotedFrames.push(shq(frames[i])); } }
  const target = frames ? quotedFrames.join(" ") : shq(dir);
  const line = "{ " + LOG_SETUP + '; echo "=== $(date) open Zerene on "' + shq(dir) + "; " + tag +
    cmd + " -noSplashScreen " + target + '; echo "zerene exit status: $?"; }</dev/null >/dev/null 2>&1 &';
  app.system("/bin/sh -c " + shq(line) + " >/dev/null 2>&1 &");
}

/** Ask what to do with an existing zerene folder: "replace", "use", or "cancel". */
function askExistingFolder(dir: string): string {
  const w: any = new Window("dialog", "zerene folder exists");
  w.orientation = "column";
  w.alignChildren = "left";
  w.add("statictext", undefined, "This folder already exists:");
  w.add("statictext", undefined, dir);
  w.add("statictext", undefined, "Replace moves it to the Trash and makes fresh TIFFs of the selection. Use as-is keeps it.");
  const buttons = w.add("group");
  buttons.alignment = "right";
  let answer = "cancel";
  const replaceBtn = buttons.add("button", undefined, "Replace");
  const useBtn = buttons.add("button", undefined, "Use as-is");
  const cancelBtn = buttons.add("button", undefined, "Cancel");
  replaceBtn.onClick = function () { answer = "replace"; w.close(1); };
  useBtn.onClick = function () { answer = "use"; w.close(1); };
  cancelBtn.onClick = function () { answer = "cancel"; w.close(0); };
  w.show();
  return answer;
}

/** Selected images -> TIFFs in <folder>/zerene, then open Zerene normally (no batch, no automation). */
function openSelectionInZerene(): void {
  let sel: any[] = [];
  try { sel = app.document.selections; } catch (e) { sel = []; }
  if (!sel || sel.length === 0) { alert("Nothing is selected. Select at least two image files in Bridge first."); return; }
  const files: string[] = [];
  let parent = "";
  for (let i = 0; i < sel.length; i++) {
    const f = sel[i].spec;
    if (f instanceof File && IMAGE_EXT.test(decodeURI(f.name))) {
      files.push(f.fsName);
      if (parent === "") { parent = f.parent.fsName; }
    }
  }
  if (files.length < 2) { alert("Select at least two image files in Bridge first."); return; }
  const tiffDir = parent + "/zerene";
  // Same as the full automation: last two components of the stack folder, e.g. "2026-11-14/stack-021".
  const pparts = parent.split("/");
  const description = loadSettings().addDescription ? pparts.slice(Math.max(0, pparts.length - 2)).join("/") : "";
  const existing = folderAt(tiffDir);
  if (existing.exists) {
    const choice = askExistingFolder(existing.fsName);
    if (choice === "cancel") { return; }
    if (choice === "use") {
      // Earlier Zerene outputs in this folder are results, not frames: leave them out of the project.
      const have: string[] = [];
      let skippedOutputs = 0;
      const all = existing.getFiles();
      for (let i = 0; i < all.length; i++) {
        const nm = decodeURI(all[i].name);
        if (all[i] instanceof File && /\.tiff?$/i.test(nm) && nm.charAt(0) !== ".") {
          if (ZERENE_OUTPUT.test(nm)) { skippedOutputs++; } else { have.push(all[i].fsName); }
        }
      }
      if (have.length === 0) { alert("No source TIFF files in " + existing.fsName); return; }
      launchZerene(existing.fsName, "", skippedOutputs > 0 ? have : undefined);
      return;
    }
    // Replace: recoverable on purpose, since the folder may hold saved outputs or projects. No rm fallback.
    app.system("/usr/bin/trash " + shq(existing.fsName));
    if (folderAt(tiffDir).exists) { alert("Could not move this folder to the Trash:\n" + existing.fsName); return; }
  }

  convertToTiffs(files, tiffDir, loadSettings(), function () { launchZerene(tiffDir, description); });
}

if (BridgeTalk.appName === "bridge") {
  // One "Zerene Stacker" submenu under Tools holds all three commands.
  MenuElement.create("menu", "Zerene Stacker", "at the end of Tools", "zereneMenu");
  const where = "at the end of zereneMenu";
  const item = MenuElement.create(
    "command",
    "Convert Folder to TIFF + Auto-Stack (PMax + DMap)",
    where,
    "zereneAutoStack"
  );
  item.onSelect = convertFolderAndAutoStack;
  const selItem = MenuElement.create(
    "command",
    "Selection to TIFF in Zerene Folder + Open Zerene",
    where,
    "zereneOpenSelection"
  );
  selItem.onSelect = openSelectionInZerene;
  const cfgItem = MenuElement.create(
    "command",
    "Settings...",
    where,
    "zereneSettings"
  );
  cfgItem.onSelect = function () { showSettingsDialog(loadSettings(), "Save"); };
}
