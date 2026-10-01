// Native messaging host for the Ask AI extension.
//
// Brave starts this program for one request from the extension (stdin/stdout, no network port),
// runs the official CLI the user is logged into, and writes back the answer.
//
// Security: page text can contain prompt injections, so every CLI runs with its tools disabled,
// in an empty temp folder, without the user's MCP servers, hooks or plugins. Only fixed commands
// are spawned (never through a shell) and all inputs are validated.

import { spawn } from "node:child_process";
import { existsSync, accessSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { delimiter, join } from "node:path";

const TIMEOUT_MS = 90000;
const STATUS_TIMEOUT_MS = 15000;
const MAX_TEXT = 20000;
const MAX_IMAGE_BASE64 = 11 * 1024 * 1024; // ~8 MB PNG
const MAX_OUTPUT = 2 * 1024 * 1024;
const MODEL_RE = /^[A-Za-z0-9._:/-]{1,80}$/;
const CLIS = ["claude", "agy", "codex"];
const SCREENSHOT_PROMPT = "Answer the question shown in this screenshot.";
// From the user database, not $HOME: Brave may start the helper with a minimal environment,
// and the CLIs need HOME to find their logins.
const HOME = userInfo().homedir;
const USER = userInfo().username;

// Brave started from the Dock has a minimal PATH; add the usual install locations.
const EXTRA_PATH = [
  "/run/current-system/sw/bin",
  `/etc/profiles/per-user/${USER}/bin`,
  `${HOME}/.nix-profile/bin`,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  `${HOME}/.npm-global/bin`,
  `${HOME}/.local/bin`,
  `${HOME}/.claude/local`,
];
// System folders last but always present: Claude Code reads its login from the Keychain via /usr/bin/security.
const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const PATH = [...new Set([...EXTRA_PATH, ...(process.env.PATH || "").split(delimiter), ...SYSTEM_PATH])].filter(Boolean).join(delimiter);

class HostError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// ---------- native messaging framing ----------

function readMessage() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    process.stdin.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (length > 16 * 1024 * 1024) return reject(new HostError("failed", "Message too large."));
      if (buffer.length >= 4 + length) {
        try {
          resolve(JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
        } catch {
          reject(new HostError("failed", "Malformed message."));
        }
      }
    });
    process.stdin.on("end", () => reject(new HostError("failed", "No message received.")));
  });
}

