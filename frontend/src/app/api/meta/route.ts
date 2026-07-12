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
 */
import { NextResponse } from "next/server";
import { readMetaSnapshot } from "@/lib/metaRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const snapshot = readMetaSnapshot();
  return NextResponse.json(snapshot, { status: 200 });
}
