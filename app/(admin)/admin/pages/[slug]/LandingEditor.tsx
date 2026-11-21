"use client";

// The same stylesheet as `puck.css` without its `@import` of Inter from a third-party host (blocked by the CSP, and a
// request to a font site on every editor load). The app's own font stack applies instead.
import "@puckeditor/core/no-external.css";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Puck, createUsePuck, type Data } from "@puckeditor/core";
import { ArrowLeft, Monitor, PanelLeft, PanelRight, Redo2, Smartphone, Tablet, Undo2 } from "lucide-react";
import Modal from "@/components/Modal";
import EntitySearch from "@/components/EntitySearch";
import AppIcon from "@/components/Icon";
import LifecycleButton from "@/components/LifecycleButton";
import LifecycleStatusChip from "@/components/LifecycleStatusChip";
import MediaPicker from "@/components/media/MediaPicker";
import { editorConfigFor } from "@/components/landing/editor-config";
import type { SiteTemplate } from "@/lib/landing/site-template";
import { checkLandingPage, type A11yIssue } from "@/lib/landing/a11y";
import type { LandingData } from "@/lib/landing/data";
import { lifecycleIcon, lifecycleLabel } from "@/lib/lifecycle-actions";
import { aiPlugin } from "./AiPanel";
import { addPlugin, panelOverrides } from "./SidePanels";
import { useMirrorHostTheme } from "./useMirrorHostTheme";
import { MODEL_SIZES, MODELS_BY_CLASS, deviceClassForSize, isLandscape, modelForSize, modelSize, type DeviceClass, type DeviceModel } from "./devices";
import { FoldContext, FoldFrame } from "./FoldMarker";
import IssueList from "./IssueList";
import JsonTransfer from "./JsonTransfer";
import SaveAsTemplate, { type TemplateOption } from "./SaveAsTemplate";
import StarterReplace, { type StarterOption } from "./StarterReplace";
import { replaceLandingDraftWithTemplate } from "../template-actions";
import { VERSION_NOTE_MAX } from "@/lib/landing/version-notes";
import { isLandingPageId } from "@/lib/landing/slug";
import { importLandingDraftJson, publishLandingPage, replaceLandingDraftWithStarter, resetLandingDraftToPublished, restoreLandingPageVersion, saveLandingDraft, unpublishLandingPage, updateLandingPageDetails } from "../actions";
import Tooltip from "@/components/Tooltip";
import { useRegisterShortcuts } from "@/components/shortcuts/ShortcutsProvider";

const usePuck = createUsePuck();

export type EditorPage = {
  id: string;
  slug: string;
  title: string;
  status: string;
  seoTitle: string;
  seoDescription: string;
  socialImageAssetId: string;
  /** The published document as JSON text, to tell whether the draft has changes that aren't live yet. */
  publishedJson: string | null;
  /** Path of the public page, for the "view" link once published. A template has none: it is never public. */
  publicPath: string;
  /** A template is a page kept to start others from: never public, and its publish checks are warnings only. */
  kind?: "page" | "template";
  /** Website page (shares the site header, footer and style) or landing page (standalone). Fixed when the page is made. */
  pageType?: "website" | "landing";
};
/** One version in History: who made it (a display name, never a user id), what it is, and the note (what changed, or what replaced the draft it kept). */
export type EditorVersion = { id: string; title: string; createdAt: string; kind?: "published" | "before_import" | "before_starter"; by?: string; note?: string | null };

type SaveState = "saved" | "unsaved" | "saving" | "error";

