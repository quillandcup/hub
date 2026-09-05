import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { getUserFeaturePreviews } from "@/lib/features.server";
import EventDetailClient from "./EventDetailClient";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: slug };
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const enabledFeatures = await getUserFeaturePreviews(user.id);
  if (!enabledFeatures.includes("events")) redirect("/dashboard");

  const { data: event } = await supabase.from("events").select("*").eq("slug", slug).single();
  if (!event) notFound();

  const { data: visiblePhotos } = await supabase
    .from("event_photos")
    .select("id, width, height")
    .eq("event_id", event.id)
    .is("hidden_at", null)
    .order("taken_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  return (
    <div className="container mx-auto px-6 py-6 max-w-4xl">
      <Link href="/events" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
        ← All Events
      </Link>
      <EventDetailClient event={event} photos={visiblePhotos || []} />
    </div>
  );
}
