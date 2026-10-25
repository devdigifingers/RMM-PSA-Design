import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ConsoleBar } from "../bar";
import { TicketTable } from "./ticket-table";

const apiUrl = process.env.API_URL || "http://127.0.0.1:4000";

const VIEWS = [
  { id: "all", label: "All Tickets", match: () => true },
  { id: "mine", label: "My Open Tickets", match: (ticket, me) => ticket.assignee?.id === me && ticket.status !== "resolved" },
  { id: "unassigned", label: "Unassigned Open Tickets", match: (ticket) => !ticket.assignee && ticket.status !== "resolved" },
  { id: "open", label: "Open Tickets", match: (ticket) => ticket.status === "open" },
  { id: "pending", label: "Pending Tickets", match: (ticket) => ticket.status === "pending" },
  { id: "overdue", label: "Overdue Tickets", match: (ticket) => ticket.overdue },
  { id: "resolved", label: "Resolved Tickets", match: (ticket) => ticket.status === "resolved" },
];

export default async function TicketsPage({ searchParams }) {
  const params = await searchParams;
  const jar = await cookies();
  const token = jar.get("df_session")?.value;
  if (!token) redirect("/");

  const response = await fetch(`${apiUrl}/v1/tickets`, {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (response.status === 401) redirect("/");
  if (response.status === 403) redirect("/devices?error=ticket");
  const body = await response.json();
  const all = body.tickets || [];
  const me = body.me;
  const view = VIEWS.find((item) => item.id === params?.view) || VIEWS[0];
  const q = typeof params?.q === "string" ? params.q.trim().slice(0, 100) : "";
  const needle = q.toLowerCase().replace(/^#/, "");
  const tickets = all
    .filter((ticket) => view.match(ticket, me))
    .filter((ticket) => !needle || [
      String(ticket.id),
      ticket.subject,
      ticket.customer?.name,
      ticket.customer?.contactName,
      ticket.device?.hostname,
      ticket.assignee?.name,
    ].some((value) => String(value || "").toLowerCase().includes(needle)));

  return (
    <div className="console">
      <ConsoleBar showTickets showAlerts={body.canMonitor} showPatches={body.canPatch} showDashboard={body.canReport} />
      <main className="main desk">
        <aside className="desk-views" aria-label="Ticket views">
          <p className="desk-views-title">Views</p>
          <nav>
            {VIEWS.map((item) => (
              <a
                key={item.id}
                href={item.id === "all" ? "/tickets" : `/tickets?view=${item.id}`}
                className={item.id === view.id ? "is-active" : undefined}
                aria-current={item.id === view.id ? "page" : undefined}
              >
                <span>{item.label}</span>
                <span className="desk-count">{all.filter((ticket) => item.match(ticket, me)).length}</span>
              </a>
            ))}
          </nav>
          <p className="desk-views-title">Desk</p>
          <nav>
            <a href="/tickets/setup"><span>SLA, Customers &amp; Contacts</span></a>
          </nav>
        </aside>
        <section className="desk-list">
          <header className="desk-head">
            <h1>
              {view.label} <span className="desk-total">({tickets.length})</span>
            </h1>
            <form className="find desk-find" method="get">
              {view.id !== "all" ? <input type="hidden" name="view" value={view.id} /> : null}
              <label className="search">
                <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <path d="M16.2 16.2L21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input name="q" placeholder="Search tickets" defaultValue={q} aria-label="Search tickets" />
              </label>
            </form>
            <a className="desk-new" href="/tickets/new">
              <span aria-hidden="true">+</span> New Ticket
            </a>
          </header>
          {!body.sla ? (
            <p className="org-name">Due dates appear once SLA targets are set in <a href="/tickets/setup">SLA, Customers &amp; Contacts</a>.</p>
          ) : null}
          <TicketTable
            tickets={tickets}
            users={body.users || []}
            me={me}
            empty={q ? "No tickets match that search." : "No tickets in this view."}
          />
        </section>
      </main>
    </div>
  );
}
