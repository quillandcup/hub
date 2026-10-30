"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import MediaUploadForm from "@/components/media/MediaUploadForm";
import { useMediaSearch } from "@/components/media/useMediaSearch";
import { mediaSrc } from "@/lib/media/url";
import MediaEditor from "./MediaEditor";

/** The staff library: search, add, and open an image to edit it, set its focal point, see where it's used or download it. */
export default function MediaLibraryClient() {
  const { q, setQ, assets, more, loading, error, setError, loadMore, reload } = useMediaSearch();
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  return (
    <div>
      <div className="flex gap-3 mb-4">
        <input
          type="search"
          aria-label="Search the library by title or tag"
          placeholder="Search by title or tag"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm"
        />
        <button type="button" data-track="media-library-upload" onClick={() => setUploading(true)} className="px-4 py-2 bg-plum-600 text-white rounded hover:bg-plum-700 text-sm whitespace-nowrap">
          Upload image
        </button>
      </div>

      {error && <p role="alert" className="mb-4 p-3 rounded text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">{error}</p>}

      {assets.length === 0 && !loading && !error ? (
        <p className="text-slate-600 dark:text-slate-400">{q ? "Nothing matches." : "No images yet. Upload the first one."}</p>
      ) : (
        <div className="@container">
          <ul className="grid grid-cols-2 @pair:grid-cols-3 @columns:grid-cols-5 gap-4">
            {assets.map((a) => (
              <li key={a.id}>
                <button type="button" data-track="media-library-open" onClick={() => setOpenId(a.id)} className="block w-full text-left group">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset */}
                  <img src={mediaSrc(a.id, "thumb", a.updated_at)} alt={a.alt_text ?? ""} loading="lazy" className="w-full aspect-square object-cover rounded border border-gray-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-plum-500" />
                  <span className="block mt-1 text-sm font-medium truncate">{a.title}</span>
                  <span className="block text-xs text-slate-600 dark:text-slate-400 truncate">
                    {a.is_public ? "Public" : ""}
                    {a.is_public && a.tags.length > 0 ? " · " : ""}
                    {a.tags.join(", ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {loading && <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">Loading...</p>}
      {more && !loading && (
        <button type="button" onClick={() => void loadMore()} className="mt-4 px-3 py-1.5 rounded text-sm bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600">
          Show more
        </button>
      )}

      <Modal isOpen={uploading} onClose={() => setUploading(false)} title="Upload an image" maxWidth="lg">
        <MediaUploadForm
          surface="admin_library"
          submitLabel="Upload"
          onError={setError}
          onUploaded={(id) => {
            setUploading(false);
            reload();
            setOpenId(id);
          }}
        />
      </Modal>

      {openId && (
        <MediaEditor
          key={openId}
          assetId={openId}
          onClose={() => setOpenId(null)}
          onChanged={() => reload()}
        />
      )}
    </div>
  );
}
