import Image from "next/image";
import Link from "next/link";
import ScrollStage from "@/components/landing/scroll-stage";
import { FaroLockup, FaroIcon } from "@/components/landing/logo";

const steps = [
  {
    name: "Understand",
    text: "Identify the new threat and who is at risk.",
    icon: (
      <>
        <circle cx="20" cy="20" r="3" fill="currentColor" stroke="none" />
        <path d="M20 5A15 15 0 0 0 5 20M35 20A15 15 0 0 1 20 35M20 11A9 9 0 0 0 11 20M29 20A9 9 0 0 1 20 29" />
      </>
    ),
  },
  {
    name: "Prioritize",
    text: "Update priorities as the situation evolves.",
    icon: (
      <>
        <path d="M12 9h23M12 20h16M12 31h9" />
        <circle cx="5" cy="9" r="2" fill="currentColor" />
        <circle cx="5" cy="20" r="2" />
        <circle cx="5" cy="31" r="2" />
      </>
    ),
  },
  {
    name: "Coordinate",
    text: "Bring help where it is needed.",
    icon: (
      <>
        <path d="M5 20h9m6-3 8-8h7m-15 14 8 8h7" />
        <circle cx="17" cy="20" r="3" />
        <circle cx="35" cy="9" r="2" fill="currentColor" />
        <circle cx="35" cy="31" r="2" fill="currentColor" />
      </>
    ),
  },
];

const learnLoop = [
  ["Rehearse.", "Run the fire as road closures, network loss and a wind shift hit."],
  ["Review.", "Replay each decision in 3D and compare it with no intervention."],
  ["Approve.", "A facilitator accepts or rejects each lesson Far0 proposes."],
  ["Reuse.", "The next matching drill starts briefed with the approved lessons."],
] as const;

function DashboardLink({ className }: { className: string }) {
  return (
    <Link className={className} href="/dashboard" prefetch={false}>
      Open dashboard
    </Link>
  );
}

