import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";
import { Facts } from "../facts";

export default async function ContactPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>Contact Us</h1>
        <Facts rows={[
          { label: "Company", value: "Digital Fingers" },
          { label: "Email", value: "admin@digitalfingers.co.za" },
        ]} />
      </main>
    </div>
  );
}
