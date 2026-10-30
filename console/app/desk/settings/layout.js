import { requireEntitlement } from "../../entitlement-guard";

export default async function DeskSettingsLayout({ children }) {
  await requireEntitlement({ app: "servicedesk" });
  return children;
}
