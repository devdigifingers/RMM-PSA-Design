// One template, two outputs: the same HTML is printed to PDF and shown in the preview and on the hosted page.
// Ported from design/invoicing/src (templates.py, docs2.py, common.py); keep the markup and classes in step with it.
import { readFileSync } from "node:fs";
import QRCode from "qrcode";
import { formatQuantity, formatRand } from "./money.js";
import { documentTitle } from "./sars.js";

const ASSETS = new URL("../../assets/billing/", import.meta.url);
export const FONT_DIR = new URL("fonts/", ASSETS).pathname;
const CSS = Object.fromEntries(
  ["base", "shared", "modern", "classic", "minimal", "docs2", "screens", "engine"].map((name) => [name, readFileSync(new URL(`css/${name}.css`, ASSETS), "utf8")]),
);
export const TEMPLATE_KEYS = ["modern", "classic", "minimal"];
const TEMPLATE_CSS = { modern: "modern", classic: "classic", minimal: "minimal" };

export const STATUS = {
  paid: ["PAID", "#15803D", "#DCFCE7", "#166534"],
  partial: ["PARTIALLY PAID", "#B45309", "#FEF3C7", "#8A4508"],
  overdue: ["OVERDUE", "#B91C1C", "#FEE2E2", "#991B1B"],
  draft: ["DRAFT", "#475569", "#F1F5F9", "#334155"],
  void: ["VOID", "#111827", "#E5E7EB", "#111827"],
};

