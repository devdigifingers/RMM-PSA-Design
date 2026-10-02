import { logout } from "./actions";

export function ConsoleBar({ showTickets, showAlerts, showPatches, showDashboard, showLicenses }) {
  return (
    <header className="topbar">
      <div className="brand-nav">
        <img className="wordmark" src="/brand/wordmark-silver.png" alt="Digital Fingers" />
        <nav className="nav">
          <a href="/devices">Devices</a>
          {showDashboard ? <a href="/dashboard">Dashboard</a> : null}
          {showLicenses ? <a href="/licenses">Licenses</a> : null}
          {showAlerts ? <a href="/alerts">Alerts</a> : null}
          {showPatches ? <a href="/patches">Patches</a> : null}
          {showTickets ? <a href="/tickets">Tickets</a> : null}
        </nav>
      </div>
      <form action={logout}>
        <button type="submit">Sign out</button>
      </form>
    </header>
  );
}
