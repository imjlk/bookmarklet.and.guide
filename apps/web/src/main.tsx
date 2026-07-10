import {
  ArrowRight,
  BookOpen,
  Boxes,
  Cloud,
  FileCode2,
  ListChecks,
  PackageCheck,
  Play,
  ScrollText,
  ShieldCheck,
  Terminal,
} from "lucide-solid";
import { createResource, createSignal, For, onCleanup, onMount } from "solid-js";
import { render } from "solid-js/web";
import "./styles.css";

interface ProjectMeta {
  name: string;
  cli: string;
  version: string;
  runtime: string;
  packages: string[];
}

const fallbackMeta: ProjectMeta = {
  name: "BMKL",
  cli: "bmkl",
  version: "0.1.0",
  runtime: "Vite preview",
  packages: [
    "create-bmkl",
    "@bmkl/core",
    "@bmkl/contracts",
    "@bmkl/runtime",
    "@bmkl/vite",
    "@bmkl/cli",
  ],
};

const workflow = [
  {
    icon: Terminal,
    title: "Create",
    command: "npm create bmkl@latest my-agent -- --template lit-shadow",
    body: "Start from a Vite template for Lit, ttsc plugins, Solid, TanStack Query, React, or dependency-light TypeScript.",
  },
  {
    icon: Play,
    title: "Develop",
    command: "pnpm dev",
    body: "Use the preview page and a dev bookmarklet while Vite serves the injected module.",
  },
  {
    icon: PackageCheck,
    title: "Ship",
    command: "bmkl build && bmkl inspect",
    body: "Generate remote, inline, install page, manifest, and report artifacts.",
  },
];

const packages = [
  ["create-bmkl", "npm/pnpm/bun create entrypoint for Vite templates"],
  ["@bmkl/core", "BookmarkBuilder, loader, debug console, companion extension builder"],
  ["@bmkl/contracts", "typia-backed contracts for debug events, manifests, actions, and bridge messages"],
  ["@bmkl/runtime", "Shadow DOM, iframe, debug, action, and postMessage bridge helpers"],
  ["@bmkl/vite", "Vite IIFE defaults plus optional ttsc unplugin bridge"],
  ["@bmkl/cli", "bmkl and bmk commands for dev, build, inspect, doctor"],
];

const navItems = [
  ["workflow", "Workflow"],
  ["templates", "Templates"],
  ["cli", "CLI"],
  ["debug", "Debug"],
  ["packages", "Packages"],
  ["deploy", "Deploy"],
] as const;

const templates = [
  {
    name: "lit-shadow",
    badge: "Default",
    title: "Lit + Shadow DOM",
    command: "npm create bmkl@latest my-agent -- --template lit-shadow",
    body: "TS-first component structure without TSX, with Web Components and Shadow DOM fitting bookmarklet isolation naturally.",
  },
  {
    name: "ttsc-shadow",
    badge: "Compiler",
    title: "ttsc + Shadow DOM",
    command: "pnpm create bmkl my-agent --template ttsc-shadow",
    body: "Turns on @ttsc/lint, @ttsc/strip, @ttsc/paths, graph scripts, and the Vite unplugin path in a TS-only bookmarklet.",
  },
  {
    name: "solid-shadow",
    badge: "Fast UI",
    title: "Solid + Shadow DOM",
    command: "pnpm create bmkl my-agent --template solid-shadow",
    body: "Fine-grained UI for compact overlays. Keeps ttsc checks and graph scripts while leaving the JSX Vite transform alone.",
  },
  {
    name: "solid-query-shadow",
    badge: "TanStack",
    title: "Solid Query + Shadow DOM",
    command: "pnpm create bmkl my-agent --template solid-query-shadow",
    body: "Adds TanStack Query for cached async reads, API-backed panels, refetch flows, and server-state style bookmarklets.",
  },
  {
    name: "react-shadow",
    badge: "React",
    title: "React + Shadow DOM",
    command: "pnpm create bmkl my-agent --template react-shadow",
    body: "Best when teams want to reuse React components or mirror an existing app workflow inside a bookmarklet.",
  },
  {
    name: "vanilla-shadow",
    badge: "Smallest",
    title: "Vanilla TS + Shadow DOM",
    command: "bun create bmkl my-agent --template vanilla-shadow",
    body: "The dependency-light baseline for page utilities, DOM actions, and tiny scripts where a framework is unnecessary.",
  },
];

