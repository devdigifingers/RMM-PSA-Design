import { hostedDecision } from "../../../pay/hosted-pdf";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { token } = await params;
  return hostedDecision(request, token);
}
