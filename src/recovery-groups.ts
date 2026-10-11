/** Two different group numbers (1–6) of the recovery code to type back from paper, in order (src/RecoveryCode.tsx). */
export function pickGroups(random: () => number = Math.random): [number, number] {
  const first = 1 + Math.floor(random() * 6); let second = 1 + Math.floor(random() * 5); if (second >= first) second++;
  return first < second ? [first, second] : [second, first];
}
