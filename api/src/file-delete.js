// Where the File Manager refuses to delete. Paths come from Mesh with forward slashes ("C:/Users/Ann", "/home/ann").
// The agents live under Program Files and ProgramData on Windows and /usr and /etc on Linux, so those cover them.

const WINDOWS_PROTECTED = [
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "recovery",
  "boot",
  "$recycle.bin",
  "system volume information",
  "$windows.~bt",
  "$windows.~ws",
  "$winreagent",
  "documents and settings",
];
const WINDOWS_ROOT_FILES = new Set(["pagefile.sys", "hiberfil.sys", "swapfile.sys", "bootmgr", "bootnxt"]);
const LINUX_PROTECTED = [
  "/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/libx32", "/proc", "/root", "/run", "/sbin", "/snap",
  "/srv", "/sys", "/usr", "/var/lib", "/var/log",
];

function inside(path, base) {
  return path === base || path.startsWith(`${base}/`);
}

export const PROTECTED_TEXT = "That is a system or Digital Fingers location, so it cannot be deleted from the File Manager.";

// Returns why the entry `name` in `folder` cannot be deleted, or "" when it can.
export function deleteBlockedReason(folder, name) {
  const raw = String(folder || "").replace(/\\/g, "/").trim();
  const parent = raw.replace(/\/+$/, "");
  const entry = String(name || "");
  if (!raw || !entry) return "Open the folder that holds it first.";
  const full = `${parent}/${entry}`.toLowerCase();
  const drive = /^([a-z]):(\/|$)/.exec(full);
  if (drive) {
    const rest = full.slice(2).split("/").filter(Boolean);
    if (rest.length === 0) return PROTECTED_TEXT;
    if (rest.length === 1 && WINDOWS_ROOT_FILES.has(rest[0])) return PROTECTED_TEXT;
    if (WINDOWS_PROTECTED.includes(rest[0])) return PROTECTED_TEXT;
    if (rest[0] === "users") {
      if (rest.length <= 2) return PROTECTED_TEXT;
      if (rest[2] === "appdata" || rest[2] === "ntuser.dat" || rest[2].startsWith("ntuser.dat")) return PROTECTED_TEXT;
    }
    return "";
  }
  if (!full.startsWith("/")) return PROTECTED_TEXT;
  const parts = full.split("/").filter(Boolean);
  if (parts.length <= 1) return PROTECTED_TEXT;
  if (LINUX_PROTECTED.some((base) => inside(full, base))) return PROTECTED_TEXT;
  if (parts[0] === "home" && parts.length <= 2) return PROTECTED_TEXT;
  return "";
}
