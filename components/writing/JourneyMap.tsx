import Link from "next/link";
import PanZoomCanvas from "@/components/PanZoomCanvas";
import {
  JOURNEY_BFF,
  JOURNEY_CANVAS,
  JOURNEY_OFFER_LABELS,
  JOURNEY_STAGES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  journeyStageForPhase,
  type JourneyOffer,
} from "@/lib/writing-journey";
import { PHASE_LABELS, type ProjectPhase } from "@/lib/writing-projects";

export interface JourneyProject {
  id: string;
  title: string;
  phase: ProjectPhase;
}

/** Arrows between stages, by the canvas coordinates the stages sit at (JOURNEY_STAGES). */
const EDGES: { d: string; kind: JourneyOffer | "bff" | "loop" }[] = [
  { d: "M73,250 C120,235 150,235 177,250", kind: "live" },
  { d: "M383,250 C420,250 420,140 457,140", kind: "live" },
  { d: "M383,250 C420,250 420,360 457,360", kind: "external" },
  { d: "M663,140 C700,140 700,250 737,250", kind: "roadmap" },
  { d: "M663,360 C700,360 700,250 737,250", kind: "roadmap" },
  { d: "M943,250 C980,250 1000,250 1017,250", kind: "external" },
  { d: "M1223,250 C1260,250 1260,105 1297,105", kind: "roadmap" },
  { d: "M1223,250 C1260,250 1260,395 1297,395", kind: "roadmap" },
  { d: "M1503,105 C1540,105 1540,250 1577,250", kind: "roadmap" },
  { d: "M1503,395 C1540,395 1540,250 1577,250", kind: "roadmap" },
  { d: "M1400,189 L1400,166", kind: "loop" },
  { d: "M1400,311 L1400,334", kind: "loop" },
  { d: "M260,111 C245,135 235,155 245,188", kind: "bff" },
  { d: "M340,111 C400,110 460,100 500,92", kind: "bff" },
];

const EDGE_STYLE: Record<(typeof EDGES)[number]["kind"], { className: string; dash?: string }> = {
  live: { className: "stroke-plum-600 dark:stroke-plum-400" },
  external: { className: "stroke-slate-500 dark:stroke-slate-400", dash: "2 6" },
  roadmap: { className: "stroke-emerald-600 dark:stroke-emerald-400", dash: "7 5" },
  loop: { className: "stroke-emerald-600 dark:stroke-emerald-400", dash: "7 5" },
  bff: { className: "stroke-amber-600 dark:stroke-amber-400", dash: "3 4" },
};

const STAGE_STYLE: Record<JourneyOffer, string> = {
  live: "border-plum-500 bg-white dark:bg-slate-900",
  external: "border-dotted border-slate-400 bg-white dark:bg-slate-900",
  roadmap: "border-dashed border-emerald-600/70 bg-white/70 dark:bg-slate-900/70",
};

/**
 * Journey as a diagram: stages joined by arrows (live, hire-a-pro and roadmap drawn
 * differently), with the member's projects at the stage their status puts them. A fixed-size canvas
 * that scrolls sideways on narrow screens; the stages are a real list so screen readers get them in order.
 */
export default function JourneyMap({ projects }: { projects: JourneyProject[] }) {
  const paused = projects.filter((p) => !journeyStageForPhase(p.phase));
  const { width, height } = JOURNEY_CANVAS;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The stages a book goes through at Quill &amp; Cup, and what we offer at each. Your projects sit at the stage their status puts them. Drag to move around, and pinch or use + and − to zoom.
      </p>

      <PanZoomCanvas width={width} height={height}>
          <svg className="absolute inset-0" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
            <defs>
              <marker id="journey-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 Z" className="fill-slate-500" />
              </marker>
            </defs>
            {EDGES.map((e) => (
              <path
                key={e.d}
                d={e.d}
                fill="none"
                strokeWidth={2}
                strokeDasharray={EDGE_STYLE[e.kind].dash}
                className={EDGE_STYLE[e.kind].className}
                markerEnd="url(#journey-arrow)"
                markerStart={e.kind === "loop" ? "url(#journey-arrow)" : undefined}
              />
            ))}
          </svg>

          <p className="absolute text-center font-serif italic text-sm text-slate-600 dark:text-slate-400" style={{ left: 4, top: 226, width: 66 }}>
            Blank page
          </p>

          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border border-dotted border-amber-600 bg-amber-50 dark:bg-slate-900 p-2"
            style={{ left: JOURNEY_BFF.x, top: JOURNEY_BFF.y, width: JOURNEY_BFF.width, height: JOURNEY_BFF.height }}
          >
            <p className="text-sm font-semibold">
              {JOURNEY_BFF.title} <span className="font-normal text-xs text-slate-500">· {JOURNEY_BFF.subtitle}</span>
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{JOURNEY_BFF.description}</p>
          </div>

          <ol>
            {JOURNEY_STAGES.map((stage) => {
              const here = projects.filter((p) => stage.phases.includes(p.phase));
              return (
                <li
                  key={stage.id}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-2 p-3 ${STAGE_STYLE[stage.offerStatus]}`}
                  style={{ left: stage.x, top: stage.y, width: STAGE_WIDTH, height: STAGE_HEIGHT }}
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                    <span>{stage.step}</span>
                    <span>{JOURNEY_OFFER_LABELS[stage.offerStatus]}</span>
                  </div>
                  <h2 className="text-sm font-semibold leading-tight">{stage.title}</h2>
                  <p className="text-xs font-medium text-plum-700 dark:text-plum-400">{stage.offer}</p>
                  {here.length > 0 ? (
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {here.map((p) => (
                        <li key={p.id}>
                          <Link href={`/projects/${p.id}`} className="inline-block rounded-full bg-plum-100 dark:bg-plum-900/40 px-2 py-0.5 text-xs text-plum-800 dark:text-plum-200 hover:underline">
                            {p.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{stage.description}</p>
                  )}
                  {stage.phases.length > 0 && (
                    <p className="mt-1 text-[10px] text-slate-500">Status: {stage.phases.map((p) => PHASE_LABELS[p]).join(" · ")}</p>
                  )}
                </li>
              );
            })}
          </ol>
      </PanZoomCanvas>

      <ul className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
        <li>Solid: live at Quill &amp; Cup</li>
        <li>Dotted: hire a pro outside Quill &amp; Cup</li>
        <li>Dashed: on the roadmap</li>
        <li>On hold and Hibernating projects are listed under Paused</li>
        <li>Community is with you the whole way</li>
      </ul>

      {paused.length > 0 && (
        <section>
          <h2 className="font-semibold">Paused</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {paused.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-sm hover:underline">
                  {p.title} · {PHASE_LABELS[p.phase]}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
