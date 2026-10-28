import { CustomerRecord } from "../../../customers/record-view";

export default function Page({ params, searchParams }) {
  return <CustomerRecord app="remote" params={params} searchParams={searchParams} />;
}
