import type { ComponentConfig, Config } from "@puckeditor/core";
import { unregisteredTypes, type PageBlockRegistry } from "./block-registry";

/**
 * A stored block whose type no contribution registers (the module that owned it is not installed) must not break the page. Puck has no
 * fallback for an unknown type, so the config gets a stand-in for each one the page uses: nothing for a visitor, and in the editor a
 * quiet note, with the block's props left exactly as stored so saving the page loses nothing. The stand-ins are not in the palette.
 */

function Unavailable({ type }: { type: string }) {
  return (
    <div role="note" className="my-2 rounded border border-dashed border-ink-muted px-3 py-2 text-sm text-ink-muted">
      The &ldquo;{type}&rdquo; block is not available here. It is kept as it is and is not shown to visitors.
    </div>
  );
}

const standIn = (type: string, editing: boolean) =>
  ({
    label: `Unavailable: ${type}`,
    defaultProps: {},
    render: () => (editing ? <Unavailable type={type} /> : null),
  }) as unknown as ComponentConfig;

/** `config` with a stand-in for each block type `data` uses that `registry` lacks. `editing` shows the note; otherwise the stand-in draws nothing. */
export function withStandIns(config: Config, data: unknown, registry: Pick<PageBlockRegistry, "has">, editing: boolean): Config {
  const missing = unregisteredTypes(data, registry);
  if (missing.length === 0) return config;
  return { ...config, components: { ...config.components, ...Object.fromEntries(missing.map((type) => [type, standIn(type, editing)])) } };
}
