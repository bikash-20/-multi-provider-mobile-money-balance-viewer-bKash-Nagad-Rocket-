/**
 * /api/meta — exposes the demo metadata row to the UI.
 *
 * Returns 200 with the snapshot regardless of whether the meta row
 * exists (first-run case). The presence of `seed.demo=true` is what
 * lets the UI decide whether to show the demo badge.
 *
 * GET /api/meta →
 *   {
 *     isDemo: boolean,
 *     persona: "freelancer" | "small_business" | "student" | null,
 *     label: string | null,
 *     description: string | null,
 *     generatedAt: ISO string | null
 *   }
 *
 * Phase 3: pulled through `MetaRepo` port via `getRepositories(getDb())`
 * rather than the v1 `lib/metaRepo.ts` facade. Behaviour preserved.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRepositories } from "@/lib/infrastructure/repos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = await getRepositories(getDb()).meta.readSnapshot();
  return NextResponse.json(snapshot, { status: 200 });
}
