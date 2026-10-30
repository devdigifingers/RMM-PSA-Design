import Link from "next/link";
import { formatDate } from "../catalog";
import { MIGRATION_STATUS, MODE_LABEL, scopeLine, statusLevel } from "../../migration-labels";

export function MigrationTable({ items, empty }) {
  return (
    <div className="usage-table admin-table">
      <table>
        <thead>
          <tr>
            <th>Request</th>
            <th>From</th>
            <th>To</th>
            <th>Mode</th>
            <th>What</th>
            <th>Requested</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td className="empty" colSpan={7}>{empty}</td></tr>
          ) : items.map((item) => (
            <tr key={item.id}>
              <td><Link href={`/control/migrations/${item.id}`}>MIG-{item.id}</Link></td>
              <td>{item.source.name}</td>
              <td>{item.target.name}</td>
              <td>{MODE_LABEL[item.mode]}</td>
              <td className="mig-scope-cell">{scopeLine(item.scope)}</td>
              <td>{formatDate(item.submittedAt)}<span className="org-name"> · {item.requestedBy.name}</span></td>
              <td><span className={`usage-state${statusLevel(item.status)}`}>{MIGRATION_STATUS[item.status] || item.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
