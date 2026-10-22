import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import MatchesPage from "./pages/Matches";
import MatchPage from "./pages/Match";
import TeamsPage from "./pages/Teams";
import TeamPage from "./pages/Team";
import PlayersPage from "./pages/Players";
import PlayerPage from "./pages/Player";
import AnalysisPage from "./pages/Analysis";
import ModelsPage from "./pages/Models";
import AboutPage from "./pages/About";
import LoginPage from "./pages/Login";
import { NAV_ITEMS } from "./nav";
import { useAuth } from "./store/auth";
import { getDataStatus, me } from "./api/client";

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} className="flex items-center gap-2.5 shrink-0">
      <img src="/scoutvision-logo.png" alt="" className="w-10 h-10 object-contain" />
      <div className="leading-tight">
        <div className="font-semibold text-sv-text tracking-tight">ScoutVision</div>
        <div className="text-[10px] text-sv-muted uppercase tracking-widest">Análise Pré-Jogo</div>
      </div>
    </Link>
  );
}

/** Classe de link de navegação, compartilhada pela sidebar e pelo drawer mobile. */
function navLinkCls(isActive: boolean) {
  return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm border transition ${
    isActive
      ? "bg-sv-accent/10 border-sv-accent/30 text-sv-accent3"
      : "border-transparent text-sv-text/85 hover:bg-sv-panel2 hover:text-white"
  }`;
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d={d} />
    </svg>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-sv-border bg-sv-panel/40 backdrop-blur-sm">
      <div className="p-4 border-b border-sv-border">
        <Logo />
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {NAV_ITEMS.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) => navLinkCls(isActive)}
          >
            <NavIcon d={n.icon} />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-3 text-[11px] text-sv-muted border-t border-sv-border">
        <div className="mb-1">
          <Link to="/about" className="hover:text-sv-text transition">Fontes, limites e guia de uso</Link>
        </div>
        <div className="opacity-80">v0.1.0 · ScoutVision</div>
      </div>
    </aside>
  );
}

/**
 * Drawer de navegação exclusivo do mobile (<md). Fica fora do fluxo da página,
 * coberto por um scrim, e fecha ao navegar ou ao tocar fora.
 */
function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const loc = useLocation();
  // Fecha o drawer ao trocar de rota.
  useEffect(() => { onClose(); }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bloqueia o scroll do fundo enquanto o drawer está aberto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`md:hidden fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
      />
      <aside
        id="sv-mobile-drawer"
        className={`absolute left-0 top-0 bottom-0 w-64 max-w-[80vw] flex flex-col
                    bg-sv-panel border-r border-sv-border shadow-2xl
                    transition-transform duration-200 ease-out ${
                      open ? "translate-x-0" : "-translate-x-full"
                    }`}
      >
        <div className="flex items-center justify-between gap-2 p-4 border-b border-sv-border">
          <Logo onClick={onClose} />
          <button onClick={onClose} aria-label="Fechar menu"
                  className="sv-btn !px-2 !py-1.5">
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <nav className="flex flex-col gap-1 p-3 overflow-y-auto">
          {NAV_ITEMS.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={onClose}
              className={({ isActive }) => navLinkCls(isActive)}
            >
              <NavIcon d={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto p-3 text-[11px] text-sv-muted border-t border-sv-border">
          <div className="opacity-80">v0.1.0 · ScoutVision</div>
        </div>
      </aside>
    </div>
  );
}

function Topbar({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const auth = useAuth();
  const loc = useLocation();
  const connection = useQuery({
    queryKey: ["data", "status"],
    queryFn: getDataStatus,
    staleTime: 30_000,
    retry: 0,
  });
  const titleMap: Record<string, string> = {
    "/": "Painel",
    "/matches": "Partidas",
    "/teams": "Times",
    "/players": "Jogadores",
    "/analysis": "Análise",
    "/models": "Modelos",
    "/about": "Sobre e como usar",
    "/login": "Entrar",
  };
  const title = Object.entries(titleMap).find(([k]) => loc.pathname === k || loc.pathname.startsWith(k + "/"))
    ?.[1] || "ScoutVision";

  return (
    <header className="sticky top-0 z-30 border-b border-sv-border bg-sv-bg/80 backdrop-blur-md">
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 md:px-6 h-14">
        {/* Botão de menu — só no mobile */}
        <button
          onClick={onMenu}
          aria-label="Abrir menu de navegação"
          aria-expanded={menuOpen}
          aria-controls="sv-mobile-drawer"
          className="md:hidden shrink-0 grid place-items-center w-10 h-10 rounded-lg border border-sv-border bg-sv-panel hover:bg-sv-panel2"
        >
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor"
               strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div className="md:hidden min-w-0">
          <Logo />
        </div>

        <div className="hidden md:block font-medium">{title}</div>

        <div className="ml-auto flex items-center gap-2 min-w-0">
          <span className={connection.isError ? "sv-chip hidden lg:inline-flex text-sv-danger" : "sv-chip-accent hidden lg:inline-flex"}>
            <span className={`w-1.5 h-1.5 rounded-full ${connection.isError ? "bg-sv-danger" : connection.isSuccess ? "bg-sv-accent3 shadow-[0_0_10px_#5ef2b8]" : "bg-sv-warn animate-pulse"}`}/>
            {connection.isError ? "API indisponível" : connection.isSuccess ? "API conectada" : "Verificando API"}
          </span>
          {auth.token ? (
            <div className="flex items-center gap-2 min-w-0">
              <div className="sv-chip hidden sm:inline-flex min-w-0">
                <span className="uppercase text-[10px] font-semibold">{auth.role}</span>
                <span className="text-sv-muted">·</span>
                <span className="truncate max-w-[140px]">{auth.email}</span>
              </div>
              <button onClick={() => auth.logout()} className="sv-btn !py-1.5 shrink-0">Sair</button>
            </div>
          ) : (
            <Link to="/login" className="sv-btn-primary !py-1.5 shrink-0">Entrar</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="flex h-full">
      <Sidebar />
      <MobileDrawer open={menuOpen} onClose={closeMenu} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main className="flex-1 p-3 sm:p-4 md:p-6 overflow-auto">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function App() {
  const auth = useAuth();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const existing = localStorage.getItem("sv.token");
    if (existing) {
      me().then((u: any) => {
        auth.setAuth({ token: existing, role: u.role, userId: u.id, email: u.email });
      }).catch(() => localStorage.removeItem("sv.token")).finally(() => setLoaded(true));
    } else {
      setLoaded(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loaded) return <div className="h-full grid place-items-center"><div className="w-10 h-10 rounded-full skeleton"/></div>;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/*" element={
        <Shell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/matches" element={<MatchesPage />} />
            <Route path="/matches/:id" element={<MatchPage />} />
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/teams/:id" element={<TeamPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/players/:id" element={<PlayerPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/analysis/:matchId" element={<AnalysisPage />} />
            <Route path="/models" element={<ModelsPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Shell>
      } />
    </Routes>
  );
}

export default App;