const cliCommands = [
  {
    command: "npm create bmkl@latest my-agent -- --template lit-shadow",
    detail: "Use the standard npm create flow to scaffold the TS-first default template.",
  },
  {
    command: "pnpm create bmkl my-agent --template solid-query-shadow",
    detail: "Start with TanStack Query when the bookmarklet needs cached async data.",
  },
  {
    command: "pnpm create bmkl my-agent --template ttsc-shadow",
    detail: "Use the compiler-aware template for lint diagnostics, strip transforms, path rewrites, and graph output.",
  },
  {
    command: "bmkl templates --json",
    detail: "List template metadata for docs, generators, and CI automation.",
  },
  {
    command: "bmkl dev --port 5173",
    detail: "Start Vite and print a development bookmarklet that loads the module from localhost.",
  },
  {
    command: "bmkl dev --debug --target https://example.com",
    detail: "Print a debug bookmarklet, serve a local console, and collect target-site events with direct POST plus popup relay.",
  },
  {
    command: "bmkl companion --target https://example.com --port 5173",
    detail: "Build an unpacked MV3 companion extension when strict CSP blocks the bookmarklet delivery path.",
  },
  {
    command: "pnpm e2e:debug",
    detail: "Run the automated matrix for bookmarklet debug plus the strict script-src companion fixture.",
  },
  {
    command: "bmkl build --base-url https://cdn.example.com/",
    detail: "Build the remote loader, IIFE app, inline fallback, manifest, install page, and report.",
  },
  {
    command: "bmkl inspect",
    detail: "Check artifact sizes, bookmarklet length, manifest target, and CSP fallback warnings.",
  },
  {
    command: "bmkl doctor",
    detail: "Check entry files, ttsc setup, typia contracts, remote base URL, and generated artifacts.",
  },
  {
    command: "bmkl contracts validate-debug-report report.json",
    detail: "Validate copied debug reports, manifests, debug events, and bridge messages against typia contracts.",
  },
];

const artifacts = [
  "remote/app.iife.js",
  "remote/loader.js",
  "remote/manifest.json",
  "remote/bookmarklet.txt",
  "remote/install.html",
  "inline/bookmarklet.txt",
  "meta/build-report.json",
];

const debugFlow = [
  [
    "1",
    "Start local debug",
    "Run bmkl dev --debug --target <site>. BMKL serves Vite plus /__bmkl/debug on localhost.",
  ],
  [
    "2",
    "Open the target site",
    "Visit the real page where the bookmarklet must run, not just the Vite preview page.",
  ],
  [
    "3",
    "Click the debug bookmarklet",
    "The target tab mounts a BMKL debug overlay, opens the localhost console, and starts best-effort event collection.",
  ],
  [
    "4",
    "Reproduce the issue",
    "Loader events, run() failures, uncaught errors, and runtime debug events stream to the terminal and console.",
  ],
  [
    "5",
    "Copy the fallback report",
    "If popup policy or collection is blocked after the overlay appears, use Copy report and paste the JSON into an issue.",
  ],
] as const;

const companionFlow = [
  [
    "1",
    "Keep bmkl dev running",
    "Run bmkl dev --debug --target <site> so the localhost console and event collector stay available.",
  ],
  [
    "2",
    "Build the companion",
    "Run bmkl companion --target <site> --port 5173 to bundle the current entry into an unpacked extension.",
  ],
  [
    "3",
    "Load unpacked",
    "Open chrome://extensions, enable Developer mode, and load dist/bookmarklet/companion-extension.",
  ],
  [
    "4",
    "Test the real page",
    "Open or reload the strict CSP target. The content script runs automatically and the extension action reruns it.",
  ],
  [
    "5",
    "Read the trail",
    "Use the terminal, debug console, companion overlay, or copied report to inspect run() and runtime events.",
  ],
] as const;

const cspMatrix = [
  [
    "No CSP",
    "Expected pass",
    "Dev module loads, app runs, overlay updates, and terminal receives debug events.",
  ],
  [
    "connect-src blocks localhost",
    "Overlay fallback",
    "The app can still run when script-src allows the dev origin, but direct collection reports collector-blocked-likely.",
  ],
  [
    "script-src blocks localhost",
    "Companion path",
    "The debug bookmarklet reports module-load-error; the companion bundles the app as an extension content script.",
  ],
  [
    "strict inline/javascript policy",
    "Companion required",
    "If the browser blocks javascript: or inline bootstrap execution, use the extension path for development.",
  ],
] as const;

