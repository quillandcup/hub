/**
 * Uploads a file to a Supabase signed upload URL with XMLHttpRequest, because the storage client's
 * `uploadToSignedUrl` (fetch) reports no progress. Browser only.
 */

export type UploadResult = { ok: true } | { ok: false; reason: "http" | "network" | "aborted"; status?: number };

/** The URL `uploadToSignedUrl` would PUT to: `<storage base>/object/upload/sign/<bucket>/<path>?token=`. */
export function signedUploadUrl(supabaseUrl: string, bucket: string, path: string, token: string): string {
  const cleanPath = path.split("/").filter(Boolean).join("/");
  const url = new URL(`${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/upload/sign/${bucket}/${cleanPath}`);
  url.searchParams.set("token", token);
  return url.toString();
}

export function uploadWithProgress({
  url,
  file,
  contentType,
  apiKey,
  onProgress,
  signal,
}: {
  url: string;
  file: Blob;
  contentType: string;
  /** Sent as `apikey`, which the API gateway wants even though the token authorizes the upload. */
  apiKey?: string;
  /** Bytes of this file sent so far (never above file.size). */
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ ok: false, reason: "aborted" });
    const xhr = new XMLHttpRequest();
    const onAbort = () => xhr.abort();
    const finish = (result: UploadResult) => {
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", contentType);
    xhr.setRequestHeader("cache-control", "max-age=3600");
    xhr.setRequestHeader("x-upsert", "false");
    if (apiKey) xhr.setRequestHeader("apikey", apiKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(e.loaded, file.size));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file.size);
        finish({ ok: true });
      } else {
        finish({ ok: false, reason: "http", status: xhr.status });
      }
    };
    xhr.onerror = () => finish({ ok: false, reason: "network" });
    xhr.ontimeout = () => finish({ ok: false, reason: "network" });
    xhr.onabort = () => finish({ ok: false, reason: "aborted" });
    signal?.addEventListener("abort", onAbort, { once: true });
    xhr.send(file);
  });
}
