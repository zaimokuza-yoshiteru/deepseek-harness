export type GlyphStyle = 'small' | 'hud' | 'footer' | 'slogan';

export interface GlyphRecord {
  x: number;
  y: number;
  w: number;
  h: number;
  advance: number;
  bearingX?: number;
  bearingY?: number;
}

export interface GlyphStyleRecord {
  font: string;
  lineHeight: number;
  baseline: number;
  glyphs: Record<string, GlyphRecord>;
}

export interface SloganDot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  delay: number;
}

export interface GlyphManifest {
  scale: number;
  styles: Record<GlyphStyle, GlyphStyleRecord>;
  sloganDots: SloganDot[];
}

export interface GlyphSprite {
  url: string;
  width: number;
  height: number;
  baseline: number;
}

export interface Glyphs {
  readonly sloganDots: readonly SloganDot[];
  draw(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    baseline: number,
    style: GlyphStyle,
    color: string,
    align?: 'left' | 'center',
  ): void;
  measure(text: string, style: GlyphStyle): number;
  sprite(text: string, style: GlyphStyle, color: string): GlyphSprite;
  dispose(): void;
}

const COLOR_CACHE_LIMIT = 8;
const SPRITE_HORIZONTAL_PADDING = 4;
const FALLBACK_STYLE: GlyphStyle = 'small';

function pathJoin(base: string, file: string): string {
  return `${base.replace(/\/$/, '')}/${file}`;
}

function assertManifest(value: unknown): asserts value is GlyphManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid glyph manifest');
  const manifest = value as Partial<GlyphManifest>;
  if (!Number.isFinite(manifest.scale) || !manifest.scale || !manifest.styles) {
    throw new Error('Invalid glyph manifest scale or styles');
  }
  for (const style of ['small', 'hud', 'footer', 'slogan'] as const) {
    const record = manifest.styles[style];
    if (!record || !Number.isFinite(record.baseline) || !Number.isFinite(record.lineHeight) || !record.glyphs) {
      throw new Error(`Invalid glyph style: ${style}`);
    }
    for (let code = 32; code <= 126; code += 1) {
      const glyph = record.glyphs[String.fromCharCode(code)];
      if (!glyph || !['x', 'y', 'w', 'h', 'advance'].every((key) => Number.isFinite(glyph[key as keyof GlyphRecord]))) {
        throw new Error(`Glyph manifest is missing ${style} character ${String.fromCharCode(code)}`);
      }
    }
  }
  if (!Array.isArray(manifest.sloganDots)) throw new Error('Invalid slogan dots');
}

function makeTintedAtlas(atlas: CanvasImageSource, width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  context.drawImage(atlas, 0, 0);
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = 'source-over';
  return canvas;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function loadGlyphs(assetBase: string, signal?: AbortSignal): Promise<Glyphs> {
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

  const manifestResponse = await fetch(pathJoin(assetBase, 'glyphs.json'), { signal });
  if (!manifestResponse.ok) throw new Error(`Could not load glyph manifest (${manifestResponse.status})`);
  const rawManifest: unknown = await manifestResponse.json();
  assertManifest(rawManifest);
  const manifest = rawManifest;
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');

  const imageResponse = await fetch(pathJoin(assetBase, 'glyphs.png'), { signal });
  if (!imageResponse.ok) throw new Error(`Could not load glyph atlas (${imageResponse.status})`);
  const atlasBlob = await imageResponse.blob();
  if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
  const atlas = await createImageBitmap(atlasBlob);
  if (signal?.aborted) {
    atlas.close();
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  let disposed = false;
  const tintCache = new Map<string, HTMLCanvasElement>();
  const getTint = (color: string): HTMLCanvasElement => {
    if (disposed) throw new Error('Glyph atlas has been disposed');
    const cached = tintCache.get(color);
    if (cached) {
      tintCache.delete(color);
      tintCache.set(color, cached);
      return cached;
    }
    const tinted = makeTintedAtlas(atlas, atlas.width, atlas.height, color);
    tintCache.set(color, tinted);
    if (tintCache.size > COLOR_CACHE_LIMIT) {
      const oldest = tintCache.keys().next().value as string | undefined;
      if (oldest !== undefined) {
        const evicted = tintCache.get(oldest);
        tintCache.delete(oldest);
        if (evicted) {
          evicted.width = 0;
          evicted.height = 0;
        }
      }
    }
    return tinted;
  };

  const measure = (text: string, style: GlyphStyle): number => {
    const record = manifest.styles[style] ?? manifest.styles[FALLBACK_STYLE];
    let width = 0;
    for (const char of text) width += record.glyphs[char]?.advance ?? record.glyphs['?'].advance;
    return width;
  };

  const draw = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    baseline: number,
    style: GlyphStyle,
    color: string,
    align: 'left' | 'center' = 'left',
  ): void => {
    if (disposed) throw new Error('Glyph atlas has been disposed');
    const record = manifest.styles[style] ?? manifest.styles[FALLBACK_STYLE];
    const totalWidth = measure(text, style);
    let cursor = x - (align === 'center' ? totalWidth / 2 : 0);
    const tinted = getTint(color);
    ctx.save();
    try {
      for (const char of text) {
        const glyph = record.glyphs[char] ?? record.glyphs['?'];
        if (glyph.w > 0 && glyph.h > 0) {
          ctx.drawImage(
            tinted,
            glyph.x,
            glyph.y,
            glyph.w,
            glyph.h,
            cursor + (glyph.bearingX ?? -4),
            baseline + (glyph.bearingY ?? -34),
            glyph.w / manifest.scale,
            glyph.h / manifest.scale,
          );
        }
        cursor += glyph.advance;
      }
    } finally {
      ctx.restore();
    }
  };

  const sprite = (text: string, style: GlyphStyle, color: string): GlyphSprite => {
    if (disposed) throw new Error('Glyph atlas has been disposed');
    const record = manifest.styles[style] ?? manifest.styles[FALLBACK_STYLE];
    const width = Math.max(1, Math.ceil(measure(text, style) + SPRITE_HORIZONTAL_PADDING * 2));
    const height = record.lineHeight;
    const scale = manifest.scale;
    const canvas = createCanvas(Math.ceil(width * scale), Math.ceil(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    context.scale(scale, scale);
    draw(context, text, SPRITE_HORIZONTAL_PADDING, record.baseline, style, color);
    return {
      url: canvas.toDataURL('image/png'),
      width,
      height,
      baseline: record.baseline,
    };
  };

  return {
    sloganDots: Object.freeze(manifest.sloganDots.map((dot) => Object.freeze({ ...dot }))),
    draw,
    measure,
    sprite,
    dispose() {
      if (disposed) return;
      disposed = true;
      atlas.close();
      for (const canvas of tintCache.values()) {
        canvas.width = 0;
        canvas.height = 0;
      }
      tintCache.clear();
    },
  };
}
