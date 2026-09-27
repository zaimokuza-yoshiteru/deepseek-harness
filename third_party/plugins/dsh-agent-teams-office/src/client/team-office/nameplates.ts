/** Place persistent labels near projected heads, stacking nearby names without overlap. */
export function layoutNameplates<T extends { x: number; y: number; width?: number }>(items: T[], width: number, height: number) {
  const h = 20, placed: (T & { width: number; height: number })[] = [];
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const w = Math.min(item.width ?? 108, width - 8);
    const x = clamp(item.x, w / 2 + 4, width - w / 2 - 4), y = clamp(item.y, h + 4, height - 4);
    let best;
    for (const dx of [0, -(w + 4), w + 4]) {
      for (let step = 0; step <= items.length * 2; step++) {
        const dy = step === 0 ? 0 : Math.ceil(step / 2) * (h + 3) * (step % 2 ? -1 : 1);
        const candidate = { ...item, x: clamp(x + dx, w / 2 + 4, width - w / 2 - 4), y: y + dy, width: w, height: h };
        if (candidate.y < h + 4 || candidate.y > height - 4) continue;
        if (!placed.some(other => Math.abs(other.x - candidate.x) < (other.width + w) / 2 + 3 && Math.abs(other.y - candidate.y) < h + 2)) { best = candidate; break; }
      }
      if (best) break;
    }
    placed.push(best ?? { ...item, x, y, width: w, height: h });
  }
  return placed;
}
