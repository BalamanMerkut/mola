/*
 * The guest's (and staff) basket: the same item added again with the same choices, note and packing is one line with more
 * pieces (8 Ekim denetimi K8: two "1 × Caffè Latte · Büyük boy" lines went to the kitchen). Weighed lines stay apart.
 */
type Line = { productId: string; quantity: number; selections: { groupId: string; optionId: string }[]; note?: string; grams?: number; packed?: boolean };
const MAX_PIECES = 20;
const key = (l: Line) => JSON.stringify([l.productId, l.selections.map(s => `${s.groupId}:${s.optionId}`).sort(), l.note?.trim() ?? '', !!l.packed]);
export function addToCart<L extends Line>(cart: L[], line: L): L[] {
  const i = line.grams ? -1 : cart.findIndex(l => !l.grams && key(l) === key(line) && l.quantity + line.quantity <= MAX_PIECES);
  return i >= 0 ? cart.map((l, k) => k === i ? { ...l, quantity: l.quantity + line.quantity } : l) : [...cart, line];
}
