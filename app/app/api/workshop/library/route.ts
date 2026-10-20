import { handle, need } from "@/lib/server/workshop/http";
import { noStore, studentFrom, teacherFrom } from "@/lib/server/workshop/runtime";
import { libraryLike } from "@/lib/server/workshop/view";
import type { LibraryManifest } from "@/lib/server/workshop/types";

export const dynamic = "force-dynamic";

const withUrls = (m: LibraryManifest) => libraryLike(m);

/** 학생: 내 에셋 + 학급 공유 / 교사: ?classId= 학급 전체 */
export async function GET(req: Request) {
  return handle(req, async (ws) => {
    const s = await studentFrom(req, ws);
    if (s) return Response.json({ assets: (await ws.library(s)).map(withUrls) }, { headers: noStore });
    const t = need(await teacherFrom(req, ws));
    const classId = new URL(req.url).searchParams.get("classId") ?? "";
    await ws.ownClass(t, classId);
    const rows = await ws.store.libraryForClass(classId);
    return Response.json({ assets: rows.map((r) => withUrls(JSON.parse(r.manifest) as LibraryManifest)) }, { headers: noStore });
  });
}