function InformationRibbon() {
  return (
    <aside className="lp-ribbon" aria-label="Partners, technology and our mission" id="ecosystem">
      <input className="lp-ribbon-toggle sr-only" type="checkbox" id="pause-ribbon" />
      <label className="lp-ribbon-control" htmlFor="pause-ribbon">
        <span className="sr-only">Pause information strip</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <path className="lp-ribbon-pause" d="M9 5v14M15 5v14" strokeWidth="2" />
          <path className="lp-ribbon-play" d="m9 5 10 7-10 7Z" />
        </svg>
      </label>
      <div className="lp-ribbon-viewport">
        <div className="lp-ribbon-track">
          {[0, 1].map((copy) => (
            <ul className="lp-ribbon-group" key={copy} aria-hidden={copy === 1 || undefined}>
              <li className="lp-ribbon-brand">
                <span className="lp-ribbon-label">Built with</span>
                <Image
                  src="/brand/happyrobot.svg"
                  alt="HappyRobot"
                  width={141}
                  height={22}
                  loading="eager"
                />
              </li>
              <li className="lp-ribbon-message">
                Changing situations. <span>Shared priorities.</span>
              </li>
              <li className="lp-ribbon-brand">
                <span className="lp-ribbon-label">Partner</span>
                <Image
                  className="lp-ribbon-junta"
                  src="/brand/junta-de-andalucia.png"
                  alt="Junta de Andalucía"
                  width={184}
                  height={48}
                  loading="eager"
                />
              </li>
              <li className="lp-ribbon-message">
                Coordinated teams. <span>People first.</span>
              </li>
              <li className="lp-ribbon-brand">
                <span className="lp-ribbon-label">Signal intelligence</span>
                <span className="lp-ribbon-jev">Jev / typesafe.ai</span>
              </li>
              <li className="lp-ribbon-event">
                <Image
                  className="lp-ribbon-hackspain"
                  src="/brand/hackspain.svg"
                  alt="HackSpain"
                  width={928}
                  height={306}
                  loading="eager"
                />
                <span>2026</span>
              </li>
            </ul>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default function LandingPage() {
  const repositoryUrl = process.env.REPOSITORY_URL?.trim();

  return (
    <>
      <a className="lp-skip" href="#main">
        Skip to content
      </a>
      <ScrollStage
        className="lp-intro"
        id="top"
        label="Far0"
        pinned
        halo={false}
        src="/media/faro-intro.mp4"
        poster="/media/faro-intro-poster.jpg"
      >
        <div className="lp-intro-stage">
          <FaroLockup className="lp-intro-lockup" gradientId="intro-gradient" />
          <a className="lp-intro-hint" href="#hero">
            Scroll <span aria-hidden="true">↓</span>
          </a>
        </div>
      </ScrollStage>
      <header className="lp-nav">
        <nav className="lp-wrap lp-nav-inner" aria-label="Primary">
          <a href="#top" aria-label="Far0, back to top">
            <FaroLockup gradientId="nav-gradient" />
          </a>
          <ul className="lp-nav-links">
            <li>
              <a href="#problem">The response</a>
            </li>
            <li>
              <a href="#learn">Learning</a>
            </li>
            <li>
              <a href="#control">Human control</a>
            </li>
          </ul>
          <DashboardLink className="lp-btn lp-btn-outline lp-nav-cta" />
        </nav>
      </header>
      <main id="main" tabIndex={-1}>
        <section className="lp-hero" id="hero" aria-labelledby="hero-title">
          <div className="lp-hero-inner lp-wrap">
            <p className="lp-hero-intro">Adaptive crisis response</p>
            <div className="lp-hero-composition">
              <h1 id="hero-title">
                When danger shifts,
                <br />
                help must follow.
              </h1>
              <FaroIcon
                className="lp-hero-mark"
                title="Far0 square logo"
                gradientId="hero-gradient"
              />
            </div>
            <div className="lp-hero-bottom">
              <p className="lp-lede">
                Far0 helps emergency teams adapt priorities and coordinate resources as a crisis
                evolves—keeping people at risk at the center of the response.
              </p>
              <div className="lp-hero-actions">
                <a className="lp-btn lp-btn-primary" href="#response">
                  See the simulated response <span aria-hidden="true">↗</span>
                </a>
                <DashboardLink className="lp-btn lp-btn-outline" />
              </div>
            </div>
            <div className="lp-hero-foot">
              <p>For the teams people depend on.</p>
              <a href="#meaning">
                What Far0 stands for <span aria-hidden="true">↓</span>
              </a>
            </div>
          </div>
        </section>
        <InformationRibbon />
        <section className="lp-response lp-wrap" id="problem" aria-labelledby="problem-title">
          <div className="lp-section-heading">
            <div>
              <p className="lp-section-label">Sierra Bermeja · Simulated scenario</p>
              <h2 id="problem-title">
                A change in the wind.
                <br />A community now at risk.
              </h2>
            </div>
            <p>
              The situation has changed. Teams need to know who is now at risk, where help is needed
              and what should happen next.
            </p>
          </div>
          <div className="lp-system" id="how">
            <ScrollStage src="/media/faro-scroll.mp4" poster="/media/faro-poster.jpg" steps={steps}>
              <p className="lp-render-caption">Understand the change. Coordinate the response.</p>
            </ScrollStage>
            <div className="lp-technology">
              <a className="lp-happyrobot" href="https://www.happyrobot.ai">
                <span>Built with</span>
                <Image src="/brand/happyrobot.svg" alt="HappyRobot" width={141} height={22} />
              </a>
              <a href="https://typesafe.ai">Signal filtering: Jev / typesafe.ai</a>
            </div>
          </div>
        </section>
        <section className="lp-learn" id="learn" aria-labelledby="learn-title">
          <div className="lp-wrap lp-learn-grid">
            <div>
              <p className="lp-section-label">Learning from past runs</p>
              <h2 id="learn-title">
                Every drill shapes
                <br />
                the next response.
              </h2>
              <p className="lp-learn-lead">
                Rehearse the wildfire in a 3D training town before the real one. Far0 records every
                decision, replays it against doing nothing and shows what worked and what did not.
              </p>
              <ol className="lp-learn-loop">
                {learnLoop.map(([name, text]) => (
                  <li key={name}>
                    <span>
                      <strong>{name}</strong> {text}
                    </span>
                  </li>
                ))}
              </ol>
              <Link className="lp-btn lp-btn-primary" href="/dashboard/drills" prefetch={false}>
                Try a wildfire drill
              </Link>
            </div>
            <figure className="lp-learn-media">
              <div className="lp-learn-video">
                <video
                  src="/media/faro-drills.mp4"
                  poster="/media/faro-drills-poster.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  aria-hidden="true"
                />
              </div>
              <figcaption>
                <span className="lp-learn-tag">Lesson from a recorded drill</span>
                <p>Road closed at T+5; no alternative route was recorded.</p>
                <p className="lp-learn-fix">
                  <span aria-hidden="true">→</span> Reserve one team for alternative access when the
                  road closes.
                </p>
              </figcaption>
            </figure>
          </div>
          <p className="lp-wrap lp-demo-note">
            Training simulator with synthetic geography. Approved lessons brief the next drill; they
            do not yet change the live coordinator.
          </p>
        </section>
        <section className="lp-control" id="control" aria-labelledby="control-title">
          <div className="lp-wrap lp-control-grid">
            <div className="lp-control-copy">
              <p className="lp-section-label">Human control</p>
              <h2 id="control-title">
                People will act on these alerts.
                <br />
                People must approve them.
              </h2>
            </div>
            <div className="lp-control-copy">
              <p className="lp-control-promise">Mass alerts always need human approval.</p>
              <details className="lp-consequence">
                <summary>Before an alert is sent</summary>
                <p>
                  Review who will receive the warning and what it asks them to do. Approve, hold or
                  override.
                </p>
              </details>
            </div>
          </div>
        </section>
        <section className="lp-demo lp-wrap" id="demo" aria-labelledby="demo-title">
          <div className="lp-demo-top">
            <h2 id="demo-title">
              See how the response adapts
              <br />
              when more people are at risk.
            </h2>
            <div className="lp-demo-actions">
              <a className="lp-btn lp-btn-primary" href="#response">
                Explore the simulation
              </a>
              <DashboardLink className="lp-btn lp-btn-outline" />
            </div>
          </div>
          <div className="lp-use-case">
            <p>
              One use case.
              <br />
              <span>Simulated scenario</span>
            </p>
            <div>
              <h3>Sierra Bermeja wildfire</h3>
              <p>Follow the response from a wind update to an alert ready for human review.</p>
              <p className="lp-case-context">Scenario context: 112 Andalucía and INFOCA.</p>
            </div>
          </div>
          <p className="lp-demo-note">Hackathon prototype. This simulation sends no messages.</p>
        </section>
      </main>
      <footer className="lp-footer lp-wrap">
        <FaroLockup gradientId="footer-gradient" />
        <p>HackSpain 2026 · HappyRobot challenge</p>
        {repositoryUrl ? <a href={repositoryUrl}>Source code</a> : null}
      </footer>
    </>
  );
}
