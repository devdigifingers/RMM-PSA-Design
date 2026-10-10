import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { accountFromSession, navFlags } from "../account-data";
import { Facts } from "../facts";
import { ChangePassword } from "./password-form";

export default async function AccountPage({ searchParams }) {
  const account = await accountFromSession();
  if (!account) redirect("/devices");
  const params = await searchParams;
  const roles = account.user.roles?.length ? account.user.roles.map(label).join(", ") : "Member";
  return (
    <div className="console">
      <ConsoleBar {...navFlags(account)} />
      <main className="main">
        <h1>My Account</h1>
        <p className="org-name">The person signed in to this console.</p>
        <Facts rows={[
          { label: "Full name", value: account.user.name },
          { label: "Email", value: account.user.email },
          { label: "User ID", value: String(account.user.accountNumber) },
          { label: "Role", value: roles },
        ]} />
        <ChangePassword notice={noticeFrom(params)} />
      </main>
    </div>
  );
}

function noticeFrom(params) {
  if (params?.saved === "1") return { kind: "saved", text: "Password changed." };
  if (params?.error === "current") return { kind: "error", text: "The current password is not correct." };
  if (params?.error === "match") return { kind: "error", text: "The new password and the confirmation do not match." };
  if (params?.error === "short") return { kind: "error", text: "Use at least 8 characters." };
  if (params?.error === "save") return { kind: "error", text: "The password was not changed." };
  return null;
}

function label(role) {
  return role.slice(0, 1).toUpperCase() + role.slice(1);
}
