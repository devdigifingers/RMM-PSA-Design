import { requireEntitlement } from "../entitlement-guard";

export default async function BillingLayout({ children }) {
  await requireEntitlement({ app: "billing", feature: "invoicing" });
  return children;
}
