import Link from "next/link";
import PanZoomCanvas from "@/components/PanZoomCanvas";
import {
  JOURNEY_BFF,
  JOURNEY_CANVAS,
  JOURNEY_OFFER_LABELS,
  JOURNEY_STAGES,
  type JourneyOffer,
  type JourneyStage,
  type JourneyStep,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  journeyStageForPhase,
} from "@/lib/writing-journey";
import { PHASE_LABELS, type ProjectPhase } from "@/lib/writing-projects";

export interface JourneyProject {
  id: string;
  title: string;
  phase: ProjectPhase;
}

const stageById = (id: string) => JOURNEY_STAGES.find((s) => s.id === id)!;
const left = (s: JourneyStage) => s.x - (s.width ?? STAGE_WIDTH) / 2;
const right = (s: JourneyStage) => s.x + (s.width ?? STAGE_WIDTH) / 2;
const curve = (from: JourneyStage, to: JourneyStage, y1 = from.y, y2 = to.y) => {
  const mid = (right(from) + left(to)) / 2;
  return `M${right(from)},${y1} C${mid},${y1} ${mid},${y2} ${left(to)},${y2}`;
};

/** Arrows between stages, from the canvas coordinates the stages sit at (JOURNEY_STAGES). */
function buildEdges(): { d: string; kind: JourneyOffer | "bff" | "loop" }[] {
  const draft = stageById("draft");
  const academy = stageById("self-edit");
  const lane = stageById("hire-a-pro");
  const pubs = [stageById("self-publish"), stageById("query-submit")];
  const arc = stageById("arc-readers");
  const launch = stageById("launch");
  const arcHalf = STAGE_HEIGHT / 2;
  return [
    { d: "M73,250 C120,235 150,235 177,250", kind: "live" },
    { d: curve(draft, academy), kind: "live" },
    { d: curve(draft, lane), kind: "external" },
    ...pubs.flatMap((pub) => [
      { d: curve(academy, pub), kind: "live" as const },
      { d: curve(lane, pub), kind: "roadmap" as const },
      { d: curve(pub, launch), kind: "roadmap" as const },
    ]),
    { d: `M${arc.x},${arc.y - arcHalf - 1} L${arc.x},${pubs[0].y + arcHalf + 2}`, kind: "loop" },
    { d: `M${arc.x},${arc.y + arcHalf + 1} L${arc.x},${pubs[1].y - arcHalf - 2}`, kind: "loop" },
    { d: `M${right(arc)},${arc.y} L${left(launch)},${launch.y}`, kind: "roadmap" },
    { d: "M260,111 C245,135 235,155 245,188", kind: "bff" },
    { d: "M390,80 C440,80 470,100 503,120", kind: "bff" },
  ];
}
const EDGES = buildEdges();

const EDGE_STYLE: Record<JourneyOffer | "bff" | "loop", { className: string; dash?: string }> = {
  live: { className: "stroke-plum-600 dark:stroke-plum-400" },
  external: { className: "stroke-slate-500 dark:stroke-slate-400", dash: "2 6" },
  own: { className: "stroke-slate-500 dark:stroke-slate-400" },
  roadmap: { className: "stroke-emerald-600 dark:stroke-emerald-400", dash: "7 5" },
  loop: { className: "stroke-emerald-600 dark:stroke-emerald-400", dash: "7 5" },
  bff: { className: "stroke-amber-600 dark:stroke-amber-400", dash: "3 4" },
};

const STAGE_STYLE: Record<JourneyOffer, string> = {
  own: "border-slate-400 bg-white dark:bg-slate-900",
  live: "border-plum-500 bg-white dark:bg-slate-900",
  external: "border-dotted border-slate-400 bg-white dark:bg-slate-900",
  roadmap: "border-dashed border-emerald-600/70 bg-white/70 dark:bg-slate-900/70",
};

const STEP_STYLE: Record<JourneyOffer, string> = {
  own: "text-slate-500 dark:text-slate-400",
  live: "font-semibold",
  external: "rounded border border-dotted border-slate-400 px-1 font-medium",
  roadmap: "rounded border border-dashed border-emerald-600/70 px-1 font-medium",
};

