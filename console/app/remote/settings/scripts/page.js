import Link from "next/link";
import { ConsoleBar } from "../../../bar";
import { SettingsCrumb } from "../../../settings-home";
import { RiskChip, SAVED, scriptsData } from "./scripts-data";

export default async function ScriptLibraryPage({ searchParams }) {
  const params = await searchParams;
  const { flags, data } = await scriptsData("/v1/scripts");
  const own = data.scripts.filter((script) => !script.builtin);
  const builtin = data.scripts.filter((script) => script.builtin);

  const table = (list) => (
    <div className="tech-table">
      <table>
        <thead>
          <tr>
            <th>Script</th>
            <th>Shell</th>
            <th>Risk</th>
            <th>Suggested for</th>
          </tr>
        </thead>
        <tbody>
          {list.map((script) => (
            <tr key={script.ref}>
              <td className="tech-name">
                <Link href={`/remote/settings/scripts/${script.ref}`}>{script.name}</Link>
                {script.description ? <span className="token-by">{script.description}</span> : null}
              </td>
              <td className="tech-nowrap">{data.shells[script.shell]?.label || script.shell}</td>
              <td className="tech-nowrap"><RiskChip risk={script.risk} risks={data.risks} /></td>
              <td>{script.fixes.map((fix) => data.fixTypes[fix] || fix).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page">
        <SettingsCrumb href="/remote/settings/scripts" />
        <h1>Script library</h1>
        <p className="org-name">
          Saved PowerShell, CMD and Bash scripts your team can run on a device from a ticket. Scripts marked
          {" "}<strong>Needs approval</strong> wait for an owner or admin before they run.
          {data.canManage ? null : " Only an owner or admin can change the library."}
        </p>
        {params?.error ? <p className="error" role="alert">{String(params.error)}</p> : null}
        {SAVED[params?.saved] ? <p className="saved" role="status">{SAVED[params.saved]}</p> : null}

        <section className="mfa-card">
          <div className="script-head">
            <h2>Your scripts</h2>
            {data.canManage ? <Link className="desk-new" href="/remote/settings/scripts/new"><span aria-hidden="true">+</span> New script</Link> : null}
          </div>
          {own.length ? table(own) : <p className="org-name">No scripts of your own yet. Add one, or open a built-in script and duplicate it.</p>}
        </section>

        <section className="mfa-card">
          <h2>Built-in scripts</h2>
          <p className="org-name">Starter scripts from Digital Fingers. They cannot be changed; duplicate one to make your own version.</p>
          {table(builtin)}
        </section>
      </main>
    </div>
  );
}
