import {
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  FileCode2,
  ListChecks,
  Menu,
  PackageCheck,
  Play,
  ScrollText,
  ShieldCheck,
  Terminal,
  X,
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

const defaultCreateCommand =
  "pnpm install && pnpm build:packages && pnpm cli -- create my-agent --local --template lit-shadow";

const cloudflarePagesGuideUrl =
  "https://developers.cloudflare.com/pages/get-started/direct-upload/";

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
    "@bmkl/templates",
    "@bmkl/vite",
    "@bmkl/cli",
  ],
};

const workflow = [
  {
    icon: Terminal,
    title: "Create",
    command: defaultCreateCommand,
    body: "From the BMKL source checkout root, install and build the local packages, then create a project linked to this checkout.",
  },
  {
    icon: Play,
    title: "Develop",
    command: "cd my-agent && pnpm install && pnpm dev",
    body: "Inside the generated project, open the local Setup page and drag the install-once bookmarklet to your browser.",
  },
  {
    icon: PackageCheck,
    title: "Ship",
    command: "pnpm build && pnpm inspect",
    body: "Inside the generated project, build and inspect remote, inline, install-page, manifest, and report artifacts.",
  },
];

const packages = [
  ["create-bmkl", "Pre-release package-manager entrypoint for Vite templates"],
  ["@bmkl/core", "BookmarkBuilder, loader, debug console, companion extension builder"],
  ["@bmkl/contracts", "typia-backed contracts for debug events, manifests, actions, and bridge messages"],
  ["@bmkl/runtime", "Shadow DOM, iframe, debug, action, and postMessage bridge helpers"],
  ["@bmkl/templates", "Versioned metadata and six framework-ready project templates"],
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
    command: "pnpm cli -- create my-agent --local --template lit-shadow",
    body: "TS-first component structure without TSX, with Web Components and Shadow DOM fitting bookmarklet isolation naturally.",
  },
  {
    name: "ttsc-shadow",
    badge: "Compiler",
    title: "ttsc Compiler Stack + Shadow DOM",
    command: "pnpm cli -- create my-agent --local --template ttsc-shadow",
    body: "A practical full-stack compiler example with @ttsc/lint, @ttsc/strip, @ttsc/paths, type emission, graph scripts, and the Vite unplugin path.",
  },
  {
    name: "solid-shadow",
    badge: "Fast UI",
    title: "Solid + Shadow DOM",
    command: "pnpm cli -- create my-agent --local --template solid-shadow",
    body: "Fine-grained UI for compact overlays. Keeps ttsc checks and graph scripts while leaving the JSX Vite transform alone.",
  },
  {
    name: "solid-query-shadow",
    badge: "TanStack",
    title: "Solid Query + Shadow DOM",
    command: "pnpm cli -- create my-agent --local --template solid-query-shadow",
    body: "Adds TanStack Query for cached page snapshots and refetch flows, with a clear path to API-backed panels when needed.",
  },
  {
    name: "react-shadow",
    badge: "React",
    title: "React + Shadow DOM",
    command: "pnpm cli -- create my-agent --local --template react-shadow",
    body: "Best when teams want to reuse React components or mirror an existing app workflow inside a bookmarklet.",
  },
  {
    name: "vanilla-shadow",
    badge: "Smallest",
    title: "Vanilla TS + Shadow DOM",
    command: "pnpm cli -- create my-agent --local --template vanilla-shadow",
    body: "The dependency-light baseline for page utilities, DOM actions, and tiny scripts where a framework is unnecessary.",
  },
];

