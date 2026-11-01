"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import Modal from "@/components/Modal";

/** A lesson's watch stats over the page it was opened from; closing goes back to that page. */
export default function StatsModal({ title, children }: { title: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Modal isOpen onClose={() => router.back()} title={title} maxWidth="5xl">
      {children}
    </Modal>
  );
}