function Chips({ projects }: { projects: JourneyProject[] }) {
  return (
    <ul className="mt-1 flex flex-wrap gap-1">
      {projects.map((p) => (
        <li key={p.id}>
          <Link href={`/projects/${p.id}`} className="inline-block rounded-full bg-plum-100 dark:bg-plum-900/40 px-2 py-0.5 text-xs text-plum-800 dark:text-plum-200 hover:underline">
            {p.title}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** One line of the hire-a-pro lane: the step, with the projects at its status after it. */
function LaneStep({ step, projects }: { step: JourneyStep; projects: JourneyProject[] }) {
  return (
    <li className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-snug">
      <span className={STEP_STYLE[step.offerStatus]}>{step.title}</span>
      {projects.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className="inline-block rounded-full bg-plum-100 dark:bg-plum-900/40 px-2 py-0.5 text-[11px] text-plum-800 dark:text-plum-200 hover:underline">
          {p.title}
        </Link>
      ))}
    </li>
  );
}

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

      <PanZoomCanvas width={width} height={height} expandTitle="Journey">
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
              const statuses = stage.coversPhases ?? stage.phases;
              const chips = here.length > 0 && <Chips projects={here} />;
              const box = { left: stage.x, top: stage.y, width: stage.width ?? STAGE_WIDTH, height: stage.height ?? STAGE_HEIGHT };
              if (stage.kind === "lane") {
                return (
                  <li
                    key={stage.id}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-2 p-3 ${STAGE_STYLE[stage.offerStatus]}`}
                    style={box}
                  >
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                      <span>{stage.step}</span>
                      <span>{JOURNEY_OFFER_LABELS[stage.offerStatus]}</span>
                    </div>
                    <h2 className="text-sm font-semibold leading-tight">{stage.title}</h2>
                    <ol className="mt-1 space-y-0.5">
                      {(stage.steps ?? []).map((step, i) => (
                        <LaneStep key={i} step={step} projects={projects.filter((p) => step.phases.includes(p.phase))} />
                      ))}
                    </ol>
                  </li>
                );
              }
              if (stage.kind === "group") {
                return (
                  <li
                    key={stage.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-dashed border-emerald-600/70 p-2"
                    style={box}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-1">
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">{stage.step}</span>
                        <h2 className="text-sm font-semibold leading-tight">{stage.title}</h2>
                      </div>
                      <span className="whitespace-nowrap text-[10px] text-slate-500">Status: {statuses.map((p) => PHASE_LABELS[p]).join(" · ")}</span>
                    </div>
                    {here.length > 0 && <div className="absolute inset-x-2 bottom-1">{chips}</div>}
                  </li>
                );
              }
              return (
                <li
                  key={stage.id}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border-2 p-3 ${STAGE_STYLE[stage.offerStatus]}`}
                  style={box}
                >
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-slate-500">
                    <span>{stage.step}</span>
                    <span>{JOURNEY_OFFER_LABELS[stage.offerStatus]}</span>
                  </div>
                  <h2 className="text-sm font-semibold leading-tight">{stage.title}</h2>
                  <p className="text-xs font-medium text-plum-700 dark:text-plum-400">{stage.offer}</p>
                  {chips || <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-slate-600 dark:text-slate-400">{stage.description}</p>}
                  {statuses.length > 0 && (
                    <p className="mt-1 text-[10px] text-slate-500">Status: {statuses.map((p) => PHASE_LABELS[p]).join(" · ")}</p>
                  )}
                </li>
              );
            })}
          </ol>
      </PanZoomCanvas>

      <ul className="flex flex-wrap gap-4 text-xs text-slate-600 dark:text-slate-400">
        <li>Solid: live at Quill &amp; Cup</li>
        <li>Dotted: hire a pro outside Quill &amp; Cup</li>
        <li>Plain: your own work</li>
        <li>Dashed: on the roadmap</li>
        <li>Hibernating projects are listed under Paused</li>
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
