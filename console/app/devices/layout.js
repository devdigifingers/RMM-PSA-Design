import { requireEntitlement } from "../entitlement-guard";

export default async function DevicesLayout({ children }) {
  await requireEntitlement({ app: "remote" });
  return children;
}
