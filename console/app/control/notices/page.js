import { platformGet } from "../api";
import { unpublishNotice } from "../actions";
import { formatDate } from "../catalog";
import { NoticeForm } from "./notice-form";

export const metadata = { title: "Notices · Digital Fingers RMM" };

const SAVED = { published: "Notice published.", unpublished: "Notice unpublished." };
const STATE = { live: ["Live", ""], scheduled: ["Scheduled", " is-near"], ended: ["Ended", " is-full"], unpublished: ["Unpublished", " is-full"] };

export default async function NoticesPage({ searchParams }) {
  const query = await searchParams;
  const { notices, tenants } = await platformGet("/v1/platform/notices");

  return (
    <section className="admin-page">
      <header className="admin-head">
        <div>
          <h1>Notices</h1>
          <p className="org-name">The ribbon across the top of the console. Each person can close it for themselves.</p>
        </div>
      </header>
      {SAVED[query?.saved] ? <p className="saved admin-note">{SAVED[query.saved]}</p> : null}
      {query?.error ? <p className="error admin-note">{String(query.error)}</p> : null}
      <section className="admin-card admin-wide">
        <h2>Publish a notice</h2>
        <p className="org-name">Publishing a notice that starts now replaces the live notice for the same audience.</p>
        <NoticeForm tenants={tenants} />
      </section>
      <section className="admin-card admin-wide">
        <h2>All notices</h2>
        <div className="usage-table admin-table">
          <table>
            <thead>
              <tr>
                <th>Message</th>
                <th>Audience</th>
                <th>Shows</th>
                <th>State</th>
                <th>Published</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {notices.length === 0 ? (
                <tr><td className="empty" colSpan={6}>No notices yet.</td></tr>
              ) : notices.map((notice) => {
                const [label, level] = STATE[notice.state];
                return (
                  <tr key={notice.id}>
                    <td>{notice.body}{notice.linkUrl ? <span className="org-name"> · {notice.linkLabel}: {notice.linkUrl}</span> : null}</td>
                    <td>{notice.audience}</td>
                    <td>{notice.startsAt ? formatDate(notice.startsAt, true) : "Straight away"} – {notice.endsAt ? formatDate(notice.endsAt, true) : "until removed"}</td>
                    <td><span className={`usage-state${level}`}>{label}</span></td>
                    <td>{formatDate(notice.createdAt, true)}{notice.createdBy ? <span className="org-name"> · {notice.createdBy}</span> : null}</td>
                    <td>
                      {notice.state === "live" || notice.state === "scheduled" ? (
                        <form action={unpublishNotice}>
                          <input type="hidden" name="noticeId" value={notice.id} />
                          <button type="submit" className="admin-secondary">Unpublish</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