// ---------------------------------------------------------------- tenant colour tokens (spec §4.1 Contrast)
function channel(hex, index) {
  return parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
}
function luminance(hex) {
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(channel(hex, 0)) + 0.7152 * f(channel(hex, 1)) + 0.0722 * f(channel(hex, 2));
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function darken(hex, k) {
  return `#${[0, 1, 2].map((i) => Math.max(0, Math.trunc(channel(hex, i) * 255 * (1 - k))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function toOklab(hex) {
  const [r, g, b] = [0, 1, 2].map((i) => s2l(channel(hex, i)));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((x) => Math.max(0, Math.min(255, Math.round(l2s(Math.max(0, Math.min(1, x))) * 255))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}
export function mix(a, b, t) {
  const A = toOklab(a);
  const B = toOklab(b);
  return fromOklab(A.map((x, i) => x + (B[i] - x) * t));
}

export function brandTokens(primary = "#6D28D9", secondary = "#0891B2") {
  const p = /^#[0-9A-Fa-f]{6}$/.test(primary) ? primary.toUpperCase() : "#6D28D9";
  const s = /^#[0-9A-Fa-f]{6}$/.test(secondary) ? secondary.toUpperCase() : "#0891B2";
  const onPrimary = contrast(p, "#FFFFFF") >= 4.5 ? "#FFFFFF" : "#0F172A";
  let primaryText = p;
  let k = 0;
  while (contrast(primaryText, "#FFFFFF") < 4.5 && k < 0.9) {
    k += 0.05;
    primaryText = darken(p, k);
  }
  let safe = 0;
  for (let x = 0; x <= 20; x += 1) if (contrast(mix(p, s, x / 20), onPrimary) >= 4.5) safe = x / 20;
  return { primary: p, secondary: s, onPrimary, primaryText, gradTextEnd: mix(p, s, safe) };
}

function tokenCss(t) {
  return `:root{--primary:${t.primary};--secondary:${t.secondary};--grad-text-end:${t.gradTextEnd};--on-primary:${t.onPrimary};--primary-text:${t.primaryText};`
    + `--tint4:color-mix(in srgb,${t.primary} 4%,#fff);--tint6:color-mix(in srgb,${t.primary} 7%,#fff);`
    + `--tint12:color-mix(in srgb,${t.primary} 14%,#fff);--tint20:color-mix(in srgb,${t.primary} 22%,#fff);}`;
}

// ---------------------------------------------------------------- formatting
export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
const rand = (cents) => formatRand(Number(cents) || 0);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function longDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "";
}
const br = (lines) => lines.filter((line) => line !== null && line !== undefined && line !== "").join("<br>");
const addressLines = (text) => String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(esc);
const titleCase = (text) => text.replace(/\b\w/g, (c) => c.toUpperCase());
const sentenceCase = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const METHOD = { eft: "EFT", cash: "Cash", card: "Card", other: "Other", credit: "Credit" };

function stamp(status, size) {
  const [word, colour] = STATUS[status];
  return `<div class="stamp" aria-hidden="true" style="--stamp:${colour};font-size:${size || (word.includes(" ") ? 76 : 120)}px">${word}</div>`;
}
function pill(status, text) {
  const [word, , bg, fg] = STATUS[status];
  return `<span class="spill" style="background:${bg};color:${fg}">${esc(text || titleCase(word.toLowerCase()))}</span>`;
}

// ---------------------------------------------------------------- shared fragments
function supplierLines(v) {
  const s = v.supplier;
  return [`<strong>${esc(s.legalName)}</strong>`, ...addressLines(s.physicalAddress),
    v.vatRegistered && s.vatNumber ? `VAT no. ${esc(s.vatNumber)}` : null, s.regNo ? `Reg. no. ${esc(s.regNo)}` : null];
}
function supplierIds(v) {
  const s = v.supplier;
  return [v.vatRegistered && s.vatNumber ? `VAT no. ${esc(s.vatNumber)}` : null, s.regNo ? `Reg. no. ${esc(s.regNo)}` : null].filter(Boolean).join(" · ");
}
function customerLines(v) {
  const c = v.recipient;
  return [`<strong>${esc(c.name)}</strong>`, c.contact ? esc(c.contact) : null, ...addressLines(c.address), c.vatNumber ? `VAT no. ${esc(c.vatNumber)}` : null];
}
function logo(v, cls = "logo") {
  const s = v.supplier;
  const name = s.tradingName || s.legalName;
  return s.logo ? `<img class="${cls}" src="${esc(s.logo)}" alt="${esc(name)}">` : `<div class="logo-text">${esc(name)}</div>`;
}
function bankRows(bank) {
  const rows = [["Bank", bank.bankName], ["Account name", bank.accountName], ["Account number", bank.accountNumber]];
  if (bank.branchCode) rows.push(["Branch code", bank.branchCode]);
  if (bank.accountType) rows.push(["Account type", bank.accountType]);
  if (bank.swift) rows.push(["BIC / SWIFT", bank.swift]);
  return rows;
}
export { bankRows };
function bankCompact(bank) {
  const last = bank.branchCode ? ["Branch · type", [bank.branchCode, bank.accountType].filter(Boolean).join(" · ")] : bank.swift ? ["BIC / SWIFT", bank.swift] : null;
  return `<dl class="bank"><dt>Bank</dt><dd>${esc(bank.bankName)}</dd><dt>Account</dt><dd>${esc(bank.accountName)}</dd>`
    + `<dt>Account no.</dt><dd>${esc(bank.accountNumber)}</dd>${last ? `<dt>${last[0]}</dt><dd>${esc(last[1])}</dd>` : ""}</dl>`;
}
function bankInline(bank) {
  return [bank.bankName, `Acc. ${bank.accountNumber}`, bank.branchCode ? `Branch ${bank.branchCode}` : bank.swift ? `SWIFT ${bank.swift}` : null].filter(Boolean).map(esc);
}
function linkText(link) {
  return esc(String(link || "").replace(/^https?:\/\//, "")).replace(/\/(pay|q)\//, "<wbr>/$1/");
}
function qrBlock(v) {
  return v.qrSvg ? `<div class="qr">${v.qrSvg}</div>` : "";
}

function title(v, style = "upper") {
  const word = documentTitle(v.kind, v.vatRegistered);
  if (style === "upper") return word.toUpperCase();
  if (style === "sentence") return sentenceCase(word);
  return word;
}

function lastColumn(v) {
  if (v.kind === "credit_note") return "Credit";
  if (v.priceMode === "incl" && v.vatRegistered) return "Amount (incl.)";
  return "Amount";
}
function thead(v, last = lastColumn(v)) {
  const vat = v.vatRegistered ? '<th class="r">VAT</th>' : "";
  return `<thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th>${vat}<th class="r">${last}</th></tr></thead>`;
}
const lineAmount = (v, line) => (v.priceMode === "incl" && v.vatRegistered ? line.total : line.net);
function vatCell(line) {
  if (line.taxType === "exempt") return "Exempt";
  return `${(line.rateBp / 100).toLocaleString("en-ZA")}%`;
}
function splitDescription(line) {
  const [first, ...rest] = String(line.description || "").split(/\r?\n/);
  const detail = rest.join("\n").trim();
  const discount = line.discountBp ? `Less ${(line.discountBp / 100).toLocaleString("en-ZA")}% discount` : "";
  return { first, detail: [detail, discount].filter(Boolean).join("\n") };
}

function lineRows(v, rows, dcls = "d1") {
  const cols = v.vatRegistered ? 5 : 4;
  return rows.map(({ line, runningSubtotal }) => {
    if (line.lineType === "heading") return `<tr class="grp"><td colspan="${cols}">${esc(line.description)}</td></tr>`;
    if (line.lineType === "subtotal") {
      return `<tr class="sub"><td colspan="${cols - 1}" class="r">${esc(line.description || "Subtotal")}</td><td class="r nowrap">${rand(runningSubtotal)}</td></tr>`;
    }
    const { first, detail } = splitDescription(line);
    const unit = line.unit && line.unit !== "each" ? ` / ${esc(line.unit)}` : "";
    const mq = `<div class="mq">${esc(formatQuantity(line.quantity))} × ${rand(line.unitPriceCents)}${v.vatRegistered ? ` · VAT ${vatCell(line)}` : ""}</div>`;
    return `<tr><td><div class="${dcls}">${esc(first)}</div>${detail ? `<div class="d2">${esc(detail)}</div>` : ""}${mq}</td>`
      + `<td class="r">${esc(formatQuantity(line.quantity))}</td><td class="r nowrap">${rand(line.unitPriceCents)}${unit}</td>`
      + `${v.vatRegistered ? `<td class="r">${vatCell(line)}</td>` : ""}<td class="r nowrap">${rand(lineAmount(v, line))}</td></tr>`;
  }).join("");
}

function totalLabel(v) {
  if (v.kind === "credit_note") return "Total credit";
  return v.vatRegistered ? "Total (incl. VAT)" : "Total";
}
function vatRows(v) {
  const rows = [];
  for (const entry of v.totals.vatByRate) {
    const [type] = String(entry.rateKey).split(":");
    if (entry.rateBp > 0) rows.push(`<div class="row"><span>VAT ${(entry.rateBp / 100).toLocaleString("en-ZA")}% on ${rand(entry.net)}</span><span>${rand(entry.vat)}</span></div>`);
    else if (type === "zero_rated" && entry.net) rows.push(`<div class="row"><span>Zero-rated supplies</span><span>${rand(entry.net)}</span></div>`);
    else if (type === "exempt" && entry.net) rows.push(`<div class="row"><span>Exempt supplies</span><span>${rand(entry.net)}</span></div>`);
  }
  return rows.join("");
}
function totalsRows(v) {
  if (v.vatRegistered) {
    return `<div class="row"><span>Subtotal (excl. VAT)</span><span>${rand(v.totals.subtotal)}</span></div>${vatRows(v)}`
      + `<div class="row grand"><span>${totalLabel(v)}</span><span>${rand(v.totals.total)}</span></div>`;
  }
  return `<div class="row grand"><span>${totalLabel(v)}</span><span>${rand(v.totals.total)}</span></div>`
    + '<div class="row novat"><span>Not registered for VAT</span><span></span></div>';
}
function paymentRows(v) {
  if (v.kind !== "invoice") return "";
  const paid = v.payments.map((p) => `<div class="row"><span>Paid ${longDate(p.date)} · ${METHOD[p.method] || esc(p.method)}</span><span>−${rand(p.amountCents)}</span></div>`).join("");
  const credits = v.credits.map((c) => `<div class="row"><span>Credit note ${esc(c.number)}</span><span>−${rand(c.amountCents)}</span></div>`).join("");
  return paid + credits;
}
function balanceRow(v) {
  return v.kind === "invoice" ? `<div class="row bal"><span>Balance due</span><span>${rand(v.balanceCents)}</span></div>` : "";
}
function appliedBox(v) {
  const c = v.credit;
  if (v.kind !== "credit_note" || !c?.originalNumber) return "";
  return `<div class="applied"><div class="row"><span>${esc(c.originalNumber)} total</span><span>${rand(c.originalTotal)}</span></div>`
    + `<div class="row"><span>Less this credit note</span><span>−${rand(v.totals.total)}</span></div>`
    + `<div class="row bal"><span>New balance on ${esc(c.originalNumber)}</span><span>${rand(c.newBalance)}</span></div></div>`;
}

function details(v) {
  const rows = [];
  if (v.kind === "invoice") {
    rows.push(["Issue date", longDate(v.issueDate)], ["Due date", longDate(v.dueDate)]);
    if (v.termsDays != null) rows.push(["Terms", v.termsDays === 0 ? "On receipt" : `${v.termsDays} days`]);
  } else if (v.kind === "quote") {
    rows.push(["Quote date", longDate(v.issueDate)], ["Valid until", longDate(v.validUntil)]);
  } else {
    rows.push(["Credit date", longDate(v.issueDate)]);
    if (v.credit?.originalNumber) rows.push(["Original invoice", esc(v.credit.originalNumber)], ["Invoice date", longDate(v.credit.originalDate)]);
  }
  if (v.poNumber) rows.push(["PO / ref.", esc(v.poNumber)]);
  return rows;
}
const kv = (rows, cls = "kv v") => `<dl class="${cls}">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join("")}</dl>`;

function payReference(v) {
  return v.kind === "credit_note" && v.credit?.originalNumber ? v.credit.originalNumber : v.number || "your invoice number";
}
function showsBank(v) {
  return Boolean(v.supplier.bank) && v.kind !== "quote";
}
function footerLine(v, pageLabel) {
  const s = v.supplier;
  return [v.copy ? '<b class="copy">COPY</b>' : null, esc(s.tradingName || s.legalName), s.phone ? esc(s.phone) : null, s.email ? esc(s.email) : null, pageLabel].filter(Boolean).join(" · ");
}
function onlineCaption(v) {
  if (v.kind === "quote") return "View &amp; accept online";
  if (v.kind === "credit_note") return "View online";
  return "Scan to view &amp; pay";
}

// ---------------------------------------------------------------- pagination
// Measured from Chrome prints of the sample documents (A4 = 794 x 1123 CSS px). Estimates lean slightly tall.
const METRICS = {
  modern: { desc: 62, descVat: 54, pad: 15, lh: 19, lh2: 17, grp: 30, sub: 34, cf: 34, contTop: 121, slimTop: 1123 - 24 - 44, footBase: 1123 - 24, dense: { pad: 11, lh2: 15, grp: 26, sub: 30, cf: 32 } },
  classic: { desc: 66, descVat: 58, pad: 16, lh: 18, lh2: 16, grp: 31, sub: 33, cf: 33, contTop: 125, slimTop: 1123 - 26 - 44, footBase: 1123 - 26 },
  minimal: { desc: 56, descVat: 48, pad: 21, lh: 18, lh2: 16, grp: 36, sub: 38, cf: 38, contTop: 115, slimTop: 1123 - 40 - 44, footBase: 1123 - 40 },
};
const textLines = (text, perLine) => (text ? String(text).split(/\r?\n/).reduce((sum, part) => sum + Math.max(1, Math.ceil(part.length / perLine)), 0) : 0);

function rowHeight(v, m, line) {
  if (line.lineType === "heading") return m.grp;
  if (line.lineType === "subtotal") return m.sub;
  const per = v.vatRegistered ? m.descVat : m.desc;
  const { first, detail } = splitDescription(line);
  return m.pad + textLines(first || " ", per) * m.lh + textLines(detail, Math.round(per * 1.1)) * m.lh2;
}

function firstTop(v, template) {
  const party = Math.max(customerLines(v).filter(Boolean).length, supplierLines(v).filter(Boolean).length);
  if (template === "classic") return 282 + Math.max(party, details(v).length + 1) * 19.5 + (v.pill ? 30 : 0);
  if (template === "minimal") return 48 + 32 + 84 + 28 + party * 19 + 24 + 44 + 57 + 30;
  const reason = v.kind === "credit_note" ? Math.max(0, textLines(v.credit?.reason, 60) - 3) * 19 : 0;
  return 331 + Math.max(party, details(v).length) * 19.5 + reason;
}

function footerHeight(v, template) {
  const terms = textLines(v.termsText, 45) * 17;
  const bank = showsBank(v) ? 4 * 17 + 50 : 0;
  const qr = v.qrSvg ? 92 : 0;
  if (template === "minimal") return 14 + 48;
  if (template === "classic") return 12 + Math.max(bank - 30, terms + 16, qr - 20) + 25;
  return 16 + Math.max(bank, terms + 20, qr) + 34;
}

function totalsHeight(v, template) {
  const vatRowCount = v.vatRegistered ? 1 + v.totals.vatByRate.length : 1;
  const payRows = v.kind === "invoice" ? v.payments.length + v.credits.length + 1 : 0;
  const tot = vatRowCount * 27 + 44 + payRows * 27 + (v.kind === "credit_note" && v.credit?.originalNumber ? 110 : 0);
  const notes = textLines(v.notes, 48) * 17 + 24;
  if (template === "classic") return 18 + Math.max(tot + 12, notes + 40 + 70 + (v.kind === "invoice" && showsBank(v) ? 50 : 0));
  if (template === "minimal") return 57 + Math.max(tot + 20, notes + textLines(v.termsText, 48) * 18 + 20);
  return 18 + Math.max(tot, notes + (v.kind === "credit_note" ? 60 : 0));
}

// Splits rows over A4 pages: "Carried forward" closes each full page and payment details go on the last page only.
export function paginate(v, template) {
  const pages = paginateWith(v, template, METRICS[template]);
  const dense = METRICS[template].dense;
  return pages.length > 1 && dense ? paginateWith(v, template, { ...METRICS[template], ...dense }) : pages;
}

function paginateWith(v, template, m) {
  const rows = [];
  let running = 0;
  for (const line of v.lines) {
    if (line.lineType === "item") running += lineAmount(v, line);
    rows.push({ line, runningSubtotal: running, height: rowHeight(v, m, line) });
    if (line.lineType === "subtotal") running = 0;
  }
  const fullTop = m.footBase - footerHeight(v, template);
  const totals = totalsHeight(v, template);
  const pages = [];
  let current = [];
  let y = firstTop(v, template);
  for (const row of rows) {
    if (current.length && y + row.height > m.slimTop - m.cf) {
      pages.push(current);
      current = [];
      y = m.contTop + m.cf;
    }
    current.push(row);
    y += row.height;
  }
  if (y + totals > fullTop) {
    const carry = [];
    while (current.length > 1 && carry.length < 3) carry.unshift(current.pop());
    pages.push(current);
    current = carry;
  }
  pages.push(current);
  return pages;
}

function carried(rows) {
  let total = 0;
  for (const { line } of rows) if (line.lineType === "item") total += line.amountForCarry;
  return total;
}

// ---------------------------------------------------------------- templates
function modernFoot(v, pageLabel) {
  const cols = [];
  if (showsBank(v)) {
    cols.push(`<div><div class="lbl">${v.kind === "credit_note" ? "Paying the balance (EFT)" : "How to pay (EFT)"}</div>${bankCompact(v.supplier.bank)}<div class="ref">Use reference: <b>${esc(payReference(v))}</b></div></div>`);
  }
  if (v.termsText) cols.push(`<div><div class="lbl">Terms</div><p>${esc(v.termsText)}</p></div>`);
  if (v.qrSvg) cols.push(`<div><div class="lbl">${v.kind === "invoice" ? "Pay online" : "Online copy"}</div><div class="qrbox">${qrBlock(v)}<div class="t"><b>${onlineCaption(v)}</b>${linkText(v.link)}</div></div></div>`);
  const cls = cols.length === 3 ? "cols" : `cols c${Math.max(1, cols.length)}`;
  return `<footer class="foot">${cols.length ? `<div class="${cls}">${cols.join("")}</div>` : ""}<div class="thanks"><span class="ty">Thank you for your business</span><span>${footerLine(v, pageLabel)}</span></div></footer>`;
}

function slimFoot(v, pageNo, pageCount) {
  return `<footer class="foot slim"><span class="cont">Continued on page ${pageNo + 1} →</span><span>${footerLine(v, `${esc(v.number || "Draft")} · Page ${pageNo} of ${pageCount}`)}</span></footer>`;
}

function continuationHead(v, pageNo, pageCount) {
  const s = v.supplier;
  const img = s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.tradingName || s.legalName)}">` : "";
  const issued = v.issueDate ? ` · ${v.kind === "quote" ? "Dated" : "Issued"} ${longDate(v.issueDate)}` : "";
  return `<header class="chead">${img}<div class="ct"><b>${title(v)} ${esc(v.number || "")}</b> <span>(continued)</span></div>`
    + `<div class="cr">${esc(v.recipient.name)}${issued}<br><b>Page ${pageNo} of ${pageCount}</b></div></header>`;
}

function tableFor(v, rows, { first, last, carryIn, carryOut, dense }) {
  const cols = v.vatRegistered ? 5 : 4;
  const bf = first ? "" : `<tr class="cf bf"><td colspan="${cols - 1}">Brought forward from page ${carryIn.page}</td><td class="r nowrap">${rand(carryIn.amount)}</td></tr>`;
  const cf = last ? "" : `<tr class="cf"><td colspan="${cols - 1}">Carried forward to page ${carryOut.page}</td><td class="r nowrap">${rand(carryOut.amount)}</td></tr>`;
  return `<table class="lines${dense ? " dense" : ""}${last ? "" : " flow-end"}">${thead(v)}<tbody>${bf}${lineRows(v, rows)}${cf}</tbody></table>`;
}

function modernPages(v, pages, mode) {
  const count = pages.length;
  let carry = 0;
  return pages.map((rows, index) => {
    const pageNo = index + 1;
    const first = index === 0;
    const last = index === count - 1;
    const carryIn = { page: pageNo - 1, amount: carry };
    carry += carried(rows);
    const table = tableFor(v, rows, { first, last, carryIn, carryOut: { page: pageNo + 1, amount: carry }, dense: count > 1 });
    let top = "";
    if (first) {
      const extra = v.kind === "credit_note" && v.credit?.originalNumber ? `<div class="st"><span class="spill cn">Credit for ${esc(v.credit.originalNumber)}</span></div>` : "";
      const pillHtml = v.pill ? `${pill(v.pill.status, v.pill.text)} ` : "";
      top = `<header class="head">${logo(v)}<div class="title"><h1>${title(v)}</h1><div class="no">${pillHtml}${esc(v.number || "Draft")}</div>${extra}</div></header>`
        + `<section class="info"><div><div class="lbl">${v.kind === "credit_note" ? "Credited to" : v.kind === "quote" ? "Quote for" : "Billed to"}</div><div class="v">${br(customerLines(v))}</div></div>`
        + `<div><div class="lbl">From</div><div class="v">${br(supplierLines(v))}</div></div>`
        + `<div><div class="lbl">Details</div>${kv(details(v))}</div></section>`
        + modernSumRow(v, mode);
    }
    const totals = last ? `<section class="totals flow-end">${modernNotes(v)}<div class="tot">${totalsRows(v)}${paymentRows(v)}${balanceRow(v)}${appliedBox(v)}</div></section>` : "";
    const wrap = `<div class="wrap${first ? "" : " w2"}">${top}${table}${totals}</div>`;
    const foot = last ? modernFoot(v, mode === "screen" ? "" : `Page ${pageNo} of ${count}`) : slimFoot(v, pageNo, count);
    const doc = `<div class="t-modern doc"><div class="bar"></div>${first ? "" : continuationHead(v, pageNo, count)}${wrap}${foot}${v.stamp ? stamp(v.stamp) : ""}</div>`;
    return mode === "screen" ? `<div class="doc-card">${doc}</div>` : `<div class="page">${doc}</div>`;
  }).join("");
}

function modernSumRow(v, mode) {
  const subject = v.kind === "credit_note"
    ? `<div class="reason"><div class="lbl">Reason for credit</div><p>${esc(v.credit?.reason || "")}</p></div>`
    : `<div class="subject">${v.reference ? `<div class="lbl">Summary</div><div class="s1">${esc(v.reference)}</div>` : ""}</div>`;
  let box;
  if (v.kind === "quote") {
    box = `<div class="due"><div class="lbl">Quote total</div><div class="amt">${rand(v.totals.total)}</div><div class="dd"><span>Valid until ${longDate(v.validUntil)}</span></div></div>`;
  } else if (v.kind === "credit_note") {
    const applied = v.credit?.originalNumber ? `Applied to ${esc(v.credit.originalNumber)}` : "Held as account credit";
    box = `<div class="due cnd"><div class="lbl">Credit amount</div><div class="amt">${rand(v.totals.total)}</div><div class="dd"><span>${applied}</span></div></div>`;
  } else {
    const paidOff = v.balanceCents === 0 && v.payments.length;
    const dueLine = paidOff ? `Paid in full · ${longDate(v.payments.at(-1).date)}` : `Due ${longDate(v.dueDate)}`;
    const payNow = v.link && v.balanceCents > 0 && mode !== "pdf" && v.payUrl ? `<a class="pill screen-only" href="${esc(v.payUrl)}" target="_top">Pay now →</a>` : "";
    box = `<div class="due"><div class="lbl">Amount due</div><div class="amt">${rand(v.balanceCents)}</div><div class="dd"><span>${dueLine}</span>${payNow}</div></div>`;
  }
  return `<section class="sumrow">${subject}${box}</section>`;
}

function modernNotes(v) {
  if (v.kind === "credit_note") {
    const how = v.credit?.originalNumber
      ? `This credit has been applied to ${esc(v.credit.originalNumber)}.${v.credit.newBalance > 0 ? " Please pay the new balance shown." : " No payment is needed."}`
      : "This credit is held on your account and will be used against your next invoice.";
    return `<div class="notes"><div class="lbl">How this credit is used</div><p>${how}</p>${v.notes ? `<p>${esc(v.notes)}</p>` : ""}</div>`;
  }
  return `<div class="notes">${v.notes ? `<div class="lbl">Notes</div><p>${esc(v.notes)}</p>` : ""}</div>`;
}

function classicPages(v, pages) {
  const count = pages.length;
  const s = v.supplier;
  let carry = 0;
  return pages.map((rows, index) => {
    const pageNo = index + 1;
    const first = index === 0;
    const last = index === count - 1;
    const carryIn = { page: pageNo - 1, amount: carry };
    carry += carried(rows);
    const table = tableFor(v, rows, { first, last, carryIn, carryOut: { page: pageNo + 1, amount: carry } });
    let top = "";
    if (first) {
      const head = s.logo ? `<img class="logo" src="${esc(s.logo)}" alt="" style="height:40px;width:auto;margin:0 auto 8px">` : "";
      const addr = [...addressLines(s.physicalAddress), s.phone ? `Tel ${esc(s.phone)}` : null, supplierIds(v) || null].filter(Boolean).join(" · ");
      const label = v.kind === "credit_note" ? "Credit to" : v.kind === "quote" ? "Quote for" : "Invoice to";
      const detailTitle = v.kind === "credit_note" ? "Credit note details" : v.kind === "quote" ? "Quote details" : "Invoice details";
      const numberLabel = v.kind === "credit_note" ? "Credit note no." : v.kind === "quote" ? "Quote no." : "Invoice no.";
      const pillHtml = v.pill ? `<div style="text-align:center;margin-top:-8px;margin-bottom:12px">${pill(v.pill.status, v.pill.text)}</div>` : "";
      top = `<header class="head">${head}<div class="co">${esc(s.legalName)}</div><div class="addr">${addr}</div></header><div class="dbl"></div>`
        + `<div class="ttl"><i></i><h1>${title(v, "title")}</h1><i></i></div>${pillHtml}`
        + `<section class="boxes"><div class="box"><h3>${label}</h3>${br(customerLines(v))}</div>`
        + `<div class="box"><h3>${detailTitle}</h3>${kv([[numberLabel, `<b>${esc(v.number || "Draft")}</b>`], ...details(v)], "kv")}</div></section>`;
    }
    let totals = "";
    if (last) {
      const left = [];
      if (v.kind === "credit_note") left.push(`<h4>Reason for credit</h4><p>${esc(v.credit?.reason || "")}</p>`);
      if (v.reference) left.push(`<h4>Reference</h4><p>${esc(v.reference)}</p>`);
      if (v.notes) left.push(`<h4>Notes</h4><p>${esc(v.notes)}</p>`);
      if (v.kind === "invoice" && showsBank(v)) left.push(`<h4>Payment</h4><p>Please pay by EFT using reference <b>${esc(payReference(v))}</b>. Bank details below.</p>`);
      if (v.kind !== "credit_note") left.push('<div class="sig"><div>Authorised signature</div><div>Date</div></div>');
      totals = `<section class="lower flow-end"><div class="left">${left.join("")}</div><div class="tot">${totalsRows(v)}${paymentRows(v)}${balanceRow(v)}${appliedBox(v)}</div></section>`;
    }
    let foot;
    if (last) {
      const cols = [];
      if (showsBank(v)) cols.push(`<div><h4>Banking details</h4>${bankCompact(s.bank)}</div>`);
      if (v.termsText) cols.push(`<div><h4>Terms</h4><p>${esc(v.termsText)}</p></div>`);
      if (v.qrSvg) cols.push(`<div><div class="qrbox">${qrBlock(v)}<div class="t"><b>${onlineCaption(v).replace("Scan to view", "View")}</b>${linkText(v.link)}</div></div></div>`);
      const cls = cols.length === 3 ? "cols" : `cols c${Math.max(1, cols.length)}`;
      const meta = [v.copy ? '<b class="copy">COPY</b>' : null, esc(s.legalName), s.email ? esc(s.email) : null, s.website ? esc(s.website) : null].filter(Boolean).join(" · ");
      foot = `<footer class="foot">${cols.length ? `<div class="${cls}">${cols.join("")}</div>` : ""}<div class="pg"><span>${meta}</span><span>Page ${pageNo} of ${count}</span></div></footer>`;
    } else {
      foot = slimFoot(v, pageNo, count);
    }
    return `<div class="page"><div class="t-classic doc">${first ? "" : continuationHead(v, pageNo, count)}<div class="wrap${first ? "" : " w2"}">${top}${table}${totals}</div>${foot}${v.stamp ? stamp(v.stamp) : ""}</div></div>`;
  }).join("");
}

function minimalTotals(v) {
  const rows = [];
  const settled = v.kind === "invoice" && (v.payments.length || v.credits.length);
  if (v.vatRegistered) rows.push(`<div class="row"><span>Subtotal</span><span>${rand(v.totals.subtotal)}</span></div>`, vatRows(v));
  const bigLabel = v.kind === "credit_note" ? "Total credit" : v.kind === "quote" ? "Total" : "Total due";
  if (settled) {
    rows.push(`<div class="row grand-row"><span>Total</span><span>${rand(v.totals.total)}</span></div>`, paymentRows(v));
    rows.push(`<div class="big"><span class="k">Balance due</span><span class="v">${rand(v.balanceCents)}</span></div>`);
  } else {
    rows.push(`<div class="big"><span class="k">${bigLabel}</span><span class="v">${rand(v.totals.total)}</span></div>`);
  }
  if (!v.vatRegistered) rows.push('<div class="row novat"><span>Not registered for VAT</span><span></span></div>');
  return rows.join("") + appliedBox(v);
}

function minimalPages(v, pages) {
  const count = pages.length;
  const s = v.supplier;
  let carry = 0;
  return pages.map((rows, index) => {
    const pageNo = index + 1;
    const first = index === 0;
    const last = index === count - 1;
    const carryIn = { page: pageNo - 1, amount: carry };
    carry += carried(rows);
    const table = tableFor(v, rows, { first, last, carryIn, carryOut: { page: pageNo + 1, amount: carry } });
    let top = "";
    if (first) {
      const numberLabel = v.kind === "credit_note" ? "Credit note number" : v.kind === "quote" ? "Quote number" : "Invoice number";
      const cells = [[numberLabel, esc(v.number || "Draft")], ...details(v).filter(([k]) => k !== "Terms")];
      const pillHtml = v.pill ? ` ${pill(v.pill.status, v.pill.text)}` : "";
      top = `<header class="head">${logo(v)}<div class="no">${esc(v.number || "Draft")}</div></header>`
        + `<div class="ttl"><i></i><h1>${title(v, "sentence")}</h1>${pillHtml}</div>`
        + `<section class="grid"><div class="span2"><div class="k">${v.kind === "credit_note" ? "Credited to" : v.kind === "quote" ? "Quote for" : "Billed to"}</div>${br(customerLines(v))}</div>`
        + `<div class="span2"><div class="k">From</div>${br(supplierLines(v))}</div>`
        + cells.slice(0, 4).map(([k, val]) => `<div><div class="k">${k}</div>${val}</div>`).join("") + "</section><hr>";
    }
    let totals = "";
    if (last) {
      const note = [v.kind === "credit_note" && v.credit?.reason ? `<b>Reason:</b> ${esc(v.credit.reason)}` : null, v.reference ? esc(v.reference) : null, v.notes ? esc(v.notes) : null, v.termsText ? esc(v.termsText) : null].filter(Boolean).join("<br><br>");
      totals = `<hr><section class="sum flow-end"><div class="note">${note}</div><div class="tot">${minimalTotals(v)}</div></section>`;
    }
    let foot;
    if (last) {
      const bank = showsBank(v) ? `<b>Pay by EFT</b> · ${bankInline(s.bank).join(" · ")} · Ref <b>${esc(payReference(v))}</b><br>${esc(s.bank.accountName)}` : `<b>${esc(s.tradingName || s.legalName)}</b>${s.email ? ` · ${esc(s.email)}` : ""}`;
      const online = v.link ? `${showsBank(v) ? " · " : "<br>"}${v.kind === "quote" ? "View and accept online" : "View online"}: ${linkText(v.link)}` : "";
      foot = `<footer class="foot"><div class="line">${qrBlock(v)}<span>${v.copy ? '<b class="copy">COPY</b> · ' : ""}${bank}${online}</span><span class="pg">Page ${pageNo} of ${count}</span></div></footer>`;
    } else {
      foot = slimFoot(v, pageNo, count);
    }
    return `<div class="page"><div class="t-min doc">${first ? "" : continuationHead(v, pageNo, count)}<div class="wrap${first ? "" : " w2"}">${top}${table}${totals}</div>${foot}${v.stamp ? stamp(v.stamp) : ""}</div></div>`;
  }).join("");
}

// ---------------------------------------------------------------- entry points
export async function qrSvg(url) {
  if (!url) return "";
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" });
  return svg.replace(/<\?xml[^>]*>/, "").replace(/ width="[^"]*" height="[^"]*"/, "");
}

// options.mode: "pdf" (A4 pages for printing), "preview" (A4 pages on a grey desk), "screen" (hosted page, Modern flows).
// options.stamp: a STATUS key or null. options.copy: true for the regenerated "Copy" PDF.
export function renderDocument(view, { mode = "pdf", stamp: stampKey = null, pill: pillValue = null, copy = false, fontBase = `file://${FONT_DIR}` } = {}) {
  const template = TEMPLATE_KEYS.includes(view.template) ? view.template : "modern";
  const v = { ...view, stamp: stampKey, pill: pillValue, copy };
  v.lines = v.lines.map((line) => ({ ...line, amountForCarry: lineAmount(v, line) }));
  const tokens = brandTokens(v.supplier.primaryColour, v.supplier.secondaryColour);
  const flowing = mode === "screen" && template === "modern";
  const pages = flowing ? [v.lines.map((line) => ({ line, runningSubtotal: 0 }))] : paginate(v, template);
  if (flowing) {
    let running = 0;
    for (const row of pages[0]) {
      if (row.line.lineType === "item") running += lineAmount(v, row.line);
      row.runningSubtotal = running;
      if (row.line.lineType === "subtotal") running = 0;
    }
  }
  const body = template === "classic" ? classicPages(v, pages) : template === "minimal" ? minimalPages(v, pages) : modernPages(v, pages, flowing ? "screen" : mode);
  const fonts = fontBase.endsWith("/") ? fontBase : `${fontBase}/`;
  const css = ["base", "shared", TEMPLATE_CSS[template], "docs2", "engine"].map((name) => CSS[name]).join("\n").replaceAll("../assets/fonts/", fonts);
  const bodyClass = mode === "pdf" ? "" : flowing ? "scr flow" : "a4";
  const docTitle = `${title(v, "title")} ${v.number || "draft"}`;
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">`
    + `<title>${esc(docTitle)}</title><style>${css}\n${tokenCss(tokens)}${flowing ? "body.scr.flow{background:transparent;}" : ""}</style></head>`
    + `<body class="${bodyClass}">${body}</body></html>`;
}

export function hostedCss() {
  return CSS.screens;
}
export { brandTokens as tokensFor, tokenCss };
