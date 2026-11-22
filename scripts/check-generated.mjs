// Static checks on what the build produces: the .jsx must parse as ES3 (ExtendScript), and the shell
// scripts and batch XML it generates at run time must pass sh -n, ShellCheck and xmllint.
// Runs the built code in a sandbox with stubbed Adobe globals; nothing is launched.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { parse } from "acorn";

const code = readFileSync(fileURLToPath(new URL("../dist/ZereneStack.jsx", import.meta.url)), "utf8");
let failed = false;

try {
	parse(code, { ecmaVersion: 3, allowReserved: false });
	console.log("ok   ES3 parse");
} catch (e) {
	failed = true;
	console.log(`FAIL ES3 parse: ${e.message}`);
}

const written = {};
const systemCalls = [];
class File {
	constructor(path) {
		this.fsName = path;
		this.name = path.split("/").pop();
		this.exists = true;
	}
	open() { return true; }
	read() { return 'java -classpath "/Applications/Z S/x.jar:/y/*" com.example.MainFrame'; }
	write(text) { written[this.fsName] = text; return true; }
	close() { return true; }
	remove() { return true; }
}
class Folder extends File {
	static temp = { fsName: "/tmp/stub" };
}
const sandbox = {
	File, Folder,
	BridgeTalk: { appName: "none" },
	alert: (m) => { throw new Error(`alert: ${m}`); },
	app: { system: (c) => { systemCalls.push(c); return 0; }, scheduleTask: () => 0 },
};
vm.runInNewContext(code, sandbox);

// A deliberately awkward path: spaces, a quote, $ and a backtick must all survive quoting.
const stack = "/Users/me/It's a $HOME `stack`/stack-001";
const settings = { dngConverter: "/opt/my tools/conv", dngProfile: "/p/cam era.dcp" };
sandbox.autoStackInZerene(stack, `${stack}/TIFF-1`, "1", 30, true);
sandbox.startDngConverter([`${stack}/a.dng`, `${stack}/b.dng`], [], `${stack}/TIFF-1`, settings, () => {});
sandbox.launchZerene(`${stack}/zerene`, "2026-11-14/stack-001");

const dir = mkdtempSync(join(tmpdir(), "zs-check-"));
const scripts = [];
for (const [path, text] of Object.entries(written)) {
	const out = join(dir, path.split("/").pop());
	writeFileSync(out, text);
	if (path.endsWith(".xml")) {
		const r = spawnSync("xmllint", ["--noout", out], { encoding: "utf8" });
		failed ||= r.status !== 0;
		console.log(`${r.status === 0 ? "ok  " : "FAIL"} xmllint ${path}\n${r.stderr}`.trim());
	} else {
		scripts.push(out);
	}
}
for (const c of systemCalls) {
	const m = /^\/bin\/sh -c '([\s\S]*)' >\/dev\/null 2>&1 &$/.exec(c);
	if (m) {
		const out = join(dir, `inline-${scripts.length}.sh`);
		writeFileSync(out, `#!/bin/sh\n${m[1].replace(/'\\''/g, "'")}\n`);
		scripts.push(out);
	}
}
for (const s of scripts) {
	const syn = spawnSync("sh", ["-n", s], { encoding: "utf8" });
	const sc = spawnSync("shellcheck", ["-s", "sh", "-S", "warning", "-f", "gcc", s], { encoding: "utf8" });
	if (sc.error) { throw new Error("shellcheck is not installed (brew install shellcheck)"); }
	failed ||= syn.status !== 0 || sc.status !== 0;
	console.log(`${syn.status === 0 && sc.status === 0 ? "ok  " : "FAIL"} shell ${s.split("/").pop()}`);
	if (syn.stderr) { console.log(syn.stderr); }
	if (sc.stdout) { console.log(sc.stdout.split(`${s}:`).join("")); }
}
rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
