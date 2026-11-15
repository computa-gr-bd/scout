import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Dashboard from "./pages/Dashboard";
import MatchesPage from "./pages/Matches";
import TeamsPage from "./pages/Teams";
import TeamPage from "./pages/Team";
import PlayersPage from "./pages/Players";
import PlayerPage from "./pages/Player";
import AnalysisPage from "./pages/Analysis";
import ComparePage from "./pages/Compare";
import LigasPage from "./pages/Ligas";
import ModelsPage from "./pages/Models";
import AboutPage from "./pages/About";
import { NAV_GROUPS, NAV_ITEMS, navForPath } from "./nav";
import { getCrests, getDataStatus } from "./api/client";
import { registerCrests } from "./lib/crests";
import { timeAgo } from "./lib/matchStatus";

function Logo({ onClick }: { onClick?: () => void }) {
  return (
    <Link to="/" onClick={onClick} aria-label="ScoutVision — ir para a Home" className="flex items-center gap-2.5 shrink-0">
      <img src="/scoutvision-logo.png" alt="" className="w-9 h-9 object-contain" />
      <div className="sv-display text-[21px] leading-none text-sv-text tracking-tight">ScoutVision</div>
    </Link>
  );
}

/** Item de navegação: barra de destaque à esquerda indica a rota ativa (além da cor). */
function navLinkCls(isActive: boolean) {
  return `group relative flex items-center gap-3 h-9 pl-3 pr-2 rounded-md text-sm transition-colors duration-150 ${
    isActive
      ? "bg-sv-panel3/70 text-sv-text font-medium before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-full before:bg-sv-accent3"
      : "text-sv-muted hover:bg-sv-panel2 hover:text-sv-text"
  }`;
}

function NavIcon({ d, active }: { d: string; active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor"
         strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         className={`shrink-0 ${active ? "text-sv-accent3" : ""}`}>
      <path d={d} />
    </svg>
  );
}

/** Lista de navegação agrupada, usada pela sidebar e pelo drawer mobile. */
function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-4 p-3 overflow-y-auto">
      {NAV_GROUPS.map((g) => {
        const items = NAV_ITEMS.filter((n) => n.group === g.key);
        if (!items.length) return null;
        return (
          <div key={g.key} className="flex flex-col gap-0.5">
            <div className="px-3 pb-1 text-[11px] font-medium text-sv-faint">{g.label}</div>
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === "/"} onClick={onNavigate}
                       className={({ isActive }) => navLinkCls(isActive)}>
                {({ isActive }) => (<><NavIcon d={n.icon} active={isActive} /><span className="truncate">{n.label}</span></>)}
              </NavLink>
            ))}
          </div>
        );
      })}
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="hidden md:flex md:flex-col shrink-0 border-r border-sv-border bg-sv-panel"
           style={{ width: "var(--sv-sidebar-w)" }}>
      <div className="flex items-center px-4 border-b border-sv-border" style={{ height: "var(--sv-header-h)" }}>
        <Logo />
      </div>
      <NavList />
      <div className="mt-auto px-4 py-3 text-[11px] text-sv-muted border-t border-sv-border">
        <Link to="/about" className="hover:text-sv-text transition-colors">Fontes, limites e guia de uso</Link>
        <div className="text-sv-faint mt-0.5">v0.1.0</div>
      </div>
    </aside>
  );
}

