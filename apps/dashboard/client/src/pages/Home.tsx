/** Design reminder: Monochrome Control Plane — a project-first workbench where human and agent workflows share the same compact configuration language. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowUpRight,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Clipboard,
  Code2,
  Command,
  Ellipsis,
  ExternalLink,
  FileJson,
  FolderKey,
  Github,
  Globe2,
  KeyRound,
  LayoutGrid,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Terminal,
  UsersRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const logoUrl = "/brand/nexuss-auth-orbit-logo.png";
const heroUrl = "/brand/nexuss-auth-controlplane-hero.png";
const providerFieldUrl = "/brand/nexuss-auth-provider-field.png";
const agentOrbitUrl = "/brand/nexuss-auth-agent-orbit.png";

type Project = {
  id: string;
  name: string;
  homepage: string;
  redirect: string;
  description: string;
  initials: string;
};

const initialProjects: Project[] = [
  {
    id: "nexuss-auth",
    name: "Nexuss-auth",
    homepage: "https://nexuss-auth.vercel.app",
    redirect: "https://nexuss-auth.vercel.app/oauth/callback",
    description: "The central identity system for portable, agent-native authentication.",
    initials: "NA",
  },
  {
    id: "customer-dashboard",
    name: "Customer Dashboard",
    homepage: "https://dashboard.example.com",
    redirect: "https://dashboard.example.com/auth/callback",
    description: "Customer-facing access for a product dashboard.",
    initials: "CD",
  },
];

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">{children}</p>;
}

function ProviderToggle({
  label,
  detail,
  active,
  onChange,
  icon,
}: {
  label: string;
  detail: string;
  active: boolean;
  onChange: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      aria-pressed={active}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition duration-200 active:scale-[0.99] ${
        active ? "border-white/25 bg-white/[0.08]" : "border-white/[0.08] bg-white/[0.025] hover:border-white/20"
      }`}
    >
      <span className={`grid size-10 place-items-center rounded-xl ${active ? "bg-white text-black" : "bg-white/10 text-white/65"}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">Continue with {label}</span>
        <span className="mt-0.5 block truncate text-xs text-white/45">{detail}</span>
      </span>
      <span className={`relative h-6 w-11 rounded-full border transition ${active ? "border-white bg-white" : "border-white/20 bg-black"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full transition ${active ? "left-[21px] bg-black" : "left-0.5 bg-white/55"}`} />
      </span>
    </button>
  );
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [selectedId, setSelectedId] = useState(initialProjects[0].id);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [githubEnabled, setGithubEnabled] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [integrationMode, setIntegrationMode] = useState<"SDK" | "CLI" | "API">("SDK");
  const [draft, setDraft] = useState({ name: "", homepage: "", redirect: "" });

  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? projects[0], [projects, selectedId]);

  const codeByMode = {
    SDK: `import { createAuth } from "nexuss-auth";\n\nconst auth = createAuth({\n  authUrl: "https://nexuss-auth.vercel.app",\n  projectId: "${selected.id}",\n});\n\nawait auth.signInWithGoogle();`,
    CLI: `nexuss-auth project create \\\n+  --name "${selected.name}" \\\n+  --home "${selected.homepage}" \\\n+  --redirect "${selected.redirect}" \\\n+  --provider google --provider github`,
    API: `POST /v1/projects\nAuthorization: Bearer $NEXUSS_ADMIN_TOKEN\n\n{\n  "name": "${selected.name}",\n  "homepageUrl": "${selected.homepage}",\n  "redirectUris": ["${selected.redirect}"],\n  "providers": ["google", "github"]\n}`,
  };
  const activeCode = integrationMode === "CLI" ? codeByMode.CLI.replace(/\n\+/g, "\n") : codeByMode[integrationMode];

  const createProject = () => {
    if (!draft.name.trim() || !draft.homepage.trim() || !draft.redirect.trim()) {
      toast.error("Add a project name, home URL, and redirect URL.");
      return;
    }
    const id = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const project: Project = {
      id,
      name: draft.name.trim(),
      homepage: draft.homepage.trim(),
      redirect: draft.redirect.trim(),
      description: "New project configuration. Add a description in Branding.",
      initials: draft.name.trim().split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    };
    setProjects((current) => [...current, project]);
    setSelectedId(project.id);
    setDraft({ name: "", homepage: "", redirect: "" });
    setNewProjectOpen(false);
    toast.success("Project draft created in this workspace.");
  };

  const copy = (value: string, label: string) => {
    void navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white selection:bg-white selection:text-black">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[278px] flex-col border-r border-white/10 bg-[#080808] px-5 py-5 lg:flex">
        <div className="flex items-center gap-3 px-2">
          <img src={logoUrl} alt="Nexuss-auth" className="size-10 rounded-xl object-cover" />
          <div>
            <p className="text-sm font-bold tracking-[-0.04em]">Nexuss-auth</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Control plane</p>
          </div>
        </div>

        <button className="mt-8 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 text-left transition hover:bg-white/[0.08]">
          <span>
            <span className="block text-xs font-semibold">Nexuss workspace</span>
            <span className="mt-0.5 block font-mono text-[10px] text-white/40">agent-ready · local mode</span>
          </span>
          <ChevronDown className="size-4 text-white/45" />
        </button>

        <nav className="mt-8 space-y-1">
          <a className="flex items-center gap-3 rounded-lg bg-white text-sm font-semibold text-black px-3 py-2.5" href="#projects">
            <LayoutGrid className="size-4" /> Projects
          </a>
          <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white" href="#integration">
            <Code2 className="size-4" /> Integration
          </a>
          <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/55 transition hover:bg-white/[0.06] hover:text-white" href="#agent">
            <Bot className="size-4" /> Agent access
          </a>
        </nav>

        <div id="projects" className="mt-9">
          <div className="mb-3 flex items-center justify-between px-2">
            <SectionLabel>Projects</SectionLabel>
            <button onClick={() => setNewProjectOpen(true)} className="-mt-3 grid size-6 place-items-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white" aria-label="Create project">
              <Plus className="size-4" />
            </button>
          </div>
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => setSelectedId(project.id)}
                className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition ${selectedId === project.id ? "bg-white/[0.10]" : "hover:bg-white/[0.045]"}`}
              >
                <span className="grid size-8 place-items-center rounded-lg bg-white/10 font-mono text-[10px] text-white/75">{project.initials}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{project.name}</span>
                  <span className="block truncate font-mono text-[10px] text-white/35">{project.id}</span>
                </span>
                {selectedId === project.id && <span className="size-1.5 rounded-full bg-white" />}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-4" /> Default by design</div>
          <p className="mt-2 text-xs leading-5 text-white/45">Google and GitHub are enabled when a new project is created. Open Advanced only when the defaults are not enough.</p>
        </div>
      </aside>

      <main className="lg:pl-[278px]">
        <header className="sticky top-0 z-10 flex h-[74px] items-center justify-between border-b border-white/10 bg-[#050505]/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <img src={logoUrl} alt="Nexuss-auth" className="size-9 rounded-lg object-cover lg:hidden" />
            <div className="hidden items-center gap-2 text-xs text-white/45 sm:flex"><span>Projects</span><ChevronRight className="size-3" /><span className="text-white">{selected.name}</span></div>
            <p className="text-sm font-semibold sm:hidden">{selected.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 font-mono text-[10px] text-white/50 sm:flex"><span className="size-1.5 rounded-full bg-white" /> local preview</span>
            <Button onClick={() => setNewProjectOpen(true)} className="h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-white/90"><CirclePlus className="mr-1.5 size-4" /> New project</Button>
          </div>
        </header>

        <div className="relative mr-auto max-w-[1520px] border-l border-white/[0.07] px-5 py-8 sm:px-8 lg:px-10 xl:pr-16">
          <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
          <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Project configuration</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="grid size-14 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-black"><img src={logoUrl} alt="Project avatar" className="size-full object-cover" /></span>
                <div>
                  <h1 className="text-3xl font-extrabold tracking-[-0.065em] sm:text-4xl">{selected.name}</h1>
                  <p className="mt-1 font-mono text-xs text-white/45">project/{selected.id}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => copy(selected.id, "Project ID")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/12 px-3 text-xs text-white/70 transition hover:bg-white/10"><Clipboard className="size-3.5" /> Copy ID</button>
              <button onClick={() => toast.info("Project activity is available when the dashboard is connected to the Nexuss-auth API.")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/12 px-3 text-xs text-white/70 transition hover:bg-white/10"><Ellipsis className="size-3.5" /> More</button>
            </div>
          </section>

          <section className="mt-8 overflow-hidden rounded-[18px] border border-white/[0.14] bg-[#0b0b0b]">
            <div className="relative min-h-[250px] overflow-hidden px-6 py-7 sm:px-9 sm:py-9">
              <img src={heroUrl} alt="Abstract Nexuss-auth control-plane topology" className="absolute inset-0 size-full object-cover opacity-75" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#080808] via-[#080808]/90 to-[#080808]/25" />
              <div className="relative max-w-xl">
                <span className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/75"><ShieldCheck className="size-3.5" /> Configuration ready</span>
                <h2 className="mt-5 max-w-md text-3xl font-extrabold leading-[0.98] tracking-[-0.06em] sm:text-4xl">Create a project, not another auth stack.</h2>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/60">Give an app a name, its trusted URLs, and the providers it needs. The SDK and CLI inherit the same project definition.</p>
                <div className="mt-6 flex flex-wrap gap-2 font-mono text-[10px] text-white/55"><span className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1.5">ROUTE: GOOGLE {googleEnabled ? "ACTIVE" : "OFF"}</span><span className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1.5">ROUTE: GITHUB {githubEnabled ? "ACTIVE" : "OFF"}</span><span className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1.5">PKCE: READY</span></div>
              </div>
            </div>
          </section>

          <div className="mt-8 grid gap-8 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-8">
              <section className="workflow-sheet">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><SectionLabel>01 · identity</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">Project details</h2><p className="mt-1 text-sm text-white/45">The information people recognize before they authorize access.</p></div>
                  <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] text-white/45">default path</span>
                </div>
                <div className="mt-7 grid gap-5 md:grid-cols-2">
                  <label className="field-label">Project name<Input defaultValue={selected.name} className="field-input" /></label>
                  <label className="field-label">Homepage URL<Input defaultValue={selected.homepage} className="field-input" /></label>
                  <label className="field-label md:col-span-2">Redirect URL<Input defaultValue={selected.redirect} className="field-input font-mono text-xs" /></label>
                </div>
              </section>

              <section className="workflow-sheet overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><SectionLabel>02 · providers</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">Enable what users already trust</h2><p className="mt-1 text-sm text-white/45">Both methods start enabled. Turn off any provider that does not belong in this project.</p></div>
                  <img src={providerFieldUrl} alt="Abstract provider signal paths" className="hidden h-16 w-24 rounded-xl object-cover opacity-80 sm:block" />
                </div>
                <div className="mt-7 grid gap-3 md:grid-cols-2">
                  <ProviderToggle label="Google" detail="Default provider · OAuth 2.0" active={googleEnabled} onChange={() => setGoogleEnabled((value) => !value)} icon={<span className="font-bold">G</span>} />
                  <ProviderToggle label="GitHub" detail="Default provider · OAuth 2.0" active={githubEnabled} onChange={() => setGithubEnabled((value) => !value)} icon={<Github className="size-5" />} />
                </div>
                <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="mt-6 flex w-full items-center justify-between border-t border-white/10 pt-5 text-left text-xs font-medium text-white/60 transition hover:text-white"><span className="flex items-center gap-2"><Settings2 className="size-4" /> Advanced provider controls</span>{advancedOpen ? <X className="size-4" /> : <Plus className="size-4" />}</button>
                {advancedOpen && <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/55">Scope restrictions, account-linking rules, custom OIDC providers, and environment overrides will appear here. The default configuration remains intentionally small.</div>}
              </section>

              <section className="workflow-sheet">
                <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl overflow-hidden bg-black border border-white/15"><img src={logoUrl} alt="Nexuss-auth project avatar" className="size-full object-cover" /></span><div><SectionLabel>03 · branding</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">The project tells users why it needs access</h2><p className="mt-1 text-sm text-white/45">Use the Nexuss-auth mark by default, then add a clear project description.</p></div></div>
                <label className="field-label mt-7">Description<Textarea defaultValue={selected.description} className="field-input min-h-24 resize-none leading-6" /></label>
              </section>

              <section id="integration" className="workflow-sheet">
                <div className="flex flex-wrap items-center justify-between gap-4"><div><SectionLabel>04 · portability</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">One project definition. Every workflow.</h2></div><div className="flex rounded-lg border border-white/10 bg-black p-1">{(["SDK", "CLI", "API"] as const).map((mode) => <button key={mode} onClick={() => setIntegrationMode(mode)} className={`rounded-md px-3 py-1.5 font-mono text-[10px] transition ${integrationMode === mode ? "bg-white text-black" : "text-white/45 hover:text-white"}`}>{mode}</button>)}</div></div>
                <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{integrationMode} setup</span><button onClick={() => copy(activeCode, `${integrationMode} setup`)} className="inline-flex items-center gap-1.5 text-xs text-white/60 transition hover:text-white"><Clipboard className="size-3.5" /> Copy</button></div><pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-white/80"><code>{activeCode}</code></pre></div>
              </section>
            </div>

            <aside className="space-y-6">
              <section id="agent" className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.035]">
                <img src={agentOrbitUrl} alt="Abstract agent navigating an identity orbit" className="h-40 w-full object-cover opacity-85" />
                <div className="p-5"><div className="flex items-center gap-2"><Bot className="size-4" /><span className="text-sm font-bold">Agent-native controls</span></div><p className="mt-2 text-xs leading-5 text-white/50">Every visible project setting maps to a portable command. Let an agent create, update, inspect, or export a project without visiting this dashboard.</p><button onClick={() => copy(`nexuss-auth project inspect --id ${selected.id} --format json`, "Agent command")} className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] text-white/70 hover:text-white"><Terminal className="size-3.5" /> Copy inspect command</button></div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-5">
                <SectionLabel>Access surface</SectionLabel>
                <div className="space-y-4">
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><Globe2 className="size-4" /></span><div><p className="text-xs font-semibold">Homepage</p><a className="mt-1 flex items-center gap-1 break-all text-xs text-white/45 hover:text-white" href={selected.homepage} target="_blank" rel="noreferrer">{selected.homepage}<ExternalLink className="size-3 shrink-0" /></a></div></div>
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><KeyRound className="size-4" /></span><div><p className="text-xs font-semibold">Redirect allowlist</p><p className="mt-1 break-all font-mono text-[10px] leading-4 text-white/45">{selected.redirect}</p></div></div>
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><UsersRound className="size-4" /></span><div><p className="text-xs font-semibold">User identity</p><p className="mt-1 text-xs text-white/45">Shared across approved projects</p></div></div>
                </div>
              </section>

              <section className="rounded-[18px] border border-white/15 bg-black p-5"><div className="flex items-center gap-2 text-sm font-bold"><Command className="size-4" /> Keep the simple path simple.</div><p className="mt-2 text-xs leading-5 text-white/50">Project name, trusted URLs, and two default providers are enough to begin. Everything else is an optional layer.</p><button onClick={() => setAdvancedOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-white/90">Open advanced controls <ArrowUpRight className="size-3.5" /></button></section>
            </aside>
          </div>
        </div>
      </main>

      {newProjectOpen && <div className="fixed inset-0 z-30 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[28px] border border-white/15 bg-[#0d0d0d] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><SectionLabel>New project</SectionLabel><h2 className="text-2xl font-bold tracking-[-0.05em]">Create a portable auth project.</h2></div><button onClick={() => setNewProjectOpen(false)} className="rounded-lg p-2 text-white/55 hover:bg-white/10 hover:text-white"><X className="size-5" /></button></div><div className="mt-7 space-y-4"><label className="field-label">Project name<Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Product dashboard" className="field-input" /></label><label className="field-label">Homepage URL<Input value={draft.homepage} onChange={(event) => setDraft((current) => ({ ...current, homepage: event.target.value }))} placeholder="https://product.example.com" className="field-input" /></label><label className="field-label">Redirect URL<Input value={draft.redirect} onChange={(event) => setDraft((current) => ({ ...current, redirect: event.target.value }))} placeholder="https://product.example.com/auth/callback" className="field-input font-mono text-xs" /></label></div><div className="mt-7 flex items-center justify-between gap-3"><p className="max-w-[230px] text-xs leading-5 text-white/40">Google and GitHub start enabled. You can adjust providers after creation.</p><Button onClick={createProject} className="bg-white text-black hover:bg-white/90"><FolderKey className="mr-1.5 size-4" /> Create project</Button></div></div></div>}
    </div>
  );
}
