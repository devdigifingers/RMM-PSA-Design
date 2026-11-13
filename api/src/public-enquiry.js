import { addressSafe } from "./mail.js";

// Custom software quote requests and Contact messages from the public website (digitalfingers.co.za). They never create
// a tenant or a login. The form posts here cross-origin: as JSON from the page script, or as a plain HTML form, which
// gets a 303 back to the website.

export const ENQUIRY_KINDS = ["quote", "contact"];
export const CONTACT_TOPICS = { sales: "Sales", support: "Support", custom: "Custom software", other: "Other" };
// Until self-serve sign-up exists, the website's sign-up page sends a request for us to set the account up by hand.
export const SIGNUP_PACKAGES = { invoicing: "Invoicing", "remote-support": "Remote Support", suite: "Full Suite" };
const BODY_LIMIT = 16 * 1024;
const MIN_FILL_MS = 3000;
const IP_LIMIT = { max: 5, seconds: 3600 };
const EMAIL_LIMIT = { max: 5, seconds: 86400 };

export function websiteOrigins() {
  return String(process.env.WEBSITE_ORIGINS || "https://digitalfingers.co.za")
    .split(",").map((item) => item.trim().replace(/\/+$/, "")).filter(Boolean);
}

function text(value, max) {
  return typeof value === "string" ? value.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}

function line(value, max) {
  return text(value, max).replace(/\s+/g, " ");
}

// Only a path on the website, so a crafted form cannot send the visitor anywhere else.
export function returnPath(value) {
  const path = typeof value === "string" ? value.trim() : "";
  return /^\/[A-Za-z0-9/_-]{0,80}$/.test(path) && !path.startsWith("//") ? path : "/contact/";
}

