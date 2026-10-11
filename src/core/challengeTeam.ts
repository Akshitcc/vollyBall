/**
 * Which of my teams challenges (QA V4): the ?fromTeamId= team when I captain it, else my only
 * captained team, else null (the screen asks me to choose; with none, only then "captains only").
 */
export function pickFromTeam(captainedIds: readonly string[], param: string | undefined, chosen: string | null): string | null {
  if (chosen && captainedIds.includes(chosen)) return chosen;
  if (param && captainedIds.includes(param)) return param;
  return captainedIds.length === 1 ? captainedIds[0] : null;
}
