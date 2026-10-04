import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Dashboard from "./pages/Dashboard";
import MatchesPage from "./pages/Matches";
import MatchPage from "./pages/Match";
import TeamsPage from "./pages/Teams";
import TeamPage from "./pages/Team";
import PlayersPage from "./pages/Players";
import PlayerPage from "./pages/Player";
import AnalysisPage from "./pages/Analysis";
import ModelsPage from "./pages/Models";
import LoginPage from "./pages/Login";
import { useAuth } from "./store/auth";
import { me } from "./api/client";

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sv-accent to-sv-accent2 grid place-items-center shadow-glow">
        <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-white">
          <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12h16M12 4v16M8 5c2 2 2 12 0 14M16 5c-2 2-2 12 0 14"/>
            <circle cx="12" cy="12" r="3"/>
          </g>
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-semibold text-sv-text tracking-tight">ScoutVision</div>
        <div className="text-[10px] text-sv-muted uppercase tracking-widest">Análise Pré-Jogo</div>
      </div>
    </Link>
  );
}

function Sidebar() {
  const nav = [
    { to: "/", label: "Painel", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
    { to: "/matches", label: "Partidas", icon: "M4 6h16v12H4zM4 10h16M10 6v12" },
    { to: "/teams", label: "Times", icon: "M4 20v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
    { to: "/players", label: "Jogadores", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6" },
    { to: "/analysis", label: "Análise", icon: "M4 20h16M7 16V8M12 16V4M17 16v-6" },
    { to: "/models", label: "Modelos", icon: "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" },
  ];
  return (
    <aside className="hidden md:flex md:flex-col w-60 shrink-0 border-r border-sv-border bg-sv-panel/40 backdrop-blur-sm">
      <div className="p-4 border-b border-sv-border">
        <Logo />
      </div>
      <nav className="flex flex-col gap-1 p-3">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm border transition ${
                isActive
                  ? "bg-sv-accent/10 border-sv-accent/30 text-sv-accent3"
                  : "border-transparent text-sv-text/85 hover:bg-sv-panel2 hover:text-white"
              }`
            }
          >
            <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5" width="18" height="18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={n.icon} />
            </svg>
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto p-3 text-[11px] text-sv-muted border-t border-sv-border">
        <div className="mb-1"><span className="sv-chip">DEMO</span> dados simulados em todo o app</div>
        <div className="opacity-80">v0.1.0 · ScoutVision</div>
      </div>
    </aside>
  );
}

function Topbar() {
  const auth = useAuth();
  const loc = useLocation();
  const titleMap: Record<string, string> = {
    "/": "Painel",
    "/matches": "Partidas",
    "/teams": "Times",
    "/players": "Jogadores",
    "/analysis": "Análise",
    "/models": "Modelos",
    "/login": "Entrar",
  };
  const title = Object.entries(titleMap).find(([k]) => loc.pathname === k || loc.pathname.startsWith(k + "/"))
    ?.[1] || "ScoutVision";

  return (
    <header className="sticky top-0 z-30 border-b border-sv-border bg-sv-bg/80 backdrop-blur-md">
      <div className="flex items-center gap-3 px-4 md:px-6 h-14">
        <div className="md:hidden"><Logo /></div>
        <div className="ml-auto md:ml-0 flex-1 md:flex-none">
          <div className="md:hidden sv-label">ScoutVision</div>
          <div className="hidden md:block font-medium">{title}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="sv-chip-accent hidden sm:inline-flex">
            <span className="w-1.5 h-1.5 rounded-full bg-sv-accent3 shadow-[0_0_10px_#5ef2b8]"/>
            API ao vivo
          </span>
          {auth.token ? (
            <div className="flex items-center gap-2">
              <div className="sv-chip">
                <span className="uppercase text-[10px] font-semibold">{auth.role}</span>
                <span className="text-sv-muted">·</span>
                <span className="truncate max-w-[140px]">{auth.email}</span>
              </div>
              <button onClick={() => auth.logout()} className="sv-btn !py-1.5">Sair</button>
            </div>
          ) : (
            <Link to="/login" className="sv-btn-primary !py-1.5">Entrar</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-4 md:p-6 overflow-auto">
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
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Shell>
      } />
    </Routes>
  );
}

export default App;
