/** Whether a version such as "1.4.0" is at least `minimum` (missing parts count as 0). */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parts = (v: string) => v.split(".").map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parts(version), parts(minimum)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
