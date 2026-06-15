// r_plane.mjs -- visplane (floor/ceiling) management (r_plane.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// M3 scope: clip arrays, openings, visplane find/check (the seg loop
// writes plane bounds through these). R_DrawPlanes becomes real in M4;
// until then floors/ceilings stay background-coloured.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

const SCREENWIDTH = _G.DOOM.SCREENWIDTH

let T = null, RM = null, RDraw = null, RD = null, L = null

const MAXVISPLANES = 128
const MAXOPENINGS = SCREENWIDTH * 64

// visplane pool; top/bottom are padded one byte each side like vanilla
// (index x+1), 0xFF = untouched column sentinel
function makeVisplane() {
    return {
        height: 0, picnum: 0, lightlevel: 0, minx: 0, maxx: 0,
        top: new Uint8Array(SCREENWIDTH + 2),
        bottom: new Uint8Array(SCREENWIDTH + 2),
    }
}
const visplanes = []
for (let i = 0; i < MAXVISPLANES; i++) visplanes.push(makeVisplane())
let lastvisplane = 0            // index into visplanes
let overflowWarned = false

// clipping arrays (vanilla shorts)
const floorclip = new Int16Array(SCREENWIDTH)
const ceilingclip = new Int16Array(SCREENWIDTH)

// sprite/masked clip storage
const openings = new Int16Array(MAXOPENINGS)
let lastopening = 0

// span-mapping state (M4)
let basexscale = 0, baseyscale = 0
const cachedheight = new Int32Array(200)

function R_ClearPlanes() {
    const vw = RM.getViewwidth()
    const vh = RM.getViewheight()
    for (let i = 0; i < vw; i++) {
        floorclip[i] = vh
        ceilingclip[i] = -1
    }
    lastvisplane = 0
    lastopening = 0
    cachedheight.fill(0)
    const angle = ((RM.R.viewangle - 0x40000000) >>> 0) >>> 19
    basexscale = T.FixedDiv(T.finecosine[angle], RM.getCenterxfrac())
    baseyscale = -T.FixedDiv(T.finesine[angle], RM.getCenterxfrac())
}

function R_FindPlane(height, picnum, lightlevel) {
    if (picnum === RD.getSkyflatnum()) {
        height = 0
        lightlevel = 0
    }
    let i
    for (i = 0; i < lastvisplane; i++) {
        const p = visplanes[i]
        if (height === p.height && picnum === p.picnum &&
            lightlevel === p.lightlevel) return p
    }
    if (lastvisplane >= MAXVISPLANES) {
        // vanilla I_Errors; we reuse the last plane and log once (render
        // damage only -- the playsim is unaffected)
        if (!overflowWarned) { overflowWarned = true }
        return visplanes[MAXVISPLANES - 1]
    }
    const p = visplanes[lastvisplane++]
    p.height = height
    p.picnum = picnum
    p.lightlevel = lightlevel
    p.minx = SCREENWIDTH
    p.maxx = -1
    p.top.fill(0xFF)
    return p
}

function R_CheckPlane(pl, start, stop) {
    let intrl, intrh, unionl, unionh
    if (start < pl.minx) { intrl = pl.minx; unionl = start }
    else { unionl = pl.minx; intrl = start }
    if (stop > pl.maxx) { intrh = pl.maxx; unionh = stop }
    else { unionh = pl.maxx; intrh = stop }

    let x
    for (x = intrl; x <= intrh; x++)
        if (pl.top[x + 1] !== 0xFF) break
    if (x > intrh) {
        pl.minx = unionl
        pl.maxx = unionh
        return pl              // use the same one
    }
    // make a new visplane
    const np = R_FindPlaneRaw(pl.height, pl.picnum, pl.lightlevel)
    np.minx = start
    np.maxx = stop
    return np
}

// allocate without merging (R_CheckPlane's tail)
function R_FindPlaneRaw(height, picnum, lightlevel) {
    if (lastvisplane >= MAXVISPLANES) return visplanes[MAXVISPLANES - 1]
    const p = visplanes[lastvisplane++]
    p.height = height
    p.picnum = picnum
    p.lightlevel = lightlevel
    p.minx = SCREENWIDTH
    p.maxx = -1
    p.top.fill(0xFF)
    return p
}

// ---- plane rendering ----

const spanstart = new Int32Array(200)
let planeheight = 0
let planezlight = null          // Int32Array of colormap offsets
const ANGLETOSKYSHIFT = 22

let ds = null, dc = null        // r_draw parameter objects (bound at init)
let RDrawMod = null

