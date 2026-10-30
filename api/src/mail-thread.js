// Pure helpers for the email channel: no database or network access.

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "mweb.co.za", "telkomsa.net",
  "webmail.co.za", "vodamail.co.za", "gmx.com", "zoho.com",
]);
const BULK_PRECEDENCE = new Set(["bulk", "junk", "list", "auto_reply"]);

export function ticketToken(id) {
  return `[#${id}]`;
}

export function ticketIdFromSubject(subject) {
  const match = String(subject || "").match(/\[#(\d{1,12})\]/);
  return match ? Number(match[1]) : null;
}

export function replySubject(id, subject) {
  const base = String(subject || "").replace(/\[#\d{1,12}\]\s*/g, "").replace(/^\s*((re|fw|fwd):\s*)+/i, "").trim();
  return `Re: ${ticketToken(id)} ${base || "Your request"}`.slice(0, 200);
}

export function inboundSubject(subject) {
  const text = String(subject || "")
    .replace(/\[#\d{1,12}\]\s*/g, "")
    .replace(/^\s*((re|fw|fwd|aw):\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "(no subject)").slice(0, 200);
}

export function emailDomain(address) {
  const at = String(address || "").lastIndexOf("@");
  return at < 0 ? "" : String(address).slice(at + 1).trim().toLowerCase();
}

// A shared mail provider domain says nothing about which customer sent it.
export function companyDomain(address) {
  const domain = emailDomain(address);
  return domain && !FREE_MAIL.has(domain) ? domain : "";
}

export function websiteDomain(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return "";
  return text.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
}

function headerText(headers, name) {
  if (!headers) return "";
  const value = typeof headers.get === "function" ? headers.get(name) : headers[name];
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value.value === "string") return value.value;
  return String(value);
}

// headers: a Map (mailparser) or plain object with lower-case names.
export function isAutomatic(headers) {
  const auto = headerText(headers, "auto-submitted").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (BULK_PRECEDENCE.has(headerText(headers, "precedence").trim().toLowerCase())) return true;
  if (headerText(headers, "x-autoreply") || headerText(headers, "x-autorespond")) return true;
  if (/(^|,)\s*(all|oof|autoreply)\s*(,|$)/i.test(headerText(headers, "x-auto-response-suppress"))) return true;
  if (headerText(headers, "x-df-ticket")) return true;
  if (headerText(headers, "list-id") || headerText(headers, "list-unsubscribe")) return true;
  return false;
}

export function messageIds(...values) {
  const ids = [];
  for (const value of values) {
    const list = Array.isArray(value) ? value : String(value || "").split(/\s+/);
    for (const item of list) {
      const match = String(item || "").match(/<[^\s<>]{3,250}>/g);
      if (match) ids.push(...match);
    }
  }
  return [...new Set(ids)].slice(-20);
}

const QUOTE_MARKERS = [
  /^On .{4,200}wrote:\s*$/i,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^_{8,}\s*$/,
  /^From:\s.+/i,
  /^Sent from my /i,
  /^Get Outlook for /i,
];

// Keeps the new text of a reply and drops the quoted thread under it.
export function replyText(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const kept = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (QUOTE_MARKERS.some((pattern) => pattern.test(trimmed)) && kept.some((item) => item.trim())) break;
    if (trimmed.startsWith(">")) continue;
    kept.push(line);
  }
  const body = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return body.slice(0, 4000);
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeColor(value) {
  return /^#[0-9A-Fa-f]{6}$/.test(String(value || "")) ? value : "#8B5CF6";
}

// The email a customer receives when an agent replies on their ticket.
export function brandedReply({ orgName, agentName, body, ticketId, subject, color, signature }) {
  const org = String(orgName || "Support").slice(0, 120);
  const agent = String(agentName || org).slice(0, 120);
  const sign = String(signature || "").trim();
  const text = [
    String(body || "").trim(),
    "",
    "--",
    agent,
    ...(sign ? [sign] : [org]),
    "",
    `Ticket ${ticketToken(ticketId)} ${subject || ""}`.trim(),
    "Reply to this email to add to the ticket.",
  ].join("\n");
  const accent = safeColor(color);
  const paragraphs = String(body || "").trim().split(/\n{2,}/)
    .map((part) => `<p style="margin:0 0 12px">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f5f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2937">
<div style="max-width:640px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:10px;border-top:4px solid ${accent};padding:24px">
<div style="font-size:13px;color:#6b7280;margin-bottom:16px">${escapeHtml(org)} &middot; Ticket ${escapeHtml(ticketToken(ticketId))}</div>
${paragraphs}
<p style="margin:20px 0 0;color:#374151">${escapeHtml(agent)}<br><span style="color:#6b7280">${escapeHtml(sign || org).replace(/\n/g, "<br>")}</span></p>
</div>
<p style="font-size:12px;color:#9ca3af;margin:12px 4px">${escapeHtml(subject || "")} &middot; Reply to this email to add to the ticket.</p>
</div></body></html>`;
  return { text, html };
}

const RATING_BUTTONS = [["good", "Good", "#16a34a"], ["ok", "OK", "#d97706"], ["bad", "Bad", "#dc2626"]];

// links: { good, ok, bad } rating URLs, or null when the tenant does not ask for ratings.
export function resolvedNotice({ orgName, ticketId, subject, color, signature, links }) {
  const org = String(orgName || "Support").slice(0, 120);
  const body = `Your ticket ${ticketToken(ticketId)} "${subject || ""}" has been resolved.\n\nIf anything is still not right, reply to this email and the ticket will be reopened.`;
  const base = brandedReply({ orgName: org, agentName: org, body, ticketId, subject, color, signature });
  if (!links) return base;
  const text = `${base.text}\n\nHow did we do?\n${RATING_BUTTONS.map(([key, label]) => `${label}: ${links[key]}`).join("\n")}\n`;
  const buttons = RATING_BUTTONS.map(([key, label, tone]) =>
    `<a href="${escapeHtml(links[key])}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:8px;background:${tone};color:#fff;text-decoration:none;font-weight:600">${label}</a>`).join("");
  const rating = `<div style="margin:20px 0 0;padding-top:16px;border-top:1px solid #e5e7eb"><p style="margin:0 0 10px;font-weight:600">How did we do?</p>${buttons}</div>`;
  return { text, html: base.html.replace("</div>\n<p style=\"font-size:12px", `${rating}</div>\n<p style="font-size:12px`) };
}

export function acknowledgement({ orgName, ticketId, subject, color }) {
  const org = String(orgName || "Support").slice(0, 120);
  return brandedReply({
    orgName: org,
    agentName: org,
    body: `Thanks, we have received your request and logged it as ticket ${ticketToken(ticketId)}.\n\nWe will be in touch soon. Reply to this email if you have anything to add.`,
    ticketId,
    subject,
    color,
  });
}
