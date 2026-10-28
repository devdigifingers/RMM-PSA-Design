import { SessionLaunch } from "./launch";

export const metadata = { title: "Starting Support Session" };

export default async function SessionPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  return (
    <SessionLaunch
      deviceId={id}
      host={typeof query.host === "string" ? query.host : ""}
      label={typeof query.label === "string" ? query.label : ""}
      user={typeof query.user === "string" ? query.user : ""}
      ticketId={typeof query.ticket === "string" && /^\d+$/.test(query.ticket) ? query.ticket : ""}
    />
  );
}
