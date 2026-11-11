import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/lib/admin-auth";
import { clock } from "@/lib/clock";
import { CONVERSATION_RECENT_CLOSED_DAYS, sortConversations } from "@/lib/conversations";
import { createRepos } from "@/lib/data/repos";
import { staffCan } from "@/lib/staff-access";
import { createClient } from "@/lib/supabase/server";
import { toConversationCard } from "./card";
import ConversationsBoard from "./ConversationsBoard";

export const metadata: Metadata = {
  title: "Conversations",
};

const MS_PER_DAY = 86_400_000;

export default async function ConversationsPage() {
  const staff = await requireStaffPage();
  const now = new Date(clock.now());
  const closedSince = new Date(now.getTime() - CONVERSATION_RECENT_CLOSED_DAYS * MS_PER_DAY).toISOString();
  const rows = await createRepos(await createClient()).conversations.list({ closedSince });
  const cards = sortConversations(rows, now).map((row) => toConversationCard(row, now));

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="container mx-auto px-6 py-4">
          <Link href="/admin" className="mb-2 inline-block text-plum-600 hover:underline dark:text-plum-400">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Members you are reaching out to, and where each one stands. Open conversations first, then the ones closed in the last{" "}
            {CONVERSATION_RECENT_CLOSED_DAYS} days.
          </p>
        </div>
      </header>
      <main className="container mx-auto px-6 py-8">
        <ConversationsBoard cards={cards} canWrite={staffCan(staff.role, "conversations.write")} />
      </main>
    </div>
  );
}
