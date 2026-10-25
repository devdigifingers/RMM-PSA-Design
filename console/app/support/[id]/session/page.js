import { SupportLaunch } from "./launch";

export const metadata = { title: "Starting Support Session" };

export default async function SupportSessionPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  return <SupportLaunch supportId={id} host={typeof query.host === "string" ? query.host : ""} />;
}
