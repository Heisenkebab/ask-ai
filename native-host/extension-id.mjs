// Prints the extension ID derived from the "key" in manifest.json (same algorithm as Chromium).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!manifest.key) {
  console.error('manifest.json has no "key"; the extension ID would depend on the folder path.');
  process.exit(1);
}
const hex = createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex").slice(0, 32);
console.log([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join(""));
