"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Props = {
  src: string;
  poster: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
  label?: string;
  /** Scrub while the stage is pinned (taller than the viewport) instead of while it enters view. */
  pinned?: boolean;
  /** Owns the cursor halo; only one stage per page should. */
  halo?: boolean;
  steps?: { name: string; text: string; icon: React.ReactNode }[];
};

const zeroGoals = ["harm", "time lost", "victims"];
const responseStages = [
  {
    event: "Wind shift detected.",
    pending: "Detect a new signal.",
    context: "A wind update reveals a new community at risk.",
    priority: "New signal",
    status: "Assessing the new signal",
  },
  {
    event: "New threat prioritized.",
    pending: "Prioritize the new threat.",
    context: "The new threat moves up the response queue.",
    priority: "High priority",
    status: "Coordinating the response",
  },
  {
    event: "Firefighting resources reassigned.",
    pending: "Reassign firefighting resources.",
    context: "Firefighting resources are reassigned to the community now at risk.",
    priority: "Resources reassigned",
    status: "Preparing the alert",
  },
  {
    event: "Alert ready for approval",
    context: "Review who will receive the warning and what it asks them to do.",
    priority: "Human approval",
    status: "Alert ready for approval",
  },
];
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

type GoalText = {
  word: number;
  letters: number;
  phase: "hold" | "erase" | "type";
};

