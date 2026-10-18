// Name matching for lecturer verification (brief §5.6, "Name match"). Order-insensitive,
// since NIMC records put the surname first. Returns 'pass', 'review' or 'fail'.

export function nameTokens(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

export function matchNames(a, b) {
  const A = nameTokens(a), B = nameTokens(b);
  const usedA = A.map(() => false), usedB = B.map(() => false);
  const pair = (ok) => {
    for (let i = 0; i < A.length; i++) {
      if (usedA[i]) continue;
      for (let j = 0; j < B.length; j++) {
        if (usedB[j] || !ok(A[i], B[j])) continue;
        usedA[i] = usedB[j] = true;
        return true;
      }
    }
    return false;
  };
  let exact = 0, other = 0;
  while (pair((x, y) => x === y)) exact++;
  while (pair((x, y) => (x.length === 1 && y[0] === x) || (y.length === 1 && x[0] === y))) other++;
  while (pair((x, y) => (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y)))) other++;
  if (exact >= 1 && exact + other >= 2) return 'pass';
  if (exact === 1 && other === 0) return 'review';
  return 'fail';
}
