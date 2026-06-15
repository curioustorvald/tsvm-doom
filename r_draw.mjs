// r_draw.mjs -- low-level column/span drawing (r_draw.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// The dc/ds parameter objects replace vanilla's dc_*/ds_* globals; callers
// fill them and invoke the draw function. One stable object shape each, so
// the JIT keeps property access monomorphic.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

const SCREENWIDTH = _G.DOOM.SCREENWIDTH
const SCREENHEIGHT = _G.DOOM.SCREENHEIGHT

let V = null, R = null          // v_video, r_data
let colormaps = null

// column drawing parameters (vanilla dc_*)
const dc = {
    x: 0, yl: 0, yh: 0,
    iscale: 0,                  // fixed
    texturemid: 0,              // fixed
    colormapOfs: 0,             // byte offset into colormaps (light*256)
    source: null,               // Uint8Array
    sourceOfs: 0,               // start of the column inside source
    translation: null,          // Uint8Array (translated draws)
    translationOfs: 0,
}

// span drawing parameters (vanilla ds_*), used from M4
const ds = {
    y: 0, x1: 0, x2: 0,
    xfrac: 0, yfrac: 0, xstep: 0, ystep: 0,
    colormapOfs: 0,
    source: null,               // 64x64 flat
}

// view window mapping into screens[0]
let viewwindowx = 0, viewwindowy = 0
let viewwidth = SCREENWIDTH, viewheight = SCREENHEIGHT
let centery = 100
const ylookup = new Int32Array(SCREENHEIGHT)
const columnofs = new Int32Array(SCREENWIDTH)

function R_InitBuffer(width, height) {
    viewwindowx = (SCREENWIDTH - width) >> 1
    viewwindowy = width === SCREENWIDTH ? 0 : (SCREENHEIGHT - 32 - height) >> 1
    viewwidth = width
    viewheight = height
    centery = height >> 1
    for (let i = 0; i < width; i++) columnofs[i] = viewwindowx + i
    for (let y = 0; y < height; y++)
        ylookup[y] = (y + viewwindowy) * SCREENWIDTH
}

// R_DrawColumn: vertical texture-mapped run. The `& 127` frac wrap is
// vanilla; composite columns are stride>=128 and pre-tiled so it is safe.
function R_DrawColumn() {
    let count = dc.yh - dc.yl
    if (count < 0) return
    const screen = V.screens[0]
    let dest = ylookup[dc.yl] + columnofs[dc.x]
    const fracstep = dc.iscale
    let frac = (dc.texturemid + Math.imul(dc.yl - centery, fracstep)) | 0
    const src = dc.source
    const sofs = dc.sourceOfs
    const cm = dc.colormapOfs
    do {
        screen[dest] = colormaps[cm + src[sofs + ((frac >> 16) & 127)]]
        dest += SCREENWIDTH
        frac = (frac + fracstep) | 0
    } while (count--)
}

// spectre/invisibility: distort by reading a nearby already-drawn pixel
// through colormap 6 (r_draw.c fuzzoffset pattern, +-SCREENWIDTH)
const F = SCREENWIDTH
const fuzzoffset = new Int32Array([
    F, -F, F, -F, F, F, -F,
    F, F, -F, F, F, F, -F,
    F, F, F, -F, -F, -F, -F,
    F, -F, -F, F, F, F, F, -F,
    F, -F, F, F, -F, -F, F,
    F, -F, -F, -F, -F, F, F,
    F, F, -F, F, F, -F, F,
])
let fuzzpos = 0
let fuzzViewheight = SCREENHEIGHT

function R_DrawFuzzColumn() {
    // keep the offset reads inside the screen
    if (dc.yl === 0) dc.yl = 1
    if (dc.yh === fuzzViewheight - 1) dc.yh = fuzzViewheight - 2
    let count = dc.yh - dc.yl
    if (count < 0) return
    const screen = V.screens[0]
    let dest = ylookup[dc.yl] + columnofs[dc.x]
    do {
        screen[dest] = colormaps[6 * 256 + screen[dest + fuzzoffset[fuzzpos]]]
        if (++fuzzpos === 50) fuzzpos = 0
        dest += SCREENWIDTH
    } while (count--)
}

// player colour remap draw (dc.translation = Uint8Array slice base offset)
function R_DrawTranslatedColumn() {
    let count = dc.yh - dc.yl
    if (count < 0) return
    const screen = V.screens[0]
    let dest = ylookup[dc.yl] + columnofs[dc.x]
    const fracstep = dc.iscale
    let frac = (dc.texturemid + Math.imul(dc.yl - centery, fracstep)) | 0
    const src = dc.source
    const sofs = dc.sourceOfs
    const cm = dc.colormapOfs
    const trans = dc.translation
    const tofs = dc.translationOfs
    do {
        screen[dest] = colormaps[cm + trans[tofs + src[sofs + ((frac >> 16) & 127)]]]
        dest += SCREENWIDTH
        frac = (frac + fracstep) | 0
    } while (count--)
}

// R_DrawSpan: horizontal flat run (M4)
function R_DrawSpan() {
    const screen = V.screens[0]
    let dest = ylookup[ds.y] + columnofs[ds.x1]
    let count = ds.x2 - ds.x1
    let xfrac = ds.xfrac, yfrac = ds.yfrac
    const src = ds.source
    const cm = ds.colormapOfs
    do {
        const spot = ((yfrac >> 10) & 0x0FC0) | ((xfrac >> 16) & 0x3F)
        screen[dest++] = colormaps[cm + src[spot]]
        xfrac = (xfrac + ds.xstep) | 0
        yfrac = (yfrac + ds.ystep) | 0
    } while (count--)
}

function R_VideoErase(ofs, count) {
    V.screens[0].set(V.screens[1].subarray(ofs, ofs + count), ofs)
}

exports = {
    dc, ds,
    R_InitBuffer, R_DrawColumn, R_DrawSpan, R_VideoErase,
    R_DrawFuzzColumn, R_DrawTranslatedColumn,
    getViewwindowx: () => viewwindowx,
    getViewwindowy: () => viewwindowy,
    setCentery: (c) => { centery = c },
    setFuzzViewheight: (h) => { fuzzViewheight = h },
    init: function (D) {
        V = D.v_video; R = D.r_data
    },
    // colormaps must be re-grabbed after R_InitData
    bindColormaps: function () { colormaps = R.getColormaps() },
}