function writeMessage(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

// ---------- process helpers ----------

function which(cmd) {
  for (const dir of PATH.split(delimiter)) {
    const candidate = join(dir, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

// Runs a fixed executable with an argument array (no shell, so no injection).
function run(executable, args, { stdin = "", cwd, env = {}, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, HOME, USER, PATH, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.stdout.on("data", (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(e.message), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.on("error", () => {}); // CLI may exit before reading stdin
    child.stdin.end(stdin);
  });
}

// Short, path-free error text for the popup.
function clean(text) {
  return String(text || "")
    .replaceAll(HOME, "~")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function classify(result, cli) {
  const text = `${result.stderr}\n${result.stdout}`;
  if (result.timedOut) return new HostError("timeout", `${cli}: no answer within ${TIMEOUT_MS / 1000}s.`);
  if (/not logged in|please log ?in|login required|unauthori[sz]ed|authenticat|\/login|401/i.test(text)) {
    return new HostError("not-logged-in", `${cli}: not logged in. Run "${cli === "codex" ? "codex login" : cli}" once in Terminal.`);
  }
  if (/usage limit|rate limit|quota|too many requests|429|limit reached/i.test(text)) {
    return new HostError("limit", `${cli}: usage limit reached.`);
  }
  return new HostError("failed", `${cli} failed: ${clean(result.stderr || result.stdout) || `exit code ${result.code}`}`);
}

// ---------- validation ----------

function validate(msg) {
  if (!msg || typeof msg !== "object") throw new HostError("failed", "Invalid request.");
  if (!CLIS.includes(msg.cli)) throw new HostError("failed", "Unknown CLI.");
  if (typeof msg.model !== "string" || !MODEL_RE.test(msg.model)) throw new HostError("failed", "Invalid model name.");
  if (typeof msg.system !== "string" || msg.system.length > 10000) throw new HostError("failed", "Invalid system prompt.");
  if (!msg.schema || typeof msg.schema !== "object") throw new HostError("failed", "Invalid schema.");
  if (typeof msg.input === "string") {
    if (!msg.input.trim() || msg.input.length > MAX_TEXT) throw new HostError("failed", "Question is empty or too long.");
  } else {
    const image = msg.input?.image;
    if (image?.mimeType !== "image/png" || typeof image.data !== "string" || !/^[A-Za-z0-9+/=]+$/.test(image.data)) {
      throw new HostError("failed", "Invalid image.");
    }
    if (image.data.length > MAX_IMAGE_BASE64) throw new HostError("failed", "Image too large.");
  }
}

function requireCli(cli) {
  const path = which(cli);
  if (!path) throw new HostError("not-installed", `${cli} is not installed (or not on PATH).`);
  return path;
}

// ---------- CLI runners ----------

async function askClaude(msg, workdir) {
  const exe = requireCli("claude");
  const image = typeof msg.input !== "string";
  const args = [
    "-p",
    "--model", msg.model,
    "--system-prompt", msg.system,
    "--json-schema", JSON.stringify(msg.schema),
    // Lock-down: no tools, no MCP servers, no hooks/plugins/CLAUDE.md, deny everything, keep nothing.
    "--tools", "",
    "--strict-mcp-config",
    "--safe-mode",
    "--permission-mode", "dontAsk",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", image ? "stream-json" : "json",
  ];
  let stdin = msg.input;
  if (image) {
    args.push("--input-format", "stream-json", "--verbose");
    stdin = `${JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: msg.input.image.mimeType, data: msg.input.image.data } },
          { type: "text", text: SCREENSHOT_PROMPT },
        ],
      },
    })}\n`;
  }
  const result = await run(exe, args, { stdin, cwd: workdir });
  // json: one object; stream-json: one object per line, the last one with type "result".
  const lines = result.stdout.trim().split("\n").reverse();
  let final = null;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj?.type === "result" || "result" in (obj || {})) {
        final = obj;
        break;
      }
    } catch {
      // not JSON
    }
  }
  if (!final) {
    try {
      final = JSON.parse(result.stdout);
    } catch {
      throw classify(result, "claude");
    }
  }
  if (final.is_error) throw classify({ ...result, stderr: `${final.result || ""} ${result.stderr}` }, "claude");
  if (final.structured_output) return JSON.stringify(final.structured_output);
  if (typeof final.result === "string" && final.result.trim()) return final.result;
  throw classify(result, "claude");
}

// Antigravity CLI (replaces the deprecated Gemini CLI).
const AGY_HOOK = `let s = "";
process.stdin.on("data", (d) => (s += d));
process.stdin.on("end", () => {
  let name = "";
  try {
    name = JSON.parse(s).toolCall.name;
  } catch {}
  process.stdout.write(JSON.stringify(name === "finish" ? { decision: "allow" } : { decision: "deny", reason: "Tools are disabled." }));
});
`;

async function askAgy(msg, workdir) {
  const exe = requireCli("agy");
  if (typeof msg.input !== "string") {
    throw new HostError("unsupported", "Screenshots aren't supported via the Google account yet.");
  }
  // agy has no "no tools" flag. A PreToolUse hook that denies every tool call is the lock-down;
  // it is only loaded when the folder is passed as a workspace (--add-dir). "finish" is how agy
  // returns the --json-schema answer, so it is the one call let through.
  if (process.execPath.includes("'")) throw new HostError("failed", "Unsupported Node path.");
  mkdirSync(join(workdir, ".agents"));
  writeFileSync(join(workdir, ".agents", "hook.mjs"), AGY_HOOK, { mode: 0o600 });
  writeFileSync(
    join(workdir, ".agents", "hooks.json"),
    // Runs via sh in the hooks.json folder; the command is fixed (no page text in it).
    JSON.stringify({
      "ask-ai-no-tools": { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `'${process.execPath}' hook.mjs`, timeout: 5 }] }] },
    }),
    { mode: 0o600 },
  );
  // No system-prompt flag: ours goes in front of the question.
  const prompt = `${msg.system}\n\nDo not use any tools, run commands, read files or open URLs. Only answer the question.\n\nQuestion:\n${msg.input}`;
  const args = [
    "--add-dir", workdir,
    "--model", msg.model,
    "--json-schema", JSON.stringify(msg.schema),
    "--output-format", "json",
    "--sandbox",
    "--disable-slash-commands",
    "--print-timeout", `${TIMEOUT_MS / 1000 - 10}s`,
    "--print", prompt,
  ];
  const result = await run(exe, args, { cwd: workdir });
  if (result.code !== 0) throw classify(result, "agy");
  try {
    const out = JSON.parse(result.stdout);
    if (out.error || out.is_error) throw classify({ ...result, stderr: JSON.stringify(out.error || out.result || "") }, "agy");
    const structured = out.structured_output ?? out.structuredOutput;
    if (structured) return typeof structured === "string" ? structured : JSON.stringify(structured);
    const text = out.response ?? out.result ?? out.text;
    if (typeof text === "string" && text.trim()) return text;
    if (out.correct_options || out.answer) return result.stdout; // the answer object itself
  } catch (e) {
    if (e instanceof HostError) throw e;
  }
  throw classify(result, "agy");
}

