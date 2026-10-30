import { requireEntitlement } from "../../entitlement-guard";

export default async function RemoteSettingsLayout({ children }) {
  await requireEntitlement({ app: "remote" });
  return children;
}
