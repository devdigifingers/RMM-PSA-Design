"use client";

export const UPLOAD_LIMIT = 8 * 1024 * 1024 * 1024;
const PIECE = 64 * 1024 * 1024;

async function readLines(response, onMessage) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    buffer += decoder.decode(step.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      onMessage(message);
    }
  }
}

export async function sendFile(deviceId, path, file, onStatus) {
  if (file.size > UPLOAD_LIMIT) return { ok: false, error: "That file is larger than 8 GB." };
  const uploadId = crypto.randomUUID();
  let result = { ok: false, error: "The file was not uploaded." };
  try {
    let offset = 0;
    do {
      const end = Math.min(file.size, offset + PIECE);
      const response = await fetch(`/devices/${deviceId}/upload`, {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-df-path": encodeURIComponent(path || ""),
          "x-df-name": encodeURIComponent(file.name || ""),
          "x-df-id": uploadId,
          "x-df-start": String(offset),
          "x-df-total": String(file.size),
        },
        body: file.slice(offset, end),
      });
      const last = end >= file.size;
      const type = response.headers.get("content-type") || "";
      if (!last || !type.includes("ndjson") || !response.body) {
        const body = await response.json().catch(() => ({}));
        if (!response.ok || body.error) {
          result = { ok: false, error: body.error || result.error };
          break;
        }
        offset = end;
        if (file.size > 0) onStatus(`Sending ${Math.floor((offset / file.size) * 100)}%`);
        if (last) result = { ok: true };
        continue;
      }
      await readLines(response, (message) => {
        if (typeof message.progress === "number") onStatus(`${message.progress}%`);
        if (message.ok) result = { ok: true };
        if (message.error) result = { ok: false, error: message.error };
      });
      break;
    } while (offset < file.size);
  } catch {
    result = { ok: false, error: "The file was not uploaded." };
  }
  return result;
}

export async function fetchFile(deviceId, path, entry, onStatus) {
  const label = entry.kind === "folder" ? `${entry.name}.zip` : entry.name;
  let result = { ok: false, error: "The file was not downloaded." };
  try {
    const response = await fetch(`/devices/${deviceId}/download`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path, name: entry.name, kind: entry.kind, size: entry.size || 0 }),
    });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("ndjson") || !response.body) {
      const body = await response.json().catch(() => ({}));
      result = { ok: false, error: body.error || result.error };
    } else {
      await readLines(response, (message) => {
        if (message.status) onStatus(message.status);
        if (message.ok) result = { ok: true, ticket: message.ticket, name: message.name || label };
        if (message.error) result = { ok: false, error: message.error };
      });
    }
  } catch {
    result = { ok: false, error: "The file was not downloaded." };
  }
  if (!result.ok) return result;
  const link = document.createElement("a");
  link.href = `/devices/${deviceId}/download/${result.ticket}`;
  link.download = result.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  return result;
}

export function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
