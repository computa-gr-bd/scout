import { useEffect, useMemo, useRef, useState } from "react";
import { STUDIO_DATASETS, studioDatasetForMatch, type StudioDataset } from "../api/studioData";
import { JerseyGlyph, JerseyDefs, JerseyBadge, BallGlyph } from "./Jersey";

type ViewMode = "heatmap" | "shots" | "onTarget" | "goals" | "positions";
type Coord = { x: number; y: number };

type Action = {
  id: number; minute: string; player: string; number: number; team: "home" | "away";
  teamName: string; type: "shot" | "goal" | "assist_shot"; from: Coord; to: Coord;
  assistant?: { name: string; number: number; from: Coord };
  xg: number; xgot: number; situation: string; shotType: string;
  goalZone?: string; goalLoc?: Coord; result: "goal" | "saved" | "off_target" | "blocked"; duration?: number;
};

type HeatPoint = { x: number; y: number; intensity: number; label?: string };

type PlayerDetail = {
  id: number; number: number; name: string; nick?: string; position: string;
  team: "home" | "away"; teamName: string;
  pitchPos: Coord;
  rating: number; injured?: boolean; minutes: number;
  avatar: string;
  stats: {
    goals: number; assists: number; shots: number; shotsOnTarget: number;
    xG: number; xGOT: number; passes: number; passesAcc: number; passAccPct: number;
    crosses: number; crossAccPct: number; dribbles: number; dribblesSuc: number;
    tackles: number; interceptions: number; duelsWon: number; duelsWonPct: number;
    touches: number; fouls: number; foulsSuffered: number; yellowCards: number; redCards: number;
    aerialWon: number; offsides: number; possessions: number;
  };
  ratingBreakdown: { shooting: number; passing: number; dribbling: number; defending: number; impact: number; };
  personalHeatmap: HeatPoint[];
  actions: {
    shots: Action[];
    passes: { from: Coord; to: Coord; minute: string; accurate: boolean; kind: "short" | "long" | "cross" | "throughball" }[];
    dribbles: { from: Coord; to: Coord; minute: string; successful: boolean; progressive?: boolean }[];
    defenses: { pos: Coord; minute: string; kind: "tackle" | "interception" | "clearance" | "recovery" }[];
  };
};

const HOME_COLOR = "#3b82f6";
const AWAY_COLOR = "#e1534e";
const HOME_COLOR_SOFT = "rgba(59,130,246,0.15)";
const AWAY_COLOR_SOFT = "rgba(225,83,78,0.15)";

const MOCK_MATCH = {
  title: "Brasileirão Série A · Rodada 22",
  home: "Flamengo", away: "Palmeiras", scoreHome: 2, scoreAway: 1,
  date: "Sáb, 21 Set 2026 · 16:00",
};

const MOCK_SHOTS: Action[] = [
  { id: 1, minute: "12", player: "Bruno Henrique", number: 27, team: "home", teamName: "Flamengo",
    type: "shot", from: { x: 72, y: 35 }, to: { x: 96, y: 48 },
    xg: 0.18, xgot: 0.42, situation: "Contra-ataque", shotType: "Chute colocado",
    goalZone: "Fora da área", result: "saved", duration: 1.6 },
  { id: 2, minute: "34", player: "Giorgian De Arrascaeta", number: 14, team: "home", teamName: "Flamengo",
    type: "goal", from: { x: 82, y: 52 }, to: { x: 99, y: 44 },
    assistant: { name: "Pedro", number: 9, from: { x: 70, y: 62 } },
    xg: 0.36, xgot: 0.82, situation: "Jogo montado", shotType: "Colocado no canto",
    goalZone: "Superior esquerdo", goalLoc: { x: 0.1, y: 0.2 },
    result: "goal", duration: 2.1 },
  { id: 3, minute: "47", player: "Raphael Veiga", number: 23, team: "away", teamName: "Palmeiras",
    type: "shot", from: { x: 30, y: 48 }, to: { x: 4, y: 52 },
    xg: 0.08, xgot: 0.25, situation: "Falta", shotType: "Chute direto",
    goalZone: "Central alta", result: "saved", duration: 1.4 },
  { id: 4, minute: "63", player: "Endrick", number: 16, team: "away", teamName: "Palmeiras",
    type: "goal", from: { x: 22, y: 56 }, to: { x: 1, y: 60 },
    assistant: { name: "Dudu", number: 7, from: { x: 30, y: 72 } },
    xg: 0.41, xgot: 0.88, situation: "Cruzamento na área", shotType: "Cabeceio",
    goalZone: "Inferior direito", goalLoc: { x: 0.85, y: 0.75 },
    result: "goal", duration: 2.0 },
  { id: 5, minute: "78", player: "Pedro", number: 9, team: "home", teamName: "Flamengo",
    type: "goal", from: { x: 88, y: 50 }, to: { x: 99, y: 56 },
    assistant: { name: "Arrascaeta", number: 14, from: { x: 76, y: 28 } },
    xg: 0.55, xgot: 0.92, situation: "Cruzamento pela direita", shotType: "Perna esquerda",
    goalZone: "Canto inferior direito", goalLoc: { x: 0.92, y: 0.78 },
    result: "goal", duration: 2.3 },
  { id: 6, minute: "89", player: "Lorran", number: 30, team: "away", teamName: "Palmeiras",
    type: "shot", from: { x: 18, y: 40 }, to: { x: 2, y: 38 },
    xg: 0.12, xgot: 0.30, situation: "Fora da área", shotType: "Bomba",
    goalZone: "—", result: "off_target", duration: 1.5 },
];

const MOCK_HEATMAP_HOME: HeatPoint[] = [
  { x: 8, y: 50, intensity: 0.9, label: "Goleiro" },
  { x: 25, y: 22, intensity: 0.72, label: "LD" },
  { x: 22, y: 40, intensity: 0.85, label: "ZAG" },
  { x: 22, y: 60, intensity: 0.83, label: "ZAG" },
  { x: 25, y: 78, intensity: 0.7, label: "LE" },
  { x: 42, y: 30, intensity: 0.78, label: "MEI" },
  { x: 45, y: 50, intensity: 0.92, label: "VOL" },
  { x: 42, y: 70, intensity: 0.76, label: "MEI" },
  { x: 68, y: 25, intensity: 0.88, label: "ATA" },
  { x: 72, y: 52, intensity: 0.9, label: "Ponta" },
  { x: 68, y: 75, intensity: 0.86, label: "ATA" },
];
const MOCK_HEATMAP_AWAY: HeatPoint[] = [
  { x: 92, y: 50, intensity: 0.9, label: "Goleiro" },
  { x: 75, y: 22, intensity: 0.7, label: "LD" },
  { x: 78, y: 40, intensity: 0.82, label: "ZAG" },
  { x: 78, y: 60, intensity: 0.84, label: "ZAG" },
  { x: 75, y: 78, intensity: 0.72, label: "LE" },
  { x: 58, y: 30, intensity: 0.76, label: "MEI" },
  { x: 55, y: 50, intensity: 0.88, label: "VOL" },
  { x: 58, y: 70, intensity: 0.78, label: "MEI" },
  { x: 32, y: 25, intensity: 0.84, label: "ATA" },
  { x: 28, y: 50, intensity: 0.86, label: "Ponta" },
  { x: 32, y: 75, intensity: 0.82, label: "ATA" },
];

const STARTING_HOME = [
  { id: 1, number: 1, name: "Rossi", position: "GOL", pitchPos: { x: 8, y: 50 } },
  { id: 2, number: 2, name: "Varela", position: "LD", pitchPos: { x: 25, y: 22 } },
  { id: 3, number: 15, name: "Fabrício Bruno", position: "ZAG", pitchPos: { x: 22, y: 40 } },
  { id: 4, number: 23, name: "David Luiz", position: "ZAG", pitchPos: { x: 22, y: 60 } },
  { id: 5, number: 6, name: "Ayrton Lucas", position: "LE", pitchPos: { x: 25, y: 78 } },
  { id: 6, number: 8, name: "Gerson", position: "VOL", pitchPos: { x: 45, y: 50 } },
  { id: 7, number: 14, name: "Arrascaeta", position: "MEI", pitchPos: { x: 42, y: 30 } },
  { id: 8, number: 7, name: "Éverton Ribeiro", position: "MEI", pitchPos: { x: 42, y: 70 } },
  { id: 9, number: 27, name: "Bruno Henrique", position: "PE", pitchPos: { x: 68, y: 25 } },
  { id: 10, number: 11, name: "Luiz Araújo", position: "PD", pitchPos: { x: 68, y: 75 } },
  { id: 11, number: 9, name: "Pedro", position: "CA", pitchPos: { x: 72, y: 52 } },
];
const STARTING_AWAY = [
  { id: 12, number: 22, name: "Weverton", position: "GOL", pitchPos: { x: 92, y: 50 } },
  { id: 13, number: 13, name: "Mayke", position: "LD", pitchPos: { x: 75, y: 22 } },
  { id: 14, number: 15, name: "Gustavo Gómez", position: "ZAG", pitchPos: { x: 78, y: 40 } },
  { id: 15, number: 26, name: "Murilo", position: "ZAG", pitchPos: { x: 78, y: 60 } },
  { id: 16, number: 12, name: "Piquerez", position: "LE", pitchPos: { x: 75, y: 78 } },
  { id: 17, number: 25, name: "Gabriel Menino", position: "VOL", pitchPos: { x: 55, y: 50 } },
  { id: 18, number: 23, name: "Raphael Veiga", position: "MEI", pitchPos: { x: 58, y: 30 } },
  { id: 19, number: 30, name: "Lorran", position: "MEI", pitchPos: { x: 58, y: 70 } },
  { id: 20, number: 7, name: "Dudu", position: "PD", pitchPos: { x: 32, y: 25 } },
  { id: 21, number: 19, name: "José López", position: "PE", pitchPos: { x: 32, y: 75 } },
  { id: 22, number: 16, name: "Endrick", position: "CA", pitchPos: { x: 28, y: 50 } },
];

function heatPersonal(points: { x: number; y: number; v?: number }[]): HeatPoint[] {
  return points.map((p, i) => ({ x: p.x, y: p.y, intensity: p.v ?? (0.35 + Math.random() * 0.6), label: `p${i}` }));
}

