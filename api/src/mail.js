import net from "node:net";
import tls from "node:tls";

const SMTP_TIMEOUT_MS = 15000;
const SMTP_DEADLINE_MS = 45000;

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

export async function sendMail({ to, subject, text }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;
  const from = process.env.SMTP_FROM || user;
  if (!host || !user || !password || !from || !to) return false;
  if (/[\r\n<>]/.test(`${from}${to}`)) return false;

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
    await command(secure, `RCPT TO:<${to}>`);
    await command(secure, "DATA");
    const safeSubject = String(subject || "New ticket").replace(/[\r\n]/g, " ").slice(0, 200);
    const payload = [
      `From: Digital Fingers <${from}>`,
      `To: ${to}`,
      `Subject: ${safeSubject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      String(text || "").replace(/\r?\n/g, "\r\n").replace(/^\./gm, ".."),
      ".",
    ].join("\r\n");
    await command(secure, payload);
    await command(secure, "QUIT");
    secure.end();
    return true;
  } finally {
    clearTimeout(deadline);
    plain.destroy();
  }
}
