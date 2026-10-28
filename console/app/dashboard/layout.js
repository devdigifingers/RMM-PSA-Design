import { requireEntitlement } from "../entitlement-guard";

export default async function DashboardLayout({ children }) {
  await requireEntitlement({ feature: "reporting" });
  return children;
}