export function parseEnquiry(input, now = Date.now()) {
  const kind = ENQUIRY_KINDS.includes(input.kind) ? input.kind : "contact";
  const value = {
    kind,
    topic: kind === "quote" ? "custom" : (Object.hasOwn(CONTACT_TOPICS, input.topic) ? input.topic : "other"),
    name: line(input.name, 120),
    email: addressSafe(line(input.email, 254)).toLowerCase(),
    phone: line(input.phone, 40),
    business: line(input.business, 160),
    message: text(input.message, 4000),
    source: returnPath(input.return),
  };
  const signup = kind === "contact" && Object.hasOwn(SIGNUP_PACKAGES, input.package) ? SIGNUP_PACKAGES[input.package] : "";
  if (signup) {
    value.topic = "sales";
    value.message = `Sign-up request: ${signup} package.${value.message ? `\n\n${value.message}` : ""}`;
  }
  const started = Number(input.started);
  const bot = line(input.website, 200) !== ""
    || (Number.isFinite(started) && started > 0 && now - started < MIN_FILL_MS);
  if (bot) return { bot: true, value };
  if (!value.name) return { error: "Enter your name.", field: "name" };
  if (!value.email) return { error: "Enter a valid email address.", field: "email" };
  if (value.phone && !/^[+0-9 ()-]{6,40}$/.test(value.phone)) return { error: "Enter a valid phone number, or leave it empty.", field: "phone" };
  if (value.message.length < 10) {
    return { error: kind === "quote" ? "Tell us a little about what you need built." : "Enter a message of at least 10 characters.", field: "message" };
  }
  return { value };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw Object.assign(new Error("The message is too long."), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const type = String(req.headers["content-type"] || "").toLowerCase();
  if (type.startsWith("application/json")) {
    try {
      const parsed = JSON.parse(raw || "{}");
      return { form: false, input: parsed && typeof parsed === "object" ? parsed : {} };
    } catch {
      throw Object.assign(new Error("Request body must be JSON."), { status: 400 });
    }
  }
  return { form: true, input: Object.fromEntries(new URLSearchParams(raw)) };
}

function notifyText(row, id) {
  const label = row.kind === "quote" ? "Custom software quote request" : `Contact message (${CONTACT_TOPICS[row.topic]})`;
  return [
    `${label} #${id} from the website.`,
    "",
    `Name: ${row.name}`,
    `Email: ${row.email}`,
    `Phone: ${row.phone || "-"}`,
    `Business: ${row.business || "-"}`,
    `Page: ${row.source}`,
    "",
    row.message,
    "",
    "Reply to this email to answer them directly.",
  ].join("\n");
}

function confirmText(row) {
  const what = row.kind === "quote" ? "your custom software enquiry" : "your message";
  return [
    `Hi ${row.name},`,
    "",
    `Thank you for ${what}. We have received it and will reply to this address.`,
    row.kind === "quote" ? "Custom software is quoted per project, so we may ask a few questions first." : "",
    "",
    "What you sent:",
    row.message,
    "",
    "Digital Fingers",
    "https://digitalfingers.co.za",
  ].filter((item, index, all) => item !== "" || all[index - 1] !== "").join("\n");
}

// Returns true when the request was handled.
export async function handlePublicEnquiry(req, res, url, h) {
  if (url.pathname !== "/v1/public/enquiry") return false;
  const origin = String(req.headers.origin || "").replace(/\/+$/, "");
  const allowed = websiteOrigins();
  const cors = allowed.includes(origin)
    ? { "access-control-allow-origin": origin, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "600", vary: "Origin" }
    : { vary: "Origin" };
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors });
    res.end(JSON.stringify(body));
    return true;
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return true;
  }
  if (req.method !== "POST") return json(405, { error: "Use POST." });
  if (!allowed.includes(origin)) return json(403, { error: "This form only works from the Digital Fingers website." });

  let body;
  try {
    body = await readBody(req);
  } catch (error) {
    return json(error.status || 400, { error: error.message });
  }
  const back = returnPath(body.input.return);
  const reply = (status, payload) => {
    if (!body.form) return json(status, payload);
    const query = payload.ok ? "sent=1" : `error=${encodeURIComponent(payload.error)}`;
    res.writeHead(303, { location: `${origin}${back}?${query}#enquiry`, "cache-control": "no-store" });
    res.end();
    return true;
  };

  const parsed = parseEnquiry(body.input);
  if (parsed.bot) return reply(200, { ok: true });
  if (parsed.error) return reply(400, { error: parsed.error, field: parsed.field });
  const row = parsed.value;

  const address = h.clientAddress(req);
  const ipKey = `enquiry:ip:${address}`;
  const emailKey = `enquiry:email:${row.email}`;
  const [ipCount, emailCount] = await Promise.all([h.redis.incr(ipKey), h.redis.incr(emailKey)]);
  if (ipCount === 1) await h.redis.expire(ipKey, IP_LIMIT.seconds);
  if (emailCount === 1) await h.redis.expire(emailKey, EMAIL_LIMIT.seconds);
  if (ipCount > IP_LIMIT.max || emailCount > EMAIL_LIMIT.max) {
    return reply(429, { error: "Too many messages from you today. Email us instead, or try again later." });
  }

  const saved = await h.pool.query(
    `INSERT INTO public_enquiries (kind, topic, name, email, phone, business, message, source, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [row.kind, row.topic, row.name, row.email, row.phone, row.business, row.message, row.source, address,
      line(req.headers["user-agent"], 300)],
  );
  const id = Number(saved.rows[0].id);
  const inbox = String(process.env.SALES_TO || process.env.MAIL_TO || "").split(",").map((item) => item.trim()).filter(Boolean)[0];
  const sent = { notified: false, confirmed: false };
  try {
    if (inbox) {
      sent.notified = await h.sendMail({
        to: inbox,
        replyTo: row.email,
        subject: `${row.kind === "quote" ? "Quote request" : "Website message"}: ${row.business || row.name}`,
        text: notifyText(row, id),
        headers: { "X-DF-Enquiry": String(id) },
      });
    }
    sent.confirmed = await h.sendMail({
      to: row.email,
      subject: row.kind === "quote" ? "We received your custom software enquiry" : "We received your message",
      text: confirmText(row),
    });
  } catch (error) {
    console.error(`enquiry ${id} mail: ${error.message}`);
  }
  await h.pool.query(
    "UPDATE public_enquiries SET notified_at = CASE WHEN $2 THEN now() END, confirmed_at = CASE WHEN $3 THEN now() END WHERE id = $1",
    [id, sent.notified, sent.confirmed],
  );
  return reply(201, { ok: true });
}
