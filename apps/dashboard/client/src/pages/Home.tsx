/** Design reminder: Monochrome Control Plane — a project-first workbench where human and agent workflows share the same compact configuration language. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ManagementError, beginDashboardSignIn, createManagedProject, listManagedProjects, updateManagedProject, type ManagedProject, type Provider } from "@/lib/management";
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
import { useEffect, useMemo, useState } from "react";
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
  avatarUrl: string | null;
  enabledProviders: Provider[];
  status: "active" | "disabled";
};

function projectFromManaged(project: ManagedProject): Project {
  return {
    id: project.projectId,
    name: project.name,
    homepage: project.homepageUrl,
    redirect: project.allowedRedirectUris[0] ?? project.homepageUrl,
    description: project.description,
    initials: project.name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
    avatarUrl: project.avatarUrl,
    enabledProviders: project.enabledProviders,
    status: project.status,
  };
}

  const emptyProject: Project = {
  id: "",
  name: "Your projects",
  homepage: "",
  redirect: "",
  description: "Create a project to begin.",
  initials: "--",
  avatarUrl: null,
  enabledProviders: [],
  status: "active",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">{children}</p>;
}

function ProviderToggle({
  label,
  detail,
  active,
  onChange,
  icon,
  disabled = false,
}: {
  label: string;
  detail: string;
  active: boolean;
  onChange: () => void;
  icon: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onChange}
      aria-pressed={active}
      className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition duration-200 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 ${
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [integrationMode, setIntegrationMode] = useState<"SDK" | "CLI" | "API">("SDK");
  const [draft, setDraft] = useState({ name: "", homepage: "", redirect: "" });
  const [apiState, setApiState] = useState<"loading" | "connected" | "unauthorized" | "offline">("loading");
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => projects.find((project) => project.id === selectedId) ?? projects[0] ?? emptyProject, [projects, selectedId]);
  const openProjectForm = () => {
    if (apiState === "unauthorized") {
      toast.info("Sign in to create a project.");
      return;
    }
    setNewProjectOpen(true);
  };
  const [details, setDetails] = useState({ name: selected.name, homepage: selected.homepage, redirect: selected.redirect, description: selected.description });
  const googleEnabled = selected.enabledProviders.includes("google");
  const githubEnabled = selected.enabledProviders.includes("github");
  const hasProject = Boolean(selected.id);

  useEffect(() => {
    void listManagedProjects()
      .then((records) => {
        if (records.length > 0) {
          const nextProjects = records.map(projectFromManaged);
          setProjects(nextProjects);
          setSelectedId(nextProjects[0]?.id ?? selectedId);
        }
        setApiState("connected");
      })
      .catch((error: unknown) => setApiState(error instanceof ManagementError && error.status === 401 ? "unauthorized" : "offline"));
  }, []);

  useEffect(() => {
    setDetails({ name: selected.name, homepage: selected.homepage, redirect: selected.redirect, description: selected.description });
  }, [selected.id]);

  const codeByMode = {
    SDK: `import { createAuth } from "nexuss-auth";\n\nconst auth = createAuth({\n  authUrl: "https://nexuss-auth.vercel.app",\n  projectId: "${selected.id}",\n});\n\nawait auth.signInWithGoogle();`,
    CLI: `nexuss-auth project create \\\n+  --name "${selected.name}" \\\n+  --home "${selected.homepage}" \\\n+  --redirect "${selected.redirect}" \\\n+  --provider google --provider github`,
    API: `POST /v1/projects\nAuthorization: Bearer $NEXUSS_ADMIN_TOKEN\n\n{\n  "name": "${selected.name}",\n  "homepageUrl": "${selected.homepage}",\n  "redirectUris": ["${selected.redirect}"],\n  "providers": ["google", "github"]\n}`,
  };
  const activeCode = integrationMode === "CLI" ? codeByMode.CLI.replace(/\n\+/g, "\n") : codeByMode[integrationMode];

  const saveProject = async () => {
    if (!hasProject) {
      toast.info("Create a project before saving settings.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateManagedProject(selected.id, {
        name: details.name.trim(),
        homepageUrl: details.homepage.trim(),
        allowedRedirectUris: [details.redirect.trim()],
        description: details.description.trim(),
      });
      const next = projectFromManaged(updated);
      setProjects((current) => current.map((project) => project.id === next.id ? next : project));
      toast.success("Project configuration saved.");
    } catch (error) {
      toast.error(error instanceof ManagementError && error.status === 401 ? "Sign in as an owner before saving projects." : "Unable to save the project configuration.");
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (provider: Provider) => {
    if (!hasProject) {
      toast.info("Create a project before changing providers.");
      return;
    }
    const enabledProviders = selected.enabledProviders.includes(provider) ? selected.enabledProviders.filter((item) => item !== provider) : [...selected.enabledProviders, provider];
    setSaving(true);
    try {
      const updated = await updateManagedProject(selected.id, { enabledProviders });
      const next = projectFromManaged(updated);
      setProjects((current) => current.map((project) => project.id === next.id ? next : project));
      toast.success(`${provider === "google" ? "Google" : "GitHub"} provider ${enabledProviders.includes(provider) ? "enabled" : "disabled"}.`);
    } catch (error) {
      toast.error(error instanceof ManagementError && error.status === 401 ? "Sign in as an owner before changing providers." : "Unable to update provider settings.");
    } finally {
      setSaving(false);
    }
  };

  const createProject = async () => {
    if (!draft.name.trim() || !draft.homepage.trim() || !draft.redirect.trim()) {
      toast.error("Add a project name, home URL, and redirect URL.");
      return;
    }
    const id = draft.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    setSaving(true);
    try {
      const created = await createManagedProject({ projectId: id, name: draft.name.trim(), homepageUrl: draft.homepage.trim(), description: "", avatarUrl: null, allowedRedirectUris: [draft.redirect.trim()], allowedOrigins: [new URL(draft.redirect.trim()).origin], enabledProviders: ["google", "github"], status: "active" });
      const project = projectFromManaged(created);
      setProjects((current) => [...current, project]);
      setSelectedId(project.id);
      setCreatedProjectId(project.id);
      setDraft({ name: "", homepage: "", redirect: "" });
      setNewProjectOpen(false);
      toast.success("Project saved.");
    } catch (error) {
      toast.error(error instanceof ManagementError && error.status === 401 ? "Sign in to create a project." : "Unable to save this project. Check the URLs and try again.");
    } finally {
      setSaving(false);
    }
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
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">Authentication</p>
          </div>
        </div>

        <button className="mt-8 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.045] px-3 py-3 text-left transition hover:bg-white/[0.08]">
            <span>
            <span className="block text-xs font-semibold">Your workspace</span>
            <span className="mt-0.5 block font-mono text-[10px] text-white/40">Projects and sign-in settings</span>
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
        </nav>

        <div id="projects" className="mt-9">
          <div className="mb-3 flex items-center justify-between px-2">
            <SectionLabel>Projects</SectionLabel>
            <button onClick={openProjectForm} className="-mt-3 grid size-6 place-items-center rounded-md text-white/50 transition hover:bg-white/10 hover:text-white" aria-label="Create project">
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
          <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-4" /> Simple by default</div>
          <p className="mt-2 text-xs leading-5 text-white/45">Google and GitHub are enabled when a project is created. Adjust them only when needed.</p>
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
            {apiState === "unauthorized" && <><button onClick={() => beginDashboardSignIn("google")} className="hidden rounded-md border border-white/15 px-3 py-2 text-xs text-white/75 hover:bg-white/10 sm:block">Sign in with Google</button><button onClick={() => beginDashboardSignIn("github")} className="hidden rounded-md border border-white/15 px-3 py-2 text-xs text-white/75 hover:bg-white/10 sm:block">Sign in with GitHub</button></>}
            {apiState === "connected" && <Button onClick={openProjectForm} className="h-9 rounded-lg bg-white px-3 text-xs font-semibold text-black hover:bg-white/90"><CirclePlus className="mr-1.5 size-4" /> New project</Button>}
          </div>
        </header>

        <div className="relative mr-auto max-w-[1520px] border-l border-white/[0.07] px-5 py-8 sm:px-8 lg:px-10 xl:pr-16">
          <div className="pointer-events-none absolute bottom-0 left-0 top-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
          {apiState === "unauthorized" ? <section className="mt-8 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.025]"><div className="grid min-h-[520px] lg:grid-cols-[0.8fr_1.2fr]"><div className="relative flex flex-col justify-between border-b border-white/10 bg-[#080808] p-7 sm:p-10 lg:border-b-0 lg:border-r"><div><div className="flex items-center gap-3"><img src={logoUrl} alt="Nexuss-auth" className="size-12 rounded-xl object-cover" /><div><p className="text-lg font-bold tracking-[-0.05em]">Nexuss-auth</p><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">Authentication</p></div></div><p className="mt-16 max-w-xs font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Workspace entry / 01</p><h1 className="mt-4 max-w-sm text-4xl font-extrabold leading-[0.98] tracking-[-0.07em] sm:text-5xl">Authorize your workspace.</h1><p className="mt-5 max-w-sm text-sm leading-6 text-white/50">Create and manage the sign-in surface for every project you own.</p></div><div className="mt-12 grid grid-cols-2 gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-white/40"><span className="border-t border-white/15 pt-3">Private projects</span><span className="border-t border-white/15 pt-3">One account</span></div></div><div className="flex flex-col justify-center p-7 sm:p-10"><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Continue with a provider</p><h2 className="mt-3 text-2xl font-bold tracking-[-0.05em]">Enter your workspace</h2><p className="mt-3 max-w-sm text-sm leading-6 text-white/50">Your projects and settings are private to your account. Choose a provider to continue.</p><div className="mt-8 grid max-w-md gap-3"><Button onClick={() => beginDashboardSignIn("google")} className="h-12 justify-between bg-white px-4 text-black hover:bg-white/90"><span className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-black text-sm font-bold text-white">G</span>Authorize with Google</span><ArrowUpRight className="size-4" /></Button><Button onClick={() => beginDashboardSignIn("github")} variant="outline" className="h-12 justify-between border-white/20 bg-transparent px-4 text-white hover:bg-white/10"><span className="flex items-center gap-3"><span className="grid size-7 place-items-center rounded-md bg-white text-black"><Github className="size-4" /></span>Authorize with GitHub</span><ArrowUpRight className="size-4" /></Button></div><p className="mt-8 max-w-sm border-t border-white/10 pt-4 font-mono text-[10px] leading-5 text-white/35">Access is scoped to your account. Nexuss-auth never exposes another user’s projects.</p></div></div></section> : <>
          <section className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Project</p>
              <div className="mt-3 flex items-center gap-3">
                <span className="grid size-14 place-items-center overflow-hidden rounded-2xl border border-white/15 bg-black"><img src={logoUrl} alt="Project avatar" className="size-full object-cover" /></span>
                <div>
                  <h1 className="text-3xl font-extrabold tracking-[-0.065em] sm:text-4xl">{selected.name}</h1>
                  <span className="mt-1 font-mono text-xs text-white/45">{selected.id}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => copy(selected.id, "Project ID")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/12 px-3 text-xs text-white/70 transition hover:bg-white/10"><Clipboard className="size-3.5" /> Copy ID</button>
              <button onClick={() => void saveProject()} disabled={saving || !hasProject} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/12 px-3 text-xs text-white/70 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"><Check className="size-3.5" /> {saving ? "Saving" : "Save project"}</button>
            </div>
          </section>

          {apiState === "connected" && projects.length === 0 && <section className="mt-8 border border-dashed border-white/20 bg-white/[0.025] p-5 sm:p-6"><SectionLabel>Empty workspace</SectionLabel><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold tracking-[-0.04em]">No projects yet.</h2><p className="mt-1 text-sm leading-6 text-white/50">Create your first project and Nexuss-auth will assign it to your signed-in account automatically.</p></div><Button onClick={openProjectForm} className="bg-white text-black hover:bg-white/90"><CirclePlus className="mr-1.5 size-4" /> Create project</Button></div></section>}
          {apiState === "offline" && <section className="mt-8 border border-white/15 bg-white/[0.045] p-5"><SectionLabel>Unavailable</SectionLabel><p className="text-sm text-white/60">Projects could not be loaded. Check your connection and try again.</p></section>}
          {createdProjectId && <section className="mt-8 flex flex-col gap-4 border border-white/20 bg-white p-5 text-black sm:flex-row sm:items-center sm:justify-between sm:p-6"><div><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-black/45">Saved</p><h2 className="mt-1 text-xl font-bold tracking-[-0.04em]">Your project is ready.</h2><p className="mt-1 text-sm text-black/60">Review its settings below or continue with the integration details.</p></div><button onClick={() => setCreatedProjectId(null)} className="inline-flex h-9 items-center justify-center rounded-lg border border-black/15 px-3 text-xs font-semibold transition hover:bg-black/5">Continue</button></section>}

          <section className="mt-8 overflow-hidden rounded-[18px] border border-white/[0.14] bg-[#0b0b0b]">
            <div className="relative min-h-[250px] overflow-hidden px-6 py-7 sm:px-9 sm:py-9">
              <img src={heroUrl} alt="Abstract Nexuss-auth control-plane topology" className="absolute inset-0 size-full object-cover opacity-75" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#080808] via-[#080808]/90 to-[#080808]/25" />
              <div className="relative max-w-xl">
                <span className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-black/30 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-white/75"><ShieldCheck className="size-3.5" /> Simple setup</span>
                <h2 className="mt-5 max-w-md text-3xl font-extrabold leading-[0.98] tracking-[-0.06em] sm:text-4xl">One project for every sign-in.</h2>
                <p className="mt-4 max-w-lg text-sm leading-6 text-white/60">Give an app a name, its trusted URLs, and the providers it needs. The SDK and CLI inherit the same project definition.</p>
                <div className="mt-6 flex flex-wrap gap-2 font-mono text-[10px] text-white/55"><span className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1.5">GOOGLE {googleEnabled ? "ON" : "OFF"}</span><span className="rounded-md border border-white/15 bg-black/25 px-2.5 py-1.5">GITHUB {githubEnabled ? "ON" : "OFF"}</span></div>
              </div>
            </div>
          </section>

          <div className="mt-8 grid gap-8 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-8">
              <section className="workflow-sheet">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><SectionLabel>Details</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">Project details</h2><p className="mt-1 text-sm text-white/45">The information people recognize before they authorize access.</p></div>

                </div>
                <div className="mt-7 grid gap-5 md:grid-cols-2">
                  <label className="field-label">Project name<Input value={details.name} onChange={(event) => setDetails((current) => ({ ...current, name: event.target.value }))} className="field-input" /></label>
                  <label className="field-label">Homepage URL<Input value={details.homepage} onChange={(event) => setDetails((current) => ({ ...current, homepage: event.target.value }))} className="field-input" /></label>
                  <label className="field-label md:col-span-2">Redirect URL<Input value={details.redirect} onChange={(event) => setDetails((current) => ({ ...current, redirect: event.target.value }))} className="field-input font-mono text-xs" /></label>
                </div>
              </section>

              <section className="workflow-sheet overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div><SectionLabel>Sign-in</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">Enable what users already trust</h2><p className="mt-1 text-sm text-white/45">Both methods start enabled. Turn off any provider that does not belong in this project.</p></div>
                  <img src={providerFieldUrl} alt="Abstract provider signal paths" className="hidden h-16 w-24 rounded-xl object-cover opacity-80 sm:block" />
                </div>
                <div className="mt-7 grid gap-3 md:grid-cols-2">
                  <ProviderToggle disabled={!hasProject || saving} label="Google" detail="Default provider · OAuth 2.0" active={googleEnabled} onChange={() => void toggleProvider("google")} icon={<span className="font-bold">G</span>} />
                  <ProviderToggle disabled={!hasProject || saving} label="GitHub" detail="Default provider · OAuth 2.0" active={githubEnabled} onChange={() => void toggleProvider("github")} icon={<Github className="size-5" />} />
                </div>
                <button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="mt-6 flex w-full items-center justify-between border-t border-white/10 pt-5 text-left text-xs font-medium text-white/60 transition hover:text-white"><span className="flex items-center gap-2"><Settings2 className="size-4" /> Advanced provider controls</span>{advancedOpen ? <X className="size-4" /> : <Plus className="size-4" />}</button>
                {advancedOpen && <div className="mt-4 rounded-xl border border-white/10 bg-black/30 p-4 text-sm text-white/55">Scope restrictions, account-linking rules, custom OIDC providers, and environment overrides will appear here. The default configuration remains intentionally small.</div>}
              </section>

              <section className="workflow-sheet">
                <div className="flex items-start gap-4"><span className="grid size-12 shrink-0 place-items-center rounded-2xl overflow-hidden bg-black border border-white/15"><img src={logoUrl} alt="Nexuss-auth project avatar" className="size-full object-cover" /></span><div><SectionLabel>Branding</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">The project tells users why it needs access</h2><p className="mt-1 text-sm text-white/45">Use the Nexuss-auth mark by default, then add a clear project description.</p></div></div>
                <label className="field-label mt-7">Description<Textarea value={details.description} onChange={(event) => setDetails((current) => ({ ...current, description: event.target.value }))} className="field-input min-h-24 resize-none leading-6" /></label>
              </section>

              <section id="integration" className="workflow-sheet">
                <div className="flex flex-wrap items-center justify-between gap-4"><div><SectionLabel>Integration</SectionLabel><h2 className="text-xl font-bold tracking-[-0.04em]">One project definition. Every workflow.</h2></div><div className="flex rounded-lg border border-white/10 bg-black p-1">{(["SDK", "CLI", "API"] as const).map((mode) => <button key={mode} onClick={() => setIntegrationMode(mode)} className={`rounded-md px-3 py-1.5 font-mono text-[10px] transition ${integrationMode === mode ? "bg-white text-black" : "text-white/45 hover:text-white"}`}>{mode}</button>)}</div></div>
                <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-black"><div className="flex items-center justify-between border-b border-white/10 px-4 py-3"><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">{integrationMode} setup</span><button onClick={() => copy(activeCode, `${integrationMode} setup`)} className="inline-flex items-center gap-1.5 text-xs text-white/60 transition hover:text-white"><Clipboard className="size-3.5" /> Copy</button></div><pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-white/80"><code>{activeCode}</code></pre></div>
              </section>
            </div>

            <aside className="space-y-6">
              <section className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.035]">
                <img src={agentOrbitUrl} alt="Abstract agent navigating an identity orbit" className="h-40 w-full object-cover opacity-85" />
                <div className="p-5"><div className="flex items-center gap-2"><Bot className="size-4" /><span className="text-sm font-bold">Portable setup</span></div><p className="mt-2 text-xs leading-5 text-white/50">Use the same project settings in your application, SDK, CLI, or API workflow.</p><button onClick={() => copy(`nexuss-auth project inspect --id ${selected.id} --format json`, "Agent command")} className="mt-4 inline-flex items-center gap-2 font-mono text-[10px] text-white/70 hover:text-white"><Terminal className="size-3.5" /> Copy CLI command</button></div>
              </section>

              <section className="rounded-[24px] border border-white/10 bg-white/[0.025] p-5">
                <SectionLabel>Project links</SectionLabel>
                <div className="space-y-4">
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><Globe2 className="size-4" /></span><div><p className="text-xs font-semibold">Homepage</p><a className="mt-1 flex items-center gap-1 break-all text-xs text-white/45 hover:text-white" href={selected.homepage} target="_blank" rel="noreferrer">{selected.homepage}<ExternalLink className="size-3 shrink-0" /></a></div></div>
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><KeyRound className="size-4" /></span><div><p className="text-xs font-semibold">Redirect allowlist</p><p className="mt-1 break-all font-mono text-[10px] leading-4 text-white/45">{selected.redirect}</p></div></div>
                  <div className="flex gap-3"><span className="grid size-9 place-items-center rounded-lg bg-white/10"><UsersRound className="size-4" /></span><div><p className="text-xs font-semibold">Sign-in methods</p><p className="mt-1 text-xs text-white/45">Google and GitHub</p></div></div>
                </div>
              </section>

              <section className="rounded-[18px] border border-white/15 bg-black p-5"><div className="flex items-center gap-2 text-sm font-bold"><Command className="size-4" /> Keep the simple path simple.</div><p className="mt-2 text-xs leading-5 text-white/50">Project name, trusted URLs, and two default providers are enough to begin. Everything else is an optional layer.</p><button onClick={() => setAdvancedOpen(true)} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-xs font-bold text-black transition hover:bg-white/90">Open advanced controls <ArrowUpRight className="size-3.5" /></button></section>
            </aside>
          </div>
        </>}
        </div>
      </main>

      {newProjectOpen && <div className="fixed inset-0 z-30 grid place-items-center bg-black/75 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-[28px] border border-white/15 bg-[#0d0d0d] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><SectionLabel>New project</SectionLabel><h2 className="text-2xl font-bold tracking-[-0.05em]">Create a project.</h2></div><button onClick={() => setNewProjectOpen(false)} className="rounded-lg p-2 text-white/55 hover:bg-white/10 hover:text-white"><X className="size-5" /></button></div><div className="mt-7 space-y-4"><label className="field-label">Project name<Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Product dashboard" className="field-input" /></label><label className="field-label">Homepage URL<Input value={draft.homepage} onChange={(event) => setDraft((current) => ({ ...current, homepage: event.target.value }))} placeholder="https://product.example.com" className="field-input" /></label><label className="field-label">Redirect URL<Input value={draft.redirect} onChange={(event) => setDraft((current) => ({ ...current, redirect: event.target.value }))} placeholder="https://product.example.com/auth/callback" className="field-input font-mono text-xs" /></label></div><div className="mt-7 flex items-center justify-between gap-3"><p className="max-w-[230px] text-xs leading-5 text-white/40">Google and GitHub are enabled by default. You can change this after saving.</p><Button onClick={createProject} className="bg-white text-black hover:bg-white/90"><FolderKey className="mr-1.5 size-4" /> Create project</Button></div></div></div>}
    </div>
  );
}
