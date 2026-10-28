import { requireAdmin } from "@/lib/supabase/api-auth";
import { triggerReprocessing, triggerPrickleTypeReprocessing } from "@/lib/processing/trigger";
import { NextRequest, NextResponse } from "next/server";
import { audienceChainError } from "@/lib/audience-rules";
import { normalizePrickleType } from "@/lib/prickle-types";
import { isId } from "@/lib/ids";

/**
 * Update an existing prickle type
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const parsed = await request.json().catch(() => undefined);
    if (parsed === undefined) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const body = parsed;
    const { typeId, name, description, purpose, soloTaskFriendly, listedInEvents, announcedPublicly, guestsAllowed, defaultHostId, summaryAliases, namesGuestSpeaker } = body;

    if (!typeId || !name) {
      return NextResponse.json(
        { error: "Missing required fields: typeId and name" },
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
    // Guests need public, public needs listed: judged with the flags the type will have, so an update that
    // names only one of them is judged with the others as they are now.
    {
      const { data: now } = await supabase.from("prickle_types").select("listed_in_events, announced_publicly, guests_allowed").eq("id", typeId).maybeSingle();
      const chain = audienceChainError({
        listed: listedInEvents ?? now?.listed_in_events ?? false,
        publicly: announcedPublicly ?? now?.announced_publicly ?? false,
        guests: guestsAllowed ?? now?.guests_allowed ?? false,
      });
      if (chain) return NextResponse.json({ error: chain }, { status: 400 });
    }
    if (soloTaskFriendly !== undefined && typeof soloTaskFriendly !== "boolean") {
      return NextResponse.json(
        { error: "soloTaskFriendly must be a boolean" },
        { status: 400 }
      );
    }

    if (defaultHostId !== undefined && defaultHostId !== null && !isId(defaultHostId, "mbr")) {
      return NextResponse.json({ error: "defaultHostId must be a member id or null" }, { status: 400 });
    }
    if (summaryAliases !== undefined && (!Array.isArray(summaryAliases) || summaryAliases.some((a) => typeof a !== "string"))) {
      return NextResponse.json({ error: "summaryAliases must be a list of names" }, { status: 400 });
    }
    if (namesGuestSpeaker !== undefined && typeof namesGuestSpeaker !== "boolean") {
      return NextResponse.json({ error: "namesGuestSpeaker must be a boolean" }, { status: 400 });
    }

    // Aliases are stored the way calendar titles are matched: normalized, no blanks, no repeats
    const aliases =
      summaryAliases === undefined
        ? undefined
        : [...new Set((summaryAliases as string[]).map((a) => normalizePrickleType(a)).filter(Boolean))];

    // Regenerate normalized_name from the new name
    const normalizedName = normalizePrickleType(name);

    // Check if another type already has this normalized name
    const { data: existingType } = await supabase
      .from("prickle_types")
      .select("id")
      .eq("normalized_name", normalizedName)
      .neq("id", typeId)
      .single();

    if (existingType) {
      return NextResponse.json(
        { error: "A prickle type with this name already exists" },
        { status: 409 }
      );
    }

    // Update the prickle type
    const { error: updateError } = await supabase
      .from("prickle_types")
      .update({
        name: name.trim(),
        normalized_name: normalizedName,
        description: description?.trim() || null,
        ...(purpose !== undefined ? { purpose } : {}),
        ...(soloTaskFriendly !== undefined ? { solo_task_friendly: soloTaskFriendly } : {}),
        ...(listedInEvents !== undefined ? { listed_in_events: listedInEvents } : {}),
        ...(announcedPublicly !== undefined ? { announced_publicly: announcedPublicly } : {}),
        ...(guestsAllowed !== undefined ? { guests_allowed: guestsAllowed } : {}),
        ...(defaultHostId !== undefined ? { default_host_id: defaultHostId } : {}),
        ...(aliases !== undefined ? { summary_aliases: aliases } : {}),
        ...(namesGuestSpeaker !== undefined ? { names_guest_speaker: namesGuestSpeaker } : {}),
      })
      .eq("id", typeId);

    if (updateError) {
      console.error("Error updating prickle type:", updateError);
      return NextResponse.json(
        { error: "Failed to update prickle type" },
        { status: 500 }
      );
    }

    // Auto-trigger calendar prickles reprocessing. Changing who hosts, other names or the speaker flag
    // reaches back to the type's older prickles; other edits only need the recent window.
    console.log('Triggering calendar reprocessing from prickle_types change');
    if (defaultHostId !== undefined || aliases !== undefined || namesGuestSpeaker !== undefined) {
      await triggerPrickleTypeReprocessing();
    } else {
      await triggerReprocessing('prickle_types', 'local');
    }

    return NextResponse.json({
      success: true,
      message: "Prickle type updated successfully",
    });
  } catch (error: any) {
    console.error("Error updating prickle type:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update prickle type" },
      { status: 500 }
    );
  }
}
