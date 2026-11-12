"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { KINDS } from "../format";

async function post(path, body = {}, method = "POST") {
  const response = await fetch(`/billing/api/documents/${path}`, { method, body: method === "DELETE" ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export function DocActions({ doc, actions, recipientEmail, attachPdf }) {
  const router = useRouter();
  const [panel, setPanel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);
  const [ack, setAck] = useState([]);
  const [send, setSend] = useState({ to: recipientEmail || "", cc: "", message: "" });
  const [reason, setReason] = useState("");
  const [reissue, setReissue] = useState(true);
  const kindWord = KINDS[doc.kind].word.toLowerCase();
  const has = (name) => actions.includes(name);

  async function run(work) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch {
      setError("That did not work. Check your connection and try again.");
    }
    setBusy(false);
  }

  const open = (name) => {
    setPanel(panel === name ? null : name);
    setError("");
    setWarnings([]);
    setAck([]);
  };

  const issue = (path, body, done) => run(async () => {
    const result = await post(`${doc.id}/${path}`, { ...body, acknowledge: ack });
    if (result.status === 409 && result.data.warnings) {
      setWarnings(result.data.warnings);
      setPanel(path);
      return;
    }
    if (!result.ok) return setError(result.data.error || "That did not work.");
    done(result.data);
  });

  const simple = (path, body, done) => run(async () => {
    const result = await post(`${doc.id}/${path}`, body);
    if (!result.ok) return setError(result.data.error || "That did not work.");
    done(result.data);
  });

  const refresh = (saved) => {
    setPanel(null);
    router.replace(`/billing/documents/${doc.id}?saved=${saved}`);
    router.refresh();
  };

  const warningList = warnings.length ? (
    <div className="bx-warnings" role="alert">
      <p>Please confirm before continuing:</p>
      {warnings.map((warning) => (
        <label key={warning.code} className="admin-check">
          <input type="checkbox" checked={ack.includes(warning.code)} onChange={(event) => setAck((prev) => (event.target.checked ? [...prev, warning.code] : prev.filter((code) => code !== warning.code)))} />
          {warning.text}
        </label>
      ))}
    </div>
  ) : null;

  return (
    <div className="bx-doc-actions">
      <div className="bx-actions-row">
        {has("edit") ? <a className="rx-button" href={`/billing/documents/${doc.id}/edit`}>Edit</a> : null}
        {has("issue") && doc.kind !== "quote" ? <button type="button" className="rx-button bx-primary" disabled={busy} onClick={() => issue("issue", {}, () => refresh("issued"))}>Issue {kindWord}</button> : null}
        {has("issue") && doc.kind === "quote" ? <button type="button" className="rx-button bx-primary" disabled={busy} onClick={() => issue("issue", {}, () => refresh("finalised"))}>Finalise quote</button> : null}
        {has("send") ? <button type="button" className={`rx-button${has("issue") ? "" : " bx-primary"}`} onClick={() => open("send")}>Send by email</button> : null}
        {has("payment") ? <a className="rx-button" href={`/billing/payments/new?customer=${doc.customerId}&invoice=${doc.id}`}>Record payment</a> : null}
        {has("accept") ? <button type="button" className="rx-button" disabled={busy} onClick={() => simple("accept", {}, () => refresh("accepted"))}>Mark accepted</button> : null}
        {has("decline") ? <button type="button" className="rx-button" disabled={busy} onClick={() => simple("decline", {}, () => refresh("declined"))}>Mark declined</button> : null}
        {has("convert") ? <button type="button" className="rx-button" disabled={busy} onClick={() => simple("convert", {}, (data) => router.push(`/billing/documents/${data.draftId}?saved=converted`))}>Convert to invoice</button> : null}
        {has("credit") ? <button type="button" className="rx-button" onClick={() => open("credit")}>Credit note</button> : null}
        {has("void") ? <button type="button" className="rx-button is-danger" onClick={() => open("void")}>Void</button> : null}
        {has("delete") ? <button type="button" className="rx-button is-danger" onClick={() => open("delete")}>Delete draft</button> : null}
        <a className="rx-button" href={`/billing/api/documents/${doc.id}/pdf`}>{doc.status === "draft" ? "Draft PDF" : "PDF"}</a>
        {doc.status !== "draft" ? <a className="rx-button" href={`/billing/api/documents/${doc.id}/pdf?copy=1`} title="A fresh copy with the current status stamp">Copy PDF</a> : null}
      </div>

      {panel === "issue" ? <div className="bx-panel">{warningList}<button type="button" className="rx-button bx-primary" disabled={busy || ack.length < warnings.length} onClick={() => issue("issue", {}, () => refresh(doc.kind === "quote" ? "finalised" : "issued"))}>Confirm and issue</button></div> : null}

      {panel === "send" ? (
        <div className="bx-panel bx-grid">
          <label>To<input type="email" value={send.to} onChange={(event) => setSend({ ...send, to: event.target.value })} maxLength={200} /></label>
          <label>CC<input value={send.cc} onChange={(event) => setSend({ ...send, cc: event.target.value })} maxLength={400} placeholder="Optional, comma separated" /></label>
          <label className="bx-span">Message<textarea rows={4} value={send.message} onChange={(event) => setSend({ ...send, message: event.target.value })} maxLength={4000} placeholder="Leave empty for the standard message" /></label>
          <p className="field-hint bx-span">The email has a button to the private online link{doc.kind === "invoice" ? " and your EFT details" : ""}{attachPdf ? ", with the PDF attached" : ""}.{doc.status === "draft" ? " Sending finalises the quote." : ""}</p>
          {warningList}
          <div className="bx-span bx-actions-row">
            <button type="button" className="rx-button bx-primary" disabled={busy || !send.to || ack.length < warnings.length} onClick={() => issue("send", send, () => refresh("sent"))}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      ) : null}

      {panel === "void" ? (
        <div className="bx-panel bx-grid">
          <p className="bx-span">Voiding cancels this invoice. Its number stays used and it shows as VOID. Only possible because it was never sent or viewed.</p>
          <label className="bx-span">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>
          <div className="bx-span"><button type="button" className="rx-button is-danger" disabled={busy || !reason.trim()} onClick={() => simple("void", { reason }, () => refresh("voided"))}>Void invoice</button></div>
        </div>
      ) : null}

      {panel === "credit" ? (
        <div className="bx-panel bx-grid">
          <p className="bx-span"><strong>Credit in full</strong> issues a credit note for the whole invoice now. Or make a <a href={`/billing/credit-notes/new?invoice=${doc.id}`}>partial credit note</a> and choose the lines.</p>
          <label className="bx-span">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="Wrong quantity on line 2" /></label>
          <label className="admin-check bx-span"><input type="checkbox" checked={reissue} onChange={(event) => setReissue(event.target.checked)} /> Start a corrected draft invoice with the same lines</label>
          <div className="bx-span">
            <button type="button" className="rx-button bx-primary" disabled={busy || !reason.trim()} onClick={() => simple("credit", { reason, reissue }, (data) => router.push(data.draftId ? `/billing/documents/${data.draftId}/edit` : `/billing/documents/${data.creditNoteId}?saved=issued`))}>Credit in full</button>
          </div>
        </div>
      ) : null}

      {panel === "delete" ? (
        <div className="bx-panel">
          <p>Delete this draft? It has no number yet, so nothing is lost from your sequence.</p>
          <button type="button" className="rx-button is-danger" disabled={busy} onClick={() => run(async () => {
            const result = await post(String(doc.id), {}, "DELETE");
            if (!result.ok) return setError(result.data.error || "The draft was not deleted.");
            router.push(`/billing/${KINDS[doc.kind].path}?saved=deleted`);
          })}>Delete draft</button>
        </div>
      ) : null}

      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

export function LinkBox({ docId, url, canManage }) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!url) return null;
  return (
    <div className="bx-link">
      <input readOnly value={url} aria-label="Online link" onFocus={(event) => event.target.select()} />
      <div className="bx-actions-row">
        <button type="button" className="rx-button" onClick={async () => {
          await navigator.clipboard.writeText(url).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}>{copied ? "Copied" : "Copy link"}</button>
        <a className="rx-button" href={url} target="_blank" rel="noopener noreferrer">Open</a>
        {canManage ? (
          <button type="button" className="rx-button" disabled={busy} title="Stops the old link working" onClick={async () => {
            setBusy(true);
            await fetch(`/billing/api/documents/${docId}/link`, { method: "POST", body: "{}" });
            setBusy(false);
            router.refresh();
          }}>New link</button>
        ) : null}
      </div>
    </div>
  );
}
