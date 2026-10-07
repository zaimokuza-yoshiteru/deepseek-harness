import { FRAME_IDS } from './frame-ids';
import { FLOW_WORD, FLOW_HEAD, FLOW_TAIL, flowPhase } from './brand-flow-12';
import { localMotion } from './local-motion';
import { LOGO_GROUPS, LOGO_VIEWBOX, OCBC_RED } from './ocbc-logo-06';
import { BRAND_REVEAL_START } from './brand-timing-10';
import { WHALE_PATH } from './brand-whale';
import { loadGlyphs, type Glyphs, type GlyphSprite } from './glyphs';
import { spline, type Point } from './layer-paths';
const W = 1280, H = 720, DURATION = 7.05, ROI = { x: 0, y: 0, w: 1280, h: 720 };
type Renderer = {
    render(t: number): void;
    dispose(): void;
};
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
function makeCanvas() { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }
function world(c: CanvasRenderingContext2D) { c.setTransform(1, 0, 0, 1, 0, 0); }
function clear(c: CanvasRenderingContext2D) { const sx = c.canvas.width / W, sy = c.canvas.height / H; c.setTransform(sx, 0, 0, sy, 0, 0); c.clearRect(0, 0, W, H); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.shadowBlur = 0; }
function path(points: Point[], close = false) { const p = new Path2D(); points.forEach((a, i) => i ? p.lineTo(...a) : p.moveTo(...a)); if (close)
    p.closePath(); return p; }
function abortError() { return new DOMException('Renderer initialization aborted', 'AbortError'); }
function check(signal?: AbortSignal) { if (signal?.aborted)
    throw signal.reason ?? abortError(); }
