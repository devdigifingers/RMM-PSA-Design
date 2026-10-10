import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";

const ITEMS = [
  ["How do I connect to a computer?", "On Devices, press Connect to open a remote session window. Open the arrow beside Connect and choose a person to start the session as that person. If nobody is logged in, Connect still opens that computer."],
  ["What do the status colours mean?", "Green means the computer checked in during the last minute. Orange means the last check-in was within five minutes, which can be a reboot. Grey means it has been quiet for longer than that."],
  ["Where do I see the company license?", "Open the account menu and choose Manage Subscription. That page shows the license type, license number, seats, and how many systems the license covers."],
];

export default async function FaqPage() {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>FAQ</h1>
        {ITEMS.map(([title, body]) => (
          <section className="job" key={title}>
            <h2>{title}</h2>
            <p className="org-name">{body}</p>
          </section>
        ))}
      </main>
    </div>
  );
}