const MOCK_PLAYERS: Record<number, PlayerDetail> = {
  // ======== PEDRO #9 (Flamengo) — ATACANTE COMPLETO ========
  9: {
    id: 11, number: 9, name: "Pedro Guilherme Abreu dos Santos", nick: "Pedro", position: "Centroavante (CA)",
    team: "home", teamName: "Flamengo", pitchPos: { x: 72, y: 52 },
    rating: 8.6, minutes: 88,
    avatar: "https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=Brazilian%20football%20striker%20Pedro%20Flamengo%20profile%20photo%20headshot%20red%20black%20jersey%20studio%20lighting&image_size=square",
    stats: {
      goals: 1, assists: 1, shots: 4, shotsOnTarget: 3, xG: 0.98, xGOT: 1.82,
      passes: 22, passesAcc: 19, passAccPct: 86, crosses: 1, crossAccPct: 100,
      dribbles: 6, dribblesSuc: 4, tackles: 0, interceptions: 0,
      duelsWon: 9, duelsWonPct: 56, touches: 44, fouls: 3, foulsSuffered: 5,
      yellowCards: 0, redCards: 0, aerialWon: 5, offsides: 2, possessions: 28,
    },
    ratingBreakdown: { shooting: 0.88, passing: 0.72, dribbling: 0.68, defending: 0.15, impact: 0.95 },
    personalHeatmap: heatPersonal([
      { x: 88, y: 50, v: 1.0 }, { x: 80, y: 44, v: 0.9 }, { x: 82, y: 58, v: 0.85 },
      { x: 72, y: 52, v: 0.82 }, { x: 86, y: 38, v: 0.55 }, { x: 86, y: 66, v: 0.5 },
      { x: 70, y: 62, v: 0.42 }, { x: 76, y: 28, v: 0.3 }, { x: 64, y: 50, v: 0.28 },
    ]),
    actions: {
      shots: MOCK_SHOTS.filter((s) => s.number === 9).concat([
        { id: 51, minute: "22", player: "Pedro", number: 9, team: "home", teamName: "Flamengo",
          type: "shot", from: { x: 80, y: 50 }, to: { x: 98, y: 52 },
          xg: 0.18, xgot: 0.34, situation: "Bola dividida", shotType: "Chute forte",
          goalZone: "Direita baixa", result: "saved", duration: 1.5 },
        { id: 52, minute: "58", player: "Pedro", number: 9, team: "home", teamName: "Flamengo",
          type: "shot", from: { x: 82, y: 42 }, to: { x: 99, y: 38 },
          xg: 0.22, xgot: 0.44, situation: "Cruzamento na área", shotType: "Cabeceio",
          goalZone: "Superior direito", result: "off_target", duration: 1.6 },
      ]),
      passes: [
        { from: { x: 70, y: 62 }, to: { x: 82, y: 52 }, minute: "34", accurate: true, kind: "throughball" },
        { from: { x: 74, y: 48 }, to: { x: 64, y: 30 }, minute: "07", accurate: true, kind: "short" },
        { from: { x: 80, y: 54 }, to: { x: 66, y: 74 }, minute: "18", accurate: true, kind: "short" },
        { from: { x: 76, y: 52 }, to: { x: 34, y: 50 }, minute: "41", accurate: true, kind: "long" },
        { from: { x: 82, y: 56 }, to: { x: 80, y: 70 }, minute: "66", accurate: false, kind: "cross" },
        { from: { x: 70, y: 46 }, to: { x: 68, y: 26 }, minute: "71", accurate: true, kind: "short" },
      ],
      dribbles: [
        { from: { x: 70, y: 50 }, to: { x: 78, y: 48 }, minute: "11", successful: true, progressive: true },
        { from: { x: 72, y: 56 }, to: { x: 74, y: 58 }, minute: "29", successful: false },
        { from: { x: 66, y: 50 }, to: { x: 76, y: 52 }, minute: "51", successful: true, progressive: true },
        { from: { x: 80, y: 52 }, to: { x: 86, y: 50 }, minute: "82", successful: true, progressive: true },
      ],
      defenses: [],
    },
  },
  // ======== ENDRICK #16 (Palmeiras) — JOIA DO BRASIL ========
  16: {
    id: 22, number: 16, name: "Endrick Felipe Moreira de Sousa", nick: "Endrick", position: "Centroavante (CA)",
    team: "away", teamName: "Palmeiras", pitchPos: { x: 28, y: 50 },
    rating: 8.2, minutes: 81,
    avatar: "https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=young%20Brazilian%20football%20talent%20Endrick%20Palmeiras%20profile%20photo%20headshot%20green%20jersey%20studio%20lighting&image_size=square",
    stats: {
      goals: 1, assists: 0, shots: 3, shotsOnTarget: 2, xG: 0.58, xGOT: 1.04,
      passes: 18, passesAcc: 15, passAccPct: 83, crosses: 0, crossAccPct: 0,
      dribbles: 11, dribblesSuc: 8, tackles: 1, interceptions: 0,
      duelsWon: 7, duelsWonPct: 50, touches: 52, fouls: 2, foulsSuffered: 7,
      yellowCards: 1, redCards: 0, aerialWon: 3, offsides: 3, possessions: 34,
    },
    ratingBreakdown: { shooting: 0.78, passing: 0.65, dribbling: 0.9, defending: 0.22, impact: 0.88 },
    personalHeatmap: heatPersonal([
      { x: 22, y: 56, v: 1.0 }, { x: 28, y: 50, v: 0.95 }, { x: 14, y: 50, v: 0.8 },
      { x: 18, y: 62, v: 0.72 }, { x: 26, y: 38, v: 0.66 }, { x: 34, y: 46, v: 0.54 },
      { x: 20, y: 40, v: 0.46 }, { x: 32, y: 60, v: 0.38 }, { x: 40, y: 50, v: 0.28 },
    ]),
    actions: {
      shots: MOCK_SHOTS.filter((s) => s.number === 16).concat([
        { id: 61, minute: "11", player: "Endrick", number: 16, team: "away", teamName: "Palmeiras",
          type: "shot", from: { x: 28, y: 48 }, to: { x: 1, y: 44 },
          xg: 0.07, xgot: 0.21, situation: "Arremate de longe", shotType: "Colocado",
          goalZone: "Superior alto", result: "off_target", duration: 1.4 },
      ]),
      passes: [
        { from: { x: 28, y: 50 }, to: { x: 32, y: 26 }, minute: "05", accurate: true, kind: "short" },
        { from: { x: 26, y: 54 }, to: { x: 30, y: 74 }, minute: "28", accurate: true, kind: "short" },
        { from: { x: 22, y: 52 }, to: { x: 24, y: 48 }, minute: "33", accurate: true, kind: "short" },
        { from: { x: 30, y: 50 }, to: { x: 70, y: 50 }, minute: "48", accurate: false, kind: "long" },
        { from: { x: 20, y: 56 }, to: { x: 32, y: 22 }, minute: "69", accurate: true, kind: "throughball" },
        { from: { x: 28, y: 44 }, to: { x: 58, y: 70 }, minute: "74", accurate: true, kind: "short" },
      ],
      dribbles: [
        { from: { x: 32, y: 48 }, to: { x: 22, y: 50 }, minute: "03", successful: true, progressive: true },
        { from: { x: 30, y: 52 }, to: { x: 20, y: 58 }, minute: "15", successful: true, progressive: true },
        { from: { x: 28, y: 48 }, to: { x: 22, y: 44 }, minute: "25", successful: false },
        { from: { x: 36, y: 50 }, to: { x: 20, y: 52 }, minute: "44", successful: true, progressive: true },
        { from: { x: 24, y: 44 }, to: { x: 14, y: 50 }, minute: "62", successful: true, progressive: true },
        { from: { x: 30, y: 46 }, to: { x: 24, y: 40 }, minute: "78", successful: true },
        { from: { x: 34, y: 52 }, to: { x: 26, y: 52 }, minute: "88", successful: false },
      ],
      defenses: [
        { pos: { x: 32, y: 34 }, minute: "13", kind: "recovery" },
        { pos: { x: 44, y: 50 }, minute: "72", kind: "tackle" },
      ],
    },
  },
  // ======== OUTROS JOGADORES COM MENOS DADOS ========
  27: {
    id: 9, number: 27, name: "Bruno Henrique Pinto", nick: "Bruno Henrique", position: "Ponta Esquerda (PE)",
    team: "home", teamName: "Flamengo", pitchPos: { x: 68, y: 25 },
    rating: 7.3, minutes: 76,
    avatar: "https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=Brazilian%20football%20winger%20Bruno%20Henrique%20Flamengo%20profile%20photo%20headshot%20red%20black%20jersey&image_size=square",
    stats: {
      goals: 0, assists: 0, shots: 1, shotsOnTarget: 1, xG: 0.18, xGOT: 0.42,
      passes: 28, passesAcc: 23, passAccPct: 82, crosses: 5, crossAccPct: 60,
      dribbles: 8, dribblesSuc: 5, tackles: 2, interceptions: 1,
      duelsWon: 8, duelsWonPct: 53, touches: 56, fouls: 2, foulsSuffered: 6,
      yellowCards: 0, redCards: 0, aerialWon: 2, offsides: 1, possessions: 38,
    },
    ratingBreakdown: { shooting: 0.52, passing: 0.74, dribbling: 0.8, defending: 0.35, impact: 0.7 },
    personalHeatmap: heatPersonal([
      { x: 68, y: 25, v: 1.0 }, { x: 72, y: 18, v: 0.88 }, { x: 54, y: 18, v: 0.78 },
      { x: 78, y: 32, v: 0.7 }, { x: 82, y: 24, v: 0.56 }, { x: 62, y: 32, v: 0.5 },
    ]),
    actions: {
      shots: MOCK_SHOTS.filter((s) => s.number === 27),
      passes: [
        { from: { x: 68, y: 25 }, to: { x: 74, y: 50 }, minute: "14", accurate: true, kind: "cross" },
        { from: { x: 72, y: 18 }, to: { x: 70, y: 26 }, minute: "22", accurate: true, kind: "short" },
      ],
      dribbles: [
        { from: { x: 52, y: 22 }, to: { x: 70, y: 28 }, minute: "10", successful: true, progressive: true },
      ],
      defenses: [],
    },
  },
  14: {
    id: 7, number: 14, name: "Giorgian Daniel De Arrascaeta", nick: "Arrascaeta", position: "Meia Atacante (MEI)",
    team: "home", teamName: "Flamengo", pitchPos: { x: 42, y: 30 },
    rating: 8.9, minutes: 90,
    avatar: "https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=Uruguayan%20playmaker%20Arrascaeta%20Flamengo%20football%20profile%20photo%20headshot%20red%20black%20jersey&image_size=square",
    stats: {
      goals: 1, assists: 1, shots: 2, shotsOnTarget: 2, xG: 0.44, xGOT: 1.06,
      passes: 62, passesAcc: 57, passAccPct: 92, crosses: 3, crossAccPct: 67,
      dribbles: 5, dribblesSuc: 4, tackles: 3, interceptions: 2,
      duelsWon: 12, duelsWonPct: 63, touches: 96, fouls: 1, foulsSuffered: 8,
      yellowCards: 0, redCards: 0, aerialWon: 2, offsides: 0, possessions: 72,
    },
    ratingBreakdown: { shooting: 0.78, passing: 0.95, dribbling: 0.82, defending: 0.42, impact: 0.97 },
    personalHeatmap: heatPersonal([
      { x: 42, y: 30, v: 1.0 }, { x: 56, y: 32, v: 0.9 }, { x: 32, y: 28, v: 0.86 },
      { x: 48, y: 48, v: 0.76 }, { x: 68, y: 28, v: 0.6 }, { x: 76, y: 28, v: 0.55 },
    ]),
    actions: {
      shots: MOCK_SHOTS.filter((s) => s.number === 14),
      passes: [
        { from: { x: 76, y: 28 }, to: { x: 88, y: 50 }, minute: "78", accurate: true, kind: "throughball" },
      ],
      dribbles: [],
      defenses: [],
    },
  },
};

/** Dataset do Studio para o jogo "demo" (Flamengo × Palmeiras). */
export const DEMO_STUDIO: StudioDataset = {
  match: {
    id: 1,
    source: "demo",
    competition: "Brasileirão Série A · Rodada 22",
    title: MOCK_MATCH.title,
    home: MOCK_MATCH.home,
    away: MOCK_MATCH.away,
    scoreHome: MOCK_MATCH.scoreHome,
    scoreAway: MOCK_MATCH.scoreAway,
    date: MOCK_MATCH.date,
    formationHome: "4-3-3",
    formationAway: "4-2-3-1",
    dataSourceLabel: "dados simulados",
  },
  shots: MOCK_SHOTS,
  heatmapHome: MOCK_HEATMAP_HOME,
  heatmapAway: MOCK_HEATMAP_AWAY,
  startingHome: STARTING_HOME,
  startingAway: STARTING_AWAY,
  players: MOCK_PLAYERS,
};

