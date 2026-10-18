"use client";

import { useState } from "react";
import { removeScheduledPrickleJoin } from "./actions";

export default function RemoveScheduledButton({ id }: { id: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          const result = await removeScheduledPrickleJoin(id);
          setError("error" in result ? (result.error ?? "Couldn't remove it") : null);
        }}
        className="ml-2 text-xs text-red-600 hover:underline dark:text-red-400"
      >
        Remove
      </button>
      {error && <span className="ml-2 text-xs text-red-600 dark:text-red-400">{error}</span>}
    </>
  );
}