async function askCodex(msg, workdir) {
  const exe = requireCli("codex");
  const schemaPath = join(workdir, "schema.json");
  const outPath = join(workdir, "answer.txt");
  writeFileSync(schemaPath, JSON.stringify(msg.schema), { mode: 0o600 });
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    // Codex always has a shell tool; read-only sandbox (no writes, no network) is the tightest setting.
    "--sandbox", "read-only",
    "--cd", workdir,
    "-m", msg.model,
    "--output-schema", schemaPath,
    "-o", outPath,
  ];
  let prompt = `${msg.system}\n\nDo not run any commands or read any files. Only answer the question.\n\n`;
  if (typeof msg.input === "string") {
    prompt += `Question:\n${msg.input}`;
  } else {
    const pngPath = join(workdir, "screenshot.png");
    writeFileSync(pngPath, Buffer.from(msg.input.image.data, "base64"), { mode: 0o600 });
    args.push("-i", pngPath);
    prompt += SCREENSHOT_PROMPT;
  }
  args.push("--", prompt);
  const result = await run(exe, args, { cwd: workdir });
  if (existsSync(outPath)) {
    const answer = readFileSync(outPath, "utf8").trim();
    if (answer) return answer;
  }
  throw classify(result, "codex");
}

// ---------- status ----------

async function status() {
  const out = {};
  const workdir = mkdtempSync(join(tmpdir(), "ask-ai-"));
  try {
    for (const cli of CLIS) {
      const exe = which(cli);
      if (!exe) {
        out[cli] = { installed: false, loggedIn: false };
        continue;
      }
      let loggedIn = false;
      if (cli === "claude") {
        const r = await run(exe, ["auth", "status", "--json"], { cwd: workdir, timeout: STATUS_TIMEOUT_MS });
        try {
          loggedIn = JSON.parse(r.stdout).loggedIn === true;
        } catch {
          loggedIn = false;
        }
      } else if (cli === "codex") {
        loggedIn = (await run(exe, ["login", "status"], { cwd: workdir, timeout: STATUS_TIMEOUT_MS })).code === 0;
      } else {
        // Lists the account's models: needs the login, but costs no model quota.
        const r = await run(exe, ["models"], { cwd: workdir, timeout: STATUS_TIMEOUT_MS });
        loggedIn = r.code === 0 && /\t/.test(r.stdout);
      }
      out[cli] = { installed: true, loggedIn };
    }
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
  return out;
}

// ---------- main ----------

async function handle(msg) {
  if (msg?.ping) return { ok: true, status: await status() };
  validate(msg);
  const workdir = mkdtempSync(join(tmpdir(), "ask-ai-")); // private, empty working folder
  try {
    const run = { claude: askClaude, agy: askAgy, codex: askCodex }[msg.cli];
    return { ok: true, raw: await run(msg, workdir) };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--status") {
  // Used by install.sh: print which CLIs are installed and logged in.
  console.log(JSON.stringify(await status(), null, 2));
} else {
  try {
    writeMessage(await handle(await readMessage()));
  } catch (e) {
    writeMessage({ ok: false, kind: e.kind || "failed", message: clean(e.message) });
  }
  process.exit(0);
}
