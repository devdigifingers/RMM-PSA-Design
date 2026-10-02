import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { addComment, runJob, updateTicket } from "../../actions";
import { ConsoleBar } from "../../bar";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

export default async function TicketPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/tickets/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (!response.ok) redirect("/tickets");
  const body = await response.json();
  const ticket = body.ticket;
  const users = body.users || [];

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} showLicenses={body.canReport} />
      <main className="main">
        <h1>{ticket.subject}</h1>
        <p className="org-name">
          {ticket.customer.name} · {ticket.device.hostname}
        </p>
        {body.clock ? (
          <p className="org-name">{clockLine(body.clock)}</p>
        ) : null}
        {body.canRemote && ticket.device.hasRemote ? (
          <p><a className="remote" href={`/tickets/${ticket.id}/remote`}>Open remote</a></p>
        ) : null}
        {body.canOperate ? (
          <section className="job">
            <h2>Command</h2>
            <form action={runJob}>
              <input type="hidden" name="deviceId" value={ticket.device.id} />
              <input type="hidden" name="ticketId" value={ticket.id} />
              <label>
                Command
                <input name="command" defaultValue={defaultCommand(ticket.device.osName)} required />
              </label>
              <button type="submit">Run</button>
            </form>
            {ticket.latestJob ? (
              <pre className="output">{ticket.latestJob.status === "finished" ? ticket.latestJob.output : ticket.latestJob.status}</pre>
            ) : null}
          </section>
        ) : null}
        {query?.error === "remote" ? (
          <p className="error">Remote desktop is not available for this device.</p>
        ) : null}
        {query?.error && query.error !== "remote" ? <p className="error">That change could not be saved.</p> : null}
        <section className="job">
          <h2>Details</h2>
          <form className="stack" action={updateTicket}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <label>
              Status
              <select name="status" defaultValue={ticket.status}>
                <option value="open">Open</option>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={ticket.priority}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label>
              Assignee
              <select name="assigneeUserId" defaultValue={ticket.assignee?.id || ""}>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>{user.name}</option>
                ))}
              </select>
            </label>
            <button type="submit">Save</button>
          </form>
        </section>
        <section className="job">
          <h2>Comments</h2>
          {ticket.comments.length === 0 ? <p className="org-name">No comments yet.</p> : null}
          {ticket.comments.map((comment) => (
            <article className="output" key={comment.id}>
              {comment.authorName}: {comment.body}
            </article>
          ))}
          <form className="stack" action={addComment}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <label>
              Comment
              <textarea name="body" required />
            </label>
            <button type="submit">Add comment</button>
          </form>
        </section>
      </main>
    </div>
  );
}

function defaultCommand(osName) {
  return /windows/i.test(osName || "") ? "ver" : "uname -srm";
}

function clockLine(clock) {
  return `Response ${clock.responseElapsed} of ${clock.responseMinutes} minutes. Resolve ${clock.resolveElapsed} of ${clock.resolveMinutes} minutes.`;
}
