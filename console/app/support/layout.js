import { requireEntitlement } from "../entitlement-guard";

export default async function SupportLayout({ children }) {
  await requireEntitlement({ feature: "remote_support" });
  return children;
}
