import { requireEntitlement } from "../entitlement-guard";

export default async function AlertsLayout({ children }) {
  await requireEntitlement({ feature: "monitoring" });
  return children;
}
