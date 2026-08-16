/** Design reminder: Monochrome Control Plane surface; tokens are operational credentials, so use clear hierarchy, quiet warnings, and no secret persistence. */
import { useEffect, useState } from "react";
import { ArrowLeft, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ManagementError, createApiToken, listApiTokens, revokeApiToken, type ApiTokenMetadata } from "@/lib/management";

export default function Tokens() {
  const [tokens, setTokens] = useState<ApiTokenMetadata[]>([]);
  const [label, setLabel] = useState("CLI token");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const refresh = async () => {
    try { setTokens(await listApiTokens()); } catch (error) { if (error instanceof ManagementError && error.status === 401) window.location.assign("/auth"); else toast.error("Unable to load API tokens."); } finally { setLoading(false); }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    setCreating(true);
    try { const result = await createApiToken(label.trim() || "CLI token"); setNewToken(result.token); setLabel("CLI token"); await refresh(); } catch { toast.error("Unable to create API token."); } finally { setCreating(false); }
  };

  const revoke = async (tokenId: string) => {
    try { await revokeApiToken(tokenId); setTokens((current) => current.filter((token) => token.tokenId !== tokenId)); toast.success("Token revoked."); } catch { toast.error("Unable to revoke token."); }
  };

  return <main className="min-h-screen bg-[#050505] px-5 py-8 text-white sm:px-10 lg:px-14">
    <div className="mx-auto max-w-5xl">
      <header className="flex items-center justify-between border-b border-white/10 pb-6">
        <div className="flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl border border-white/15 bg-white text-black"><KeyRound className="size-5" /></div><div><p className="text-sm font-bold tracking-[-0.04em]">API tokens</p><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">Account access</p></div></div>
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-xs text-white/50 hover:text-white"><ArrowLeft className="size-3.5" /> Back to workspace</Link>
      </header>
      <section className="mt-10 grid gap-6 lg:grid-cols-[1fr_1.35fr]">
        <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-6 sm:p-8"><div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/40"><ShieldCheck className="size-3.5" /> User-scoped credential</div><h1 className="mt-5 text-4xl font-extrabold leading-[0.95] tracking-[-0.08em]">One token.<br /><span className="text-white/40">Your account.</span></h1><p className="mt-5 text-sm leading-6 text-white/50">Generate a token for the CLI or a private integration. It can manage only the projects owned by this account.</p><label className="mt-8 block text-xs font-semibold text-white/70">Label<Input value={label} onChange={(event) => setLabel(event.target.value)} className="mt-2 h-11 border-white/15 bg-black text-white" maxLength={80} /></label><Button onClick={() => void create()} disabled={creating} className="mt-5 h-11 bg-white text-black hover:bg-white/90"><Plus className="mr-2 size-4" /> {creating ? "Generating…" : "Generate token"}</Button></div>
        <div className="rounded-[24px] border border-white/10 bg-black p-6 sm:p-8"><p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">Active credentials</p><div className="mt-6 space-y-3">{loading ? <p className="text-sm text-white/45">Loading tokens…</p> : tokens.length === 0 ? <div className="border border-dashed border-white/15 p-6 text-sm text-white/45">No tokens yet. Generate one when you need terminal access.</div> : tokens.map((token) => <div key={token.tokenId} className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><span className="grid size-9 place-items-center rounded-xl bg-white text-black"><KeyRound className="size-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{token.label}</span><span className="mt-1 block font-mono text-[10px] text-white/40">{token.tokenPrefix} · created {new Date(token.createdAt).toLocaleDateString()}</span></span><button onClick={() => void revoke(token.tokenId)} className="text-white/35 hover:text-red-300" aria-label={`Revoke ${token.label}`}><Trash2 className="size-4" /></button></div>)}</div></div>
      </section>
      {newToken && <section className="mt-6 rounded-[20px] border border-white/20 bg-white p-5 text-black"><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-black/50">Copy once</p><p className="mt-2 text-sm font-semibold">This secret will not be shown again.</p><code className="mt-4 block break-all rounded-xl bg-black p-4 font-mono text-xs text-white">{newToken}</code></div><button onClick={() => { void navigator.clipboard.writeText(newToken); toast.success("Token copied."); }} className="grid size-10 shrink-0 place-items-center rounded-xl bg-black text-white" aria-label="Copy API token"><Copy className="size-4" /></button></div><p className="mt-4 text-xs text-black/60">Activate it in the CLI with <code className="font-mono">nexuss token use --value &lt;token&gt;</code>.</p></section>}
    </div>
  </main>;
}
