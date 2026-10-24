import { sessionDevice } from "../../session-device";
import { SessionFileManager } from "../../session-files";

export const metadata = { title: "Advanced File Manager" };

export default async function FileManagerPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const device = await sessionDevice(id, typeof query?.user === "string" ? query.user : "");
  return <SessionFileManager device={device} />;
}
