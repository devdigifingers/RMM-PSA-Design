import { notFound } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession } from "../account-data";

export default async function ControlLayout({ children }) {
  const account = await accountFromSession();
  if (!account?.user?.isPlatformAdmin) notFound();
  return (
    <div className="console">
      <ConsoleBar platform />
      <main className="main admin-main">{children}</main>
    </div>
  );
}