function assetUrl(base: string, name: string) { return `${base.replace(/\/$/, '')}/${name}`; }
/** Theme 13 animation core. Host owns playback, dismissal and fade timing. */
export async function createRenderer(parent: HTMLElement, assetBase: string, signal?: AbortSignal): Promise<Renderer> {
    check(signal);
    const wrapper = document.createElement('div');
    wrapper.className = 'dsh13-renderer';
    wrapper.innerHTML = `<style>
 .dsh13-renderer{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#030609;contain:strict}
 .dsh13-renderer .dsh13-stage{position:relative;flex:none;overflow:hidden;background:#030609}
 .dsh13-renderer canvas{position:absolute;inset:0;width:100%;height:100%;display:block}.dsh13-renderer .scene-canvas{filter:brightness(1.12)}.dsh13-renderer .cli-canvas{z-index:1}
 .dsh13-renderer .brand-vectors{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden;z-index:2}
 .dsh13-renderer .brand-hud{position:absolute;pointer-events:none;left:0;top:0;width:1280px;height:720px;transform:scale(var(--stage-scale,1));transform-origin:0 0;color:#cfecff;opacity:0;z-index:3}
 .dsh13-renderer .hud-tl{position:absolute;left:42px;top:42px;display:flex;align-items:center;height:26px}.dsh13-renderer .whale-badge{width:32px;height:26px;display:flex;align-items:center;justify-content:center}.dsh13-renderer .whale-badge svg{width:26px;height:19px;fill:#cfecff}.dsh13-renderer .hud-rule{position:absolute;left:234px;top:13px;width:136px;height:1px;background:#cfecff}.dsh13-renderer .hud-plus{position:absolute;left:376px;top:3px}.dsh13-renderer .hud-tr{position:absolute;left:1147px;top:55px;width:89px;height:12px;border-top:1px solid #cfecff;border-right:1px solid #cfecff}.dsh13-renderer .hud-bl{position:absolute;left:44px;top:638px}.dsh13-renderer .hud-bl i{position:absolute;width:116px;height:1px;background:#cfecff}.dsh13-renderer .hud-br{position:absolute;left:1138px;top:637px;width:104px;height:35px;border-bottom:1px solid #cfecff}.dsh13-renderer .hud-br .whale-badge{position:absolute;right:4px;top:14px;width:8px;height:6px}.dsh13-renderer .hud-br .whale-badge svg{width:8px;height:6px}.dsh13-renderer .hud-br i{position:absolute;top:14px;left:56px;width:28px;height:5px;background:repeating-linear-gradient(125deg,transparent 0 2px,#cfecff 2px 3px,transparent 3px 5px)}
 </style><div class="dsh13-stage"><canvas class="scene-canvas" width="1280" height="720"></canvas><canvas class="cli-canvas" width="1280" height="720" aria-hidden="true"></canvas></div>`;
    const stage = wrapper.querySelector<HTMLElement>('.dsh13-stage')!;
    parent.append(wrapper);
    const output = stage.querySelector('canvas')!, ctx = output.getContext('2d', { alpha: false })!, cliCanvas = stage.querySelector<HTMLCanvasElement>('.cli-canvas')!, cliCtx = cliCanvas.getContext('2d')!;
    ctx.fillStyle = '#030609';
    ctx.fillRect(0, 0, W, H);
    // Dimensions follow the rendered 16:9 stage while all artwork stays in approved 1280×720 coordinates.
    let lastTime = 0, redrawCli: (() => void) | undefined;
    const resize = () => { const scale = Math.max(0, Math.min(wrapper.clientWidth / W, wrapper.clientHeight / H)); stage.style.width = `${W * scale}px`; stage.style.height = `${H * scale}px`; stage.style.setProperty('--stage-scale', String(scale)); const backingScale = Math.max(1, Math.min(3, window.devicePixelRatio || 1)) * scale; cliCanvas.width = Math.max(1, Math.round(W * backingScale)); cliCanvas.height = Math.max(1, Math.round(H * backingScale)); clear(cliCtx); redrawCli?.(); };
    const observer = new ResizeObserver(resize);
    observer.observe(wrapper);
    window.addEventListener('resize', resize);
    resize();
    const initController = new AbortController();
    const abortLink = () => initController.abort(signal?.reason ?? abortError());
    signal?.addEventListener('abort', abortLink, { once: true });
    const initSignal = initController.signal;
    let glyphApi: Glyphs | undefined, cleanPlate: ImageBitmap | undefined, motionResource: ReturnType<typeof localMotion> | undefined, disposed = false;
    const frames = new Map<number, ImageBitmap>();
    try {
        const glyphs = await loadGlyphs(assetBase, initSignal);
        glyphApi = glyphs;
        const hud = document.createElement('div');
        hud.className = 'brand-hud';
        hud.setAttribute('aria-hidden', 'true');
        hud.innerHTML = `<div class="hud-tl"><span class="whale-badge"><svg viewBox="0 0 23.16 17.04"><path d="${WHALE_PATH}"/></svg></span><i class="hud-rule"></i><b class="hud-plus"></b></div><div class="hud-tr"></div><div class="hud-bl"><i></i></div><div class="hud-br"><i></i><span class="whale-badge"><svg viewBox="0 0 23.16 17.04"><path d="${WHALE_PATH}"/></svg></span></div>`;
        stage.append(hud);
        const hudName = glyphs.sprite('DeepSeek Harness', 'hud', '#f4f8ff'), hudFooter = glyphs.sprite('Everything is a Plugin', 'footer', '#f4f8ff'), hudPlus = glyphs.sprite('+', 'hud', '#f4f8ff');
        const makeHudImage = (sprite: GlyphSprite, x: number, baseline: number) => { const image = document.createElement('img'); image.src = sprite.url; image.alt = ''; image.draggable = false; image.style.cssText = `position:absolute;left:${x - 4}px;top:${baseline - sprite.baseline}px;width:${sprite.width}px;height:${sprite.height}px`; return image; };
        hud.append(makeHudImage(hudName, 86, 61), makeHudImage(hudFooter, 44, 664));
        const plusImage = document.createElement('img');
        plusImage.src = hudPlus.url;
        plusImage.alt = '';
        plusImage.draggable = false;
        plusImage.style.cssText = `position:absolute;left:-4px;top:${16 - hudPlus.baseline}px;width:${hudPlus.width}px;height:${hudPlus.height}px`;
        hud.querySelector('.hud-plus')!.append(plusImage);
        const canvases = { atlas: makeCanvas(), revealed: makeCanvas(), mask: makeCanvas(), gridAtlas: makeCanvas(), gridReveal: makeCanvas(), person: makeCanvas(), sourceMask: makeCanvas() };
        const ac = canvases.atlas.getContext('2d')!, rc = canvases.revealed.getContext('2d')!, mc = canvases.mask.getContext('2d')!;
        const flowRegionColumns = 8, flowRegionRows = 3, flowsPerRegion = 2, flowBrightness = 78;
        const assertLive = () => { check(initSignal); if (disposed)
            throw abortError(); };
        const loadFrame = async (i: number) => {
            if (frames.has(i))
                return frames.get(i)!;
            const response = await fetch(assetUrl(assetBase, `frames/native-${String(i).padStart(4, '0')}.webp`), { signal: initSignal });
            if (!response.ok)
                throw new Error(`Theme frame ${i} failed to load (${response.status})`);
            const decoded = await createImageBitmap(await response.blob());
            if (disposed || initSignal.aborted) {
                decoded.close();
                assertLive();
            }
            frames.set(i, decoded);
            return decoded;
        };
        const frameIds = FRAME_IDS;
        // Decode at most six frames at a time, including when an AbortSignal interrupts startup.
        let cursor = 0;
        const workers = Array.from({ length: Math.min(6, frameIds.length) }, async () => { while (true) {
            assertLive();
            const slot = cursor++;
            if (slot >= frameIds.length)
                return;
            try {
                await loadFrame(frameIds[slot]);
            }
            catch (error) {
                initController.abort(error);
                throw error;
            }
        } });
        const settled = await Promise.allSettled(workers);
        const failed = settled.find((item): item is PromiseRejectedResult => item.status === 'rejected');
        if (failed)
            throw failed.reason;
        assertLive();
        const img = (i: number) => { const v = frames.get(i); if (!v)
            throw new Error(`Theme frame ${i} is unavailable`); return v; };
        // Broad source-space envelope and source cutouts preserve the approved silhouette.
        const personShape = path(spline([[599, -40], [600, 78], [555, 119], [547, 183], [566, 237], [630, 279], [651, 336], [614, 389], [551, 438], [470, 491], [461, 536], [507, 564], [423, 569], [346, 590], [306, 643], [274, 758], [1320, 758], [1320, -40]]), true);
        const fringeBoundary = spline([[1073, -30], [1034, 129], [985, 208], [955, 275], [944, 329], [954, 372], [983, 413], [1027, 452], [1066, 476]]);
        const hairShape = path([[775, -30], ...fringeBoundary, [1019, 469], [994, 470], [1025, 490], [979, 482], [1008, 510], [968, 496], [994, 533], [950, 556], [1005, 620], [1007, 750], [730, 750], [767, 400]], true);
        const headShape = path(spline([[617, -30], [834, -30], [787, 95], [750, 186], [719, 287], [630, 274], [567, 164]]), true);
        const collarShape = path(spline([[1080, 602], [1131, 598], [1207, 646], [1285, 704], [1285, 750], [1029, 750], [1019, 655]]), true);
        const faceShape = path([[1040, -30], [1310, -30], [1310, 750], [1007, 750], [1005, 620], [950, 556], [994, 533], [968, 496], [1008, 510], [979, 482], [1025, 490], [994, 470], [1019, 469], ...fringeBoundary.slice().reverse()], true);
        const hudRects = [[1138, 35, 112, 54], [1190, 248, 84, 82], [1144, 630, 106, 52], [72, 275, 567, 95]];
        const pm = canvases.person.getContext('2d')!;
        pm.fillStyle = 'white';
        pm.filter = 'blur(14px)';
        pm.fill(personShape);
        pm.filter = 'none';
        const sm = canvases.sourceMask.getContext('2d')!;
        sm.fillStyle = 'white';
        sm.fillRect(0, 0, W, H);
        sm.globalCompositeOperation = 'destination-out';
        sm.fillStyle = 'white';
        sm.filter = 'blur(3px)';
        for (const [x, y, w, h] of hudRects)
            sm.fillRect(x - 3, y - 3, w + 6, h + 6);
        sm.filter = 'none';
        sm.globalCompositeOperation = 'source-over';
        function applyCharacterMask(c: CanvasRenderingContext2D) { c.globalCompositeOperation = 'destination-in'; c.drawImage(canvases.person, 0, 0); c.globalCompositeOperation = 'source-over'; }
        const cleanResponse = await fetch(assetUrl(assetBase, 'clean-plate-v1.webp'), { signal: initSignal });
        if (!cleanResponse.ok)
            throw new Error(`Clean plate failed to load (${cleanResponse.status})`);
        cleanPlate = await createImageBitmap(await cleanResponse.blob());
        assertLive();
        const gridContext = canvases.gridAtlas.getContext('2d')!;
        gridContext.drawImage(img(39), 0, 0);
        const gridPixels = gridContext.getImageData(0, 0, W, H);
        for (let i = 0; i < gridPixels.data.length; i += 4) {
            const r = gridPixels.data[i] / 255, g = gridPixels.data[i + 1] / 255, b = gridPixels.data[i + 2] / 255, light = .2126 * r + .7152 * g + .0722 * b;
            gridPixels.data[i + 3] = Math.round(255 * smooth(.055, .31, light) * smooth(.01, .12, b - r));
        }
        gridContext.putImageData(gridPixels, 0, 0);
        gridContext.globalCompositeOperation = 'destination-in';
        gridContext.drawImage(canvases.sourceMask, 0, 0);
        gridContext.globalCompositeOperation = 'source-over';
        const contourCanvas = document.createElement('canvas');
        contourCanvas.width = W;
        contourCanvas.height = H;
        const contourContext = contourCanvas.getContext('2d', { willReadFrequently: true })!;
        const arrivalKeys = [12, 24, 30, 36] as const;
        const arrivalBuffers = await Promise.all(arrivalKeys.map(async (key) => {
            const response = await fetch(assetUrl(assetBase, `arrival-${key}.bin`), { signal: initSignal });
            if (!response.ok)
                throw new Error(`Contour map ${key} failed to load (${response.status})`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length !== W * H)
                throw new Error(`Contour map ${key} has invalid size`);
            return bytes;
        }));
        assertLive();
        const contourTracks = arrivalKeys.map((key, index) => {
            contourContext.clearRect(0, 0, W, H);
            contourContext.drawImage(img(key), ROI.x, ROI.y, ROI.w, ROI.h, 0, 0, ROI.w, ROI.h);
            const sample = contourContext.getImageData(0, 0, W, H).data, pixels = contourContext.createImageData(W, H), arrival = new Float32Array(W * H), strength = new Float32Array(arrival.length), born = arrivalBuffers[index];
            for (let i = 0; i < arrival.length; i++) {
                const offset = i * 4, light = (sample[offset] + sample[offset + 1] + sample[offset + 2]) / 765, blue = (sample[offset + 2] - sample[offset]) / 255;
                strength[i] = smooth(.075, .31, light) * smooth(.008, .08, blue);
                arrival[i] = born[i] === 255 ? 99 : born[i] / 24;
                pixels.data.set([sample[offset], sample[offset + 1], sample[offset + 2], 0], offset);
            }
            return { key, pixels, arrival, strength };
        });
        arrivalBuffers.forEach(buffer => buffer.fill(0));
        for (const index of [12, 24, 30, 36, 39]) {
            frames.get(index)?.close();
            frames.delete(index);
        }
        const motion = localMotion(W, H);
        motionResource = motion;
        const poseToCanvas = (t: number) => Math.max(63, Math.min(168, Math.round(t * 24)));
        function composeMaterial(t: number) {
            clear(ac);
            ac.drawImage(img(poseToCanvas(t)), 240, 0);
            ac.globalCompositeOperation = 'destination-in';
            ac.drawImage(canvases.sourceMask, 0, 0);
            ac.globalCompositeOperation = 'destination-over';
            ac.drawImage(cleanPlate!, 0, 0, W, H);
            ac.globalCompositeOperation = 'destination-in';
            ac.drawImage(canvases.person, 0, 0);
            ac.globalCompositeOperation = 'source-over';
            clear(mc);
            world(mc);
            mc.fillStyle = 'white';
            if (t >= 2.36)
                mc.fillRect(0, 0, W, H);
            else {
                const pitch = 8;
                for (let y = -24; y < H + 24; y += pitch)
                    for (let x = -24; x < W + 24; x += pitch) {
                        const start = 1.42 + .2 * smooth(620, 1190, x) + .1 * smooth(70, 720, y);
                        mc.globalAlpha = smooth(start, start + .38, t);
                        mc.fillRect(x, y, pitch, pitch);
                    }
            }
            clear(rc);
            rc.drawImage(canvases.atlas, 0, 0);
            rc.globalCompositeOperation = 'destination-in';
            rc.filter = 'blur(3px)';
            rc.drawImage(canvases.mask, 0, 0);
            rc.filter = 'none';
            rc.globalCompositeOperation = 'source-over';
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(motion.draw(canvases.revealed, t), 0, 0);
            ctx.restore();
        }
        function drawGrid(t: number) { const gc = canvases.gridReveal.getContext('2d')!; clear(gc); gc.drawImage(canvases.gridAtlas, 0, 0); clear(mc); world(mc); mc.fillStyle = 'white'; const pitch = 18; for (let y = -18; y < H + 18; y += pitch)
            for (let x = -18; x < W + 18; x += pitch) {
                const seed = Math.sin(x * .083 + y * .031) * 43758.5453, n = seed - Math.floor(seed), start = .74 + .65 * smooth(800, 1020, x) + .12 * smooth(150, 660, y) + n * .08, late = smooth(370, 530, y) * smooth(965, 1170, x);
                mc.globalAlpha = smooth(start, start + .32, t) * (1 - smooth(1.84 + late * .35, 2.39 + late * .52, t));
                mc.fillRect(x - .5, y - .5, pitch + 1, pitch + 1);
            } gc.globalCompositeOperation = 'destination-in'; gc.filter = 'blur(5px)'; gc.drawImage(canvases.mask, 0, 0); gc.filter = 'none'; gc.globalCompositeOperation = 'source-over'; applyCharacterMask(gc); ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.drawImage(canvases.gridReveal, 0, 0); ctx.restore(); }
        function drawContours(t: number) { const fade = 1 - smooth(1.39, 1.79, t); if (fade <= 0)
            return; const track = contourTracks.find(v => v.key / 24 >= t) ?? contourTracks[3], { pixels, arrival, strength } = track, data = pixels.data; for (let i = 0; i < arrival.length; i++) {
            const born = arrival[i], a = strength[i] * smooth(born - .018, born + .022, t) * fade;
            data[i * 4 + 3] = Math.round(a * 255);
        } contourContext.putImageData(pixels, 0, 0); const temp = canvases.gridReveal.getContext('2d')!; clear(temp); temp.drawImage(contourCanvas, 0, 0); temp.globalCompositeOperation = 'destination-in'; temp.drawImage(canvases.sourceMask, 0, 0); temp.globalCompositeOperation = 'source-over'; applyCharacterMask(temp); ctx.save(); ctx.shadowColor = '#67bfff'; ctx.shadowBlur = 3; ctx.drawImage(canvases.gridReveal, 0, 0); ctx.restore(); }
        const S = 3, X = 62, Y = 244, WIDTH = 536, HEIGHT = 231, logoLayer = document.createElement('canvas');
        logoLayer.width = WIDTH * S;
        logoLayer.height = HEIGHT * S;
        const logoCtx = logoLayer.getContext('2d')!;
        const logoGroups = LOGO_GROUPS.map(g => { const tr = g.transform, m = new DOMMatrix([tr.sx, 0, 0, tr.sy, tr.x - tr.ox * tr.sx, tr.y - tr.oy * tr.sy]), toPath = (d: string) => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'); el.setAttribute('d', d); const path = new Path2D(); path.addPath(new Path2D(d), m); return { d, path, el, length: el.getTotalLength() }; }; return { fills: g.paths.map(toPath), contours: g.paths.flatMap(d => (d.match(/M[^M]+/g) ?? []).map(toPath)) }; });
        function drawLogoGlow(t: number) { if (t < 2)
            return; logoCtx.setTransform(1, 0, 0, 1, 0, 0); logoCtx.clearRect(0, 0, logoLayer.width, logoLayer.height); logoCtx.setTransform(S, 0, 0, S, -X * S, -Y * S); const p = smooth(BRAND_REVEAL_START, BRAND_REVEAL_START + .45, t), x = 139 - 34 * p, y = 305 - 25 * p, scale = (324 - 237 * p) / LOGO_VIEWBOX[2]; logoCtx.save(); logoCtx.translate(x, y); logoCtx.scale(scale, scale); logoCtx.lineJoin = 'round'; logoCtx.lineCap = 'round'; logoGroups.forEach((group, i) => { const fill = smooth(2 + i * .4 + .4, 2 + i * .4 + .88, t), progress = clamp((t - (2 + i * .4)) / .8), total = group.contours.reduce((sum, g) => sum + g.length, 0); let traveled = 0; for (const g of group.contours) {
            const amount = clamp((progress * total - traveled) / g.length);
            traveled += g.length;
            if (amount <= 0)
                continue;
            logoCtx.setLineDash([g.length * amount, g.length + 1]);
            logoCtx.globalAlpha = .3 * (1 - fill);
            logoCtx.strokeStyle = '#b64658';
            logoCtx.lineWidth = 4.6 / scale;
            logoCtx.shadowColor = '#a72d46';
            logoCtx.shadowBlur = 6 * S;
            logoCtx.stroke(g.path);
        } }); logoCtx.restore(); ctx.save(); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(logoLayer, X, Y, WIDTH, HEIGHT); ctx.restore(); }
        // The text objects in the source SVG overlay are replaced by fixed, atlas-backed sprites.
        const SLOGAN_TEXT = 'TOGETHER, LIFTING EVERYONE WE SERVE';
        const sloganSprite = glyphs.sprite(SLOGAN_TEXT, 'slogan', '#f4f8ff');
        const sloganImage = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        sloganImage.setAttribute('href', sloganSprite.url);
        sloganImage.setAttribute('x', String(105 - 4));
        sloganImage.setAttribute('y', String(370 - sloganSprite.baseline));
        sloganImage.setAttribute('width', String(sloganSprite.width));
        sloganImage.setAttribute('height', String(sloganSprite.height));
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 1280 720');
        svg.setAttribute('class', 'brand-vectors');
        svg.setAttribute('aria-hidden', 'true');
        stage.append(svg);
        const mark = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        mark.setAttribute('stroke-linejoin', 'round');
        mark.setAttribute('stroke-linecap', 'round');
        svg.append(mark);
        const vectorNodes = logoGroups.map((group, index) => {
            const v = LOGO_GROUPS[index].transform, transform = `matrix(${v.sx} 0 0 ${v.sy} ${v.x - v.ox * v.sx} ${v.y - v.oy * v.sy})`;
            const fills = group.fills.map(g => { const el = document.createElementNS('http://www.w3.org/2000/svg', 'path'); el.setAttribute('d', g.d); el.setAttribute('transform', transform); el.setAttribute('fill', OCBC_RED); el.setAttribute('fill-rule', 'evenodd'); mark.append(el); return el; });
            const contours = group.contours.map(g => { const base = document.createElementNS('http://www.w3.org/2000/svg', 'path'), head = document.createElementNS('http://www.w3.org/2000/svg', 'path'); for (const el of [base, head]) {
                el.setAttribute('d', g.d);
                el.setAttribute('transform', transform);
                el.setAttribute('fill', 'none');
                mark.append(el);
            } base.setAttribute('stroke', '#d6818d'); head.setAttribute('stroke', '#df91a1'); return { base, head }; });
            return { fills, contours };
        });
        const sloganGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        sloganGroup.append(sloganImage);
        svg.append(sloganGroup);
        function drawSloganEffects(t: number) { if (t < BRAND_REVEAL_START)
            return; const elapsed = t - BRAND_REVEAL_START; ctx.save(); if (elapsed < 1.49) {
            for (const d of glyphs.sloganDots) {
                const v = smooth(.04 + d.delay, 1.14 + d.delay, elapsed), a = smooth(0, .22, elapsed) * (1 - smooth(.96, 1.44, elapsed));
                if (!a)
                    continue;
                const x = d.x + d.dx * (1 - v), y = d.y + d.dy * (1 - v);
                ctx.globalAlpha = a * (.4 + v * .45);
                ctx.fillStyle = '#a1d9fb';
                ctx.fillRect(x, y, 1.3, 1.3);
            }
        } ctx.globalAlpha = smooth(BRAND_REVEAL_START + .87, BRAND_REVEAL_START + 1.34, t) * .12; ctx.fillStyle = '#9bd6ff'; ctx.shadowColor = '#58aef0'; ctx.shadowBlur = 7; glyphs.draw(ctx, SLOGAN_TEXT, 105, 370, 'slogan', '#9bd6ff'); ctx.restore(); }
        function drawTerminal(t: number) { clear(cliCtx); const first = BRAND_REVEAL_START + .15; if (t < first)
            return; const lines = [{ start: first, text: '> initializing deepseek harness...' }, { start: BRAND_REVEAL_START + 1.35, text: '> loading model...' }, { start: BRAND_REVEAL_START + 2.1, text: '> ready' }]; cliCtx.save(); cliCtx.shadowBlur = 0; cliCtx.translate(108, 503); cliCtx.scale(.7, .7); cliCtx.translate(-108, -503); let active = -1; for (let i = 0; i < lines.length; i++) {
            const line = lines[i], text = line.text.slice(0, Math.max(0, Math.floor((t - line.start) * 31)));
            if (t < line.start)
                continue;
            active = i;
            glyphs.draw(cliCtx, text, 108, 462 + i * 19, 'small', '#f4f8ff');
        } if (active >= 0) {
            const line = lines[active], text = line.text.slice(0, Math.max(0, Math.floor((t - line.start) * 31))), typing = text.length < line.text.length;
            if (typing || Math.floor(t * 2) % 2 === 0) {
                const x = 108 + glyphs.measure(text, 'small') + 3;
                cliCtx.fillStyle = '#f4f8ff';
                cliCtx.fillRect(x, 452 + active * 19, 6, 11);
            }
        } cliCtx.restore(); }
        redrawCli = () => drawTerminal(lastTime);
        function drawLetterFlow(t: number) { ctx.save(); ctx.textAlign = 'center'; for (let i = 0; i < flowRegionColumns * flowRegionRows * flowsPerRegion; i++) {
            const region = Math.floor(i / flowsPerRegion), column = region % flowRegionColumns, row = Math.floor(region / flowRegionColumns);
            const lane = i % flowsPerRegion, phase = flowPhase((region * 11) % 24 + lane * 31, t);
            const x = 36 + column * 160 + lane * 58 + (row % 2) * 8, bottom = 18 + row * 232 + 84 + phase * 148;
            const visibility = smooth(0, .12, phase) * (1 - smooth(.86, 1, phase));
            for (let j = 0; j < 5; j++) {
                const y = bottom - j * 18;
                if (y < 18 || y > 704)
                    continue;
                const brandAvoid = x > 88 && x < 572 && y > 262 && y < 417 ? .3 : 1, titleAvoid = x < 450 && y < 82 ? .2 : 1;
                ctx.globalAlpha = flowBrightness / 100 * visibility * (1 - j * .16) * brandAvoid * titleAvoid * smooth(.4, 1.8, t);
                glyphs.draw(ctx, FLOW_WORD[j], x, y, 'small', j === 0 ? FLOW_HEAD : FLOW_TAIL, 'center');
            }
        } ctx.restore(); }
        function drawBackground(t: number) {
            ctx.fillStyle = '#030609';
            ctx.fillRect(0, 0, W, H);
            drawLetterFlow(t);
        }
        function updateOverlay(t: number) {
            const visible = t >= 2;
            svg.style.visibility = visible ? 'visible' : 'hidden';
            if (!visible)
                return;
            const p = smooth(BRAND_REVEAL_START, BRAND_REVEAL_START + .45, t), x = 139 - 34 * p, y = 305 - 25 * p, scale = (324 - 237 * p) / LOGO_VIEWBOX[2];
            mark.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
            vectorNodes.forEach((node, i) => {
                const fill = smooth(2 + i * .4 + .4, 2 + i * .4 + .88, t), contours = logoGroups[i].contours, total = contours.reduce((sum, g) => sum + g.length, 0);
                node.fills.forEach(el => el.setAttribute('opacity', String(fill)));
                let traveled = 0;
                contours.forEach((g, j) => {
                    const progress = clamp((t - (2 + i * .4)) / .8), amount = clamp((progress * total - traveled) / g.length);
                    traveled += g.length;
                    const { base, head } = node.contours[j];
                    base.setAttribute('opacity', amount > 0 ? String(.85 * (1 - fill)) : '0');
                    base.setAttribute('stroke-width', String(1.75 / scale));
                    base.setAttribute('stroke-dasharray', `${g.length * amount} ${g.length + 1}`);
                    const end = g.length * amount, tail = Math.min(end, 24 / scale);
                    head.setAttribute('opacity', amount > 0 && amount < 1 ? '.95' : '0');
                    head.setAttribute('stroke-width', String(2.15 / scale));
                    head.setAttribute('stroke-dasharray', `${tail} ${g.length + tail + 1}`);
                    head.setAttribute('stroke-dashoffset', String(-(end - tail)));
                });
            });
            sloganGroup.setAttribute('opacity', String(smooth(BRAND_REVEAL_START + .87, BRAND_REVEAL_START + 1.34, t)));
        }
        function render(t: number) { if (disposed)
            return; const time = clamp(t / DURATION) * DURATION; lastTime = time; clear(ctx); drawBackground(time); world(ctx); composeMaterial(time); drawGrid(time); drawContours(time); drawLogoGlow(time); drawSloganEffects(time); drawTerminal(time); hud.style.opacity = String(smooth(.3, 1, time)); updateOverlay(time); }
        // Preload only validated release assets; no study, host, or network URL is embedded here.
        let released = false;
        const dispose = () => { if (released)
            return; released = true; disposed = true; signal?.removeEventListener('abort', dispose); initController.abort(abortError()); signal?.removeEventListener('abort', abortLink); observer.disconnect(); window.removeEventListener('resize', resize); for (const image of frames.values())
            image.close(); frames.clear(); contourTracks.length = 0; cleanPlate?.close(); motion.dispose?.(); glyphs.dispose(); svg.remove(); hud.remove(); wrapper.remove(); for (const c of Object.values(canvases)) {
            c.width = 0;
            c.height = 0;
        } contourCanvas.width = 0; contourCanvas.height = 0; logoLayer.width = 0; logoLayer.height = 0; output.width = 0; output.height = 0; cliCanvas.width = 0; cliCanvas.height = 0; };
        signal?.addEventListener('abort', dispose, { once: true });
        return { render, dispose };
    }
    catch (error) {
        disposed = true;
        initController.abort(error);
        signal?.removeEventListener('abort', abortLink);
        observer.disconnect();
        window.removeEventListener('resize', resize);
        for (const image of frames.values())
            image.close();
        frames.clear();
        cleanPlate?.close();
        motionResource?.dispose?.();
        glyphApi?.dispose();
        wrapper.remove();
        throw error;
    }
}
