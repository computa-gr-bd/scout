import { PITCH_LENGTH, PITCH_WIDTH, type PitchPoint } from "./pitchGeometry";
export type PitchZoneId =
  | "own_box" | "own_left_channel" | "own_right_channel" | "own_central_midfield"
  | "own_left_flank" | "own_right_flank"
  | "neutral_midfield" | "neutral_left_flank" | "neutral_right_flank"
  | "opp_left_flank" | "opp_right_flank"
  | "opp_left_channel" | "opp_right_channel" | "opp_central_midfield"
  | "outside_box_left" | "outside_box_right" | "outside_box_central"
  | "central_box";
function scaled(x: number, y: number, w: number, h: number) {
  return {
    x: (x / 100) * PITCH_LENGTH,
    y: (y / 100) * PITCH_WIDTH,
    w: (w / 100) * PITCH_LENGTH,
    h: (h / 100) * PITCH_WIDTH,
  };
}
export const ZONE_GEOMETRY_M: Record<PitchZoneId, { x: number; y: number; w: number; h: number; label: string }> = {
  own_box: { ...scaled(0, 21, 16, 58), label: "Area propria" },
  own_left_channel: { ...scaled(16, 18, 14, 20), label: "Corredor esquerdo proprio" },
  own_right_channel: { ...scaled(16, 62, 14, 20), label: "Corredor direito proprio" },
  own_central_midfield: { ...scaled(16, 38, 14, 24), label: "Meio-campo central proprio" },
  own_left_flank: { ...scaled(16, 0, 14, 18), label: "Ala esquerda propria" },
  own_right_flank: { ...scaled(16, 82, 14, 18), label: "Ala direita propria" },
  neutral_midfield: { ...scaled(30, 18, 40, 64), label: "Meio-campo neutro" },
  neutral_left_flank: { ...scaled(30, 0, 40, 18), label: "Ala esquerda neutra" },
  neutral_right_flank: { ...scaled(30, 82, 40, 18), label: "Ala direita neutra" },
  opp_left_flank: { ...scaled(70, 0, 14, 18), label: "Ala esquerda adversaria" },
  opp_right_flank: { ...scaled(70, 82, 14, 18), label: "Ala direita adversaria" },
  opp_left_channel: { ...scaled(70, 18, 14, 20), label: "Corredor esquerdo adversario" },
  opp_right_channel: { ...scaled(70, 62, 14, 20), label: "Corredor direito adversario" },
  opp_central_midfield: { ...scaled(70, 38, 14, 24), label: "Meio-campo central adversario" },
  outside_box_left: { ...scaled(84, 21, 8, 19), label: "Fora da area (E)" },
  outside_box_right: { ...scaled(84, 60, 8, 19), label: "Fora da area (D)" },
  outside_box_central: { ...scaled(84, 40, 8, 20), label: "Fora da area (C)" },
  central_box: { ...scaled(92, 29, 8, 42), label: "Area central" },
};
export const ZONE_ORDER: PitchZoneId[] = [
  "own_box", "own_left_flank", "own_left_channel", "own_central_midfield", "own_right_channel", "own_right_flank",
  "neutral_left_flank", "neutral_midfield", "neutral_right_flank",
  "opp_left_flank", "opp_left_channel", "opp_central_midfield", "opp_right_channel", "opp_right_flank",
  "outside_box_left", "outside_box_central", "outside_box_right", "central_box",
];
export function zoneCenterM(zone: PitchZoneId): PitchPoint {
  const g = ZONE_GEOMETRY_M[zone];
  return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
}
export function flipZoneId(z: PitchZoneId): PitchZoneId {
  const map: Partial<Record<PitchZoneId, PitchZoneId>> = {
    own_box: "central_box",
    own_left_channel: "opp_right_channel",
    own_right_channel: "opp_left_channel",
    own_central_midfield: "opp_central_midfield",
    own_left_flank: "opp_right_flank",
    own_right_flank: "opp_left_flank",
    opp_left_flank: "own_right_flank",
    opp_right_flank: "own_left_flank",
    opp_left_channel: "own_right_channel",
    opp_right_channel: "own_left_channel",
    opp_central_midfield: "own_central_midfield",
    outside_box_left: "outside_box_right",
    outside_box_right: "outside_box_left",
    central_box: "own_box",
  };
  return (map[z] as PitchZoneId) || z;
}
