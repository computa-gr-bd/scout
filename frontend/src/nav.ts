export interface NavItem {
  to: string;
  label: string;
  icon: string;
}

/** Itens de navegação compartilhados entre a sidebar desktop e o drawer mobile. */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Painel", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { to: "/matches", label: "Partidas", icon: "M4 6h16v12H4zM4 10h16M10 6v12" },
  { to: "/teams", label: "Times", icon: "M4 20v-6a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v6M8 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" },
  { to: "/players", label: "Jogadores", icon: "M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21c0-4 4-6 8-6s8 2 8 6" },
  { to: "/analysis", label: "Análise", icon: "M4 20h16M7 16V8M12 16V4M17 16v-6" },
  { to: "/understat", label: "Understat", icon: "M12 2v4m0 12v4M2 12h4m12 0h4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" },
  { to: "/models", label: "Modelos", icon: "M3 7l9-4 9 4-9 4-9-4zM3 12l9 4 9-4M3 17l9 4 9-4" },
  { to: "/about", label: "Sobre e como usar", icon: "M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z" },
];
