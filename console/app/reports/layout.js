import { requireEntitlement } from "../entitlement-guard";

export default async function ReportsLayout({ children }) {
  await requireEntitlement({ feature: "reporting" });
  return children;
}