/**
 * Drawer de navegação exclusivo do mobile (<md). Fica fora do fluxo da página,
 * coberto por um scrim, e fecha ao navegar, ao tocar fora ou com Esc.
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
    <div className={`md:hidden fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/70 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        id="sv-mobile-drawer"
        className={`absolute left-0 top-0 bottom-0 w-64 max-w-[82vw] flex flex-col bg-sv-panel border-r border-sv-border shadow-pop
                    transition-transform duration-200 ease-sv ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 border-b border-sv-border" style={{ height: "var(--sv-header-h)" }}>
          <Logo onClick={onClose} />
          <button onClick={onClose} aria-label="Fechar menu" className="sv-btn !px-2 !py-1.5" tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" fill="none" width="18" height="18" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <NavList onNavigate={onClose} />
        <div className="mt-auto px-4 py-3 text-[11px] text-sv-faint border-t border-sv-border">v0.1.0 · ScoutVision</div>
      </aside>
    </div>
  );
}

function Topbar({ onMenu, menuOpen }: { onMenu: () => void; menuOpen: boolean }) {
  const loc = useLocation();
  // Catálogo de escudos: alimenta o TeamLogo de todas as telas (times sem logo na API).
  const crestsQ = useQuery({ queryKey: ["crests"], queryFn: getCrests, staleTime: 30 * 60_000, retry: 1 });
  useEffect(() => { if (crestsQ.data) registerCrests(crestsQ.data); }, [crestsQ.data]);
  const connection = useQuery({
    queryKey: ["data", "status"],
    queryFn: getDataStatus,
    staleTime: 30_000,
    retry: 0,
  });

  const { item, isDetail } = navForPath(loc.pathname);
  const title = item?.title ?? item?.label ?? "ScoutVision";
  const hint = isDetail ? `Detalhe · ${item?.label}` : item?.hint ?? "";

  // Atualização mais recente entre as coletas de dados (dado real do /data/status).
  const lastSync = useMemo(() => {
    const times = (connection.data?.competitions ?? [])
      .map((c) => c.last_success_at)
      .filter((t): t is string => !!t)
      .sort();
    return times.length ? times[times.length - 1] : null;
  }, [connection.data]);
  const ago = timeAgo(lastSync);

  return (
    <header className="sticky top-0 z-30 border-b border-sv-border bg-sv-bg/90 backdrop-blur-md" style={{ height: "var(--sv-header-h)" }}>
      <div className="flex items-center gap-3 px-3 sm:px-4 md:px-6 h-full">
        {/* Botão de menu — só no mobile */}
        <button
          onClick={onMenu}
          aria-label="Abrir menu de navegação"
          aria-expanded={menuOpen}
          aria-controls="sv-mobile-drawer"
          className="md:hidden shrink-0 grid place-items-center w-10 h-10 rounded-md border border-sv-border bg-sv-panel hover:bg-sv-panel2 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20" stroke="currentColor"
               strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-3">
          {isDetail && item && (
            <Link to={item.to} aria-label={`Voltar para ${item.label}`}
                  className="shrink-0 grid place-items-center w-8 h-8 rounded-md border border-sv-border text-sv-muted hover:text-sv-text hover:bg-sv-panel2 transition-colors">
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16" stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </Link>
          )}
          <div className="min-w-0 leading-tight">
            <h1 className="sv-display text-[22px] leading-6 truncate">{title}</h1>
            <p className="hidden sm:block text-xs text-sv-muted truncate">{hint}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {ago && (
            <span className="hidden lg:inline text-xs text-sv-muted" title={lastSync ? new Date(lastSync).toLocaleString("pt-BR") : undefined}>
              Dados atualizados {ago}
            </span>
          )}
          <span role="status" className={connection.isError ? "sv-chip text-sv-danger border-sv-danger/40" : "sv-chip"}>
            <span className={`w-1.5 h-1.5 rounded-full ${connection.isError ? "bg-sv-danger" : connection.isSuccess ? "bg-sv-accent3" : "bg-sv-warn animate-pulse"}`} aria-hidden="true" />
            <span className="hidden sm:inline">{connection.isError ? "API indisponível" : connection.isSuccess ? "API conectada" : "Verificando API"}</span>
            <span className="sm:hidden sr-only">{connection.isError ? "API indisponível" : connection.isSuccess ? "API conectada" : "Verificando API"}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <a href="#conteudo" className="sv-skip">Pular para o conteúdo</a>
      <Sidebar />
      <MobileDrawer open={menuOpen} onClose={closeMenu} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main id="conteudo" tabIndex={-1} className="min-h-0 flex-1 overflow-auto p-3 sm:p-4 md:p-6 focus:outline-none">
          <div className="mx-auto max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/*" element={
        <Shell>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/matches" element={<MatchesPage />} />
            {/* /matches/:id removida: a partida abre direto na Análise */}
            <Route path="/teams" element={<TeamsPage />} />
            <Route path="/teams/:id" element={<TeamPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/players/:id" element={<PlayerPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/analysis/:matchId" element={<AnalysisPage />} />
            <Route path="/ligas" element={<LigasPage />} />
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
