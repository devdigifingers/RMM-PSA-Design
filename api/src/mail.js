import { randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const SMTP_TIMEOUT_MS = 15000;
const SMTP_DEADLINE_MS = 45000;
const MAX_RECIPIENTS = 20;

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      const lines = data.split(/\r?\n/).filter(Boolean);
      const last = lines.at(-1) || "";
      if (!/^\d{3} /.test(last)) return;
      socket.off("data", onData);
      resolve({ code: Number(last.slice(0, 3)) });
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("smtp closed")));
  });
}

function command(socket, line) {
  socket.write(`${line}\r\n`);
  return readResponse(socket).then((response) => {
    if (response.code >= 400) {
      throw new Error(`smtp ${response.code}`);
    }
    return response;
  });
}

function headerSafe(value) {
  return String(value || "").replace(/[\r\n"\\]/g, " ").slice(0, 200);
}

export function addressSafe(value) {
  const text = String(value || "").trim();
  return /^[^\s<>()",;:\\[\]@]+@[^\s<>()",;:\\[\]@]+\.[^\s<>()",;:\\[\]@]+$/.test(text) && text.length <= 254 ? text : "";
}

function messageIdSafe(value) {
  const text = String(value || "").trim();
  return /^<[^\s<>]{3,250}>$/.test(text) ? text : "";
}

function textPart(text) {
  return ["Content-Type: text/plain; charset=utf-8", "", String(text || "").replace(/\r?\n/g, "\r\n")];
}

function htmlPart(html) {
  return [
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    ...(Buffer.from(String(html), "utf8").toString("base64").match(/.{1,76}/g) || []),
  ];
}

function alternative(text, html) {
  if (!html) return textPart(text);
  const boundary = `df-alt-${randomBytes(12).toString("hex")}`;
  return [
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...textPart(text),
    `--${boundary}`,
    ...htmlPart(html),
    `--${boundary}--`,
  ];
}

// attachments: [{ filename, contentType, content: Buffer }]
export function mailBody({ text, html, attachments = [] }) {
  if (!attachments.length) return alternative(text, html);
  const boundary = `df-${randomBytes(12).toString("hex")}`;
  const parts = [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    ...alternative(text, html),
  ];
  for (const file of attachments) {
    const name = headerSafe(file.filename) || "attachment";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${headerSafe(file.contentType) || "application/octet-stream"}; name="${name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${name}"`,
      "",
      ...(Buffer.from(file.content).toString("base64").match(/.{1,76}/g) || []),
    );
  }
  parts.push(`--${boundary}--`);
  return parts;
}

export function newMessageId(domain = "rmm.digitalfingers.co.za") {
  return `<${randomBytes(16).toString("hex")}@${domain}>`;
}

export function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

export async function sendMail({
  to,
  cc = [],
  subject,
  text,
  html,
  attachments = [],
  fromName = "Digital Fingers",
  replyTo,
  messageId,
  inReplyTo,
  references = [],
  headers = {},
  automatic = true,
}) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !password || !from || !to) return false;
  if (/[\r\n<>]/.test(from)) return false;
  const primary = addressSafe(to);
  if (!primary) return false;
  const copies = [...new Set((Array.isArray(cc) ? cc : []).map(addressSafe).filter((item) => item && item !== primary))]
    .slice(0, MAX_RECIPIENTS - 1);
  const reply = addressSafe(replyTo);

  const plain = net.connect({ host, port });
  plain.setTimeout(SMTP_TIMEOUT_MS, () => plain.destroy(new Error("smtp timeout")));
  const deadline = setTimeout(() => plain.destroy(new Error("smtp timeout")), SMTP_DEADLINE_MS);
  try {
    await new Promise((resolve, reject) => {
      plain.once("connect", resolve);
      plain.once("error", reject);
    });
    await readResponse(plain);
    await command(plain, "EHLO rmm.digitalfingers.co.za");
    await command(plain, "STARTTLS");
    const secure = tls.connect({ socket: plain, servername: host });
    secure.setTimeout(SMTP_TIMEOUT_MS, () => secure.destroy(new Error("smtp timeout")));
    await new Promise((resolve, reject) => {
      secure.once("secureConnect", resolve);
      secure.once("error", reject);
    });
    await command(secure, "EHLO rmm.digitalfingers.co.za");
    const token = Buffer.from(`\0${user}\0${password}`).toString("base64");
    await command(secure, `AUTH PLAIN ${token}`);
    await command(secure, `MAIL FROM:<${from}>`);
    for (const address of [primary, ...copies]) await command(secure, `RCPT TO:<${address}>`);
    await command(secure, "DATA");
    const safeSubject = String(subject || "New ticket").replace(/[\r\n]/g, " ").slice(0, 200);
    const threadRefs = (Array.isArray(references) ? references : []).map(messageIdSafe).filter(Boolean).slice(-10);
    const extra = Object.entries(headers)
      .filter(([name]) => /^X-[A-Za-z0-9-]{1,40}$/.test(name))
      .map(([name, value]) => `${name}: ${headerSafe(value)}`);
    const payload = [
      `From: ${headerSafe(fromName) || "Digital Fingers"} <${from}>`,
      `To: ${primary}`,
      ...(copies.length ? [`Cc: ${copies.join(", ")}`] : []),
      ...(reply ? [`Reply-To: ${reply}`] : []),
      `Subject: ${safeSubject}`,
      `Date: ${new Date().toUTCString()}`,
      ...(messageIdSafe(messageId) ? [`Message-ID: ${messageId}`] : []),
      ...(messageIdSafe(inReplyTo) ? [`In-Reply-To: ${inReplyTo}`] : []),
      ...(threadRefs.length ? [`References: ${threadRefs.join(" ")}`] : []),
      ...(automatic ? ["Auto-Submitted: auto-generated"] : []),
      ...extra,
      "MIME-Version: 1.0",
      ...mailBody({ text, html, attachments }),
    ].join("\r\n").replace(/^\./gm, "..") + "\r\n.";
    await command(secure, payload);
    await command(secure, "QUIT");
    secure.end();
    return true;
  } finally {
    clearTimeout(deadline);
    plain.destroy();
  }
}
