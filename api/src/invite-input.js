const ROLES = ["owner", "admin", "tech"];

export function parseInvite(body) {
  const name = typeof body?.name === "string" ? body.name.replace(/[\r\n\t]+/g, " ").trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = typeof body?.role === "string" ? body.role : "";
  if (!name || name.length > 120) return { error: "Enter the person's full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  return { value: { name, email, role } };
}
