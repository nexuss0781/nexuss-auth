import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return <main className="grid min-h-screen place-items-center bg-[#050505] p-6 text-white"><section className="max-w-sm border border-white/15 bg-white/[0.03] p-7"><p className="font-mono text-xs text-white/45">404 / ROUTE NOT FOUND</p><h1 className="mt-3 text-3xl font-bold tracking-[-0.05em]">No project exists here.</h1><button onClick={handleGoHome} className="mt-6 inline-flex items-center gap-2 bg-white px-3 py-2 text-sm font-semibold text-black"><ArrowLeft className="size-4" /> Return to control plane</button></section></main>;
}
