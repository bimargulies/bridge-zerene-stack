// Copy the built startup script into every Bridge version's Startup Scripts folder.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const base = join(homedir(), "Library/Application Support/Adobe");
const src = fileURLToPath(new URL("../dist/ZereneStack.jsx", import.meta.url));
const bridges = readdirSync(base, { withFileTypes: true })
	.filter((d) => d.isDirectory() && d.name.startsWith("Bridge"))
	.map((d) => d.name);
if (bridges.length === 0) {
	console.error(`No Bridge folder found under ${base}`);
	process.exit(1);
}
for (const d of bridges) {
	const dest = join(base, d, "Startup Scripts");
	mkdirSync(dest, { recursive: true });
	copyFileSync(src, join(dest, "ZereneStack.jsx"));
	console.log(`Installed to ${dest}`);
}
