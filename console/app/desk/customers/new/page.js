import { NewCustomer } from "../../../customers/new-view";

export default function Page({ searchParams }) {
  return <NewCustomer app="desk" searchParams={searchParams} />;
}
