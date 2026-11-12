import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CANDIDATES = [
  process.env.CHROME_PATH,
  "/opt/chrome-headless-shell/chrome-headless-shell",
  "/opt/chrome/chrome",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].filter(Boolean);
const TIMEOUT_MS = 45000;

export function chromePath() {
  return CANDIDATES.find((candidate) => existsSync(candidate)) || null;
}

let running = Promise.resolve();

// Prints our own escaped HTML. The document's CSP forbids scripts and every host lookup fails, so it cannot reach the network.
async function print(html) {
  const chrome = chromePath();
  if (!chrome) throw new Error("PDF printing is not set up on this server.");
  const dir = await mkdtemp(path.join(tmpdir(), "df-pdf-"));
  try {
    const page = path.join(dir, "document.html");
    const out = path.join(dir, "document.pdf");
    await writeFile(page, html, "utf8");
    const args = [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--no-first-run",
      "--mute-audio",
      "--allow-file-access-from-files",
      "--host-resolver-rules=MAP * ~NOTFOUND",
      `--user-data-dir=${path.join(dir, "profile")}`,
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=8000",
      `--print-to-pdf=${out}`,
      `file://${page}`,
    ];
    await new Promise((resolve, reject) => {
      const child = spawn(chrome, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 4000) stderr += chunk.toString();
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timer);
        if (existsSync(out)) resolve();
        else reject(new Error(`PDF printing failed (exit ${code}). ${stderr.split("\n").filter((line) => /error/i.test(line)).slice(0, 2).join(" ")}`));
      });
    });
    const pdf = await readFile(out);
    if (pdf.length < 800 || pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("PDF printing produced an empty file.");
    return pdf;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// One print at a time keeps memory flat on the shared server.
export function htmlToPdf(html) {
  const job = running.then(() => print(html));
  running = job.catch(() => {});
  return job;
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
