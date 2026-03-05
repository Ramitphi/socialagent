import { NextRequest, NextResponse } from "next/server";
import { buildMentionGraph } from "@/lib/mentionGraph";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const apiKey = String(body.apiKey || process.env.NEYNAR_API_KEY || "").trim();
    const seed = String(body.seed || body.source || "").trim();
    const target = String(body.target || "").trim();

    const depth = Number(body.depth ?? 2);
    const castsPerUser = Number(body.castsPerUser ?? 50);
    const pageSize = Number(body.pageSize ?? 100);
    const maxExpandedUsers = Number(body.maxExpandedUsers ?? 500);

    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing API key. Set NEYNAR_API_KEY or send apiKey in request." },
        { status: 400 }
      );
    }

    if (!seed) {
      return NextResponse.json({ error: "Missing seed/source user." }, { status: 400 });
    }

    if (!Number.isInteger(depth) || depth < 0 || depth > 6) {
      return NextResponse.json({ error: "depth must be an integer between 0 and 6." }, { status: 400 });
    }

    if (!Number.isInteger(castsPerUser) || castsPerUser < 1 || castsPerUser > 200) {
      return NextResponse.json(
        { error: "castsPerUser must be an integer between 1 and 200." },
        { status: 400 }
      );
    }

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "pageSize must be an integer between 1 and 100." }, { status: 400 });
    }

    if (!Number.isInteger(maxExpandedUsers) || maxExpandedUsers < 1 || maxExpandedUsers > 3000) {
      return NextResponse.json(
        { error: "maxExpandedUsers must be an integer between 1 and 3000." },
        { status: 400 }
      );
    }

    const data = await buildMentionGraph({
      apiKey,
      seed,
      target: target || undefined,
      depth,
      castsPerUser,
      pageSize,
      maxExpandedUsers,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