function easeOutCubic(t: number) { t = Math.max(0, Math.min(1, t)); return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t: number) { t = Math.max(0, Math.min(1, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

/** Interpolação de um colormap por stops (t em 0..1). */
function rampColor(stops: [number, number, number][], t: number) {
  const v = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const pos = v * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const f = pos - i;
  const a = stops[i], b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ] as [number, number, number];
}

// Rampas "sérias" (viridis-like / inferno-like) — sem cores infantis.
const RAMP_HOME: [number, number, number][] = [
  [13, 27, 62], [26, 74, 132], [30, 132, 156], [56, 180, 140], [144, 214, 96],
];
const RAMP_AWAY: [number, number, number][] = [
  [58, 12, 60], [126, 25, 92], [199, 62, 74], [232, 120, 58], [250, 190, 88],
];

/** Cor do mapa de calor (versão profissional, com rampa multi-stop). */
function heatColor2(value: number, team: "home" | "away" = "home") {
  const v = Math.max(0, Math.min(1, value));
  const [r, g, b] = rampColor(team === "home" ? RAMP_HOME : RAMP_AWAY, v);
  return `rgba(${r},${g},${b},${0.08 + v * 0.8})`;
}

type StatTab = "shot" | "pass" | "drib" | "def";

/** Categoria de finalização para o mapa de chutes. */
type ShotKind = "goal" | "on_target" | "off_target";

/** Classifica um lance: gol, chute no alvo (defendido) ou chute pra fora. */
function shotKind(s: { result: Action["result"] }): ShotKind {
  if (s.result === "goal") return "goal";
  if (s.result === "saved") return "on_target";
  return "off_target";
}

/**
 * Marcador de finalização no mapa de chutes:
 *   • gol            → a bola (glifo de futebol) com anel
 *   • chute no alvo  → "bolinha com ponto" (círculo preenchido + ponto branco)
 *   • chute pra fora → "bola sem ponto" (anel vazado, sem ponto no meio)
 */
function ShotMarker({
  x, y, color, kind, r = 2, highlight = false,
}: { x: number; y: number; color: string; kind: ShotKind; r?: number; highlight?: boolean }) {
  if (kind === "goal") {
    return (
      <g>
        <circle cx={x} cy={y} r={r * 2.0} fill="none" stroke={color} strokeWidth={r * (highlight ? 0.34 : 0.24)} opacity={highlight ? 1 : 0.85} />
        <circle cx={x} cy={y} r={r * 1.62} fill="none" stroke={color} strokeWidth={r * 0.13} opacity={0.5} />
        <BallGlyph x={x} y={y} r={r * 1.25} />
      </g>
    );
  }
  const onTarget = kind === "on_target";
  return (
    <g>
      <circle
        cx={x} cy={y} r={r}
        fill={onTarget ? color : "rgba(15,23,42,0.32)"}
        stroke={color}
        strokeWidth={r * (highlight ? 0.42 : 0.3)}
      />
      {onTarget && <circle cx={x} cy={y} r={r * 0.34} fill="#ffffff" />}
    </g>
  );
}

/**
 * Trajetória do chute: linha de `from` até `to` com uma ponta de seta indicando
 * a DIREÇÃO do remate. O `endGap` evita que a seta fique sob o marcador final.
 */
function ShotArrow({
  from, to, color, width = 0.45, opacity = 0.85, endGap = 3.2, dashed = false,
}: { from: Coord; to: Coord; color: string; width?: number; opacity?: number; endGap?: number; dashed?: boolean }) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const tipX = to.x - ux * endGap, tipY = to.y - uy * endGap;
  const baseX = tipX - ux * 1.7, baseY = tipY - uy * 1.7;
  const nx = -uy, ny = ux;
  const head = `${tipX},${tipY} ${baseX + nx * 0.9},${baseY + ny * 0.9} ${baseX - nx * 0.9},${baseY - ny * 0.9}`;
  return (
    <g opacity={opacity}>
      <line x1={from.x} y1={from.y} x2={baseX} y2={baseY} stroke={color} strokeWidth={width}
            strokeLinecap="round" strokeDasharray={dashed ? "1.4 1.1" : undefined} />
      <polygon points={head} fill={color} />
    </g>
  );
}


export function PitchStudio({
  width = 1000, height = 620, datasets = STUDIO_DATASETS, selectedMatchId,
}: {
  width?: number; height?: number; datasets?: StudioDataset[]; selectedMatchId?: number | null;
}) {
  const vb = "0 0 100 100";
  const stroke = "rgba(255,255,255,0.92)";
  const sw = 0.22;
  const [view, setView] = useState<ViewMode>("heatmap");
  const [heatTeam, setHeatTeam] = useState<"home" | "away" | "both">("both");
  const [idx, setIdx] = useState(0);
  // `started` = reprodução iniciada. Enquanto false, mostramos a VISÃO GERAL
  // (trajetória + direção de TODOS os chutes) sem animar nenhum lance.
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [goalPulse, setGoalPulse] = useState(0);
  const [hoverPlayer, setHoverPlayer] = useState<number | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerDetail | null>(null);
  const [statTab, setStatTab] = useState<StatTab>("shot");
  // Popup de gol (estilo SofaScore): abre quando o lance é gol e o lance termina.
  const [goalPopup, setGoalPopup] = useState(false);
  const goalClosedRef = useRef(false);

  // ---- Seleção de partida (demo + jogos reais da API) ----
  const allDatasets = useMemo(() => [DEMO_STUDIO, ...datasets], [datasets]);
  const [activeId, setActiveId] = useState<number>(() => {
    const wanted = studioDatasetForMatch(selectedMatchId);
    return wanted ? wanted.match.id : DEMO_STUDIO.match.id;
  });
  const ds = useMemo(
    () => allDatasets.find((d) => d.match.id === activeId) ?? allDatasets[0],
    [allDatasets, activeId],
  );
  const matchInfo = ds.match;
  const shots = ds.shots;
  const homeStar = useMemo(() => Object.values(ds.players).find((p) => p.team === "home"), [ds]);
  const awayStar = useMemo(() => Object.values(ds.players).find((p) => p.team === "away"), [ds]);

  useEffect(() => {
    const wanted = studioDatasetForMatch(selectedMatchId);
    if (wanted) setActiveId(wanted.match.id);
  }, [selectedMatchId]);

  useEffect(() => {
    setIdx(0); progressRef.current = 0; setProgress(0); setPlaying(false); setStarted(false); setSelectedPlayer(null);
    setGoalPulse(0); setGoalPopup(false); goalClosedRef.current = false;
  }, [ds]);

  const filtered = useMemo(() => {
    if (view === "goals") return shots.filter((s) => s.result === "goal");
    if (view === "onTarget") return shots.filter((s) => s.result === "goal" || s.result === "saved");
    if (view === "shots") return shots;
    return [];
  }, [view, shots]);

  const current = filtered[idx];

  const isShotView = view === "shots" || view === "onTarget" || view === "goals";

  useEffect(() => {
    setIdx(0); progressRef.current = 0; setProgress(0); setPlaying(false); setStarted(false);
    setGoalPulse(0); setGoalPopup(false); goalClosedRef.current = false;
  }, [view, filtered.length]);

  useEffect(() => {
    if (!started || !playing || !current || view === "heatmap" || view === "positions") {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const dur = (current.duration || 1.8) * 1000;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last; last = now; progressRef.current += dt;
      const p = Math.min(1, progressRef.current / dur);
      setProgress(p);
      if (p >= 1) {
        setPlaying(false);
        if (current.result === "goal") {
          let g = 0;
          const gp = () => {
            g += 30;
            setGoalPulse(Math.min(1, g / 900));
            if (g < 900) requestAnimationFrame(gp);
            else if (!goalClosedRef.current) setGoalPopup(true);
          };
          requestAnimationFrame(gp);
        } else {
          setTimeout(() => {
            if (idx < filtered.length - 1) { setIdx(i => i + 1); progressRef.current = 0; setProgress(0); setPlaying(true); }
          }, 500);
        }
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [started, playing, current, view, idx, filtered.length]);

  /** Inicia a reprodução do lance atual (limpa progresso e toca). */
  const startPlayback = () => {
    progressRef.current = 0; setProgress(0); setGoalPulse(0); setGoalPopup(false);
    goalClosedRef.current = false; setStarted(true); setPlaying(true);
  };
  /** Botão principal: inicia a reprodução ou pausa/continua o lance atual. */
  const restart = () => {
    if (!started) { startPlayback(); return; }
    if (playing) { setPlaying(false); return; }
    const done = progressRef.current >= (current?.duration ?? 1.8) * 1000;
    if (done) startPlayback();
    else setPlaying(true);
  };
  const goPrev = () => { if (idx > 0) { setIdx(idx - 1); startPlayback(); } };
  const goNext = () => { if (idx < filtered.length - 1) { setIdx(idx + 1); startPlayback(); } };
  /** Fecha o popup de gol e segue para o próximo lance (ou reinicia). */
  const closeGoalPopup = () => {
    goalClosedRef.current = true;
    setGoalPopup(false);
    setGoalPulse(0);
    setTimeout(() => {
      if (idx < filtered.length - 1) { setIdx(i => i + 1); progressRef.current = 0; setProgress(0); goalClosedRef.current = false; setPlaying(true); }
    }, 220);
  };

  const t = easeOutCubic(progress);
  const fromScreen = current ? { x: current.from.x, y: current.from.y } : null;
  const toScreen = current ? { x: current.to.x, y: current.to.y } : null;
  const ballLift = Math.sin(progress * Math.PI) * 2.2;
  const ballX = fromScreen && toScreen ? fromScreen.x + (toScreen.x - fromScreen.x) * t : 50;
  const ballY = fromScreen && toScreen ? fromScreen.y + (toScreen.y - fromScreen.y) * t - ballLift : 50;
  const ballGroundY = fromScreen && toScreen ? fromScreen.y + (toScreen.y - fromScreen.y) * t : 50;
  const assistFrom = current?.assistant?.from ? { x: current.assistant.from.x, y: current.assistant.from.y } : null;

  const heatPts = useMemo(() => {
    const pts: { pt: HeatPoint; team: "home" | "away" }[] = [];
    if (heatTeam === "home" || heatTeam === "both") ds.heatmapHome.forEach(p => pts.push({ pt: p, team: "home" }));
    if (heatTeam === "away" || heatTeam === "both") ds.heatmapAway.forEach(p => pts.push({ pt: p, team: "away" }));
    return pts;
  }, [heatTeam, ds]);

  // Jogadores com detalhes clicáveis
  const allPlayers = useMemo(() => {
    const merge = (list: typeof ds.startingHome, team: "home" | "away") =>
      list.map((p) => ({
        ...p, team,
        detail: ds.players[p.number] as PlayerDetail | undefined,
        color: team === "home" ? HOME_COLOR : AWAY_COLOR,
      }));
    return [...merge(ds.startingHome, "home"), ...merge(ds.startingAway, "away")];
  }, [ds]);

  return (
    <div className="sv-card overflow-hidden relative">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-center justify-between gap-3 border-b border-sv-border/70">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-semibold tracking-tight text-[15px]">{matchInfo.title}</div>
            <div className="sv-chip">{matchInfo.date}</div>
            <div className={`sv-chip ${matchInfo.source === "api" ? "!border-sv-accent3/50 !text-sv-accent3" : ""}`}>
              {matchInfo.source === "api" ? "● API real" : "● demo"}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 rounded-full" style={{ background: HOME_COLOR, boxShadow: "0 0 8px rgba(59,130,246,.5)" }} />
              <span className="text-sm font-medium">{matchInfo.home}</span>
            </div>
            <div className="font-mono text-xl font-bold tabular-nums text-white/95">
              {matchInfo.scoreHome} <span className="text-sv-muted mx-1">–</span> {matchInfo.scoreAway}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{matchInfo.away}</span>
              <div className="w-3.5 h-3.5 rounded-full" style={{ background: AWAY_COLOR, boxShadow: "0 0 8px rgba(225,83,78,.5)" }} />
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          {([ "heatmap", "shots", "onTarget", "goals", "positions" ] as ViewMode[]).map((m) => (
            <button key={m} onClick={() => { setView(m); if (m === "positions") setStatTab("shot"); }}
              className={`sv-btn !py-1.5 !px-3 text-[12.5px] ${view === m ? "!bg-sv-accent text-white !border-sv-accent3 shadow-glow" : ""}`}>
              {m === "heatmap" ? "🔥 Mapa de calor" : m === "shots" ? "⚽ Chutes" : m === "onTarget" ? "🎯 Chutes a Gol" : m === "goals" ? "🥅 Gols" : "👥 Posições"}
            </button>
          ))}
        </div>
      </div>

      {/* Seletor de partida: demo + jogos reais da API */}
      {allDatasets.length > 1 && (
        <div className="px-5 py-2.5 flex items-center gap-2 overflow-x-auto border-b border-sv-border/50 bg-sv-panel/40">
          <span className="text-[10px] uppercase tracking-widest text-sv-muted shrink-0">Partida</span>
          {allDatasets.map((d) => {
            const active = d.match.id === matchInfo.id;
            return (
              <button key={d.match.id} onClick={() => setActiveId(d.match.id)} title={d.match.competition}
                className={`sv-btn !py-1 !px-2.5 text-[12px] whitespace-nowrap shrink-0 ${active ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                <span className={`mr-1.5 text-[10px] font-semibold ${d.match.source === "api" ? "text-sv-accent3" : "text-sv-muted"}`}>
                  {d.match.source === "api" ? "API" : "DEMO"}
                </span>
                {d.match.home} <span className="text-sv-muted mx-0.5">×</span> {d.match.away}
              </button>
            );
          })}
        </div>
      )}

      {/* Sub controls */}
      <div className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 bg-sv-panel2/40 border-b border-sv-border/50">
        {view === "heatmap" ? (
          <div className="flex gap-1">
            {(["both", "home", "away"] as const).map((t) => (
              <button key={t} onClick={() => setHeatTeam(t)}
                className={`sv-btn !py-1 text-[11.5px] capitalize ${heatTeam === t ? "!bg-sv-accent text-white !border-sv-accent3" : ""}`}>
                {t === "both" ? "Ambos" : t === "home" ? matchInfo.home : matchInfo.away}
              </button>
            ))}
          </div>
        ) : view === "positions" ? (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="sv-chip-accent">👥 22 jogadores em campo</span>
            <span className="text-xs text-sv-muted">
              Clique no camisa dos atacantes <span className="text-white/90 font-medium">{homeStar ? `${homeStar.nick || homeStar.name} #${homeStar.number}` : "—"}</span> ou{" "}
              <span className="text-white/90 font-medium">{awayStar ? `${awayStar.nick || awayStar.name} #${awayStar.number}` : "—"}</span> para abrir estatísticas completas
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="sv-chip-accent">{started ? `${current?.minute || "—"}'` : "👁 Visão geral"}</span>
            <span className="text-sm text-white/80 font-medium">
              {started ? `${idx + 1} / ${filtered.length || 0}` : `${filtered.length} finalizações`}
            </span>
            <span className="text-xs text-sv-muted">
              {started && current ? `${current.player} · ${current.teamName}` : "▶ Reproduzir para ver os lances"}
            </span>
            {/* Legenda dos marcadores */}
            <span className="flex items-center gap-3 ml-1 pl-3 border-l border-sv-border/60 text-[11px] text-sv-muted">
              <span className="flex items-center gap-1.5" title="Gol">
                <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                  <circle cx="7.5" cy="7.5" r="6.4" fill="#fff" stroke="#0f172a" strokeWidth="0.9" />
                  <polygon points="7.5,4.4 10,6.2 9,9.2 6,9.2 5,6.2" fill="#0f172a" />
                  <circle cx="7.5" cy="7.5" r="1" fill="#0f172a" />
                </svg>
                Gol
              </span>
              <span className="flex items-center gap-1.5" title="Chute no alvo (defendido)">
                <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                  <circle cx="7.5" cy="7.5" r="5.9" fill={HOME_COLOR} stroke={HOME_COLOR} strokeWidth="2" />
                  <circle cx="7.5" cy="7.5" r="2" fill="#fff" />
                </svg>
                No alvo
              </span>
              <span className="flex items-center gap-1.5" title="Chute pra fora">
                <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden>
                  <circle cx="7.5" cy="7.5" r="5.9" fill="rgba(15,23,42,0.35)" stroke={HOME_COLOR} strokeWidth="2" />
                </svg>
                Pra fora
              </span>
            </span>
          </div>
        )}
        {isShotView && (
          <div className="flex items-center gap-1.5">
            <button onClick={goPrev} disabled={idx === 0} className="sv-btn !py-1 !px-2.5 text-[12px]" title="Anterior">⏮</button>
            <button onClick={restart} className="sv-btn-primary !py-1 !px-3.5 text-[12px]">
              {!started ? "▶ Reproduzir" : playing ? "⏸ Pausar" : "▶ Reproduzir lance"}
            </button>
            <button onClick={goNext} disabled={idx === Math.max(0, filtered.length - 1)} className="sv-btn !py-1 !px-2.5 text-[12px]" title="Próximo">⏭</button>
          </div>
        )}
      </div>

      {/* Main area + drawer */}
      <div className="flex">
        {/* Pitch canvas */}
        <div className={`flex-1 p-3 md:p-5 transition-all ${selectedPlayer ? "lg:mr-0" : ""}`}>
          <div className="rounded-2xl overflow-hidden border border-white/10 relative" style={{
            background:
              "radial-gradient(120% 90% at 50% 0%, rgba(255,255,255,0.12), transparent 55%)," +
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0 46px, rgba(0,0,0,0.055) 46px 92px)," +
              "linear-gradient(180deg, #2f8f57 0%, #1e7c48 48%, #14562f 100%)",
          }}>
            {/* vignette/sombreamento para dar profundidade */}
            <div className="pointer-events-none absolute inset-0"
                 style={{ background: "radial-gradient(120% 120% at 50% 40%, transparent 55%, rgba(0,0,0,0.34) 100%)" }} />
            <svg viewBox={vb} width="100%" preserveAspectRatio="xMidYMid meet"
                 style={{ display: "block", aspectRatio: `${width} / ${height}`, position: "relative" }}>
              <defs>
                <JerseyDefs />
                <pattern id="grassTex" width="6" height="6" patternUnits="userSpaceOnUse">
                  <rect width="6" height="6" fill="transparent" />
                  <circle cx="1.2" cy="1.6" r="0.14" fill="rgba(255,255,255,0.06)" />
                  <circle cx="4.4" cy="3.1" r="0.12" fill="rgba(0,0,0,0.08)" />
                  <circle cx="2.9" cy="5.2" r="0.1" fill="rgba(255,255,255,0.05)" />
                </pattern>
                <pattern id="goalNet" width="1.9" height="1.9" patternUnits="userSpaceOnUse">
                  <path d="M0 0.45 H1.9 M0.45 0 V1.9" stroke="rgba(255,255,255,0.30)" strokeWidth="0.11" />
                </pattern>
                <linearGradient id="goalFrame" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgba(255,255,255,0.98)" />
                  <stop offset="100%" stopColor="rgba(226,232,240,0.9)" />
                </linearGradient>
                <radialGradient id="heatGradHome" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(46,132,160,0.92)" />
                  <stop offset="42%" stopColor="rgba(30,110,150,0.62)" />
                  <stop offset="72%" stopColor="rgba(26,74,132,0.28)" />
                  <stop offset="100%" stopColor="rgba(13,27,62,0)" />
                </radialGradient>
                <radialGradient id="heatGradAway" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="rgba(232,120,58,0.92)" />
                  <stop offset="42%" stopColor="rgba(199,62,74,0.62)" />
                  <stop offset="72%" stopColor="rgba(126,25,92,0.28)" />
                  <stop offset="100%" stopColor="rgba(58,12,60,0)" />
                </radialGradient>
                <filter id="blurHeat" x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur in="SourceGraphic" stdDeviation="1.15" /></filter>
                <filter id="blurHeat2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur in="SourceGraphic" stdDeviation="0.55" /></filter>
                <filter id="softGlow"><feGaussianBlur stdDeviation="0.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
              </defs>

              {/* textura de grama + faixas de corte */}
              <rect x="0" y="0" width="100" height="100" fill="url(#grassTex)" />
              {Array.from({ length: 12 }).map((_, i) => (
                <rect key={`stripe-${i}`} x={(100 / 12) * i} y="0" width={100 / 12} height="100"
                      fill={i % 2 === 0 ? "rgba(255,255,255,0.028)" : "rgba(0,0,0,0.045)"} />
              ))}

              {/* Heatmap blobs (blend aditivo p/ interseções mais densas) */}
              {view === "heatmap" && (
                <g style={{ mixBlendMode: "screen" }}>
                  {heatPts.map((h, i) => {
                    const size = 9 + h.pt.intensity * 15;
                    return (
                      <ellipse key={`h-${i}`} cx={h.pt.x} cy={h.pt.y} rx={size * 1.42} ry={size * 0.98}
                               filter="url(#blurHeat)" opacity={0.9}
                               fill={h.team === "home" ? "url(#heatGradHome)" : "url(#heatGradAway)"} />
                    );
                  })}
                </g>
              )}
              {view === "heatmap" && heatPts.map((h, i) => (
                <g key={`hd-${i}`} opacity={0.55}>
                  <circle cx={h.pt.x} cy={h.pt.y} r={0.5} fill="#ffffff" />
                  <circle cx={h.pt.x} cy={h.pt.y} r={1.0} fill="none" stroke="#ffffff" strokeWidth={0.12} />
                </g>
              ))}

              {/* Markings */}
              <g filter="url(#softGlow)" strokeLinecap="round">
                <rect x="1" y="1" width="98" height="98" fill="none" stroke={stroke} strokeWidth={sw * 1.25} rx="0.4" />
                <line x1="50" y1="1" x2="50" y2="99" stroke={stroke} strokeWidth={sw} />
                <circle cx="50" cy="50" r="9.15" fill="none" stroke={stroke} strokeWidth={sw} />
                <circle cx="50" cy="50" r="0.5" fill={stroke} stroke="none" />
                <rect x="1" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
                <rect x="1" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
                <circle cx="16" cy="50" r="0.5" fill={stroke} stroke="none" />
                <path d={`M16,${50 - 7.3} A9.15 9.15 0 0 1 16,${50 + 7.3}`} fill="none" stroke={stroke} strokeWidth={sw} />
                <rect x="83" y="21" width="16" height="58" fill="none" stroke={stroke} strokeWidth={sw} />
                <rect x="93" y="34" width="6" height="32" fill="none" stroke={stroke} strokeWidth={sw} />
                <circle cx="84" cy="50" r="0.5" fill={stroke} stroke="none" />
                <path d={`M84,${50 - 7.3} A9.15 9.15 0 0 0 84,${50 + 7.3}`} fill="none" stroke={stroke} strokeWidth={sw} />
                {/* arcos de canto */}
                <path d="M1,3 A2,2 0 0 0 3,1" fill="none" stroke={stroke} strokeWidth={sw * 0.85} />
                <path d="M99,3 A2,2 0 0 1 97,1" fill="none" stroke={stroke} strokeWidth={sw * 0.85} />
                <path d="M1,97 A2,2 0 0 1 3,99" fill="none" stroke={stroke} strokeWidth={sw * 0.85} />
                <path d="M99,97 A2,2 0 0 0 97,99" fill="none" stroke={stroke} strokeWidth={sw * 0.85} />
              </g>

              {/* Gols (rede + moldura com profundidade) */}
              {[{ x: 0.7, flip: false }, { x: 99.3, flip: true }].map((g, gi) => (
                <g key={`goal-${gi}`}>
                  <rect x={g.flip ? g.x - 2.4 : g.x} y="44.6" width="2.4" height="10.8" fill="url(#goalNet)" stroke="none" />
                  <rect x={g.flip ? g.x - 2.4 : g.x} y="44.6" width="2.4" height="10.8"
                        fill="none" stroke="url(#goalFrame)" strokeWidth={sw * 1.9} rx="0.2" />
                  <line x1={g.x} y1="44.6" x2={g.flip ? g.x - 1.5 : g.x + 1.5} y2="43.4" stroke="rgba(255,255,255,0.75)" strokeWidth={sw * 1.1} />
                  <line x1={g.x} y1="55.4" x2={g.flip ? g.x - 1.5 : g.x + 1.5} y2="56.6" stroke="rgba(255,255,255,0.75)" strokeWidth={sw * 1.1} />
                  <line x1={g.flip ? g.x - 1.5 : g.x + 1.5} y1="43.4" x2={g.flip ? g.x - 1.5 : g.x + 1.5} y2="56.6"
                        stroke="rgba(255,255,255,0.6)" strokeWidth={sw * 0.9} />
                </g>
              ))}

              {/* POSITIONS VIEW: JOGADORES CLICÁVEIS */}
              {view === "positions" && (
                <g>
                  {allPlayers.map((p) => {
                    const hasDetail = !!p.detail;
                    const isHover = hoverPlayer === p.number;
                    const isSel = selectedPlayer?.number === p.number;
                    const clickable = hasDetail;
                    return (
                      <g key={`pos-${p.number}`}
                        style={{ cursor: clickable ? "pointer" : "default" }}
                        onMouseEnter={() => clickable && setHoverPlayer(p.number)}
                        onMouseLeave={() => setHoverPlayer(null)}
                        onClick={() => { if (hasDetail) { setSelectedPlayer(p.detail!); setStatTab("shot"); } }}
                      >
                        {/* Outer pulse */}
                        {(isHover || isSel) && (
                          <>
                            <circle cx={p.pitchPos.x} cy={p.pitchPos.y} r={5.8} fill="none" stroke={p.color} strokeWidth="0.3" opacity="0.7" />
                            <circle cx={p.pitchPos.x} cy={p.pitchPos.y} r={7.5} fill="none" stroke={p.color} strokeWidth="0.15" opacity="0.45" />
                          </>
                        )}
                        {/* Clickable indicator ring */}
                        {clickable && (
                          <circle cx={p.pitchPos.x} cy={p.pitchPos.y} r="3.6" fill="none" stroke="#fde047" strokeWidth={isHover || isSel ? "0.38" : "0.18"}
                            strokeDasharray="0.8 0.5" opacity={isHover || isSel ? 1 : 0.6} />
                        )}
                        {/* Camisa do jogador (jersey) */}
                        <JerseyGlyph
                          number={p.number}
                          color={p.color}
                          x={p.pitchPos.x}
                          y={p.pitchPos.y}
                          size={isHover || isSel ? 8.4 : 7.6}
                          outline={isSel ? "#fde047" : "rgba(255,255,255,0.95)"}
                          outlineWidth={isSel || isHover ? 0.5 : 0.38}
                        />
                        {/* Tooltip on hover */}
                        {isHover && (
                          <g>
                            <rect x={p.pitchPos.x - 11} y={p.pitchPos.y - 12.5} width="22" height="4.6" rx="0.6"
                              fill="rgba(15,23,42,0.95)" stroke="rgba(255,255,255,0.2)" strokeWidth="0.15" />
                            <text x={p.pitchPos.x} y={p.pitchPos.y - 9.5} textAnchor="middle" fontSize="1.75" fill="white" fontWeight="700">
                              {(p.detail?.nick || p.name).slice(0, 14)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              )}

              {/* Marcadores + trajetória/direção de TODOS os chutes.
                  • gol → bola · no alvo → bolinha com ponto · pra fora → bola sem ponto */}
              {isShotView && filtered.map((s, i) => {
                const isCur = i === idx;
                const color = s.team === "home" ? HOME_COLOR : AWAY_COLOR;
                const kind = shotKind(s);
                // Visão geral (antes de reproduzir): todos ativos. Ao reproduzir: só o atual destaca.
                const active = !started || isCur;
                const markerR = kind === "goal" ? (active ? 2.1 : 1.6) : (active ? 2.2 : 1.7);
                return (
                  <g key={`sm-${s.id}`}>
                    <ShotArrow
                      from={s.from}
                      to={s.to}
                      color={color}
                      width={active ? 0.5 : 0.3}
                      opacity={active ? 0.92 : 0.26}
                      endGap={kind === "goal" ? 4.8 : 3.4}
                    />
                    <circle cx={s.from.x} cy={s.from.y} r={active ? 0.85 : 0.55} fill={color} opacity={active ? 0.9 : 0.35} />
                    <ShotMarker x={s.to.x} y={s.to.y} color={color} kind={kind} r={markerR} highlight={active} />
                  </g>
                );
              })}

              {/* Anima o lance atual SOMENTE depois de apertar ▶ Reproduzir */}
              {started && current && fromScreen && toScreen && isShotView && (
                <g>
                  {assistFrom && <line x1={assistFrom.x} y1={assistFrom.y} x2={fromScreen.x} y2={fromScreen.y} stroke="rgba(255,255,255,0.55)" strokeWidth="0.3" strokeDasharray="1.2 1" />}
                  <line x1={fromScreen.x} y1={fromScreen.y} x2={fromScreen.x + (toScreen.x - fromScreen.x) * t}
                        y2={fromScreen.y + (toScreen.y - fromScreen.y) * t - Math.sin(t * Math.PI) * 0.8}
                        stroke={current.result === "goal" ? "#86efac" : "#fcd34d"} strokeWidth="0.55" strokeLinecap="round" />
                  {progress > 0.08 && Array.from({ length: 5 }).map((_, k) => {
                    const tp = Math.max(0, progress - (5 - k) * 0.025);
                    const te = easeOutCubic(tp);
                    const tx = fromScreen.x + (toScreen.x - fromScreen.x) * te;
                    const ty = fromScreen.y + (toScreen.y - fromScreen.y) * te - Math.sin(tp * Math.PI) * 2.2;
                    return <circle key={`tr-${k}`} cx={tx} cy={ty} r={0.9 - k * 0.12} fill="white" opacity={(k + 1) * 0.13} />;
                  })}
                  <JerseyGlyph
                    number={current.number}
                    color={current.team === "home" ? HOME_COLOR : AWAY_COLOR}
                    x={fromScreen.x}
                    y={fromScreen.y}
                    size={7.6}
                    outlineWidth={0.4}
                  />
                  <ellipse cx={ballX} cy={ballGroundY + 0.2} rx={0.7 + (1 - Math.sin(progress * Math.PI)) * 0.3} ry={0.28} fill="rgba(0,0,0,0.5)" />
                  <BallGlyph x={ballX} y={ballY} r={1.35} rotate={progress * 540} />
                  {current.result === "goal" && goalPulse > 0 && (
                    <g>
                      <circle cx={toScreen.x} cy={toScreen.y} r={3 + goalPulse * 14} fill="none" stroke="#22c55e" strokeWidth={1 - goalPulse} opacity={1 - goalPulse} />
                      <circle cx={toScreen.x} cy={toScreen.y} r={2 + goalPulse * 9} fill="none" stroke="#fde047" strokeWidth={0.8 - goalPulse * 0.7} opacity={(1 - goalPulse) * 0.8} />
                    </g>
                  )}
                </g>
              )}
            </svg>
            {/* POPUP DE GOL — mostra a bola entrando no gol (estilo SofaScore) */}
            {goalPopup && current && current.result === "goal" && (
              <div className="goal-overlay">
                <div className="goal-popup" style={{ transform: `scale(${0.94 + easeInOutCubic(Math.min(1, goalPulse + 0.4)) * 0.06})` }}>
                  <GoalPopupVisual
                    shot={current}
                    home={matchInfo.home}
                    away={matchInfo.away}
                    scoreHome={matchInfo.scoreHome}
                    scoreAway={matchInfo.scoreAway}
                    onClose={closeGoalPopup}
                  />
                </div>
              </div>
            )}

            {current?.result === "goal" && goalPulse > 0.15 && (
              <div className="absolute top-5 left-1/2 -translate-x-1/2 px-6 py-2 rounded-full font-bold tracking-wider text-xl bg-gradient-to-r from-emerald-500 to-emerald-400 text-white shadow-2xl"
                   style={{ opacity: Math.min(1, goalPulse * 2.4), transform: `translateX(-50%) scale(${0.85 + easeInOutCubic(goalPulse) * 0.2})` }}>
                ⚽ GOOOOOL · {current.player}
              </div>
            )}
          </div>

          {/* Progress + info grid */}
          <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
            {isShotView && current ? (
              <>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className={`px-3 py-1.5 rounded-lg text-xs font-bold text-center mb-3 tracking-wide
                    ${current.result === "goal" ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-white" :
                      current.result === "saved" ? "bg-gradient-to-r from-amber-500 to-amber-400 text-white" :
                      "bg-gradient-to-r from-rose-500 to-rose-400 text-white"}`}>
                    {current.result === "goal" ? "🎯 GOL" : current.result === "saved" ? "🧤 DEFENDIDO" : current.result === "off_target" ? "↗ FORA" : "🛡 BLOQUEADO"}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0">
                      <JerseyBadge number={current.number} color={current.team === "home" ? HOME_COLOR : AWAY_COLOR} size={56} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{current.player}</div>
                      <div className="text-xs text-sv-muted mt-0.5">{current.teamName} · {current.minute}'</div>
                      {current.assistant && <div className="text-[11px] text-sv-muted mt-1">🎯 Assistência: <span className="text-white/80">{current.assistant.name}</span></div>}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between"><span className="text-xs text-sv-muted">xG (chance)</span><span className="font-mono font-bold text-sm">{current.xg.toFixed(2)}</span></div>
                  <div className="h-1.5 rounded-full bg-sv-panel overflow-hidden"><div className="h-full bg-gradient-to-r from-sv-accent to-sv-accent3 rounded-full" style={{ width: `${Math.min(100, current.xg * 200)}%` }} /></div>
                  <div className="flex items-center justify-between"><span className="text-xs text-sv-muted">xGOT (no alvo)</span><span className={`font-mono font-bold text-sm ${current.xgot >= 0.7 ? "text-emerald-400" : ""}`}>{current.xgot.toFixed(2)}</span></div>
                  <div className="h-1.5 rounded-full bg-sv-panel overflow-hidden"><div className={`h-full rounded-full ${current.xgot >= 0.7 ? "bg-gradient-to-r from-emerald-500 to-emerald-300" : "bg-gradient-to-r from-amber-500 to-amber-300"}`} style={{ width: `${current.xgot * 100}%` }} /></div>
                  <div className="pt-1 grid grid-cols-2 gap-1.5 text-[11px]">
                    <div className="bg-sv-panel rounded-md px-2 py-1"><div className="text-sv-muted">Situação</div><div className="text-white/90 font-medium truncate">{current.situation}</div></div>
                    <div className="bg-sv-panel rounded-md px-2 py-1"><div className="text-sv-muted">Tipo</div><div className="text-white/90 font-medium truncate">{current.shotType}</div></div>
                  </div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="text-xs font-semibold text-sv-muted mb-2 tracking-wide text-center">MAPA DO GOL</div>
                  <div className="relative mx-auto rounded-lg overflow-hidden border border-white/10" style={{ background: "#0f172a", aspectRatio: "16 / 10", width: "100%", maxWidth: 240 }}>
                    <div className="absolute inset-2 rounded-md border-2 border-white/85" />
                    <svg viewBox="0 0 100 62" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                      {Array.from({ length: 11 }).map((_, i) => <line key={`gv-${i}`} x1={10 + i * 8} y1="15" x2={10 + i * 8} y2="52" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />)}
                      {Array.from({ length: 6 }).map((_, i) => <line key={`gh-${i}`} x1="10" y1={15 + i * 7.2} x2="90" y2={15 + i * 7.2} stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />)}
                      {current.goalLoc ? (
                        <g>
                          <circle cx={10 + current.goalLoc.x * 80} cy={15 + current.goalLoc.y * 37} r="4" fill={current.result === "goal" ? "#22c55e" : "#ef4444"} stroke="white" strokeWidth="0.8" />
                          {current.result === "goal" && <circle cx={10 + current.goalLoc.x * 80} cy={15 + current.goalLoc.y * 37} r="7" fill="none" stroke="#22c55e" strokeWidth="0.6" opacity="0.6" />}
                        </g>
                      ) : <text x="50" y="38" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)">Fora do alvo</text>}
                    </svg>
                  </div>
                  {current.goalZone && <div className="text-center text-[11px] text-sv-muted mt-2">Zona: <span className="text-white/85 font-medium">{current.goalZone}</span></div>}
                </div>
              </>
            ) : view === "heatmap" ? (
              <>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="flex items-center gap-2 mb-2.5"><div className="w-3 h-3 rounded-sm" style={{ background: heatColor2(0.7, "home") }} /><div className="text-sm font-semibold">{matchInfo.home} · Ocupação</div></div>
                  <div className="text-xs text-sv-muted leading-relaxed">4-3-3 ofensivo: pontas altas + centroavante fixo na área.</div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="flex items-center gap-2 mb-2.5"><div className="w-3 h-3 rounded-sm" style={{ background: heatColor2(0.7, "away") }} /><div className="text-sm font-semibold">{matchInfo.away} · Ocupação</div></div>
                  <div className="text-xs text-sv-muted leading-relaxed">4-2-3-1 compacto: volantes centrais + Endrick explorando velocidade.</div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="text-sm font-semibold mb-2.5">Legenda</div>
                  <div className="space-y-1.5 text-[11px]">
                    {[1, 0.75, 0.5, 0.25].map((v) => (
                      <div key={v} className="flex items-center gap-2">
                        <div className="w-10 h-3 rounded-sm" style={{ background: `linear-gradient(90deg, ${heatColor2(v, "home")}, ${heatColor2(v, "away")})` }} />
                        <span className="text-sv-muted">{">"} {Math.round(v * 100)}% intensidade</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="flex items-center gap-2 mb-2"><div className="w-3 h-3 rounded-full" style={{ background: HOME_COLOR }} /><div className="text-sm font-semibold">{matchInfo.home} · {matchInfo.formationHome || "4-3-3"}</div></div>
                  <div className="text-xs text-sv-muted">Anel dourado = jogador com perfil completo clicável</div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="flex items-center gap-2 mb-2"><div className="w-3 h-3 rounded-full" style={{ background: AWAY_COLOR }} /><div className="text-sm font-semibold">{matchInfo.away} · {matchInfo.formationAway || "4-2-3-1"}</div></div>
                  <div className="text-xs text-sv-muted">Clique em <span className="text-white/90 font-medium">#{homeStar?.number ?? "9"}</span> ou <span className="text-white/90 font-medium">#{awayStar?.number ?? "16"}</span> para abrir as stats</div>
                </div>
                <div className="rounded-xl border border-sv-border bg-sv-panel2/60 p-3.5">
                  <div className="text-sm font-semibold mb-2">🎯 Jogadores com ficha completa</div>
                  <div className="space-y-1.5">
                    {Object.values(ds.players).slice(0, 4).map((pd) => (
                      <button key={pd.number} onClick={() => { setView("positions"); setSelectedPlayer(pd); setStatTab("shot"); }}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md hover:bg-sv-panel transition text-left">
                        <div className="flex items-center gap-2 min-w-0">
                          <JerseyBadge number={pd.number} color={pd.team === "home" ? HOME_COLOR : AWAY_COLOR} size={26} />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{pd.nick || pd.name}</div>
                            <div className="text-[10px] text-sv-muted truncate">{pd.position}</div>
                          </div>
                        </div>
                        <div className="font-bold text-emerald-400 text-sm">{pd.rating.toFixed(1)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {isShotView && (
            <div className="mt-4 flex items-center gap-3">
              <span className="text-[10px] text-sv-muted font-mono tabular-nums w-10 text-right">{Math.round(progress * 100)}%</span>
              <div className="flex-1 h-1.5 rounded-full bg-sv-panel overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-sv-accent via-sv-accent2 to-sv-accent3 transition-[width] duration-75" style={{ width: `${progress * 100}%` }} />
              </div>
              <span className="text-[10px] text-sv-muted font-mono tabular-nums w-10">100%</span>
            </div>
          )}
        </div>

        {/* ====================== PAINEL LATERAL DE JOGADOR ====================== */}
        {selectedPlayer && (
          <PlayerDrawer
            player={selectedPlayer}
            teamColor={selectedPlayer.team === "home" ? HOME_COLOR : AWAY_COLOR}
            tab={statTab}
            setTab={setStatTab}
            onClose={() => setSelectedPlayer(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ============== COMPONENTE SEPARADO: DRAWER DE JOGADOR (Estilo Sofascore) ============== */
function PlayerDrawer({ player, teamColor, tab, setTab, onClose }: {
  player: PlayerDetail; teamColor: string; tab: StatTab; setTab: (t: StatTab) => void; onClose: () => void;
}) {
  const p = player;
  const rb = p.ratingBreakdown;
  const ratingColor = p.rating >= 8 ? "bg-emerald-500" : p.rating >= 7 ? "bg-sky-500" : p.rating >= 6 ? "bg-amber-500" : "bg-slate-500";

  return (
    <div className="w-full lg:w-[420px] xl:w-[460px] shrink-0 border-l border-sv-border bg-sv-panel2/70 backdrop-blur max-h-[900px] overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-sv-border flex items-start gap-3"
           style={{ background: `linear-gradient(180deg, ${teamColor}33, transparent)` }}>
        {/* Avatar + camisa do jogador */}
        <div className="relative shrink-0">
          <img src={p.avatar} alt={p.nick || p.name}
               onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
               className="w-24 h-24 rounded-2xl border-2 border-white/15 object-cover bg-slate-800 shadow-lg" />
          <div className="absolute -bottom-2 -right-2">
            <JerseyBadge number={p.number} color={teamColor} size={40} />
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-extrabold text-lg tracking-tight truncate">{p.nick || p.name}</div>
              <div className="text-[11px] text-sv-muted truncate">{p.position} · {p.teamName}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={onClose} className="w-8 h-8 rounded-lg grid place-items-center text-sv-muted hover:text-white hover:bg-white/5 transition" title="Minimizar">–</button>
              <button onClick={onClose} className="w-8 h-8 rounded-lg grid place-items-center text-sv-muted hover:text-white hover:bg-white/5 transition" title="Fechar">✕</button>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {p.injured && <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[11px] font-semibold border border-rose-500/30">✚ Contundido</span>}
            <div className="flex items-center gap-1.5">
              <span className={`${ratingColor} px-2 py-0.5 rounded-md text-white text-sm font-extrabold shadow-md inline-block min-w-[40px] text-center tabular-nums`}>
                {p.rating.toFixed(1)}
              </span>
              <span className="text-[11px] text-sv-muted">Avaliação ScoutVision</span>
            </div>
            <span className="px-2 py-0.5 rounded-md bg-sv-panel text-[11px] text-white/85 border border-sv-border">⏱ {p.minutes}' jogados</span>
          </div>
        </div>
      </div>

      {/* Scroll area */}
      <div className="flex-1 overflow-y-auto pr-1 space-y-4">
        {/* Stats grid */}
        <div className="px-4 pt-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <StatMini label="Gols" value={p.stats.goals} accent="text-emerald-400" />
            <StatMini label="Assistências" value={p.stats.assists} accent="text-sky-400" />
            <StatMini label="Chutes" value={p.stats.shots} accent="text-amber-400" />
            <StatMini label="Chutes no alvo" value={`${p.stats.shotsOnTarget}/${p.stats.shots}`} small />
            <StatMini label="xG total" value={p.stats.xG.toFixed(2)} accent="text-indigo-400" />
            <StatMini label="xGOT total" value={p.stats.xGOT.toFixed(2)} accent="text-rose-400" />
            <StatMini label="Passes certos" value={`${p.stats.passesAcc}/${p.stats.passes}`} small />
            <StatMini label="Precisão" value={`${p.stats.passAccPct}%`} accent={p.stats.passAccPct >= 85 ? "text-emerald-400" : ""} />
            <StatMini label="Dribles / certos" value={`${p.stats.dribblesSuc}/${p.stats.dribbles}`} small />
          </div>
          <div className="grid grid-cols-4 gap-2 text-center mt-2">
            <StatMini label="Toques" value={p.stats.touches} mini />
            <StatMini label="Faltas sofridas" value={p.stats.foulsSuffered} mini accent="text-amber-400" />
            <StatMini label="Impedimentos" value={p.stats.offsides} mini />
            <StatMini label="Cartões" value={`${p.stats.yellowCards}A · ${p.stats.redCards}V`} mini />
          </div>
        </div>

        {/* Rating breakdown */}
        <div className="px-4">
          <div className="rounded-xl border border-sv-border bg-sv-panel/60 p-3.5 space-y-3">
            <div className="flex items-center gap-2">
              <span className={`${ratingColor} w-8 h-7 rounded-md grid place-items-center text-white font-extrabold text-sm tabular-nums`}>{p.rating.toFixed(1)}</span>
              <div>
                <div className="font-semibold text-sm">Avaliação detalhada</div>
                <div className="text-[10px] text-sv-muted">Distribuição da performance</div>
              </div>
            </div>
            {[
              { k: "Impacto", v: rb.impact },
              { k: "Finalização", v: rb.shooting },
              { k: "Passes", v: rb.passing },
              { k: "Dribles", v: rb.dribbling },
              { k: "Defensivo", v: rb.defending },
            ].map((r) => (
              <div key={r.k}>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-sv-muted">{r.k}</span>
                  <span className="font-mono text-white/85 tabular-nums">{(r.v * 100).toFixed(0)}</span>
                </div>
                <div className="relative h-2 rounded-full bg-slate-800/80 overflow-hidden">
                  <div className="absolute inset-y-0 left-1/2 w-0.5 bg-white/15" />
                  <div className="absolute inset-y-0 left-1/2 rounded-full" style={{
                    width: `${Math.abs(r.v - 0.5) * 2 * 50}%`,
                    background: r.v >= 0.5 ? "linear-gradient(90deg, #22c55e, #4ade80)" : "linear-gradient(270deg, #ef4444, #fca5a5)",
                    transform: r.v >= 0.5 ? "none" : "translateX(-100%)",
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Match heatmap do jogador */}
        <div className="px-4">
          <details className="rounded-xl border border-sv-border bg-sv-panel/60 p-3.5 group" open>
            <summary className="flex items-center justify-between cursor-pointer list-none">
              <div className="flex items-center gap-2">
                <span className="text-xl">⚽</span>
                <div>
                  <div className="font-semibold text-sm">Mapa de calor da partida</div>
                  <div className="text-[10px] text-sv-muted">Zonas de maior movimentação</div>
                </div>
              </div>
              <span className="sv-chip">expandir</span>
            </summary>
            <div className="mt-3 rounded-xl overflow-hidden border border-white/10" style={{
              background: "repeating-linear-gradient(90deg, rgba(255,255,255,0.025) 0 24px, rgba(0,0,0,0.06) 24px 48px), linear-gradient(180deg, #1e7548, #144e2f)",
            }}>
              <svg viewBox="0 0 100 70" width="100%" style={{ display: "block", aspectRatio: "100 / 60" }}>
                <defs>
                  <radialGradient id={`phm-${p.number}`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor={teamColor} stopOpacity="0.95" />
                    <stop offset="55%" stopColor={teamColor} stopOpacity="0.45" />
                    <stop offset="100%" stopColor={teamColor} stopOpacity="0" />
                  </radialGradient>
                  <filter id={`phmf-${p.number}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="2.2" /></filter>
                </defs>
                {/* field */}
                <rect x="1" y="1" width="98" height="68" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.28" />
                <line x1="50" y1="1" x2="50" y2="69" stroke="rgba(255,255,255,0.9)" strokeWidth="0.22" />
                <circle cx="50" cy="35" r="8" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.22" />
                <rect x="1" y="17" width="15" height="36" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.22" />
                <rect x="84" y="17" width="15" height="36" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="0.22" />
                <g filter={`url(#phmf-${p.number})`} opacity="0.92">
                  {p.personalHeatmap.map((h, i) => (
                    <ellipse key={i} cx={h.x} cy={(h.y / 100) * 68 + 1} rx={4 + h.intensity * 9} ry={3 + h.intensity * 6} fill={`url(#phm-${p.number})`} />
                  ))}
                </g>
                {/* position dot */}
                <JerseyGlyph number={p.number} color={teamColor} x={p.pitchPos.x} y={(p.pitchPos.y / 100) * 68 + 1} size={5.4} outlineWidth={0.3} />
              </svg>
            </div>
          </details>
        </div>

        {/* Abas: Shot / Pass / Drib / Def */}
        <div className="px-4">
          <div className="rounded-2xl border border-sv-border bg-sv-panel/60 overflow-hidden">
            <div className="flex gap-1 p-2 border-b border-sv-border/70 bg-slate-900/40">
              {([["shot", "⚽ Chute", `Chutes (${p.actions.shots.length})`],
                 ["pass", "🎯 Passe", `Passes (${p.actions.passes.length})`],
                 ["drib", "💨 Drible", `Dribles (${p.actions.dribbles.length})`],
                 ["def",  "🛡 Defesa",  `Defesas (${p.actions.defenses.length})`],
               ] as const).map(([k, icon, label]) => (
                <button key={k} onClick={() => setTab(k as StatTab)}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap overflow-hidden text-ellipsis
                    ${tab === k ? "bg-slate-200 text-slate-900 shadow-inner" : "text-slate-300 hover:bg-white/5"}`}>
                  <span className="mr-1">{icon}</span>
                  <span className="hidden md:inline">{label}</span>
                </button>
              ))}
            </div>

            <div className="p-3 space-y-3 max-h-[420px] overflow-y-auto">
              {tab === "shot" && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <InfoRow label="Gols" value={p.stats.goals} accent />
                    <InfoRow label="xG" value={p.stats.xG.toFixed(2)} />
                    <InfoRow label="Chutes" value={p.stats.shots} />
                    <InfoRow label="xGOT" value={p.stats.xGOT.toFixed(2)} />
                    <InfoRow label="No alvo" value={`${p.stats.shotsOnTarget} (${p.stats.shots ? Math.round(p.stats.shotsOnTarget / p.stats.shots * 100) : 0}%)`} />
                    <InfoRow label="Cabeceios" value={p.stats.aerialWon} />
                  </div>

                  {/* Lista de chutes */}
                  <div className="space-y-2">
                    <div className="flex gap-1.5 flex-wrap">
                      {p.actions.shots.map((s) => (
                        <span key={s.id} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${s.result === "goal" ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-slate-700/50 text-white/70"}`}>
                          {s.minute}' · {s.result === "goal" ? "GOL" : s.result === "saved" ? "DEF" : s.result === "off_target" ? "FORA" : "BLOQ"}
                        </span>
                      ))}
                    </div>

                    {p.actions.shots.map((s, idx) => (
                      <div key={s.id} className={`rounded-xl border p-2.5 ${idx === 0 ? "border-sv-accent40 bg-sv-accent5" : "border-sv-border bg-slate-900/30"}`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="sv-chip font-bold">{s.minute}'</span>
                          <span className={`font-semibold text-xs ${s.result === "goal" ? "text-emerald-400" : "text-white/80"}`}>
                            {s.result === "goal" ? "🎯 GOL marcado" : s.result === "saved" ? "🧤 Defendido" : s.result === "off_target" ? "↗ Fora do alvo" : "🛡 Bloqueado"}
                          </span>
                        </div>
                        <div className="flex gap-2.5">
                          {/* Mini pitch com trajetória */}
                          <div className="relative shrink-0 rounded-lg overflow-hidden border border-white/10 flex-1 max-w-[220px]" style={{
                            background: "linear-gradient(180deg, #206e46, #124229)", aspectRatio: "100/70",
                          }}>
                            <svg viewBox="0 0 100 70" className="absolute inset-0 w-full h-full">
                              <rect x="0.6" y="0.6" width="98.8" height="68.8" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="0.4" />
                              <line x1="50" y1="0.6" x2="50" y2="69.4" stroke="rgba(255,255,255,0.7)" strokeWidth="0.35" strokeDasharray="1 0.8" />
                              {/* goal */}
                              {s.team === "home" ? (
                                <>
                                  <rect x="84" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.4" />
                                  <rect x="94.2" y="26" width="5.2" height="18" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.4" />
                                </>
                              ) : (
                                <>
                                  <rect x="0.6" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.4" />
                                  <rect x="0.6" y="26" width="5.2" height="18" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="0.4" />
                                </>
                              )}
                              {/* Assist origin */}
                              {s.assistant && (
                                <>
                                  <circle cx={s.assistant.from.x} cy={(s.assistant.from.y / 100) * 68} r="1.2" fill="#fde047" stroke="white" strokeWidth="0.15" />
                                  <line x1={s.assistant.from.x} y1={(s.assistant.from.y / 100) * 68}
                                        x2={s.from.x} y2={(s.from.y / 100) * 68}
                                        stroke="rgba(255,255,255,0.75)" strokeWidth="0.35" strokeDasharray="0.8 0.6" />
                                </>
                              )}
                              {/* trajectory */}
                              <line x1={s.from.x} y1={(s.from.y / 100) * 68}
                                    x2={s.to.x}   y2={(s.to.y   / 100) * 68}
                                    stroke="rgba(255,255,255,0.3)" strokeWidth="0.3" />
                              <line x1={s.from.x} y1={(s.from.y / 100) * 68}
                                    x2={s.to.x}   y2={(s.to.y   / 100) * 68}
                                    stroke={s.result === "goal" ? "#86efac" : "#fcd34d"} strokeWidth="0.6"
                                    strokeDasharray="1.5 0.8" />
                              {/* from */}
                              <JerseyGlyph number={p.number} color={teamColor} x={s.from.x} y={(s.from.y / 100) * 68} size={5.6} outlineWidth={0.3} />
                              {/* to */}
                              <circle cx={s.to.x} cy={(s.to.y / 100) * 68} r={s.result === "goal" ? 2.4 : 1.8}
                                      fill={s.result === "goal" ? "#22c55e" : s.result === "saved" ? "#f59e0b" : "#ef4444"} stroke="white" strokeWidth="0.4" />
                              {s.result === "goal" && <circle cx={s.to.x} cy={(s.to.y / 100) * 68} r="4" fill="none" stroke="#22c55e" strokeWidth="0.35" opacity="0.8" />}
                            </svg>
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0 space-y-1.5 text-[11px]">
                            <div className="flex justify-between gap-1"><span className="text-sv-muted">xG</span><span className="font-mono font-bold text-sv-accent3">{s.xg.toFixed(2)}</span></div>
                            <div className="flex justify-between gap-1"><span className="text-sv-muted">xGOT</span><span className="font-mono font-bold text-emerald-400">{s.xgot.toFixed(2)}</span></div>
                            <div className="flex justify-between gap-1"><span className="text-sv-muted">Situação</span><span className="text-white/85 font-medium text-right">{s.situation}</span></div>
                            <div className="flex justify-between gap-1"><span className="text-sv-muted">Tipo</span><span className="text-white/85 font-medium text-right">{s.shotType}</span></div>
                            {s.assistant && <div className="flex justify-between gap-1"><span className="text-sv-muted">Assist.</span><span className="text-amber-300 font-medium text-right truncate">{s.assistant.name}</span></div>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === "pass" && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <InfoRow label="Total passes" value={p.stats.passes} accent />
                    <InfoRow label="Precisão" value={`${p.stats.passAccPct}%`} />
                    <InfoRow label="Corretos" value={p.stats.passesAcc} />
                    <InfoRow label="Cruzamentos" value={`${p.stats.crosses} (${p.stats.crossAccPct}%)`} />
                  </div>
                  <div className="relative rounded-xl overflow-hidden border border-white/10" style={{ background: "linear-gradient(180deg, #206e46, #124229)", aspectRatio: "100/70" }}>
                    <svg viewBox="0 0 100 70" className="absolute inset-0 w-full h-full">
                      <rect x="0.6" y="0.6" width="98.8" height="68.8" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="0.4" />
                      <line x1="50" y1="0.6" x2="50" y2="69.4" stroke="rgba(255,255,255,0.7)" strokeWidth="0.35" strokeDasharray="1 0.8" />
                      <rect x="0.6" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.4" />
                      <rect x="84" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.4" />
                      {p.actions.passes.map((pa, i) => (
                        <g key={i}>
                          <line x1={pa.from.x} y1={(pa.from.y / 100) * 68} x2={pa.to.x} y2={(pa.to.y / 100) * 68}
                                stroke={pa.accurate ? "#86efac" : "#fca5a5"} strokeWidth="0.45" markerEnd={pa.accurate ? "" : ""} />
                          <circle cx={pa.to.x} cy={(pa.to.y / 100) * 68} r="1.2" fill={pa.accurate ? "#22c55e" : "#ef4444"} />
                        </g>
                      ))}
                      <JerseyGlyph number={p.number} color={teamColor} x={p.pitchPos.x} y={(p.pitchPos.y / 100) * 68} size={5.6} outlineWidth={0.3} />
                    </svg>
                    <div className="absolute bottom-1.5 left-1.5 right-1.5 flex justify-between text-[9px] font-bold gap-1.5">
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-900/80 text-emerald-300 border border-emerald-500/30">✔ {p.actions.passes.filter(x => x.accurate).length} corretos</span>
                      <span className="px-1.5 py-0.5 rounded-md bg-slate-900/80 text-rose-300 border border-rose-500/30">✘ {p.actions.passes.filter(x => !x.accurate).length} errados</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {p.actions.passes.map((pa, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1 rounded-md bg-slate-900/30 border border-sv-border/70 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="sv-chip font-bold">{pa.minute}'</span>
                          <span className="sv-chip text-[10px]" title={pa.kind}>
                            {pa.kind === "throughball" ? "🎯 Infiltração" : pa.kind === "long" ? "🥅 Longo" : pa.kind === "cross" ? "↗ Cruzamento" : "• Curto"}
                          </span>
                        </div>
                        <span className={`font-bold ${pa.accurate ? "text-emerald-400" : "text-rose-400"}`}>{pa.accurate ? "✔" : "✘"}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === "drib" && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <InfoRow label="Dribles tentados" value={p.stats.dribbles} accent />
                    <InfoRow label="Bem-sucedidos" value={`${p.stats.dribblesSuc} (${p.stats.dribbles ? Math.round(p.stats.dribblesSuc / p.stats.dribbles * 100) : 0}%)`} />
                    <InfoRow label="Toques" value={p.stats.touches} />
                    <InfoRow label="Toques malsuced." value="1" />
                  </div>
                  <div className="relative rounded-xl overflow-hidden border border-white/10" style={{ background: "linear-gradient(180deg, #206e46, #124229)", aspectRatio: "100/70" }}>
                    <svg viewBox="0 0 100 70" className="absolute inset-0 w-full h-full">
                      <rect x="0.6" y="0.6" width="98.8" height="68.8" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="0.4" />
                      <line x1="50" y1="0.6" x2="50" y2="69.4" stroke="rgba(255,255,255,0.7)" strokeWidth="0.35" strokeDasharray="1 0.8" />
                      <rect x="0.6" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.4" />
                      <rect x="84" y="18" width="15.4" height="34" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="0.4" />
                      {p.actions.dribbles.map((d, i) => (
                        <g key={i}>
                          <line x1={d.from.x} y1={(d.from.y / 100) * 68} x2={d.to.x} y2={(d.to.y / 100) * 68}
                                stroke={d.successful ? "#86efac" : "#fca5a5"} strokeWidth="0.55" strokeDasharray={d.progressive ? "" : "1 0.6"} />
                        </g>
                      ))}
                      <JerseyGlyph number={p.number} color={teamColor} x={p.pitchPos.x} y={(p.pitchPos.y / 100) * 68} size={5.6} outlineWidth={0.3} />
                    </svg>
                  </div>
                  <div className="space-y-1.5">
                    {p.actions.dribbles.map((d, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1 rounded-md bg-slate-900/30 border border-sv-border/70 text-[11px]">
                        <div className="flex items-center gap-1.5">
                          <span className="sv-chip font-bold">{d.minute}'</span>
                          {d.progressive && <span className="sv-chip-accent text-[10px]">progressivo</span>}
                        </div>
                        <span className={`font-bold ${d.successful ? "text-emerald-400" : "text-rose-400"}`}>{d.successful ? "✔ bem-sucedido" : "✘ perdido"}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {tab === "def" && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <InfoRow label="Divididos ganhos" value={`${p.stats.duelsWon} (${p.stats.duelsWonPct}%)`} accent />
                    <InfoRow label="Desarmes" value={p.stats.tackles} />
                    <InfoRow label="Interceptações" value={p.stats.interceptions} />
                    <InfoRow label="Aéreos ganhos" value={p.stats.aerialWon} />
                  </div>
                  {p.actions.defenses.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-sv-border p-5 text-center">
                      <div className="text-3xl mb-2">😴</div>
                      <div className="font-semibold text-sm">Nenhuma ação defensiva registrada</div>
                      <div className="text-[11px] text-sv-muted mt-1">Jogador atuou mais ofensivamente nesta partida</div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {p.actions.defenses.map((d, i) => (
                        <div key={i} className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-slate-900/30 border border-sv-border/70 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="sv-chip font-bold">{d.minute}'</span>
                            <span className="font-semibold text-white/85">
                              {d.kind === "tackle" ? "🛡 Desarme" : d.kind === "interception" ? "🎯 Interceptação" : d.kind === "clearance" ? "⚡ Afastamento" : "🔄 Recuperação"}
                            </span>
                          </div>
                          <span className="text-emerald-400 font-bold">✔</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Stats summary full */}
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-sv-border bg-sv-panel/60 p-3.5">
            <div className="font-semibold text-sm mb-2.5">Estatísticas da partida · {p.nick || p.name}</div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {[
                ["Min. jogados", `${p.minutes}'`],
                ["Posse individual", `${p.stats.possessions}`],
                ["Divididos", `${p.stats.duelsWon} ganhos (${p.stats.duelsWonPct}%)`],
                ["Duelo aéreo", `${p.stats.aerialWon} ganhos`],
                ["Faltas", `${p.stats.fouls} cometidas · ${p.stats.foulsSuffered} sofridas`],
                ["Cartões", `${p.stats.yellowCards} amarelo · ${p.stats.redCards} vermelho`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-md bg-slate-900/40 px-2 py-1.5 border border-sv-border/70">
                  <div className="text-sv-muted">{k}</div>
                  <div className="text-white/90 font-medium">{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatMini({ label, value, accent, small, mini }: { label: string; value: React.ReactNode; accent?: string; small?: boolean; mini?: boolean }) {
  return (
    <div className={`rounded-lg border border-sv-border/70 bg-slate-900/40 ${mini ? "p-1.5" : small ? "px-2 py-1.5" : "px-2 py-2"}`}>
      <div className={`${mini ? "text-[9px]" : "text-[10px]"} text-sv-muted`}>{label}</div>
      <div className={`${mini ? "text-[11px]" : small ? "text-[12px]" : "text-sm"} font-extrabold font-mono tabular-nums ${accent || "text-white/95"}`}>{value}</div>
    </div>
  );
}

/* ============== POPUP DE GOL: a bola entrando no gol ============== */
function GoalPopupVisual({
  shot, home, away, scoreHome, scoreAway, onClose,
}: {
  shot: Action; home: string; away: string; scoreHome: number; scoreAway: number; onClose: () => void;
}) {
  // goalLoc.x: 0 = esquerda do gol, 1 = direita · goalLoc.y: 0 = topo, 1 = base
  const gx = shot.goalLoc ? Math.max(0.06, Math.min(0.94, shot.goalLoc.x)) : 0.5;
  const gy = shot.goalLoc ? Math.max(0.1, Math.min(0.92, shot.goalLoc.y)) : 0.5;
  const teamColor = shot.team === "home" ? HOME_COLOR : AWAY_COLOR;
  const scoringTeam = shot.team === "home" ? home : away;

  return (
    <>
      <div className="goal-popup-header">
        <span className="goal-popup-score">
          {home} {scoreHome} <span className="text-slate-400">–</span> {scoreAway} {away}
        </span>
        <button className="goal-popup-close" onClick={onClose} title="Fechar" aria-label="Fechar">✕</button>
      </div>
      <div className="goal-popup-body">
        <div className="goal-popup-label" style={{ color: "#15803d" }}>GOL!</div>
        <svg viewBox="0 0 320 200" className="goal-net-svg" preserveAspectRatio="xMidYMid meet">
          <defs>
            <JerseyDefs />
            <linearGradient id="gpSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#eef2f7" /><stop offset="100%" stopColor="#dbe4ee" />
            </linearGradient>
            <linearGradient id="gpGrass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3f9a5f" /><stop offset="100%" stopColor="#1f6d40" />
            </linearGradient>
            <pattern id="gpNet" width="7" height="7" patternUnits="userSpaceOnUse">
              <path d="M0 1.6 H7 M1.6 0 V7" stroke="rgba(255,255,255,0.55)" strokeWidth="0.7" />
            </pattern>
            <radialGradient id="gpBall" cx="35%" cy="30%" r="70%">
              <stop offset="0%" stopColor="#ffffff" /><stop offset="100%" stopColor="#cfd8e3" />
            </radialGradient>
            <filter id="gpShadow" x="-60%" y="-60%" width="220%" height="220%">
              <feDropShadow dx="0" dy="4" stdDeviation="5" floodColor="#000000" floodOpacity="0.28" />
            </filter>
            <filter id="gpTrail" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </defs>

          {/* fundo + gramado */}
          <rect x="0" y="0" width="320" height="200" fill="url(#gpSky)" />
          <rect x="0" y="150" width="320" height="50" fill="url(#gpGrass)" />
          {Array.from({ length: 8 }).map((_, i) => (
            <rect key={`gp-st-${i}`} x={i * 40} y="150" width="40" height="50"
                  fill={i % 2 === 0 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)"} />
          ))}

          {/* baliza com rede */}
          <rect x="118" y="42" width="84" height="108" fill="url(#gpNet)" />
          <rect x="118" y="42" width="84" height="108" fill="none" stroke="#e2e8f0" strokeWidth="4" />
          <line x1="118" y1="42" x2="130" y2="52" stroke="#cbd5e1" strokeWidth="2.4" />
          <line x1="202" y1="42" x2="190" y2="52" stroke="#cbd5e1" strokeWidth="2.4" />
          <line x1="130" y1="52" x2="190" y2="52" stroke="#cbd5e1" strokeWidth="2.4" />
          <line x1="118" y1="150" x2="130" y2="140" stroke="#cbd5e1" strokeWidth="2.4" />
          <line x1="202" y1="150" x2="190" y2="140" stroke="#cbd5e1" strokeWidth="2.4" />
          <line x1="130" y1="140" x2="190" y2="140" stroke="#cbd5e1" strokeWidth="2" />
          {/* postes principais */}
          <line x1="118" y1="42" x2="118" y2="150" stroke="#f8fafc" strokeWidth="5" strokeLinecap="round" />
          <line x1="202" y1="42" x2="202" y2="150" stroke="#f8fafc" strokeWidth="5" strokeLinecap="round" />
          <line x1="118" y1="42" x2="202" y2="42" stroke="#f8fafc" strokeWidth="5" strokeLinecap="round" />

          {/* trajetória da bola entrando */}
          <path
            d={`M22,176 C120,150 190,${64 + gy * 46} ${118 + gx * 84},${48 + gy * 92}`}
            fill="none" stroke="rgba(239,68,68,0.35)" strokeWidth="3" filter="url(#gpTrail)"
            strokeLinecap="round" strokeDasharray="4 5"
          />
          <circle cx={118 + gx * 84} cy={48 + gy * 92} r="17" fill="rgba(34,197,94,0.28)">
            <animate attributeName="r" values="12;20;12" dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.55;0.05;0.55" dur="1.6s" repeatCount="indefinite" />
          </circle>
          {/* bola dentro do gol */}
          <g transform={`translate(${118 + gx * 84} ${48 + gy * 92})`} filter="url(#gpShadow)">
            <circle cx="0" cy="0" r="11" fill="url(#gpBall)" stroke="#94a3b8" strokeWidth="1" />
            <polygon points="0,-4.4 4.1,-1.4 2.6,3.6 -2.6,3.6 -4.1,-1.4" fill="#1e293b" />
            <circle cx="0" cy="0" r="1.7" fill="#1e293b" />
          </g>

          {/* autor do gol (camisa + número) */}
          <g transform="translate(276 158)">
            <JerseyGlyph number={shot.number} color={teamColor} x={0} y={0} size={30} outlineWidth={1.6} />
            <text x="0" y="26" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0f172a">
              {(shot.player || "").split(" ").slice(-1)[0].slice(0, 12)}
            </text>
          </g>
        </svg>
      </div>
      <div className="goal-popup-footer">
        <div className="font-semibold text-slate-800">
          {shot.minute}' · {shot.player} ({scoringTeam})
        </div>
        {shot.assistant && (
          <div className="text-slate-500">Assistência: {shot.assistant.name} #{shot.assistant.number}</div>
        )}
        <div className="text-slate-500">xG {shot.xg.toFixed(2)} · xGOT {shot.xgot.toFixed(2)} · {shot.situation}</div>
      </div>
    </>
  );
}

function InfoRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <div className={`rounded-md ${accent ? "bg-sv-accent5 border border-sv-accent40" : "bg-slate-900/40 border border-sv-border/70"} px-2 py-1.5`}>
      <div className="text-sv-muted text-[10px]">{label}</div>
      <div className={`font-extrabold font-mono tabular-nums ${accent ? "text-white" : "text-white/95"} text-sm`}>{value}</div>
    </div>
  );
}
