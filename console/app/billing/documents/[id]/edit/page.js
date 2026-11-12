import { EditDocumentPage } from "../../editor-page";

export const metadata = { title: "Edit draft · Invoicing" };

export default async function EditDraftPage({ params }) {
  const { id } = await params;
  return <EditDocumentPage id={id} />;
}
