import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { login } from "../api/client";
import { useAuth } from "../store/auth";
import { Badge } from "../components/ui";

export default function LoginPage() {
  const auth = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@scoutvision.local");
  const [password, setPassword] = useState("admin123");
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => login(email, password),
    onSuccess: (d: any) => {
      auth.setAuth({ token: d.access_token, role: d.role, userId: d.user_id, email });
      nav("/", { replace: true });
    },
    onError: (e: any) => {
      setErr(e?.response?.data?.detail || "Falha ao entrar");
    },
  });

  return (
    <div className="h-full grid place-items-center p-6">
      <div className="sv-card sv-ring w-full max-w-md">
        <div className="sv-card-inner space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-sv-accent to-sv-accent2 grid place-items-center shadow-glow">
              <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-white" stroke="currentColor" strokeWidth="2">
                <path d="M4 12h16M12 4v16M8 5c2 2 2 12 0 14M16 5c-2 2-2 12 0 14" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </div>
            <div>
              <div className="text-xl font-bold">Entrar no ScoutVision</div>
              <div className="text-xs text-sv-muted">Scouting pré-jogo &amp; análise preditiva</div>
            </div>
          </div>

          {err && <div className="sv-chip border-sv-danger/40 text-sv-danger">{err}</div>}

          <form onSubmit={(e) => { e.preventDefault(); setErr(null); mut.mutate(); }} className="space-y-3">
            <label className="block">
              <div className="sv-label mb-1">E-mail</div>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full sv-btn !py-2 bg-sv-panel2 text-left"
              />
            </label>
            <label className="block">
              <div className="sv-label mb-1">Senha</div>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full sv-btn !py-2 bg-sv-panel2 text-left"
              />
            </label>
            <button type="submit" disabled={mut.isPending}
              className="sv-btn-primary w-full justify-center disabled:opacity-60">
              {mut.isPending ? "Entrando…" : "Entrar"}
            </button>
          </form>

          <div className="sv-divider" />
          <div className="sv-card !bg-sv-panel2/60">
            <div className="p-4 text-sm space-y-1">
              <div className="flex items-center gap-2 mb-1.5"><Badge kind="accent">Credenciais de demonstração</Badge></div>
              <div><span className="text-sv-muted">Admin:</span> <code className="font-mono text-xs">admin@scoutvision.local / admin123</code></div>
              <div><span className="text-sv-muted">Usuário:</span> <code className="font-mono text-xs">user@scoutvision.local / user123</code></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