// All-intra video (ffmpeg -g 1), ~1080p and under 15 MB keeps seeking responsive.
export default function ScrollStage({
  src,
  poster,
  children,
  className = "lp-stage",
  id,
  label,
  pinned = false,
  halo = true,
  steps,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const meaningRef = useRef<HTMLDivElement>(null);
  const advanceButtonRef = useRef<HTMLButtonElement>(null);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [animateGoals, setAnimateGoals] = useState(false);
  const [goalsVisible, setGoalsVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const hydrated = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const [responseIndex, setResponseIndex] = useState<number | null>(null);
  const response = responseIndex === null ? null : responseStages[responseIndex];
  const awaitingApproval = responseIndex === responseStages.length - 1;
  const [goalText, setGoalText] = useState<GoalText>({
    word: 0,
    letters: zeroGoals[0].length,
    phase: "hold",
  });
  const typing = animateGoals && goalsVisible && !paused;

  const advanceResponse = () => {
    setResponseIndex((current) =>
      current === null || current === responseStages.length - 1 ? 0 : current + 1,
    );
  };
  const previousResponse = () => {
    if (responseIndex === 1) advanceButtonRef.current?.focus({ preventScroll: true });
    setResponseIndex((current) => (current === null ? null : Math.max(0, current - 1)));
  };
  const responseState = (index: number) => {
    if (responseIndex === null) return undefined;
    if (index < responseIndex) return "complete";
    return index === responseIndex ? "current" : "upcoming";
  };

  useEffect(() => {
    const meaning = meaningRef.current;
    if (!meaning) return;

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    let visible = false;
    const update = () => {
      setAnimateGoals(motion.matches);
      setGoalsVisible(visible && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(meaning);
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);

    return () => {
      observer.disconnect();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!typing) return;

    const delay = goalText.phase === "hold" ? 1900 : goalText.phase === "erase" ? 65 : 110;
    const timer = window.setTimeout(() => {
      setGoalText((current) => {
        if (current.phase === "hold") return { ...current, phase: "erase" };
        if (current.phase === "erase") {
          return current.letters > 0
            ? { ...current, letters: current.letters - 1 }
            : { word: (current.word + 1) % zeroGoals.length, letters: 0, phase: "type" };
        }
        return current.letters < zeroGoals[current.word].length
          ? { ...current, letters: current.letters + 1 }
          : { ...current, phase: "hold" };
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [typing, goalText]);

  useEffect(() => {
    const root = stageRef.current?.closest<HTMLElement>(".lp");
    if (!root || !halo) return;

    const media = window.matchMedia(
      "(min-width: 768px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    let x = 0;
    let y = 0;

    const paint = () => {
      frame = 0;
      root.style.setProperty("--lp-cursor-x", `${x}px`);
      root.style.setProperty("--lp-cursor-y", `${y}px`);
      root.style.setProperty("--lp-cursor-visible", "1");
    };
    const move = (event: PointerEvent) => {
      if (!media.matches || event.pointerType !== "mouse") return;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const hide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      root.style.setProperty("--lp-cursor-visible", "0");
    };

    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", hide);
    window.addEventListener("blur", hide);
    media.addEventListener("change", hide);
    return () => {
      hide();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      media.removeEventListener("change", hide);
      for (const property of ["--lp-cursor-x", "--lp-cursor-y", "--lp-cursor-visible"]) {
        root.style.removeProperty(property);
      }
    };
  }, [halo]);

  useEffect(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage || !video) return;

    const motion = window.matchMedia("(prefers-reduced-motion: no-preference)");
    const desktop = window.matchMedia("(min-width: 768px)");
    let nearby = false;
    let frame = 0;

    const tick = () => {
      frame = 0;
      if (!nearby || !motion.matches || !desktop.matches) return;
      const rect = stage.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = Math.min(
        1,
        Math.max(
          0,
          pinned
            ? // The next section overlaps by one viewport; let it slide in over the last quarter of the dolly.
              -rect.top / Math.max(1, rect.height - viewport * 1.75)
            : (viewport * 0.85 - rect.top) / (rect.height + viewport * 0.45),
        ),
      );
      if (pinned) stage.style.setProperty("--lp-progress", progress.toFixed(4));
      if (video.readyState < 2) return;
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      const target = progress * Math.max(0, video.duration - 1 / 24);
      const delta = target - video.currentTime;
      if (Math.abs(delta) > 0.02 && !video.seeking) {
        video.currentTime += delta * 0.18;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const update = () => {
      setEnabled(nearby && motion.matches && desktop.matches);
      schedule();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        nearby = entry.isIntersecting;
        update();
      },
      { rootMargin: "300px" },
    );
    observer.observe(stage);
    motion.addEventListener("change", update);
    desktop.addEventListener("change", update);
    video.addEventListener("loadeddata", schedule);
    video.addEventListener("seeked", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener("change", update);
      desktop.removeEventListener("change", update);
      video.removeEventListener("loadeddata", schedule);
      video.removeEventListener("seeked", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      stage.style.removeProperty("--lp-progress");
    };
  }, [pinned]);

  const mediaStage = (
    <div
      ref={stageRef}
      className={className}
      id={id}
      aria-label={label}
      data-scrub={pinned && hydrated ? "true" : undefined}
    >
      <div className="lp-stage-media" aria-hidden="true">
        <div className="lp-stage-frame">
          {/* eslint-disable-next-line @next/next/no-img-element -- original poster shared with the video */}
          <img
            className="lp-stage-video"
            src={poster}
            width={1920}
            height={1080}
            alt=""
            loading={pinned ? "eager" : "lazy"}
            fetchPriority={pinned ? "high" : "auto"}
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
          <video
            ref={videoRef}
            className="lp-stage-video"
            src={enabled && !failed ? src : undefined}
            poster={enabled ? poster : undefined}
            width={1920}
            height={1080}
            muted
            playsInline
            preload="auto"
            tabIndex={-1}
            hidden={!enabled || !ready || failed}
            onLoadedData={() => setReady(true)}
            onError={() => setFailed(true)}
          />
          <div className="lp-stage-scrim" />
        </div>
      </div>
      {children}
    </div>
  );

  if (!steps) return mediaStage;

  return (
    <>
      <div className="lp-lighthouse">
        {mediaStage}
        <div
          ref={meaningRef}
          className="lp-meaning"
          id="meaning"
          role="group"
          aria-labelledby="meaning-title"
        >
          <div className="lp-meaning-heading">
            <h3 id="meaning-title">Far0, decoded</h3>
            <button
              className="lp-motion-toggle"
              type="button"
              hidden={!animateGoals}
              aria-label={paused ? "Resume text animation" : "Pause text animation"}
              onClick={() => setPaused((current) => !current)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
          <dl className="lp-acronym">
            <div>
              <dt>F</dt>
              <dd>Fully</dd>
            </div>
            <div>
              <dt>a</dt>
              <dd>Automated</dd>
            </div>
            <div>
              <dt>r</dt>
              <dd>Response</dd>
            </div>
            <div className="lp-zero">
              <dt>0</dt>
              <dd>
                <span className="sr-only">
                  Our ambition: zero harm, zero time lost, zero victims.
                </span>
                <span className="lp-zero-static" aria-hidden="true" hidden={animateGoals}>
                  harm
                  <span className="lp-zero-alternatives">time lost · victims</span>
                </span>
                <span
                  className="lp-zero-typing"
                  aria-hidden="true"
                  hidden={!animateGoals}
                  data-motion={typing ? "running" : "paused"}
                >
                  {zeroGoals[goalText.word].slice(0, goalText.letters)}
                  <span className="lp-zero-caret" />
                </span>
              </dd>
            </div>
          </dl>
          <p className="lp-meaning-note">Our ambition. Every response.</p>
          <p className="lp-meaning-note">Automated coordination. Human-approved alerts.</p>
        </div>
      </div>
      <div className="lp-system-copy">
        <ol className="lp-steps" aria-label="The response loop">
          {steps.map((step, index) => (
            <li
              key={step.name}
              data-state={responseState(index)}
              aria-current={responseIndex === index ? "step" : undefined}
            >
              <svg
                className="lp-step-icon"
                viewBox="0 0 40 40"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                focusable="false"
              >
                {step.icon}
              </svg>
              <div>
                <h3>{step.name}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <figure
        className="lp-decision"
        id="response"
        aria-labelledby="response-title"
        data-step={responseIndex ?? undefined}
      >
        <figcaption className="lp-decision-caption">
          <span>Sierra Bermeja · Wind update</span>
          <span>Simulated scenario</span>
        </figcaption>
        <div className="lp-decision-body">
          <div className="lp-response-heading">
            <h3 id="response-title">
              The wind shifts.
              <br />
              The response shifts with it.
            </h3>
            <span className="lp-priority">{response?.priority ?? "High priority"}</span>
          </div>
          <p className="lp-response-context" key={responseIndex ?? "overview"}>
            {response?.context ??
              "A wind shift puts another community at risk. The response must change with it."}
          </p>
          <ol className="lp-response-events" id="response-events" aria-label="Simulated response">
            {responseStages.slice(0, -1).map((stage, index) => (
              <li
                key={stage.event}
                data-state={responseState(index)}
                aria-current={responseIndex === index ? "step" : undefined}
              >
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                {responseIndex !== null && index > responseIndex ? stage.pending : stage.event}
              </li>
            ))}
          </ol>
          <div className="lp-story-controls" hidden={!hydrated}>
            <p className="lp-story-position">
              {responseIndex === null
                ? `${responseStages.length}-step walkthrough`
                : `Step ${responseIndex + 1} of ${responseStages.length}`}
            </p>
            <div className="lp-story-buttons">
              <button
                className="lp-btn lp-btn-outline"
                type="button"
                disabled={responseIndex === null || responseIndex === 0}
                aria-controls="response-events response-status"
                onClick={previousResponse}
              >
                Back
              </button>
              <button
                ref={advanceButtonRef}
                className="lp-btn lp-btn-primary"
                type="button"
                aria-controls="response-events response-status"
                onClick={advanceResponse}
              >
                {responseIndex === null
                  ? "Show the response"
                  : awaitingApproval
                    ? "Replay scenario"
                    : "Next step"}
                <span aria-hidden="true">{awaitingApproval ? "↺" : "→"}</span>
              </button>
            </div>
          </div>
          <p className="sr-only" role="status" aria-atomic="true">
            {response && responseIndex !== null
              ? `Step ${responseIndex + 1} of ${responseStages.length}. ${response.event} ${response.context}`
              : ""}
          </p>
          <div className="lp-response-footer">
            <span
              className="lp-status"
              id="response-status"
              data-ready={awaitingApproval || undefined}
            >
              <span aria-hidden="true" />
              {response?.status ?? "Alert ready for approval"}
            </span>
            <a href="#control">
              Human oversight <span aria-hidden="true">→</span>
            </a>
          </div>
          <p className="lp-decision-gate">Simulated scenario. No messages are sent.</p>
        </div>
      </figure>
    </>
  );
}
