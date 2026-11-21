import { requireAdmin } from "@/lib/supabase/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { audienceChainError } from "@/lib/audience-rules";
import { createRepos } from "@/lib/data/repos";

/**
 * POST /api/prickle-types/create
 * Create a new prickle type
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const prickles = createRepos(auth.supabase).prickles;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const { name, description, purpose, soloTaskFriendly, listedInEvents, announcedPublicly, guestsAllowed } = parsed;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
    }

    const VALID_PURPOSES = ["writing", "work", "social", "mixed"];
    if (purpose !== undefined && !VALID_PURPOSES.includes(purpose)) {
      return NextResponse.json(
        { error: `Invalid purpose. Must be one of: ${VALID_PURPOSES.join(", ")}` },
        { status: 400 }
      );
    }
    if (listedInEvents !== undefined && typeof listedInEvents !== "boolean") {
      return NextResponse.json(
        { error: "listedInEvents must be a boolean" },
        { status: 400 }
      );
    }
    if (announcedPublicly !== undefined && typeof announcedPublicly !== "boolean") {
      return NextResponse.json(
        { error: "announcedPublicly must be a boolean" },
        { status: 400 }
      );
    }
    if (guestsAllowed !== undefined && typeof guestsAllowed !== "boolean") {
      return NextResponse.json(
        { error: "guestsAllowed must be a boolean" },
        { status: 400 }
      );
    }
    const chain = audienceChainError({ listed: listedInEvents ?? false, publicly: announcedPublicly ?? false, guests: guestsAllowed ?? false });
    if (chain) return NextResponse.json({ error: chain }, { status: 400 });
    if (soloTaskFriendly !== undefined && typeof soloTaskFriendly !== "boolean") {
      return NextResponse.json(
        { error: "soloTaskFriendly must be a boolean" },
        { status: 400 }
      );
    }

    // Generate normalized name from name
    const normalizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .trim();

    // Check if normalized name already exists
    const existing = await prickles.typeIdByNormalizedName(normalizedName);

    if (existing) {
      return NextResponse.json(
        { error: "A prickle type with this name already exists" },
        { status: 409 }
      );
    }

    // Create the prickle type
    let prickleType;
    try {
      prickleType = await prickles.createType({
        name: name.trim(),
        normalizedName,
        description: description?.trim() || null,
        purpose,
        soloTaskFriendly,
        listedInEvents,
        announcedPublicly,
        guestsAllowed,
      });
    } catch (insertError) {
      console.error("Error creating prickle type:", insertError);
      return NextResponse.json(
        { error: (insertError as Error).message },
        { status: 500 }
      );
    }

    return NextResponse.json({ prickleType }, { status: 201 });
  } catch (error: any) {
    console.error("Error in create prickle type route:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