const cliCommands = [
  {
    command: "pnpm cli -- create my-agent --local --template lit-shadow",
    detail: "Use the source workspace wrapper to scaffold the TS-first default template during pre-release.",
  },
  {
    command: "pnpm cli -- create my-agent --local --template solid-query-shadow",
    detail: "Start with TanStack Query when the bookmarklet needs cached async data.",
  },
  {
    command: "pnpm cli -- create my-agent --local --template ttsc-shadow",
    detail: "Use the compiler-aware template for lint diagnostics, strip transforms, path rewrites, and graph output.",
  },
  {
    command: "pnpm cli -- templates --json",
    detail: "Source checkout — list template metadata for docs, generators, and CI automation.",
  },
  {
    command: "pnpm exec bmkl dev --port 5173",
    detail: "Generated project — start Vite and open the local Setup page to drag or copy an install-once bookmarklet.",
  },
  {
    command: "pnpm exec bmkl dev --debug --target https://example.com",
    detail: "Generated project — add a debug installer to Setup, serve a local console, and collect target-site events.",
  },
  {
    command: "pnpm exec bmkl companion --target https://example.com --port 5173",
    detail: "Generated project — build an unpacked MV3 companion when strict CSP blocks bookmarklet delivery.",
  },
  {
    command: "pnpm e2e:debug",
    detail: "Source checkout — run bookmarklet debug and strict script-src companion fixtures.",
  },
  {
    command: "pnpm exec bmkl build --base-url https://cdn.example.com/",
    detail: "Generated project — build the remote loader, app, inline fallback, manifest, install page, and report.",
  },
  {
    command: "pnpm exec bmkl inspect",
    detail: "Generated project — check artifact sizes, bookmarklet length, manifest target, and CSP fallback warnings.",
  },
  {
    command: "pnpm exec bmkl doctor",
    detail: "Generated project — check entry files, ttsc setup, contracts, remote base URL, and artifacts.",
  },
  {
    command: "pnpm exec bmkl contracts validate-debug-report report.json",
    detail: "Generated project — validate copied debug reports against typia contracts.",
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
    "Run pnpm exec bmkl dev --debug --target <site>. BMKL serves Vite plus /__bmkl/debug on localhost.",
  ],
  [
    "2",
    "Install from Setup",
    "Open the printed local Setup URL and drag BMKL debug to your bookmarks bar once.",
  ],
  [
    "3",
    "Open the target site",
    "Visit the real page where the bookmarklet must run, then click BMKL debug in the bookmarks bar.",
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
    "Run pnpm exec bmkl dev --debug --target <site> so the localhost console and event collector stay available.",
  ],
  [
    "2",
    "Build the companion",
    "Run pnpm exec bmkl companion --target <site> --port 5173 to bundle the current entry into an unpacked extension.",
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

interface CopyCommandButtonProps {
  id: string;
  command: string;
  copied: boolean;
  onCopy(id: string, command: string): void | Promise<void>;
}

function CopyCommandButton(props: CopyCommandButtonProps) {
  return (
    <button
      class="copy-command"
      type="button"
      aria-label={`${props.copied ? "Copied" : "Copy"} command: ${props.command}`}
      onClick={() => props.onCopy(props.id, props.command)}
    >
      {props.copied ? <Check size={16} /> : <Copy size={16} />}
      <span>{props.copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

function App() {
  const [meta] = createResource<ProjectMeta>(async () => {
    try {
      const response = await fetch("/api/project");
      if (!response.ok) {
        throw new Error(`Project metadata request failed with ${response.status}`);
      }

      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Project metadata response was not JSON");
      }

      const projectMeta: unknown = await response.json();
      if (!isProjectMeta(projectMeta)) {
        throw new Error("Project metadata response had an unexpected shape");
      }

      return projectMeta;
    } catch (error) {
      console.warn(
        "[BMKL] Using local project metadata fallback:",
        error instanceof Error ? error.message : String(error),
      );
      return fallbackMeta;
    }
  });
  const [activeSection, setActiveSection] = createSignal<string | null>(null);
  const [navOpen, setNavOpen] = createSignal(false);
  const [copiedCommand, setCopiedCommand] = createSignal<string | null>(null);
  const [copyAnnouncement, setCopyAnnouncement] = createSignal("");
  let copyTimer: number | undefined;
  let navToggleButton: HTMLButtonElement | undefined;

  const copyCommand = async (id: string, command: string) => {
    try {
      await writeClipboard(command);
      setCopiedCommand(id);
      setCopyAnnouncement(`Copied command: ${command}`);
    } catch {
      setCopiedCommand(null);
      setCopyAnnouncement("Could not copy the command. Select and copy it manually.");
    }

    window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      setCopiedCommand(null);
      setCopyAnnouncement("");
    }, 2400);
  };

  onMount(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && navOpen()) {
        setNavOpen(false);
        navToggleButton?.focus();
      }
    };
    document.addEventListener("keydown", handleKeydown);

    const revealElements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    let revealObserver: IntersectionObserver | undefined;
    let sectionObserver: IntersectionObserver | undefined;
    let initialScrollFrame: number | undefined;

    if (!("IntersectionObserver" in window)) {
      revealElements.forEach((element) => element.setAttribute("data-reveal", "true"));
    } else {
      revealObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.setAttribute("data-reveal", "true");
              revealObserver?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.18 },
      );

      revealElements.forEach((element) => revealObserver?.observe(element));

      const sectionRatios = new Map<string, number>();
      sectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            sectionRatios.set(
              entry.target.id,
              entry.isIntersecting ? entry.intersectionRatio : 0,
            );
          }

          const visible = [...sectionRatios.entries()]
            .filter(([, ratio]) => ratio > 0)
            .sort((left, right) => right[1] - left[1])[0];
          setActiveSection(visible?.[0] ?? null);
        },
        {
          rootMargin: "-20% 0px -70% 0px",
          threshold: [0, 0.01],
        },
      );

      navItems.forEach(([id]) => {
        const section = document.getElementById(id);
        if (section) {
          sectionObserver?.observe(section);
        }
      });
    }

    const initialHash = decodeURIComponent(window.location.hash.slice(1));
    if (initialHash) {
      initialScrollFrame = window.requestAnimationFrame(() => {
        document.getElementById(initialHash)?.scrollIntoView();
      });
    }

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeydown);
      window.cancelAnimationFrame(initialScrollFrame ?? 0);
      revealObserver?.disconnect();
      sectionObserver?.disconnect();
    });
  });

  onCleanup(() => window.clearTimeout(copyTimer));

  return (
    <>
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>
      <header class="site-header" data-nav-open={navOpen() ? "true" : "false"}>
        <a class="brand" href="#top" aria-label="BMKL home">
          <Boxes size={22} />
          <span>BMKL</span>
        </a>
        <button
          ref={navToggleButton}
          class="nav-toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={navOpen()}
          aria-label={`${navOpen() ? "Close" : "Open"} navigation`}
          onClick={() => setNavOpen((open) => !open)}
        >
          {navOpen() ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav id="primary-navigation" aria-label="Primary">
          <ul>
            <For each={navItems}>
              {([id, label]) => (
                <li>
                  <a
                    href={`#${id}`}
                    classList={{ active: activeSection() === id }}
                    aria-current={activeSection() === id ? "location" : undefined}
                    onClick={() => setNavOpen(false)}
                  >
                    {label}
                  </a>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section id="top" class="hero" aria-labelledby="hero-heading">
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
            <p class="eyebrow">Pre-release · Vite-first BMKL</p>
            <h1 id="hero-heading">BMKL</h1>
            <p class="lede">
              Build bookmarklets as remote-updatable in-page apps with Vite,
              ttsc checks, and a typed runtime surface.
            </p>
            <p>
              Run the copied command from the root of an installed BMKL source
              checkout while packages are still pre-release.
            </p>
            <div class="hero-actions">
              <button
                class="primary-action"
                type="button"
                onClick={() => copyCommand("hero-create", defaultCreateCommand)}
              >
                {copiedCommand() === "hero-create" ? (
                  <Check size={18} />
                ) : (
                  <Copy size={18} />
                )}
                <span>
                  {copiedCommand() === "hero-create"
                    ? "Local command copied"
                    : "Copy local create command"}
                </span>
                <ArrowRight size={18} />
              </button>
              <a class="secondary-action" href="#packages">
                <FileCode2 size={18} />
                <span>View packages</span>
              </a>
            </div>
          </div>
        </section>

        <section
          id="workflow"
          class="workflow"
          aria-labelledby="workflow-heading"
          data-reveal
        >
          <div class="section-label">Workflow</div>
          <div class="section-heading">
            <h2 id="workflow-heading">
              One create path, one build path, six Vite templates.
            </h2>
            <p>
              Build the workspace packages once, then use the local create mode
              while BMKL is in pre-release. The generated project links back to
              this checkout and carries bmkl for dev, build, inspect, and doctor.
            </p>
          </div>
          <ol class="steps">
            <For each={workflow}>
              {(item) => {
                const Icon = item.icon;
                return (
                  <li class="step">
                    <div class="step-icon">
                      <Icon size={20} />
                    </div>
                    <div>
                      <h3>{item.title}</h3>
                      <code>{item.command}</code>
                      <p>{item.body}</p>
                    </div>
                  </li>
                );
              }}
            </For>
          </ol>
        </section>

        <section
          id="templates"
          class="templates"
          aria-labelledby="templates-heading"
          data-reveal
        >
          <div class="section-label">Templates</div>
          <div class="section-heading">
            <h2 id="templates-heading">Pick the smallest shape that matches the job.</h2>
            <p>
              BMKL keeps Query, React, and framework dependencies opt-in so
              ordinary bookmarklets stay lean while data-heavy tools still have
              a ready starter. Run <code>pnpm build:packages</code> once; the
              <code>--local</code> commands below then link each generated app
              to this checkout until the packages are published.
            </p>
          </div>
          <ul class="template-list">
            <For each={templates}>
              {(item) => (
                <li class="template-row">
                  <div class="template-meta">
                    <span>{item.badge}</span>
                    <h3>{item.title}</h3>
                  </div>
                  <div>
                    <code>{item.command}</code>
                    <p>{item.body}</p>
                  </div>
                  <strong>{item.name}</strong>
                </li>
              )}
            </For>
          </ul>
        </section>

        <section
          id="cli"
          class="cli-section"
          aria-labelledby="cli-heading"
          data-reveal
        >
          <div class="section-label">CLI</div>
          <div class="cli-layout">
            <div class="cli-copy">
              <h2 id="cli-heading">Create from source. Work with bmkl.</h2>
              <p>
                npm publishing has not started, so project generation currently
                uses the workspace wrapper with <code>--local</code>. That mode
                writes file dependencies and pnpm overrides for this checkout;
                the generated app then carries bmkl scripts for local dev,
                release artifacts, diagnostics, and install pages.
              </p>
              <div class="cli-badges" aria-label="CLI capabilities">
                <span>
                  <PackageCheck size={16} />
                  pre-release workspace
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

            <ul class="command-list" aria-label="BMKL CLI commands">
              <For each={cliCommands}>
                {(item, index) => (
                  <li class="command-row">
                    <div class="command-value">
                      <code>{item.command}</code>
                      <CopyCommandButton
                        id={`cli-${index()}`}
                        command={item.command}
                        copied={copiedCommand() === `cli-${index()}`}
                        onCopy={copyCommand}
                      />
                    </div>
                    <p>{item.detail}</p>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <div class="artifact-strip" aria-label="Generated artifacts">
            <div>
              <ScrollText size={18} />
              <span>Generated output</span>
            </div>
            <For each={artifacts}>{(artifact) => <code>{artifact}</code>}</For>
          </div>
        </section>

        <section
          id="debug"
          class="debug-section"
          aria-labelledby="debug-heading"
          data-reveal
        >
          <div class="section-label">Debug</div>
          <div class="debug-grid">
            <div class="debug-copy">
              <h2 id="debug-heading">
                Test on the real site without losing the failure trail.
              </h2>
              <p>
                The debug bookmarklet sends localhost events directly, mirrors
                them to a console window, and leaves an in-page overlay behind
                when a site blocks one of those paths. The local collector
                validates debug payloads through the contract layer before
                logging them.
              </p>
              <div class="debug-terminal" aria-label="Debug command">
                <code>pnpm exec bmkl dev --debug --target https://example.com</code>
                <code>pnpm exec bmkl companion --target https://example.com --port 5173</code>
                <code>Debug console: http://127.0.0.1:5173/__bmkl/debug</code>
                <code>Debug bookmarklet: javascript:(...)</code>
              </div>
            </div>
            <ol class="debug-flow" aria-label="Target-site debug flow">
              <For each={debugFlow}>
                {([step, title, body]) => (
                  <li>
                    <span>{step}</span>
                    <div>
                      <h3>{title}</h3>
                      <p>{body}</p>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </div>
          <table class="csp-matrix">
            <caption class="sr-only">CSP compatibility matrix</caption>
            <thead class="sr-only">
              <tr>
                <th scope="col">Policy</th>
                <th scope="col">Expected result</th>
                <th scope="col">Behavior</th>
              </tr>
            </thead>
            <tbody>
              <For each={cspMatrix}>
                {([policy, status, body]) => (
                  <tr>
                    <th scope="row">{policy}</th>
                    <td>
                      <strong>{status}</strong>
                    </td>
                    <td>
                      <p>{body}</p>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
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
            <ol class="companion-flow">
              <For each={companionFlow}>
                {([step, title, body]) => (
                  <li>
                    <span>{step}</span>
                    <div>
                      <h4>{title}</h4>
                      <p>{body}</p>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </section>

        <section
          id="packages"
          class="packages"
          aria-labelledby="packages-heading"
          data-reveal
        >
          <div class="section-label">Packages</div>
          <div class="package-grid">
            <div class="package-lead">
              <h2 id="packages-heading">Vite builds fast. ttsc keeps watch.</h2>
              <p>
                BMKL keeps bundling, type checks, generated contracts, action
                bridge helpers, optional compiler plugins, graph output, and
                runtime mounting in separate packages. This package split is
                tested locally but is not available from npm yet.
              </p>
              <div class="meta-line">
                <ShieldCheck size={18} />
                <span>{meta()?.runtime ?? "Cloudflare Pages advanced mode"}</span>
              </div>
            </div>
            <ul class="package-list">
              <For each={packages}>
                {([name, body]) => (
                  <li>
                    <h3>{name}</h3>
                    <p>{body}</p>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </section>

        <section
          id="deploy"
          class="deploy"
          aria-labelledby="deploy-heading"
          data-reveal
        >
          <div>
            <div class="section-label">Deploy</div>
            <h2 id="deploy-heading">Ready for Cloudflare Pages.</h2>
            <p>
              The site ships with advanced mode so `/api/project` can run at
              the edge while static assets remain cache-friendly.
            </p>
            <a
              class="deploy-action"
              href={cloudflarePagesGuideUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Read the Cloudflare Pages deployment guide (opens in a new tab)"
            >
              <span>Read the deployment guide</span>
              <ExternalLink size={18} />
            </a>
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
      <div class="sr-only" role="status" aria-live="polite">
        {copyAnnouncement()}
      </div>
    </>
  );
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function isProjectMeta(value: unknown): value is ProjectMeta {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.cli === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.runtime === "string" &&
    Array.isArray(candidate.packages) &&
    candidate.packages.every((item) => typeof item === "string")
  );
}

const root = document.getElementById("root");
if (!(root instanceof HTMLElement)) {
  throw new Error("BMKL could not find the #root mount element");
}

document.documentElement.classList.add("js");
render(() => <App />, root);
