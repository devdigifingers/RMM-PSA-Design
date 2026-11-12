"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { KINDS, TAX_LABELS, quantityInput, randInput } from "../format";
import { PreviewFrame } from "./preview-frame";

const TEMPLATES = [["modern", "Modern"], ["classic", "Classic"], ["minimal", "Minimal"]];
let nextKey = 1;
const keyed = (line) => ({ key: nextKey++, ...line });

export function blankLine(vatRegistered) {
  return { lineType: "item", itemId: "", description: "", quantity: "1", unit: "", unitPrice: "", discountPercent: "", taxType: vatRegistered ? "standard" : "no_vat" };
}

export function linesFromApi(lines) {
  return lines.map((line) => ({
    lineType: line.lineType,
    itemId: line.itemId ? String(line.itemId) : "",
    description: line.description || "",
    quantity: quantityInput(line.quantity),
    unit: line.unit || "",
    unitPrice: line.lineType === "item" ? randInput(line.unitPriceCents) : "",
    discountPercent: line.discountBp ? String(line.discountBp / 100).replace(".", ",") : "",
    taxType: line.taxType,
  }));
}

export function DocumentEditor({ kind, docId = null, initial, customers, items, vatRegistered, lockedCustomer = false, original = null }) {
  const router = useRouter();
  const info = KINDS[kind];
  const [form, setForm] = useState(() => ({ ...initial, lines: undefined }));
  const [lines, setLines] = useState(() => (initial.lines?.length ? initial.lines : [blankLine(vatRegistered)]).map(keyed));
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const customer = customers.find((c) => String(c.id) === String(form.customerId));
  const set = (name) => (event) => setForm((prev) => ({ ...prev, [name]: event.target.value }));

  const body = useMemo(() => ({
    kind,
    customerId: form.customerId ? Number(form.customerId) : null,
    issueDate: form.issueDate || undefined,
    termsDays: kind === "invoice" ? form.termsDays : undefined,
    dueDate: kind === "invoice" && form.dueDate ? form.dueDate : undefined,
    validUntil: kind === "quote" && form.validUntil ? form.validUntil : undefined,
    poNumber: form.poNumber,
    reference: form.reference,
    notes: form.notes,
    terms: form.terms,
    template: form.template,
    priceMode: form.priceMode,
    creditReason: kind === "credit_note" ? form.creditReason : undefined,
    creditsDocumentId: kind === "credit_note" && form.creditsDocumentId ? Number(form.creditsDocumentId) : undefined,
    sourceQuoteId: form.sourceQuoteId || undefined,
    lines: lines.map(({ key, ...line }) => ({ ...line, itemId: line.itemId || null })),
  }), [form, lines, kind]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/billing/api/preview", { method: "POST", body: JSON.stringify(body), signal: controller.signal });
        if (response.ok) setHtml(await response.text());
      } catch {}
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [body]);

  const updateLine = (key, patch) => setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const move = (key, step) => setLines((prev) => {
    const index = prev.findIndex((line) => line.key === key);
    const target = index + step;
    if (target < 0 || target >= prev.length) return prev;
    const next = [...prev];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const pickItem = (key, itemId) => {
    const item = items.find((entry) => String(entry.id) === itemId);
    if (!item) return updateLine(key, { itemId: "" });
    updateLine(key, {
      itemId,
      description: item.description ? `${item.name}\n${item.description}` : item.name,
      unit: item.unit === "each" ? "" : item.unit,
      unitPrice: randInput(item.unitPriceCents),
      taxType: vatRegistered ? item.taxType : "no_vat",
    });
  };

  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(docId ? `/billing/api/documents/${docId}` : "/billing/api/documents", {
        method: docId ? "PUT" : "POST",
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || "The draft was not saved.");
        setSaving(false);
        return;
      }
      router.push(`/billing/documents/${result.id}?saved=draft`);
    } catch {
      setError("The draft was not saved. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <div className="bx-editor">
      <section className="bx-editor-form">
        {original ? (
          <p className="bx-note">Credits invoice <strong>{original.number}</strong>. The credit note uses that invoice&apos;s VAT treatment and rates. Remove or reduce lines for a partial credit.</p>
        ) : null}
        <div className="bx-grid">
          <label className="bx-span">
            Customer
            <select value={form.customerId || ""} onChange={set("customerId")} disabled={lockedCustomer}>
              <option value="">Choose a customer</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {customer && vatRegistered && customer.vatStatus === "unknown" ? <small className="field-hint">Set this customer&apos;s VAT status on their billing details before issuing a tax invoice over R5 000.</small> : null}
          </label>
          <label>{kind === "quote" ? "Quote date" : kind === "credit_note" ? "Credit note date" : "Invoice date"}<input type="date" value={form.issueDate || ""} onChange={set("issueDate")} /></label>
          {kind === "invoice" ? (
            <label>
              Payment terms (days)
              <input type="number" min="0" max="365" value={form.termsDays ?? ""} onChange={(event) => setForm((prev) => ({ ...prev, termsDays: event.target.value, dueDate: "" }))} />
            </label>
          ) : null}
          {kind === "quote" ? <label>Valid until<input type="date" value={form.validUntil || ""} onChange={set("validUntil")} /></label> : null}
          {kind !== "credit_note" ? <label>PO / reference number<input value={form.poNumber || ""} onChange={set("poNumber")} maxLength={60} /></label> : null}
          <label className={kind === "credit_note" ? undefined : "bx-span"}>Summary (shown under the title)<input value={form.reference || ""} onChange={set("reference")} maxLength={200} placeholder="Managed IT services — November 2026" /></label>
          {vatRegistered ? (
            <label>
              Prices are
              <select value={form.priceMode || "excl"} onChange={set("priceMode")}>
                <option value="excl">Excluding VAT</option>
                <option value="incl">Including VAT</option>
              </select>
            </label>
          ) : null}
          {kind === "credit_note" ? <label className="bx-span">Reason for the credit<textarea rows={2} value={form.creditReason || ""} onChange={set("creditReason")} maxLength={2000} /></label> : null}
        </div>

        <h2 className="bx-sub">Lines</h2>
        <div className="bx-lines">
          {lines.map((line, index) => (
            <div key={line.key} className={`bx-line is-${line.lineType}`}>
              {line.lineType === "item" ? (
                <>
                  <div className="bx-line-main">
                    {items.length ? (
                      <select aria-label="Item" value={line.itemId} onChange={(event) => pickItem(line.key, event.target.value)}>
                        <option value="">Custom line</option>
                        {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    ) : null}
                    <textarea aria-label="Description" rows={2} value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder="Description (the second line prints smaller)" maxLength={2000} />
                  </div>
                  <div className="bx-line-nums">
                    <label>Qty<input inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} /></label>
                    <label>Unit<input value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} maxLength={20} placeholder="each" /></label>
                    <label>Price (R)<input inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} placeholder="0,00" /></label>
                    <label>Disc. %<input inputMode="decimal" value={line.discountPercent} onChange={(event) => updateLine(line.key, { discountPercent: event.target.value })} placeholder="0" /></label>
                    {vatRegistered ? (
                      <label>
                        VAT
                        <select value={line.taxType} onChange={(event) => updateLine(line.key, { taxType: event.target.value })}>
                          {["standard", "zero_rated", "exempt"].map((key) => <option key={key} value={key}>{TAX_LABELS[key]}</option>)}
                        </select>
                      </label>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="bx-line-main">
                  <input aria-label={line.lineType === "heading" ? "Heading" : "Subtotal label"} value={line.description} onChange={(event) => updateLine(line.key, { description: event.target.value })} placeholder={line.lineType === "heading" ? "Section heading" : "Subtotal"} maxLength={200} />
                </div>
              )}
              <div className="bx-line-tools">
                <button type="button" className="link-button" onClick={() => move(line.key, -1)} disabled={index === 0} aria-label="Move up">↑</button>
                <button type="button" className="link-button" onClick={() => move(line.key, 1)} disabled={index === lines.length - 1} aria-label="Move down">↓</button>
                <button type="button" className="link-button is-danger" onClick={() => setLines((prev) => prev.filter((entry) => entry.key !== line.key))} aria-label="Remove line">Remove</button>
              </div>
            </div>
          ))}
        </div>
        <p className="bx-actions-row">
          <button type="button" className="rx-button" onClick={() => setLines((prev) => [...prev, keyed(blankLine(vatRegistered))])}>Add line</button>
          <button type="button" className="rx-button" onClick={() => setLines((prev) => [...prev, keyed({ ...blankLine(vatRegistered), lineType: "heading" })])}>Add heading</button>
          <button type="button" className="rx-button" onClick={() => setLines((prev) => [...prev, keyed({ ...blankLine(vatRegistered), lineType: "subtotal", description: "Subtotal" })])}>Add subtotal</button>
        </p>

        <div className="bx-grid">
          <label className="bx-span">Notes<textarea rows={3} value={form.notes || ""} onChange={set("notes")} maxLength={4000} /></label>
          {kind !== "credit_note" ? <label className="bx-span">Terms<textarea rows={3} value={form.terms || ""} onChange={set("terms")} maxLength={4000} /></label> : null}
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <div className="bx-actions-row">
          <button type="button" className="rx-button bx-primary" onClick={save} disabled={saving || !form.customerId}>{saving ? "Saving…" : "Save draft"}</button>
          <a className="rx-button" href={docId ? `/billing/documents/${docId}` : `/billing/${info.path}`}>Cancel</a>
          <small className="field-hint">The number is given when you issue. Drafts can be changed freely.</small>
        </div>
      </section>

      <section className="bx-preview-pane" aria-label="Preview">
        <div className="bx-template-switch" role="radiogroup" aria-label="Template">
          {TEMPLATES.map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={form.template === key} className={form.template === key ? "is-on" : undefined} onClick={() => setForm((prev) => ({ ...prev, template: key }))}>{label}</button>
          ))}
        </div>
        <PreviewFrame html={html} />
      </section>
    </div>
  );
}
