import { hostedPdf } from "../../hosted-pdf";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { token } = await params;
  return hostedPdf(request, "pay", token);
}
