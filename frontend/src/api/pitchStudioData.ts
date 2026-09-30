export type PitchPoint = { x: number; y: number };

export type PitchAction = {
  type: "goal" | "shot" | "pass";
  player: string;
  number: number;
  team: "home" | "away";
  minute: number;
  from: PitchPoint;
  to: PitchPoint;
  from_assist?: PitchPoint;
  assistant?: string;
  assistant_number?: number;
  /** Posição normalizada da bola na rede: [0–1, 0–1] (x=esquerda→direita, y=topo→base) */
  goal_loc?: [number, number];
  goal_zone?: string;
  xg?: number;
  path?: PitchPoint[];
  duration?: number;
};

export type StudioMatch = {
  id: number;
  home: string;
  away: string;
  scoreHome: number;
  scoreAway: number;
  homeColor: string;
  awayColor: string;
  actions: PitchAction[];
};

export const DEMO_STUDIO_MATCH: StudioMatch = {
  id: 1,
  home: "Flamengo",
  away: "Palmeiras",
  scoreHome: 2,
  scoreAway: 1,
  homeColor: "#c8102e",
  awayColor: "#006437",
  actions: [
    {
      type: "goal",
      player: "Gabigol",
      number: 9,
      team: "home",
      minute: 34,
      from: { x: 88, y: 42 },
      to: { x: 98.5, y: 48 },
      from_assist: { x: 72, y: 55 },
      assistant: "Arrascaeta",
      assistant_number: 10,
      goal_loc: [0.28, 0.68],
      goal_zone: "Canto inferior esquerdo",
      xg: 0.42,
      path: [
        { x: 22, y: 78 },
        { x: 35, y: 62 },
        { x: 48, y: 58 },
        { x: 58, y: 52 },
        { x: 68, y: 58 },
        { x: 72, y: 55 },
        { x: 88, y: 42 },
        { x: 98.5, y: 48 },
      ],
      duration: 2.8,
    },
    {
      type: "shot",
      player: "Endrick",
      number: 9,
      team: "away",
      minute: 58,
      from: { x: 82, y: 38 },
      to: { x: 97, y: 50 },
      goal_loc: [0.72, 0.35],
      goal_zone: "Travessão direita",
      xg: 0.18,
      path: [
        { x: 55, y: 45 },
        { x: 68, y: 40 },
        { x: 82, y: 38 },
        { x: 97, y: 50 },
      ],
      duration: 1.8,
    },
    {
      type: "goal",
      player: "Pedro",
      number: 21,
      team: "home",
      minute: 78,
      from: { x: 91, y: 52 },
      to: { x: 98.5, y: 46 },
      from_assist: { x: 78, y: 38 },
      assistant: "Gerson",
      assistant_number: 8,
      goal_loc: [0.55, 0.22],
      goal_zone: "Centro-alto",
      xg: 0.61,
      path: [
        { x: 40, y: 35 },
        { x: 55, y: 42 },
        { x: 68, y: 38 },
        { x: 78, y: 38 },
        { x: 91, y: 52 },
        { x: 98.5, y: 46 },
      ],
      duration: 2.5,
    },
  ],
};
