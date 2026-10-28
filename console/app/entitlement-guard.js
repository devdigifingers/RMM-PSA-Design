import { forbidden } from "next/navigation";
import { accountFromSession, hasApp, hasFeature } from "./account-data";

// Route layouts call this; the API enforces the same checks on every request.
export async function requireEntitlement({ app, feature }) {
  const account = await accountFromSession();
  if (!account || account.user?.isPlatformAdmin) return;
  if ((app && !hasApp(account, app)) || (feature && !hasFeature(account, feature))) forbidden();
}