function App() {
  const [meta] = createResource<ProjectMeta>(async () => {
    try {
      const response = await fetch("/api/project");
      if (response.ok) {
        return await response.json();
      }
    } catch {
      return fallbackMeta;
    }
    return fallbackMeta;
  });
  const [activeSection, setActiveSection] = createSignal("workflow");

  onMount(() => {
    const revealElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );

    if (!("IntersectionObserver" in window)) {
      revealElements.forEach((element) => element.setAttribute("data-reveal", "true"));
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.setAttribute("data-reveal", "true");
          }
        }
      },
      { threshold: 0.18 },
    );

    revealElements.forEach((element) => revealObserver.observe(element));

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];

        if (visible?.target.id) {
          setActiveSection(visible.target.id);
        }
      },
      {
        rootMargin: "-20% 0px -55% 0px",
        threshold: [0.18, 0.36, 0.6],
      },
    );

    navItems.forEach(([id]) => {
      const section = document.getElementById(id);
      if (section) {
        sectionObserver.observe(section);
      }
    });

    onCleanup(() => {
      revealObserver.disconnect();
      sectionObserver.disconnect();
    });
  });

  return (
    <>
      <header class="site-header">
        <a class="brand" href="#top" aria-label="BMKL home">
          <Boxes size={22} />
          <span>BMKL</span>
        </a>
        <nav aria-label="Primary">
          <For each={navItems}>
            {([id, label]) => (
              <a
                href={`#${id}`}
                classList={{ active: activeSection() === id }}
                aria-current={activeSection() === id ? "true" : undefined}
              >
                {label}
              </a>
            )}
          </For>
        </nav>
      </header>

      <main id="top">
        <section class="hero">
          <div class="hero-visual" aria-hidden="true">
            <div class="browser-shell">
              <div class="browser-bar">
                <span />
                <span />
                <span />
                <div class="bookmark">bmkl</div>
              </div>
              <div class="page-lines">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div class="selection-ribbon">selected DOM text</div>
              <div class="floating-panel">
                <div class="panel-title">
                  <span>my-agent</span>
                  <i />
                </div>
                <div class="panel-row strong" />
                <div class="panel-row" />
                <div class="panel-actions">
                  <span />
                  <span />
                </div>
              </div>
            <div class="code-strip">
              <code>runtime: remote</code>
              <code>format: iife</code>
              <code>template: lit-shadow</code>
              <code>typecheck: ttsc</code>
            </div>
            </div>
          </div>

          <div class="hero-copy">
            <p class="eyebrow">Vite-first bookmarklet framework</p>
            <h1>BMKL</h1>
            <p class="lede">
              Build bookmarklets as remote-updatable in-page apps with Vite,
              ttsc checks, and a typed runtime surface.
            </p>
            <div class="hero-actions">
              <a class="primary-action" href="#cli">
                <Terminal size={18} />
                <span>Start with create</span>
                <ArrowRight size={18} />
              </a>
              <a class="secondary-action" href="#packages">
                <FileCode2 size={18} />
                <span>View packages</span>
              </a>
            </div>
          </div>
        </section>

        <section id="workflow" class="workflow" data-reveal>
          <div class="section-label">Workflow</div>
          <div class="section-heading">
            <h2>One create path, one build path, six Vite templates.</h2>
            <p>
              Start with the package-manager create command, then use bmkl
              inside the generated project for dev, build, inspect, and doctor.
            </p>
          </div>
          <div class="steps">
            <For each={workflow}>
              {(item) => {
                const Icon = item.icon;
                return (
                  <article class="step">
                    <div class="step-icon">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3>{item.title}</h3>
                      <code>{item.command}</code>
                      <p>{item.body}</p>
                    </div>
                  </article>
                );
              }}
            </For>
          </div>
        </section>

        <section id="templates" class="templates" data-reveal>
          <div class="section-label">Templates</div>
          <div class="section-heading">
            <h2>Pick the smallest shape that matches the job.</h2>
            <p>
              BMKL keeps Query, React, and framework dependencies opt-in so
              ordinary bookmarklets stay lean while data-heavy tools still have
              a ready starter.
            </p>
          </div>
          <div class="template-list">
            <For each={templates}>
              {(item) => (
                <article class="template-row">
                  <div class="template-meta">
                    <span>{item.badge}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <div>
                    <code>{item.command}</code>
                    <p>{item.body}</p>
                  </div>
                  <strong>{item.name}</strong>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="cli" class="cli-section" data-reveal>
          <div class="section-label">CLI</div>
          <div class="cli-layout">
            <div class="cli-copy">
              <h2>Create with npm. Work with bmkl.</h2>
              <p>
                Project generation follows the JavaScript create convention.
                The generated app then carries bmkl scripts for local dev,
                release artifacts, diagnostics, and install pages.
              </p>
              <div class="cli-badges" aria-label="CLI capabilities">
                <span>
                  <PackageCheck size={16} />
                  create-bmkl
                </span>
                <span>
                  <Terminal size={16} />
                  bmkl
                </span>
                <span>
                  <BookOpen size={16} />
                  bmk alias
                </span>
                <span>
                  <ListChecks size={16} />
                  ttsc checks
                </span>
              </div>
            </div>

            <div class="command-list" aria-label="BMKL CLI commands">
              <For each={cliCommands}>
                {(item) => (
                  <article class="command-row">
                    <code>{item.command}</code>
                    <p>{item.detail}</p>
                  </article>
                )}
              </For>
            </div>
          </div>

          <div class="artifact-strip" aria-label="Generated artifacts">
            <div>
              <ScrollText size={18} />
              <span>Generated output</span>
            </div>
            <For each={artifacts}>{(artifact) => <code>{artifact}</code>}</For>
          </div>
        </section>

        <section id="debug" class="debug-section" data-reveal>
          <div class="section-label">Debug</div>
          <div class="debug-grid">
            <div class="debug-copy">
              <h2>Test on the real site without losing the failure trail.</h2>
              <p>
                The debug bookmarklet sends localhost events directly, mirrors
                them to a console window, and leaves an in-page overlay behind
                when a site blocks one of those paths. The local collector
                validates debug payloads through the contract layer before
                logging them.
              </p>
              <div class="debug-terminal" aria-label="Debug command">
                <code>bmkl dev --debug --target https://example.com</code>
                <code>bmkl companion --target https://example.com --port 5173</code>
                <code>Debug console: http://127.0.0.1:5173/__bmkl/debug</code>
                <code>Debug bookmarklet: javascript:(...)</code>
              </div>
            </div>
            <div class="debug-flow" aria-label="Target-site debug flow">
              <For each={debugFlow}>
                {([step, title, body]) => (
                  <article>
                    <span>{step}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </div>
          <div class="csp-matrix" aria-label="CSP compatibility matrix">
            <For each={cspMatrix}>
              {([policy, status, body]) => (
                <article>
                  <span>{policy}</span>
                  <strong>{status}</strong>
                  <p>{body}</p>
                </article>
              )}
            </For>
          </div>
          <div class="companion-panel" aria-label="Companion extension test flow">
            <div>
              <span>Companion Mode</span>
              <h3>When the site blocks the bookmarklet path, move delivery into an extension.</h3>
              <p>
                The collector still comes from bmkl dev, but the app code is
                bundled into a Chrome MV3 content script so strict script-src
                policies do not stop the development run.
              </p>
            </div>
            <div class="companion-flow">
              <For each={companionFlow}>
                {([step, title, body]) => (
                  <article>
                    <span>{step}</span>
                    <div>
                      <h4>{title}</h4>
                      <p>{body}</p>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </div>
        </section>

        <section id="packages" class="packages" data-reveal>
          <div class="section-label">Packages</div>
          <div class="package-grid">
            <div class="package-lead">
              <h2>Vite builds fast. ttsc keeps watch.</h2>
              <p>
                BMKL keeps bundling, type checks, generated contracts, action
                bridge helpers, optional compiler plugins, graph output, and
                runtime mounting in separate packages.
              </p>
              <div class="meta-line">
                <ShieldCheck size={18} />
                <span>{meta()?.runtime ?? "Cloudflare Pages advanced mode"}</span>
              </div>
            </div>
            <div class="package-list">
              <For each={packages}>
                {([name, body]) => (
                  <article>
                    <h3>{name}</h3>
                    <p>{body}</p>
                  </article>
                )}
              </For>
            </div>
          </div>
        </section>

        <section id="deploy" class="deploy" data-reveal>
          <div>
            <div class="section-label">Deploy</div>
            <h2>Ready for Cloudflare Pages.</h2>
            <p>
              The site ships with advanced mode so `/api/project` can run at
              the edge while static assets remain cache-friendly.
            </p>
          </div>
          <div class="deploy-terminal">
            <div>
              <Cloud size={18} />
              <span>pages</span>
            </div>
            <code>pnpm --filter @bmkl/web build</code>
            <code>pnpm --filter @bmkl/web pages:dev</code>
            <code>pnpm --filter @bmkl/web deploy</code>
          </div>
        </section>
      </main>
    </>
  );
}

render(() => <App />, document.getElementById("root")!);
