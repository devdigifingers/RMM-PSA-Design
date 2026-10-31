import Link from "next/link";
import { forbidden } from "next/navigation";
import { archiveScript, duplicateScript, saveScript } from "../../../../actions";
import { ConsoleBar } from "../../../../bar";
import { SettingsCrumb } from "../../../../settings-home";
import { RiskChip, SAVED, scriptsData } from "../scripts-data";

const BLANK = { name: "", description: "", shell: "powershell", risk: "safe", body: "", fixes: [], parameters: [] };

const SHELL_HELP = {
  powershell: "Runs as SYSTEM on Windows (agent 1.6.1 or newer) for up to 5 minutes. Parameters become variables, for example $ServiceName.",
  cmd: "One command line for cmd.exe on Windows, up to 20 seconds. Join steps with &&. Put parameters in the line as {{Name}}; their values may only hold letters, digits, spaces and . _ - : \\ /",
  bash: "Runs with bash on Linux as the agent's limited user, up to 20 seconds. Parameters become shell variables, for example \"$Path\".",
};

function ScriptForm({ script, data }) {
  const rows = [0, 1, 2, 3, 4].map((i) => script.parameters[i] || { name: "", label: "", default: "", required: false });
  return (
    <form className="stack script-form" action={saveScript}>
      {script.ref ? <input type="hidden" name="ref" value={script.ref} /> : null}
      <label>
        Name
        <input name="name" defaultValue={script.name} maxLength={80} required placeholder="Clear Outlook cache" />
      </label>
      <label>
        Description
        <textarea name="description" defaultValue={script.description} maxLength={500} rows={2} placeholder="What it does and when to use it." />
      </label>
      <div className="script-row">
        <label>
          Shell
          <select name="shell" defaultValue={script.shell}>
            {Object.entries(data.shells).map(([key, shell]) => (
              <option key={key} value={key}>{shell.label} ({shell.os === "windows" ? "Windows" : "Linux"})</option>
            ))}
          </select>
        </label>
        <label>
          Risk
          <select name="risk" defaultValue={script.risk}>
            {Object.entries(data.risks).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
      </div>
      <ul className="script-help">
        {Object.entries(SHELL_HELP).map(([key, text]) => <li key={key}><strong>{data.shells[key].label}:</strong> {text}</li>)}
      </ul>
      <label>
        Script
        <textarea name="body" className="script-body" defaultValue={script.body} rows={14} required spellCheck={false} />
      </label>
      <fieldset className="script-params">
        <legend>Parameters (optional)</legend>
        <div className="script-param-head" aria-hidden="true"><span>Name</span><span>Label</span><span>Default</span><span>Required</span></div>
        {rows.map((param, i) => (
          <div key={i} className="script-param">
            <input name={`param${i}_name`} defaultValue={param.name} maxLength={32} aria-label={`Parameter ${i + 1} name`} placeholder={i === 0 ? "ServiceName" : ""} />
            <input name={`param${i}_label`} defaultValue={param.label} maxLength={60} aria-label={`Parameter ${i + 1} label`} placeholder={i === 0 ? "Service name" : ""} />
            <input name={`param${i}_default`} defaultValue={param.default} maxLength={200} aria-label={`Parameter ${i + 1} default`} />
            <input type="checkbox" name={`param${i}_required`} defaultChecked={param.required} aria-label={`Parameter ${i + 1} required`} />
          </div>
        ))}
      </fieldset>
      <fieldset className="script-fixes">
        <legend>Suggest on tickets from these alerts</legend>
        {Object.entries(data.fixTypes).map(([key, label]) => (
          <label key={key} className="check">
            <input type="checkbox" name="fixes" value={key} defaultChecked={script.fixes.includes(key)} /> {label}
          </label>
        ))}
      </fieldset>
      <button type="submit">{script.ref ? "Save Script" : "Add Script"}</button>
    </form>
  );
}

function ScriptDetails({ script, data }) {
  return (
    <>
      <dl className="script-facts">
        <dt>Shell</dt><dd>{data.shells[script.shell]?.label} ({script.os === "windows" ? "Windows" : "Linux"})</dd>
        <dt>Risk</dt><dd><RiskChip risk={script.risk} risks={data.risks} /></dd>
        <dt>Suggested for</dt><dd>{script.fixes.map((fix) => data.fixTypes[fix]).join(", ") || "—"}</dd>
        {script.parameters.length ? (
          <>
            <dt>Parameters</dt>
            <dd>{script.parameters.map((param) => `${param.label} (${param.name}${param.required ? ", required" : ""}${param.default ? `, default ${param.default}` : ""})`).join("; ")}</dd>
          </>
        ) : null}
      </dl>
      <pre className="script-body">{script.body}</pre>
    </>
  );
}

export default async function ScriptPage({ params, searchParams }) {
  const { ref } = await params;
  const query = await searchParams;
  const isNew = ref === "new";
  const { flags, data } = await scriptsData(isNew ? "/v1/scripts" : `/v1/scripts/${encodeURIComponent(ref)}`);
  if (isNew && !data.canManage) forbidden();
  const script = isNew ? BLANK : data.script;
  const editable = data.canManage && !script.builtin;

  return (
    <div className="console">
      <ConsoleBar {...flags} />
      <main className="main settings-page">
        <SettingsCrumb href="/remote/settings/scripts" />
        <p className="script-back"><Link href="/remote/settings/scripts">← Script library</Link></p>
        <h1>{isNew ? "New script" : script.name}</h1>
        {script.builtin ? <p className="org-name">Built-in script. {data.canManage ? "Duplicate it to make a version you can change." : null}</p> : null}
        {!isNew && script.description ? <p className="org-name">{script.description}</p> : null}
        {query?.error ? <p className="error" role="alert">{String(query.error)}</p> : null}
        {SAVED[query?.saved] ? <p className="saved" role="status">{SAVED[query.saved]}</p> : null}

        <section className="mfa-card">
          {editable || isNew ? <ScriptForm script={script} data={data} /> : <ScriptDetails script={script} data={data} />}
        </section>

        {!isNew && data.canManage ? (
          <div className="script-actions">
            <form action={duplicateScript}>
              <input type="hidden" name="ref" value={script.ref} />
              <button type="submit" className="link-button">Duplicate</button>
            </form>
            {editable ? (
              <form action={archiveScript}>
                <input type="hidden" name="ref" value={script.ref} />
                <button type="submit" className="danger-link">Remove from library</button>
              </form>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
