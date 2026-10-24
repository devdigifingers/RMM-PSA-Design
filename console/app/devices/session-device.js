import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export async function sessionDevice(id, wanted) {
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");
  const response = await fetch(`${apiUrl}/v1/devices`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/control");
  const body = await response.json();
  const device = (body.devices || []).find((item) => String(item.id) === String(id));
  if (!device) redirect("/devices");
  const users = (Array.isArray(device.users) ? device.users : [])
    .map((user) => String(user || "").trim().split("\\").pop())
    .filter(Boolean);
  const want = String(wanted || "").trim().split("\\").pop();
  const user = users.find((name) => name.toLowerCase() === want.toLowerCase()) || users[0] || "";
  return {
    id: device.id,
    name: device.displayName || device.hostname || "Device",
    osName: device.osName || "",
    linux: /linux|ubuntu|debian|centos|red hat|fedora/i.test(device.osName || ""),
    user,
  };
}
