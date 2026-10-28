import { ContactList } from "../../../customers/contacts-view";

export default function Page({ searchParams }) {
  return <ContactList app="remote" searchParams={searchParams} />;
}
