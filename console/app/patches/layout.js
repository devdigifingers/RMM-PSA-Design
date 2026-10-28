import { requireEntitlement } from "../entitlement-guard";

export default async function PatchesLayout({ children }) {
  await requireEntitlement({ feature: "patching" });
  return children;
}
