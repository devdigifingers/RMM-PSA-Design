import { sessionDevice } from "../../session-device";
import { FileTransfer, ReceivePicker } from "../../session-files";

export const metadata = { title: "Web File Transfer" };

export default async function FileTransferPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const device = await sessionDevice(id, typeof query?.user === "string" ? query.user : "");
  if (query?.view === "receive") {
    const path = typeof query.path === "string" && query.path.length <= 400 ? query.path : "";
    const to = typeof query.to === "string" && /^[0-9a-f-]{36}$/i.test(query.to) ? query.to : "";
    return <ReceivePicker device={device} startPath={path} to={to} />;
  }
  return <FileTransfer device={device} />;
}
