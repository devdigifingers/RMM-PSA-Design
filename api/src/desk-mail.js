import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, join } from "node:path";
import { pool } from "./db.js";
import { addressSafe, newMessageId, sendMail } from "./mail.js";
import {
  acknowledgement,
  brandedReply,
  companyDomain,
  emailDomain,
  htmlToText,
  inboundSubject,
  isAutomatic,
  messageIds,
  replySubject,
  replyText,
  resolvedNotice,
  ticketIdFromSubject,
  websiteDomain,
} from "./mail-thread.js";
import { csatLinks } from "./csat.js";
import { consoleUrl } from "./invites.js";
import { deskNotify } from "./desk-settings.js";
import { deskOptions, runAutomations } from "./desk-flow.js";
import { ATTACHMENT_LIMIT, ATTACHMENTS_PER_POST, imageType, safeFileName, storedContentType } from "./ticket-events.js";

const MESSAGES_PER_POLL = 25;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const OUTGOING_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const IMAP_TIMEOUT_MS = 60000;

const blocked = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["::ffff:0:0", 96]]) {
  blocked.addSubnet(address, prefix, "ipv6");
}

// Tenants type the IMAP host, so it must never reach our own network.
async function publicAddress(host) {
  const results = await lookup(host, { all: true });
  if (!results.length) throw new Error("The mail server name could not be found.");
  for (const item of results) {
    if (blocked.check(item.address, item.family === 6 ? "ipv6" : "ipv4")) {
      throw new Error("That mail server is on a private network. Use the provider's public IMAP host.");
    }
  }
  return results[0].address;
}

function mailboxView(row) {
  if (!row) return null;
  return {
    address: row.address,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    folder: row.folder,
    enabled: row.enabled,
    sendReplies: row.send_replies,
    acknowledge: row.acknowledge,
    defaultCustomerId: row.default_customer_id == null ? null : Number(row.default_customer_id),
    lastPolledAt: row.last_polled_at,
    lastError: row.last_error,
    messagesIn: row.messages_in,
    hasPassword: Boolean(row.password_sealed),
  };
}

function hostSafe(value) {
  const host = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host) ? host : "";
}

function parseMailbox(body, existing) {
  const address = addressSafe(String(body.address || "").toLowerCase());
  if (!address) return { error: "Enter the support email address customers write to." };
  const host = hostSafe(body.host);
  if (!host) return { error: "Enter the IMAP server name, for example outlook.office365.com." };
  const port = Number(body.port || 993);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Enter a port number." };
  const username = String(body.username || "").trim();
  if (!username || username.length > 254) return { error: "Enter the mailbox sign-in name." };
  const password = typeof body.password === "string" ? body.password : "";
  if (!password && !existing?.password_sealed) return { error: "Enter the mailbox password or app password." };
  if (password.length > 500) return { error: "That password is too long." };
  const folder = String(body.folder || "INBOX").trim();
  if (!folder || folder.length > 100 || /[\r\n]/.test(folder)) return { error: "Enter the folder to read, usually INBOX." };
  const defaultCustomerId = body.defaultCustomerId == null || body.defaultCustomerId === "" ? null : Number(body.defaultCustomerId);
  if (defaultCustomerId != null && !Number.isSafeInteger(defaultCustomerId)) return { error: "Choose a default customer." };
  const enabled = body.enabled === true;
  if (enabled && defaultCustomerId == null) {
    return { error: "Choose a default customer for mail from senders we don't recognise before switching the mailbox on." };
  }
  return {
    value: {
      address, host, port, secure: body.secure !== false, username, password, folder,
      enabled, sendReplies: body.sendReplies === true, acknowledge: body.acknowledge === true, defaultCustomerId,
    },
  };
}

async function imapClient(box, password) {
  const { ImapFlow } = await import("imapflow");
  await publicAddress(box.host);
  const client = new ImapFlow({
    host: box.host,
    port: box.port,
    secure: box.secure,
    auth: { user: box.username, pass: password },
    logger: false,
    socketTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: 20000,
    connectionTimeout: 20000,
    disableAutoIdle: true,
  });
  client.on("error", () => {});
  await client.connect();
  return client;
}

