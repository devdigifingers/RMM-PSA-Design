import { requireEntitlement } from "../entitlement-guard";

export default async function TicketsLayout({ children }) {
  await requireEntitlement({ app: "servicedesk" });
  return children;
}
