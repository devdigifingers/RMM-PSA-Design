import { AddContactPicker } from "../../../../customers/add-contact-view";

export default function Page({ searchParams }) {
  return <AddContactPicker app="remote" searchParams={searchParams} />;
}
