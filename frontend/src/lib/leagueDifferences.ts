export function leagueDifferences(
  points: number | null,
  xpts: number | null,
  goals: number | null,
  xg: number | null,
) {
  return {
    points: points != null && xpts != null ? points - xpts : null,
    goals: goals != null && xg != null ? goals - xg : null,
  };
}