function R_MapPlane(y, x1, x2) {
    let distance
    if (planeheight !== cachedheight[y]) {
        cachedheight[y] = planeheight
        distance = cacheddistance[y] = T.FixedMul(planeheight, RM.yslope[y])
        ds.xstep = cachedxstep[y] = T.FixedMul(distance, basexscale)
        ds.ystep = cachedystep[y] = T.FixedMul(distance, baseyscale)
    } else {
        distance = cacheddistance[y]
        ds.xstep = cachedxstep[y]
        ds.ystep = cachedystep[y]
    }
    const length = T.FixedMul(distance, RM.distscale[x1])
    const angle = (((RM.R.viewangle + RM.xtoviewangle[x1]) >>> 0) >>> 19) & 8191
    ds.xfrac = (RM.R.viewx + T.FixedMul(T.finecosine[angle], length)) | 0
    ds.yfrac = (-RM.R.viewy - T.FixedMul(T.finesine[angle], length)) | 0

    if (RM.R.fixedcolormapOfs >= 0) {
        ds.colormapOfs = RM.R.fixedcolormapOfs
    } else {
        let index = distance >>> 20            // LIGHTZSHIFT
        if (index >= 128) index = 127          // MAXLIGHTZ
        ds.colormapOfs = planezlight[index]
    }
    ds.y = y
    ds.x1 = x1
    ds.x2 = x2
    RDrawMod.R_DrawSpan()
}

function R_MakeSpans(x, t1, b1, t2, b2) {
    while (t1 < t2 && t1 <= b1) {
        R_MapPlane(t1, spanstart[t1], x - 1)
        t1++
    }
    while (b1 > b2 && b1 >= t1) {
        R_MapPlane(b1, spanstart[b1], x - 1)
        b1--
    }
    while (t2 < t1 && t2 <= b2) {
        spanstart[t2] = x
        t2++
    }
    while (b2 > b1 && b2 >= t2) {
        spanstart[b2] = x
        b2--
    }
}

const cacheddistance = new Int32Array(200)
const cachedxstep = new Int32Array(200)
const cachedystep = new Int32Array(200)

function R_DrawPlanes() {
    const skyflatnum = RD.getSkyflatnum()
    for (let i = 0; i < lastvisplane; i++) {
        const pl = visplanes[i]
        if (pl.minx > pl.maxx) continue

        if (pl.picnum === skyflatnum) {
            // sky: full-bright columns, angle-mapped horizontally
            dc.iscale = RM.getPspriteiscale()
            dc.colormapOfs = 0
            dc.texturemid = RM.getSkytexturemid()
            const skytex = RM.getSkytexture()
            const skydata = RD.R_GetTexture(skytex)
            for (let x = pl.minx; x <= pl.maxx; x++) {
                dc.yl = pl.top[x + 1]
                dc.yh = pl.bottom[x + 1]
                if (dc.yl <= dc.yh) {
                    const angle = ((RM.R.viewangle + RM.xtoviewangle[x]) >>> 0)
                        >>> ANGLETOSKYSHIFT
                    dc.x = x
                    dc.source = skydata
                    dc.sourceOfs = RD.R_GetColumnOfs(skytex, angle)
                    RDrawMod.R_DrawColumn()
                }
            }
            continue
        }

        // regular flat
        ds.source = RD.R_GetFlat(pl.picnum)
        planeheight = Math.abs((pl.height - RM.R.viewz) | 0)
        let light = (pl.lightlevel >> 4) + RM.R.extralight
        if (light >= 16) light = 15
        if (light < 0) light = 0
        planezlight = RM.zlight[light]

        pl.top[pl.maxx + 2] = 0xFF
        pl.top[pl.minx] = 0xFF

        const stop = pl.maxx + 1
        for (let x = pl.minx; x <= stop; x++) {
            R_MakeSpans(x, pl.top[x], pl.bottom[x], pl.top[x + 1], pl.bottom[x + 1])
        }
    }
}

exports = {
    floorclip, ceilingclip, openings,
    R_ClearPlanes, R_FindPlane, R_CheckPlane, R_DrawPlanes,
    getLastopening: () => lastopening,
    setLastopening: (v) => { lastopening = v },
    getLastvisplane: () => lastvisplane,
    getVisplane: (i) => visplanes[i],
    init: function (D) {
        T = D.tables; RM = D.r_main; RDraw = D.r_draw; RD = D.r_data
        L = D.p_setup.level
        RDrawMod = D.r_draw; ds = D.r_draw.ds; dc = D.r_draw.dc
    },
}
