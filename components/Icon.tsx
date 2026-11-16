/**
 * The app's one set of small line icons (20px grid, stroked with the current color). The course builder
 * defined them first; every admin list and builder uses the same icon for the same action, so add a new
 * one here rather than drawing a variant in a page: edit = pencil, preview = eye, duplicate = copy,
 * delete = trash, copy link = link.
 */
export const ICONS = {
  folder: "M2.5 6a1.5 1.5 0 0 1 1.5-1.5h3.2l1.6 1.8H16A1.5 1.5 0 0 1 17.5 7.8V14A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14z",
  video: "M3 6.5A1.5 1.5 0 0 1 4.5 5h7A1.5 1.5 0 0 1 13 6.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 13.5zM13 9l4-2v6l-4-2",
  edit: "M4 13.5V16h2.5l7-7L11 6.5zM12 5.5l2.5 2.5",
  rename: "M7 4H5v12h2M13 4h2v12h-2M10 6v8",
  copy: "M7 7h8v8H7zM5 13V5h8",
  link: "M8.5 11.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.8.8M11.5 8.5a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l.8-.8",
  comment: "M4 5h12v8H9l-3 3v-3H4z",
  eye: "M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  trash: "M5 6h10M8 6V4h4v2M6.5 6l.5 10h6l.5-10",
  plus: "M10 4v12M4 10h12",
  chevron: "m5 8 5 5 5-5",
  grip: "M4 7.5h12M4 12.5h12",
  up: "m5 12 5-5 5 5",
  down: "m5 8 5 5 5-5",
};

export type IconName = keyof typeof ICONS;

export default function Icon({ path, name, className = "h-4 w-4" }: { path?: string; name?: IconName; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={path ?? (name ? ICONS[name] : "")} />
    </svg>
  );
}
