import { fromConsole, refused } from "../../request-guard";
import { linuxPackage, packageAccess } from "../package";

export async function GET(request) {
  if (!fromConsole(request, { navigation: true })) return refused();
  const access = await packageAccess(request);
  if (access.error) return access.error;
  const archive = await linuxPackage(access.update ? null : access.enrollToken);
  if (!archive) return new Response("The Linux agent is not available yet.", { status: 404 });
  const file = access.update ? "DigitalFingersAgentUpdate-linux.tar.gz" : "DigitalFingersAgent-linux.tar.gz";
  return new Response(archive, {
    headers: {
      "content-type": "application/gzip",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  });
}