function friendlyImapError(error) {
  const text = String(error?.responseText || error?.message || "");
  if (error?.authenticationFailed || /auth/i.test(text)) return "The mail server rejected the sign-in. Check the user name and password (many providers need an app password).";
  if (/ENOTFOUND|EAI_AGAIN/.test(text) || /could not be found/.test(text)) return "The mail server name could not be found.";
  if (/ETIMEDOUT|timeout/i.test(text)) return "The mail server did not answer in time.";
  if (/ECONNREFUSED/.test(text)) return "The mail server refused the connection. Check the port and SSL setting.";
  if (/private network/.test(text)) return text;
  if (/mailbox|folder|NONEXISTENT/i.test(text)) return "That folder was not found in the mailbox.";
  return "Could not read the mailbox. Check the settings and try again.";
}

async function storeAttachment(client, orgId, ticketId, commentId, file) {
  const data = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content || "");
  if (!data.length || data.length > ATTACHMENT_LIMIT) return false;
  const image = imageType(data.subarray(0, 16));
  const storageKey = `${orgId}/${randomBytes(16).toString("hex")}`;
  const stored = join(process.env.ATTACHMENT_DIR || "/var/lib/df-api/attachments", storageKey);
  await mkdir(dirname(stored), { recursive: true, mode: 0o700 });
  await writeFile(stored, data, { mode: 0o600, flag: "wx" });
  await client.query(
    `INSERT INTO ticket_attachments (org_id, ticket_id, comment_id, file_name, content_type, is_image, size_bytes, storage_key, linked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
    [orgId, ticketId, commentId, safeFileName(file.filename), image || storedContentType(file.contentType), Boolean(image), data.length, storageKey],
  );
  return true;
}

function mailFiles(mail) {
  return (mail.attachments || [])
    .filter((file) => file.contentDisposition !== "inline" || !file.related)
    .slice(0, ATTACHMENTS_PER_POST);
}

async function threadTicket(orgId, refs, subject, sender) {
  let ticketId = null;
  if (refs.length) {
    const found = await pool.query(
      `SELECT ticket_id AS id FROM ticket_comments WHERE org_id = $1 AND email_message_id = ANY($2::text[])
       UNION ALL
       SELECT id FROM tickets WHERE org_id = $1 AND email_message_id = ANY($2::text[])
       LIMIT 1`,
      [orgId, refs],
    );
    ticketId = found.rows[0]?.id ?? null;
  }
  const token = ticketId == null ? ticketIdFromSubject(subject) : null;
  if (token != null) {
    // A subject token alone is guessable, so the sender must belong to that ticket's account.
    const found = await pool.query(
      `SELECT t.id FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       WHERE t.id = $1 AND t.org_id = $2
         AND (lower(c.email) = $3 OR lower(c.contact_email) = $3
              OR EXISTS (SELECT 1 FROM contacts ct WHERE ct.customer_id = t.customer_id AND lower(ct.email) = $3))`,
      [token, orgId, sender],
    );
    ticketId = found.rows[0]?.id ?? null;
  }
  for (let hop = 0; ticketId != null && hop < 5; hop += 1) {
    const row = await pool.query("SELECT merged_into_id FROM tickets WHERE id = $1", [ticketId]);
    if (row.rows[0]?.merged_into_id == null) break;
    ticketId = row.rows[0].merged_into_id;
  }
  if (ticketId != null) {
    const moved = await pool.query("SELECT 1 FROM tickets WHERE id = $1 AND migration_lock IS NOT NULL", [ticketId]);
    if (moved.rows.length) ticketId = null;
  }
  return ticketId == null ? null : Number(ticketId);
}

async function matchCustomer(orgId, sender, fallbackId) {
  const contact = await pool.query(
    `SELECT ct.id, ct.customer_id FROM contacts ct
     JOIN customers c ON c.id = ct.customer_id AND c.migration_lock IS NULL
     WHERE ct.org_id = $1 AND lower(ct.email) = $2
     ORDER BY ct.is_primary DESC, ct.id LIMIT 1`,
    [orgId, sender],
  );
  if (contact.rows[0]) return { customerId: Number(contact.rows[0].customer_id), contactId: Number(contact.rows[0].id) };
  const direct = await pool.query(
    "SELECT id FROM customers WHERE org_id = $1 AND migration_lock IS NULL AND (lower(email) = $2 OR lower(contact_email) = $2) ORDER BY id LIMIT 1",
    [orgId, sender],
  );
  if (direct.rows[0]) return { customerId: Number(direct.rows[0].id), contactId: null };
  const domain = companyDomain(sender);
  if (domain) {
    const rows = await pool.query(
      `SELECT c.id, c.website, c.email, c.contact_email,
              ARRAY(SELECT ct.email FROM contacts ct WHERE ct.customer_id = c.id AND ct.email IS NOT NULL) AS contact_emails
       FROM customers c WHERE c.org_id = $1 AND c.migration_lock IS NULL`,
      [orgId],
    );
    const hits = rows.rows.filter((row) =>
      websiteDomain(row.website) === domain
      || [row.email, row.contact_email, ...(row.contact_emails || [])].some((item) => emailDomain(item) === domain));
    if (hits.length === 1) return { customerId: Number(hits[0].id), contactId: null };
  }
  return fallbackId == null ? null : { customerId: Number(fallbackId), contactId: null };
}

async function addEmailReply(h, box, ticketId, mail, sender, label, body) {
  const orgId = Number(box.org_id);
  const client = await pool.connect();
  let reopened = null;
  let subject = "";
  let assignee = null;
  try {
    await client.query("BEGIN");
    const ticket = await client.query("SELECT id, subject, status, assignee_user_id FROM tickets WHERE id = $1 AND org_id = $2 FOR UPDATE", [ticketId, orgId]);
    if (!ticket.rows[0]) {
      await client.query("ROLLBACK");
      return false;
    }
    subject = ticket.rows[0].subject;
    assignee = ticket.rows[0].assignee_user_id;
    const comment = await client.query(
      `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, author_label, body, kind, email_message_id, email_from)
       VALUES ($1, $2, NULL, $3, $4, 'reply', $5, $6) RETURNING id`,
      [orgId, ticketId, label, body || "(no text)", mail.messageId || null, sender],
    );
    const commentId = Number(comment.rows[0].id);
    let stored = 0;
    for (const file of mailFiles(mail)) if (await storeAttachment(client, orgId, ticketId, commentId, file)) stored += 1;
    await h.ticketEvent(orgId, ticketId, "reply", { label, detail: { commentId, email: true }, db: client });
    if (ticket.rows[0].status !== "open") {
      reopened = ticket.rows[0].status;
      await client.query("UPDATE tickets SET status = 'open', status_id = NULL WHERE id = $1", [ticketId]);
      await h.ticketEvent(orgId, ticketId, "status", { label: "Customer email", detail: { from: reopened, to: "open" }, db: client });
    }
    await client.query("UPDATE tickets SET updated_at = now() WHERE id = $1", [ticketId]);
    await client.query("COMMIT");
    await h.writeAudit(orgId, null, "ticket.email_in", "ticket", String(ticketId), { commentId, attachments: stored, ...(reopened ? { reopened } : {}) });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await deskNotify(h, { orgId, event: "customer_reply", ticketId, subject, userIds: assignee ? [assignee] : [] });
  await runAutomations(h, orgId, ticketId, "updated");
  return true;
}

async function createEmailTicket(h, box, mail, sender, label, body) {
  const orgId = Number(box.org_id);
  const match = await matchCustomer(orgId, sender, box.default_customer_id);
  if (!match) return { skipped: `A message from ${sender} could not be matched to a customer. Choose a default customer.` };
  const subject = inboundSubject(mail.subject);
  const client = await pool.connect();
  let ticketId;
  try {
    await client.query("BEGIN");
    const ticket = await client.query(
      `INSERT INTO tickets (org_id, customer_id, contact_id, subject, status, priority, channel, email_message_id)
       VALUES ($1, $2, $3, $4, 'open', 'normal', 'email', $5) RETURNING id`,
      [orgId, match.customerId, match.contactId, subject, mail.messageId || null],
    );
    ticketId = Number(ticket.rows[0].id);
    await h.ticketEvent(orgId, ticketId, "created", { label, detail: { status: "open", priority: "normal", email: true }, db: client });
    const comment = await client.query(
      `INSERT INTO ticket_comments (org_id, ticket_id, author_user_id, author_label, body, kind, email_from)
       VALUES ($1, $2, NULL, $3, $4, 'reply', $5) RETURNING id`,
      [orgId, ticketId, label, body || "(no text)", sender],
    );
    const commentId = Number(comment.rows[0].id);
    for (const file of mailFiles(mail)) await storeAttachment(client, orgId, ticketId, commentId, file);
    await h.ticketEvent(orgId, ticketId, "reply", { label, detail: { commentId, email: true }, db: client });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await h.writeAudit(orgId, null, "ticket.create", "ticket", String(ticketId), {
    customerId: match.customerId,
    contactId: match.contactId,
    status: "open",
    priority: "normal",
    channel: "email",
  });
  await runAutomations(h, orgId, ticketId, "created");
  await h.notifyNewTicket(orgId, ticketId, subject);
  if (box.acknowledge) await sendAcknowledgement(h, box, ticketId, subject, sender, mail.messageId);
  return { ticketId };
}

async function alreadyStored(orgId, messageId) {
  if (!messageId) return false;
  const found = await pool.query(
    `SELECT 1 FROM ticket_comments WHERE org_id = $1 AND email_message_id = $2
     UNION ALL SELECT 1 FROM tickets WHERE org_id = $1 AND email_message_id = $2 LIMIT 1`,
    [orgId, messageId],
  );
  return Boolean(found.rows[0]);
}

async function ingest(h, box, mail) {
  const orgId = Number(box.org_id);
  const from = mail.from?.value?.[0];
  const sender = addressSafe(String(from?.address || "").toLowerCase());
  if (!sender) return "skipped";
  const ours = [box.address, process.env.SMTP_FROM, process.env.SMTP_USER].map((item) => String(item || "").toLowerCase());
  if (ours.includes(sender)) return "skipped";
  if (isAutomatic(mail.headers)) return "skipped";
  const messageId = messageIds(mail.messageId)[0] || null;
  mail.messageId = messageId;
  if (await alreadyStored(orgId, messageId)) return "skipped";
  const name = String(from?.name || "").replace(/[\r\n]/g, " ").trim().slice(0, 80);
  const label = name ? `${name} (${sender})` : sender;
  const body = replyText(mail.text || htmlToText(mail.html));
  const refs = messageIds(mail.inReplyTo, mail.references);
  const ticketId = await threadTicket(orgId, refs, mail.subject, sender);
  if (ticketId != null && (await addEmailReply(h, box, ticketId, mail, sender, label, body))) return "reply";
  const created = await createEmailTicket(h, box, mail, sender, label, body);
  if (created.skipped) {
    await pool.query("UPDATE desk_mailboxes SET last_error = $1 WHERE org_id = $2", [created.skipped.slice(0, 300), orgId]);
    return "skipped";
  }
  return "ticket";
}

async function pollMailbox(h, box) {
  const { simpleParser } = await import("mailparser");
  const client = await imapClient(box, h.openSecret(box.password_sealed));
  let processed = 0;
  try {
    const lock = await client.getMailboxLock(box.folder);
    try {
      const validity = String(client.mailbox.uidValidity);
      const top = Number(client.mailbox.uidNext) - 1;
      let last = box.last_uid == null || String(box.uid_validity) !== validity ? null : Number(box.last_uid);
      if (last == null) {
        // First read (or the folder was rebuilt): start from now instead of importing old mail.
        await pool.query("UPDATE desk_mailboxes SET uid_validity = $1, last_uid = $2 WHERE org_id = $3", [validity, Math.max(0, top), box.org_id]);
        return 0;
      }
      if (top <= last) return 0;
      const uids = ((await client.search({ uid: `${last + 1}:*` }, { uid: true })) || [])
        .map(Number).filter((uid) => uid > last).sort((a, b) => a - b).slice(0, MESSAGES_PER_POLL);
      for (const uid of uids) {
        const message = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
        if (message?.source && (message.size || message.source.length) <= MAX_MESSAGE_BYTES) {
          const mail = await simpleParser(message.source, { skipImageLinks: true, skipTextToHtml: true });
          const outcome = await ingest(h, box, mail);
          if (outcome !== "skipped") processed += 1;
        }
        await pool.query("UPDATE desk_mailboxes SET last_uid = $1 WHERE org_id = $2", [uid, box.org_id]);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return processed;
}

let polling = false;

// h: { writeAudit, ticketEvent, openSecret, notifyNewTicket, ticketingFor }.
export async function pollMailboxes(h) {
  if (polling) return;
  polling = true;
  try {
    const boxes = await pool.query("SELECT * FROM desk_mailboxes WHERE enabled ORDER BY last_polled_at NULLS FIRST LIMIT 50");
    for (const box of boxes.rows) {
      if (!(await h.ticketingFor(box.org_id))) continue;
      try {
        const count = await pollMailbox(h, box);
        await pool.query(
          `UPDATE desk_mailboxes SET last_polled_at = now(), messages_in = messages_in + $1,
             last_error = CASE WHEN last_error LIKE 'A message from%' THEN last_error ELSE NULL END
           WHERE org_id = $2`,
          [count, box.org_id],
        );
      } catch (error) {
        await pool.query("UPDATE desk_mailboxes SET last_polled_at = now(), last_error = $1 WHERE org_id = $2", [friendlyImapError(error), box.org_id]);
      }
    }
  } catch (error) {
    console.error("mailbox poll failed", error.message);
  } finally {
    polling = false;
  }
}

async function orgName(orgId) {
  const row = await pool.query("SELECT name FROM orgs WHERE id = $1", [orgId]);
  return row.rows[0]?.name || "Support";
}

function fromDomain() {
  return emailDomain(process.env.SMTP_FROM || process.env.SMTP_USER) || "rmm.digitalfingers.co.za";
}

async function sendAcknowledgement(h, box, ticketId, subject, sender, inboundId) {
  try {
    const [name, options] = await Promise.all([orgName(box.org_id), deskOptions(box.org_id)]);
    const content = acknowledgement({ orgName: name, ticketId, subject, color: options.brandColor });
    const sent = await sendMail({
      to: sender,
      subject: replySubject(ticketId, subject),
      ...content,
      fromName: name,
      replyTo: box.address,
      messageId: newMessageId(fromDomain()),
      inReplyTo: inboundId || undefined,
      references: inboundId ? [inboundId] : [],
      headers: { "X-DF-Ticket": String(ticketId) },
      automatic: true,
    });
    if (sent) {
      await h.ticketEvent(box.org_id, ticketId, "email", { label: "Email channel", detail: { template: "acknowledgement", subject } });
    }
  } catch {
    console.error("acknowledgement failed");
  }
}

// Agent replies (never notes) go to the ticket contact and CCs when the tenant has switched replies on.
// h: { writeAudit, ticketEvent }.
export async function emailAgentReply(h, orgId, ticketId, commentId, actor) {
  try {
    const box = (await pool.query("SELECT * FROM desk_mailboxes WHERE org_id = $1 AND send_replies", [orgId])).rows[0];
    if (!box) return false;
    const found = await pool.query(
      `SELECT t.id, t.subject, t.email_message_id, ct.email AS contact_email, c.contact_email AS customer_email,
              (SELECT array_agg(x.email) FROM ticket_cc cc JOIN contacts x ON x.id = cc.contact_id
               WHERE cc.ticket_id = t.id AND x.email IS NOT NULL) AS cc_emails,
              tc.body, tc.kind
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN contacts ct ON ct.id = t.contact_id
       JOIN ticket_comments tc ON tc.id = $3 AND tc.ticket_id = t.id
       WHERE t.id = $1 AND t.org_id = $2`,
      [ticketId, orgId, commentId],
    );
    const ticket = found.rows[0];
    if (!ticket || ticket.kind !== "reply") return false;
    const to = addressSafe(ticket.contact_email) || addressSafe(ticket.customer_email);
    if (!to) return false;
    const refs = await pool.query(
      "SELECT email_message_id FROM ticket_comments WHERE ticket_id = $1 AND email_message_id IS NOT NULL ORDER BY id",
      [ticketId],
    );
    const references = messageIds(ticket.email_message_id, refs.rows.map((row) => row.email_message_id));
    const files = await pool.query(
      "SELECT file_name, content_type, size_bytes, storage_key FROM ticket_attachments WHERE comment_id = $1 AND org_id = $2 ORDER BY id",
      [commentId, orgId],
    );
    const attachments = [];
    let total = 0;
    for (const file of files.rows) {
      total += file.size_bytes;
      if (total > OUTGOING_ATTACHMENT_BYTES) break;
      try {
        const content = await readFile(join(process.env.ATTACHMENT_DIR || "/var/lib/df-api/attachments", file.storage_key));
        attachments.push({ filename: file.file_name, contentType: file.content_type, content });
      } catch {
        // A missing file is left out of the email; the ticket still shows it as missing.
      }
    }
    const [name, options] = await Promise.all([orgName(orgId), deskOptions(orgId)]);
    const content = brandedReply({
      orgName: name,
      agentName: actor?.name || name,
      body: ticket.body,
      ticketId,
      subject: ticket.subject,
      color: options.brandColor,
      signature: options.signature,
    });
    const messageId = newMessageId(fromDomain());
    const sent = await sendMail({
      to,
      cc: (ticket.cc_emails || []).filter((item) => item && item.toLowerCase() !== to.toLowerCase()),
      subject: replySubject(ticketId, ticket.subject),
      ...content,
      attachments,
      fromName: name,
      replyTo: box.address,
      messageId,
      inReplyTo: references.at(-1),
      references,
      headers: { "X-DF-Ticket": String(ticketId) },
      automatic: false,
    });
    if (!sent) return false;
    await pool.query("UPDATE ticket_comments SET email_message_id = $1 WHERE id = $2", [messageId, commentId]);
    await h.ticketEvent(orgId, ticketId, "email", {
      actorId: actor?.id ?? null,
      detail: { template: "agent_reply", subject: replySubject(ticketId, ticket.subject) },
    });
    await h.writeAudit(orgId, actor?.id ?? null, "ticket.mail", "ticket", String(ticketId), { event: "agent_reply", commentId });
    return true;
  } catch {
    console.error("agent reply email failed");
    return false;
  }
}

// Tells the ticket contact the ticket is resolved, with rating links when CSAT is on.
// h: { writeAudit, ticketEvent, csatKey }.
export async function emailResolved(h, orgId, ticketId) {
  try {
    const box = (await pool.query("SELECT address FROM desk_mailboxes WHERE org_id = $1 AND send_replies", [orgId])).rows[0];
    if (!box) return false;
    const found = await pool.query(
      `SELECT t.subject, t.email_message_id, t.merged_into_id, ct.email AS contact_email, c.contact_email AS customer_email,
              (SELECT array_agg(email_message_id ORDER BY id) FROM ticket_comments
               WHERE ticket_id = t.id AND email_message_id IS NOT NULL) AS refs
       FROM tickets t
       JOIN customers c ON c.id = t.customer_id
       LEFT JOIN contacts ct ON ct.id = t.contact_id
       WHERE t.id = $1 AND t.org_id = $2 AND t.status = 'resolved'`,
      [ticketId, orgId],
    );
    const ticket = found.rows[0];
    if (!ticket || ticket.merged_into_id != null) return false;
    const to = addressSafe(ticket.contact_email) || addressSafe(ticket.customer_email);
    if (!to) return false;
    const [name, options] = await Promise.all([orgName(orgId), deskOptions(orgId)]);
    const links = options.csatEnabled ? csatLinks(consoleUrl(), h.csatKey(), orgId, ticketId) : null;
    const references = messageIds(ticket.email_message_id, ticket.refs || []);
    const content = resolvedNotice({
      orgName: name,
      ticketId,
      subject: ticket.subject,
      color: options.brandColor,
      signature: options.signature,
      links,
    });
    const sent = await sendMail({
      to,
      subject: replySubject(ticketId, ticket.subject),
      ...content,
      fromName: name,
      replyTo: box.address,
      messageId: newMessageId(fromDomain()),
      inReplyTo: references.at(-1),
      references,
      headers: { "X-DF-Ticket": String(ticketId) },
      automatic: true,
    });
    if (!sent) return false;
    await h.ticketEvent(orgId, ticketId, "email", {
      label: "Email channel",
      detail: { template: links ? "resolved_csat" : "resolved", subject: replySubject(ticketId, ticket.subject) },
    });
    await h.writeAudit(orgId, null, "ticket.mail", "ticket", String(ticketId), { event: "resolved", csat: Boolean(links) });
    return true;
  } catch {
    console.error("resolved email failed");
    return false;
  }
}

// h: { send, readJson, requireTicketing, canOperate, writeAudit, sealSecret, openSecret }.
export async function handleDeskMail(req, res, url, actor, h) {
  const path = url.pathname;
  if (path !== "/v1/desk/mailbox" && path !== "/v1/desk/mailbox/test") return false;
  if (req.method === "GET" && path === "/v1/desk/mailbox") {
    if (!(await h.requireTicketing(actor, res))) return true;
    const [box, customers] = await Promise.all([
      pool.query("SELECT * FROM desk_mailboxes WHERE org_id = $1", [actor.org_id]),
      pool.query("SELECT id, name FROM customers WHERE org_id = $1 ORDER BY lower(name)", [actor.org_id]),
    ]);
    h.send(res, 200, {
      mailbox: mailboxView(box.rows[0]),
      customers: customers.rows.map((row) => ({ id: Number(row.id), name: row.name })),
      canEdit: h.canOperate(actor),
    });
    return true;
  }
  if (!["POST", "PUT", "DELETE"].includes(req.method)) return false;
  if (!(await h.requireTicketing(actor, res))) return true;
  if (!h.canOperate(actor)) {
    h.send(res, 403, { error: "Only an owner or admin can change Service Desk settings." });
    return true;
  }
  const orgId = actor.org_id;
  const existing = (await pool.query("SELECT * FROM desk_mailboxes WHERE org_id = $1", [orgId])).rows[0];

  if (req.method === "DELETE" && path === "/v1/desk/mailbox") {
    await pool.query("DELETE FROM desk_mailboxes WHERE org_id = $1", [orgId]);
    await h.writeAudit(orgId, actor.id, "desk.mailbox_delete", "org", String(orgId), {});
    h.send(res, 200, { ok: true });
    return true;
  }

  if (req.method === "POST" && path === "/v1/desk/mailbox/test") {
    if (!existing) return h.send(res, 400, { error: "Save the mailbox settings first." }), true;
    let client;
    try {
      client = await imapClient(existing, h.openSecret(existing.password_sealed));
      const status = await client.status(existing.folder, { messages: true });
      await pool.query("UPDATE desk_mailboxes SET last_error = NULL WHERE org_id = $1", [orgId]);
      await h.writeAudit(orgId, actor.id, "desk.mailbox_test", "org", String(orgId), { ok: true });
      h.send(res, 200, { ok: true, messages: status.messages ?? null });
    } catch (error) {
      const message = friendlyImapError(error);
      await pool.query("UPDATE desk_mailboxes SET last_error = $1 WHERE org_id = $2", [message, orgId]);
      await h.writeAudit(orgId, actor.id, "desk.mailbox_test", "org", String(orgId), { ok: false });
      h.send(res, 400, { error: message });
    } finally {
      if (client) await client.logout().catch(() => {});
    }
    return true;
  }

  if (req.method === "PUT" && path === "/v1/desk/mailbox") {
    const parsed = parseMailbox(await h.readJson(req), existing);
    if (parsed.error) return h.send(res, 400, { error: parsed.error }), true;
    const m = parsed.value;
    if (m.defaultCustomerId != null) {
      const customer = await pool.query("SELECT id FROM customers WHERE id = $1 AND org_id = $2", [m.defaultCustomerId, orgId]);
      if (!customer.rows[0]) return h.send(res, 400, { error: "Choose a default customer." }), true;
    }
    try {
      await publicAddress(m.host);
    } catch (error) {
      return h.send(res, 400, { error: friendlyImapError(error) }), true;
    }
    const sealed = m.password ? h.sealSecret(m.password) : existing.password_sealed;
    const moved = existing && (existing.host !== m.host || existing.username !== m.username || existing.folder !== m.folder);
    await pool.query(
      `INSERT INTO desk_mailboxes (org_id, address, host, port, secure, username, password_sealed, folder, enabled,
                                   send_replies, acknowledge, default_customer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (org_id) DO UPDATE SET address = EXCLUDED.address, host = EXCLUDED.host, port = EXCLUDED.port,
         secure = EXCLUDED.secure, username = EXCLUDED.username, password_sealed = EXCLUDED.password_sealed,
         folder = EXCLUDED.folder, enabled = EXCLUDED.enabled, send_replies = EXCLUDED.send_replies,
         acknowledge = EXCLUDED.acknowledge, default_customer_id = EXCLUDED.default_customer_id,
         uid_validity = CASE WHEN $13::boolean THEN NULL ELSE desk_mailboxes.uid_validity END,
         last_uid = CASE WHEN $13::boolean THEN NULL ELSE desk_mailboxes.last_uid END,
         updated_at = now()`,
      [orgId, m.address, m.host, m.port, m.secure, m.username, sealed, m.folder, m.enabled,
        m.sendReplies, m.acknowledge, m.defaultCustomerId, Boolean(moved)],
    );
    await h.writeAudit(orgId, actor.id, existing ? "desk.mailbox_update" : "desk.mailbox_create", "org", String(orgId), {
      address: m.address,
      host: m.host,
      enabled: m.enabled,
      sendReplies: m.sendReplies,
      acknowledge: m.acknowledge,
      passwordChanged: Boolean(m.password),
    });
    h.send(res, 200, { ok: true });
    return true;
  }
  return false;
}
