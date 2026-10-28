"use client";

import { useEffect, useRef, useState } from "react";
import { fileExtension, fileSize } from "./format";

const LIMIT = 10 * 1024 * 1024;
const MAX_FILES = 10;
const PREVIEWABLE = /^image\/(png|jpeg|gif|webp)$/;

export function FileDrop({ ticketId, onBusy }) {
  const [files, setFiles] = useState([]);
  const [over, setOver] = useState(false);
  const picker = useRef(null);
  const previews = useRef([]);

  useEffect(() => {
    onBusy?.(files.some((file) => file.status === "uploading"));
  }, [files, onBusy]);

  useEffect(() => () => previews.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function update(key, patch) {
    setFiles((list) => list.map((file) => (file.key === key ? { ...file, ...patch } : file)));
  }

  async function upload(file) {
    const key = crypto.randomUUID();
    const preview = PREVIEWABLE.test(file.type) ? URL.createObjectURL(file) : null;
    if (preview) previews.current.push(preview);
    const entry = { key, name: file.name, size: file.size, preview, status: "uploading", id: null, error: "" };
    if (file.size > LIMIT) {
      setFiles((list) => [...list, { ...entry, status: "error", error: "Larger than 10 MB" }]);
      return;
    }
    setFiles((list) => [...list, entry]);
    try {
      const response = await fetch("/tickets/attachments", {
        method: "POST",
        headers: {
          "content-type": "application/octet-stream",
          "x-df-name": encodeURIComponent(file.name),
          "x-df-type": file.type || "",
          ...(ticketId ? { "x-df-ticket": String(ticketId) } : {}),
        },
        body: file,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) update(key, { status: "error", error: body.error || "Not uploaded" });
      else update(key, { status: "done", id: body.id });
    } catch {
      update(key, { status: "error", error: "Not uploaded" });
    }
  }

  function add(list) {
    const room = MAX_FILES - files.filter((file) => file.status !== "error").length;
    [...list].slice(0, Math.max(0, room)).forEach(upload);
  }

  function remove(key) {
    setFiles((list) => list.filter((file) => file.key !== key));
  }

  const ready = files.filter((file) => file.status === "done").map((file) => file.id);

  return (
    <div
      className={`file-drop${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        add(event.dataTransfer.files);
      }}
    >
      <input type="hidden" name="attachmentIds" value={ready.join(",")} />
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <p>
        Drop files here or{" "}
        <button type="button" className="link-button" onClick={() => picker.current?.click()}>choose files</button>
        . Up to {MAX_FILES} files, 10 MB each.
      </p>
      {files.length ? (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.key} className={`is-${file.status}`}>
              {file.preview ? <img src={file.preview} alt="" /> : <span className="file-icon" aria-hidden="true">{fileExtension(file.name)}</span>}
              <span className="file-name">{file.name}</span>
              <span className="file-meta">
                {file.status === "uploading" ? "Uploading…" : file.status === "error" ? file.error : fileSize(file.size)}
              </span>
              <button type="button" className="link-button" onClick={() => remove(file.key)} aria-label={`Remove ${file.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
