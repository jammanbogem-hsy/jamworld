import { handle } from "@/lib/server/workshop/http";
import { noStore, sessionCookie, sessionToken } from "@/lib/server/workshop/runtime";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(req, async (ws) => {
    const t = sessionToken(req);
    if (t) await ws.logout(t);
    return Response.json({ ok: true }, { headers: { ...noStore, "set-cookie": sessionCookie("", 0) } });
  });
}