const BUTTON = "rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const SECONDARY = `${BUTTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`;
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700`;
const ICON = "flex h-8 w-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100 disabled:opacity-40 aria-pressed:bg-plum-50 aria-pressed:text-plum-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:aria-pressed:bg-plum-800 dark:aria-pressed:text-plum-50";

type CanvasSize = { width: number; height: number | "auto" };

/** The preview buttons. Desktop is as wide as the frame with a free height; Tablet and Phone use the chosen model of their class (the first one until another is picked), portrait or on its side. */
const DEVICES: { label: string; deviceClass: DeviceClass | null; landscape: boolean; Icon: typeof Monitor; rotate: boolean }[] = [
  { label: "Desktop", deviceClass: null, landscape: false, Icon: Monitor, rotate: false },
  { label: "Tablet portrait", deviceClass: "tablet", landscape: false, Icon: Tablet, rotate: false },
  { label: "Tablet landscape", deviceClass: "tablet", landscape: true, Icon: Tablet, rotate: true },
  { label: "Phone", deviceClass: "phone", landscape: false, Icon: Smartphone, rotate: false },
];
const DESKTOP: CanvasSize = { width: 1280, height: "auto" };

/** The model a class's button uses: the chosen one if it belongs to the class, else the class's first. */
function modelOfClass(deviceClass: DeviceClass, chosen: string | null): DeviceModel {
  return MODELS_BY_CLASS[deviceClass].find((m) => m.name === chosen) ?? MODELS_BY_CLASS[deviceClass][0];
}

function buttonSize({ deviceClass, landscape }: (typeof DEVICES)[number], chosen: string | null): CanvasSize {
  return deviceClass ? modelSize(modelOfClass(deviceClass, chosen), landscape) : DESKTOP;
}

/** The model picker beside the Tablet and Phone buttons (our searchable picker); shows only while the canvas is at a tablet or phone size. The chosen model and the orientation are kept apart, so turning the device keeps the model. */
function DeviceModelSelect({ width, height, chosen, onPick }: { width: number | string; height: number | string; chosen: string | null; onPick: (model: DeviceModel, landscape: boolean) => void }) {
  const deviceClass = deviceClassForSize(width, height);
  const models = useMemo(() => (deviceClass ? MODELS_BY_CLASS[deviceClass] : []), [deviceClass]);
  const items = useMemo(() => models.map((m) => ({ id: m.name, name: m.name, detail: `${m.width}x${m.height}` })), [models]);
  if (!deviceClass) return null;
  const landscape = isLandscape(width, height);
  const sameSize = (m: DeviceModel) => modelSize(m, landscape).width === width && modelSize(m, landscape).height === height;
  const current = models.find((m) => m.name === chosen && sameSize(m))?.name ?? modelForSize(deviceClass, width, height)?.name;
  return (
    <EntitySearch
      key={deviceClass}
      items={items}
      browse
      selectedId={null}
      onSelect={(item) => {
        const model = models.find((m) => m.name === item?.id);
        if (model) onPick(model, landscape);
      }}
      placeholder={current ?? (deviceClass === "tablet" ? "Tablet model" : "Phone model")}
      ariaLabel={deviceClass === "tablet" ? "Tablet model" : "Phone model"}
      emptyText="No such model"
      className="w-44 text-xs"
    />
  );
}

const SAVE_TEXT: Record<SaveState, string> = { saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", error: "Couldn't save. Trying again…" };

const AUTOSAVE_MS = 1200;
const RETRY_MS = 5000;

/** The header Puck shows in place of its own: back, title and save state, device and history controls, preview and publish. */
function EditorHeader({
  page,
  save,
  hasUnpublished,
  resetError,
  onDetails,
  onHistory,
  onReset,
  onPublish,
  onUnpublish,
  onPreview,
  busy,
}: {
  page: EditorPage;
  save: SaveState;
  hasUnpublished: boolean;
  resetError: string | null;
  onDetails: () => void;
  onHistory: () => void;
  onReset: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onPreview: () => void;
  busy: boolean;
}) {
  const history = usePuck((s) => s.history);
  const dispatch = usePuck((s) => s.dispatch);
  const viewports = usePuck((s) => s.appState.ui.viewports);
  const current = viewports.current.width;
  const currentHeight = viewports.current.height;
  const fold = useContext(FoldContext);
  const [chosen, setChosen] = useState<string | null>(null);
  const setCanvas = (size: CanvasSize) => dispatch({ type: "setUi", ui: { viewports: { ...viewports, current: size } } });
  const leftOpen = usePuck((s) => s.appState.ui.leftSideBarVisible);
  const rightOpen = usePuck((s) => s.appState.ui.rightSideBarVisible);
  const published = page.status === "published";
  const isTemplate = page.kind === "template";
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-700 dark:bg-slate-900">
      <Link href={isTemplate ? "/admin/pages/templates" : "/admin/pages"} className={`${ICON} w-auto gap-1 px-2 text-sm`} aria-label={isTemplate ? "Back to templates" : "Back to pages"}>
        <ArrowLeft size={16} aria-hidden="true" /> {isTemplate ? "Templates" : "Pages"}
      </Link>
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {page.title}
          {isTemplate && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">Template</span>}
        </p>
        <p role="status" className={`text-xs ${save === "error" ? "text-red-700" : "text-slate-600 dark:text-slate-400"}`}>
          {SAVE_TEXT[save]}
        </p>
      </div>
      <div role="group" aria-label="Side panels" className="flex items-center gap-1">
        <Tooltip content="Show or hide the blocks panel">
          <button type="button" aria-label="Blocks panel" aria-pressed={leftOpen} onClick={() => dispatch({ type: "setUi", ui: { leftSideBarVisible: !leftOpen } })} className={ICON}>
            <PanelLeft size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content="Show or hide the settings panel">
          <button type="button" aria-label="Settings panel" aria-pressed={rightOpen} onClick={() => dispatch({ type: "setUi", ui: { rightSideBarVisible: !rightOpen } })} className={ICON}>
            <PanelRight size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
      <LifecycleStatusChip published={published} />
      {published && hasUnpublished && <span className="text-xs text-amber-800 dark:text-amber-300">Changes not published yet</span>}
      {resetError && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-400">
          {resetError}
        </span>
      )}

      <div role="group" aria-label="Preview size" className="mx-auto flex items-center gap-1">
        {DEVICES.map((device) => {
          const { label, Icon, rotate } = device;
          const size = buttonSize(device, chosen);
          return (
            <Tooltip key={label} content={`${label} preview`}>
              <button
                type="button"
                aria-label={`${label} preview`}
                aria-pressed={current === size.width && currentHeight === size.height}
                onClick={() => setCanvas(size)}
                className={ICON}
              >
                <Icon size={16} aria-hidden="true" className={rotate ? "rotate-90" : undefined} />
              </button>
            </Tooltip>
          );
        })}
        <DeviceModelSelect
          width={current}
          height={currentHeight}
          chosen={chosen}
          onPick={(model, landscape) => {
            setChosen(model.name);
            setCanvas(modelSize(model, landscape));
          }}
        />
        {typeof currentHeight === "number" && (
          <Tooltip content={`${fold.visible ? "Hide" : "Show"} the fold line (where the first screen ends)`}>
            <button type="button" aria-label="Fold line" aria-pressed={fold.visible} onClick={() => fold.setVisible(!fold.visible)} className={ICON}>
              <AppIcon name="fold" />
            </button>
          </Tooltip>
        )}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
        <Tooltip content="Undo (Ctrl/⌘ Z)">
          <button type="button" aria-label="Undo" aria-keyshortcuts="Control+Z Meta+Z" disabled={!history.hasPast} onClick={() => history.back()} className={ICON}>
            <Undo2 size={16} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content="Redo (Ctrl/⌘ Shift Z)">
          <button type="button" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y Meta+Y" disabled={!history.hasFuture} onClick={() => history.forward()} className={ICON}>
            <Redo2 size={16} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <Tooltip content="Details">
          <button type="button" onClick={onDetails} aria-label="Details" className={ICON}>
            <AppIcon name="details" />
          </button>
        </Tooltip>
        <LifecycleButton action="history" noun="page" variant="icon" onRun={onHistory} className={ICON} />
        {hasUnpublished && (
          <>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
            <LifecycleButton action="reset" noun="page" variant="icon" onRun={onReset} disabled={busy} className={ICON} />
          </>
        )}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
        <LifecycleButton action="preview" noun="page" variant="icon" onRun={onPreview} className={ICON} />
        {published && !isTemplate && (
          <Tooltip content={lifecycleLabel("viewLive")}>
            <a href={page.publicPath} target="_blank" rel="noopener noreferrer" aria-label={lifecycleLabel("viewLive")} className={ICON}>
              <AppIcon name={lifecycleIcon("viewLive")} />
            </a>
          </Tooltip>
        )}
        {published && (
          <LifecycleButton
            action="unpublish"
            noun={isTemplate ? "template" : "page"}
            variant="icon"
            detail={isTemplate ? "It is no longer offered when you start a page. Its draft and versions stay." : "It comes off the public site at once. Your draft and its versions stay."}
            onRun={onUnpublish}
            disabled={busy}
            className={ICON}
          />
        )}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-slate-300 dark:bg-slate-600" />
        <LifecycleButton
          action="publish"
          noun="page"
          label={published ? "Publish changes" : undefined}
          onRun={onPublish}
          disabled={busy}
          className={PRIMARY}
        />
      </div>
    </header>
  );
}

/** `site` is the site template draft a website page shows at the top and bottom of its canvas (edited in Design, not here); null for a landing page. */
export default function LandingEditor({ page: initial, data, versions, starters = [], templates = [], site = null }: { page: EditorPage; data: LandingData; versions: EditorVersion[]; starters?: StarterOption[]; templates?: TemplateOption[]; site?: SiteTemplate | null }) {
  const router = useRouter();
  useMirrorHostTheme();
  const [page, setPage] = useState(initial);
  // The kind of page never changes, so the config is made once: a new config object would make Puck remount the canvas.
  const config = useMemo(() => editorConfigFor({ pageType: initial.pageType === "website" ? "website" : "landing", site, editing: true }), [initial.pageType, site]);
  const [save, setSave] = useState<SaveState>("saved");
  const publishedJson = useRef(initial.publishedJson);
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [dialog, setDialog] = useState<"details" | "history" | "publish" | null>(null);
  const [issues, setIssues] = useState<A11yIssue[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [foldVisible, setFoldVisible] = useState(true);
  const foldContext = useMemo(() => ({ visible: foldVisible, setVisible: setFoldVisible }), [foldVisible]);
  const [busy, startBusy] = useTransition();

  const latest = useRef<string>(JSON.stringify(data));
  const lastSaved = useRef<string>(JSON.stringify(data));
  const timer = useRef<number | undefined>(undefined);
  const saving = useRef<Promise<boolean> | null>(null);
  const retry = useRef<() => Promise<boolean>>(async () => true);

  /** Saves the draft now if it changed; resolves true when what is stored is what is on screen. */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    if (saving.current) await saving.current;
    if (latest.current === lastSaved.current) {
      setSave("saved");
      return true;
    }
    const body = latest.current;
    setSave("saving");
    const run = (async () => {
      const result = await saveLandingDraft(page.id, JSON.parse(body));
      if (result.error) {
        setSave("error");
        timer.current = window.setTimeout(() => void retry.current(), RETRY_MS);
        return false;
      }
      lastSaved.current = body;
      setSave(latest.current === body ? "saved" : "unsaved");
      return true;
    })();
    saving.current = run;
    const ok = await run;
    saving.current = null;
    return ok && latest.current === lastSaved.current;
  }, [page.id]);
  useEffect(() => {
    retry.current = flush;
  }, [flush]);

  const onChange = useCallback(
    (next: Data) => {
      latest.current = JSON.stringify(next);
      setHasUnpublished(publishedJson.current !== null && publishedJson.current !== latest.current);
      if (latest.current === lastSaved.current) return;
      setSave("unsaved");
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  useRegisterShortcuts("landingEditor");

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (latest.current !== lastSaved.current) e.preventDefault();
    };
    const keys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", keys);
      window.clearTimeout(timer.current);
    };
  }, [flush]);

  function openPublish() {
    setMessage(null);
    setIssues(checkLandingPage(JSON.parse(latest.current)));
    setDialog("publish");
  }

  function publish() {
    startBusy(async () => {
      const result = await publishLandingPage(page.id, JSON.parse(latest.current), { note });
      if (result.error) {
        setIssues(result.issues ?? issues);
        setMessage(result.error);
        return;
      }
      lastSaved.current = latest.current;
      publishedJson.current = latest.current;
      setHasUnpublished(false);
      setNote("");
      setPage((p) => ({ ...p, status: "published" }));
      setSave("saved");
      setDialog(null);
      router.refresh();
    });
  }

  function unpublish() {
    startBusy(async () => {
      const result = await unpublishLandingPage(page.id);
      if (result.error) return setMessage(result.error);
      setPage((p) => ({ ...p, status: "draft" }));
      router.refresh();
    });
  }

  function resetToPublished() {
    setResetError(null);
    startBusy(async () => {
      // Stop autosave from writing the unpublished edits back over the reset.
      window.clearTimeout(timer.current);
      if (saving.current) await saving.current;
      const result = await resetLandingDraftToPublished(page.id);
      if (result.error) {
        setResetError(result.error);
        return;
      }
      // The editor takes its document once, so a reset reloads the page to open the published copy as the draft.
      latest.current = lastSaved.current;
      window.location.reload();
    });
  }

  async function preview() {
    await flush();
    window.open(`/admin/pages/${page.slug}/preview`, "_blank", "noopener");
  }

  const overrides = useMemo(
    () => ({
      ...panelOverrides,
      iframe: FoldFrame,
      header: () => (
        <EditorHeader
          page={page}
          save={save}
          hasUnpublished={hasUnpublished}
          resetError={resetError}
          busy={busy}
          onDetails={() => setDialog("details")}
          onHistory={() => setDialog("history")}
          onReset={resetToPublished}
          onPublish={openPublish}
          onUnpublish={unpublish}
          onPreview={() => void preview()}
        />
      ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handlers read refs and state setters only
    [page, save, hasUnpublished, resetError, busy],
  );

  // A template legitimately has placeholders and empty links, so for it every check is a warning that never blocks.
  const errors = page.kind === "template" ? [] : issues.filter((i) => i.severity === "error");

  return (
    <div className="landing-editor h-[calc(100dvh-4rem)]">
      <FoldContext.Provider value={foldContext}>
        <Puck
          config={config}
          data={data as unknown as Data}
          onChange={onChange}
          overrides={overrides}
          plugins={[addPlugin, aiPlugin]}
          viewports={[{ ...DESKTOP, label: "Desktop" }, ...MODEL_SIZES.map((s) => ({ ...s, label: `${s.width}x${s.height}` }))]}
          ui={{ plugin: { current: "outline" }, rightSideBarVisible: false, viewports: { current: { width: 1280, height: "auto" }, controlsVisible: false, options: [] } }}
        />
      </FoldContext.Provider>

      <Modal isOpen={dialog === "publish"} onClose={() => setDialog(null)} title={page.status === "published" ? "Publish changes" : page.kind === "template" ? "Publish this template" : "Publish this page"} maxWidth="lg">
        <div className="space-y-4">
          {errors.length > 0 ? (
            <p className="text-sm">These need fixing before the page can go live.</p>
          ) : page.kind === "template" ? (
            <p className="text-sm">
              Publishing makes this version of the template the one offered when you start a page, or restart one. It is never on the public site, and its pictures are not made public. Checks below are only things to know about.
            </p>
          ) : (
            <p className="text-sm">
              The page goes live at <span className="font-mono">{page.publicPath}</span> for anyone with the link. The pictures it uses become visible to visitors who aren&apos;t signed in.
            </p>
          )}
          {issues.length > 0 && <IssueList issues={issues} />}
          <label className="block text-sm font-medium">
            What changed? (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={VERSION_NOTE_MAX}
              placeholder="A few words, shown in History"
              className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-normal dark:border-slate-700 dark:bg-slate-900"
            />
          </label>
          {message && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className={SECONDARY}>
              Not yet
            </button>
            <button type="button" disabled={busy || errors.length > 0} onClick={publish} className={PRIMARY}>
              {issues.length > 0 && errors.length === 0 ? "Publish anyway" : "Publish"}
            </button>
          </div>
        </div>
      </Modal>

      <DetailsDialog
        open={dialog === "details"}
        page={page}
        onClose={() => setDialog(null)}
        onSaved={(next) => {
          setPage((p) => ({ ...p, ...next }));
          setDialog(null);
          if (next.slug !== page.slug) router.replace(`/admin/pages/${next.slug}`);
          else router.refresh();
        }}
      />

      <Modal isOpen={dialog === "history"} onClose={() => setDialog(null)} title="Version history" maxWidth="lg">
        <VersionList
          versions={versions}
          onRestore={async (id) => {
            const result = await restoreLandingPageVersion(id);
            if (result.error) return result.error;
            // The editor takes its document once, so a restore reloads the page to open the restored draft.
            window.location.reload();
            return null;
          }}
        />
        <StarterReplace
          starters={starters}
          onReplace={async (key) => {
            // Save what is typed first, so the draft kept in History is the one on screen, and autosave can't write it back over the starter.
            if (!(await flush())) return "Couldn't save your latest changes first. Try again in a moment.";
            const result = isLandingPageId(key) ? await replaceLandingDraftWithTemplate(page.id, key) : await replaceLandingDraftWithStarter(page.id, key);
            if (result.error) return result.error;
            // The editor takes its document once, so a replacement reloads the page to open the new draft.
            window.location.reload();
            return null;
          }}
        />
        {page.kind !== "template" && <SaveAsTemplate templates={templates} getDraft={() => JSON.parse(latest.current)} pageId={page.id} />}
        <JsonTransfer
          slug={page.slug}
          title={page.title}
          publishedJson={page.publishedJson}
          getDraft={() => JSON.parse(latest.current)}
          onPreview={async (text) => {
            // Save what is typed first, so the preview compares with the draft on screen.
            if (!(await flush())) return { error: "Couldn't save your latest changes first. Try again in a moment." };
            return importLandingDraftJson(page.id, text, { dryRun: true });
          }}
          onApply={async (text) => {
            // Same as a starter: the draft kept in History is the one on screen, and autosave can't write it back over the import.
            if (!(await flush())) return "Couldn't save your latest changes first. Try again in a moment.";
            const result = await importLandingDraftJson(page.id, text);
            if (result.error) return result.error;
            window.location.reload();
            return null;
          }}
        />
      </Modal>
    </div>
  );
}

function DetailsDialog({ open, page, onClose, onSaved }: { open: boolean; page: EditorPage; onClose: () => void; onSaved: (next: Partial<EditorPage>) => void }) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [seoTitle, setSeoTitle] = useState(page.seoTitle);
  const [seoDescription, setSeoDescription] = useState(page.seoDescription);
  const [social, setSocial] = useState(page.socialImageAssetId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = "mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900";
  return (
    <Modal isOpen={open} onClose={onClose} title="Page details" maxWidth="lg">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            const result = await updateLandingPageDetails(page.id, { title, slug, seoTitle, seoDescription, socialImageAssetId: social });
            if (result.error) return setError(result.error);
            onSaved({ title, slug: result.slug ?? slug, seoTitle, seoDescription, socialImageAssetId: social, publicPath: page.kind === "template" ? "" : `/p/${result.slug ?? slug}` });
          });
        }}
      >
        <label className="block text-sm font-medium">
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className={input} />
        </label>
        <p className="text-sm">
          <span className="font-medium">Kind of page: </span>
          {page.pageType === "website" ? "Website page" : "Landing page"}
          <span className="block text-xs text-slate-600 dark:text-slate-400">
            {page.pageType === "website" ? "Shares the site's header, footer and style with the other website pages." : "Stands alone and is styled on its own."} Chosen when the page was made.
          </span>
        </p>
        <label className="block text-sm font-medium">
          {page.kind === "template" ? "Address in the editor (/admin/pages/…)" : "Address (/p/…)"}
          <input value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" title="Lowercase letters, numbers and dashes" className={input} />
          {page.status === "published" && page.kind !== "template" && <span className="mt-1 block text-xs text-amber-800 dark:text-amber-300">The page is live: changing the address breaks links people already have.</span>}
        </label>
        {page.kind !== "template" && (
          <>
            <label className="block text-sm font-medium">
              Title in search results and shared links
              <input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} placeholder={title} className={input} />
            </label>
            <label className="block text-sm font-medium">
              Description
              <textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} rows={3} className={input} />
            </label>
            <div className="text-sm font-medium">
              Picture when the page is shared
              <div className="mt-1">
                <MediaPicker value={social || null} onChange={(id) => setSocial(id ?? "")} surface="landing_page" preview="event_card" noun="picture" />
              </div>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={SECONDARY}>
            Cancel
          </button>
          <button type="submit" disabled={pending} className={PRIMARY}>
            Save details
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VersionList({ versions, onRestore }: { versions: EditorVersion[]; onRestore: (id: string) => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (versions.length === 0) return <p className="text-sm">Each time you publish, that version is kept here. Nothing has been published yet.</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm">Bringing a version back puts it in your draft. It doesn&apos;t go live until you publish it.</p>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700">
        {versions.map((v) => (
          <li key={v.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0">
              {v.title}
              <time dateTime={v.createdAt} className="block text-xs text-slate-600 dark:text-slate-400">
                {v.kind === "before_import" ? "Your draft before an import" : v.kind === "before_starter" ? "Your draft before it was replaced" : "Published"} by {v.by ?? "Someone"}, {new Date(v.createdAt).toLocaleString()}
              </time>
              {v.note && <span className="block text-xs">“{v.note}”</span>}
            </span>
            <LifecycleButton action="restore" noun="version" disabled={pending} className={SECONDARY} onRun={() => start(async () => setError(await onRestore(v.id)))} />
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
