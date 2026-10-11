export function trackingCode(input: string): string | null {
  if (input.length > 1000) return null;
  const codes = input.match(/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/gi) ?? [];
  const unique = [...new Set(codes.map(code => code.toLowerCase()))];
  return unique.length === 1 ? unique[0] : null;
}
