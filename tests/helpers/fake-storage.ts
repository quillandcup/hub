import { clock } from "@/lib/clock";

interface Stored {
  bytes: Buffer;
  type: string;
  createdAt: number;
}

/** A one-bucket stand-in for the parts of Supabase Storage the unfurl picture cache uses. Time comes from lib/clock. */
export class FakeStorage {
  objects = new Map<string, Stored>();
  uploads = 0;
  failUpload = false;

  from(_bucket: string) {
    return {
      download: async (path: string) => {
        const o = this.objects.get(path);
        if (!o) return { data: null, error: { message: "Object not found" } };
        return { data: new Blob([new Uint8Array(o.bytes)], { type: o.type }), error: null };
      },
      upload: async (path: string, body: Buffer, opts: { contentType: string }) => {
        this.uploads++;
        if (this.failUpload) return { data: null, error: { message: "boom" } };
        this.objects.set(path, { bytes: Buffer.from(body), type: opts.contentType, createdAt: clock.now() });
        return { data: { path }, error: null };
      },
      list: async (_prefix: string, opts: { limit: number; offset: number }) => {
        const all = [...this.objects.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
        const page = all.slice(opts.offset, opts.offset + opts.limit).map(([name, o]) => ({ name, id: `id-${name}`, created_at: new Date(o.createdAt).toISOString() }));
        return { data: page, error: null };
      },
      remove: async (paths: string[]) => {
        for (const p of paths) this.objects.delete(p);
        return { data: [], error: null };
      },
    };
  }
}
