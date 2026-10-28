import { CustomerList } from "../../customers/list-view";

export default function Page({ searchParams }) {
  return <CustomerList app="remote" searchParams={searchParams} />;
}
