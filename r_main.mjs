// r_main.mjs -- renderer core: view state, projection, lighting (r_main.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Angle discipline: angle_t values are uint32; every angle expression is
// wrapped with >>> 0 and finesine/viewangletox indexing uses >>> shifts.
// The exported `R` object carries the cross-module render state that
// vanilla kept as file-scope globals shared via headers.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, RD = null, RDraw = null, RB = null, RP = null
let L = null, RT = null

const SCREENWIDTH = _G.DOOM.SCREENWIDTH
const SCREENHEIGHT = _G.DOOM.SCREENHEIGHT
const FRACUNIT = 65536
const FINEANGLES = 8192
const ANGLETOFINESHIFT = 19
const FIELDOFVIEW = 2048
const ANG90 = 0x40000000
const ANG180 = 0x80000000
const ANG270 = 0xc0000000

// lighting constants (r_main.h)
const LIGHTLEVELS = 16
const LIGHTSEGSHIFT = 4
const MAXLIGHTSCALE = 48
const LIGHTSCALESHIFT = 12
const MAXLIGHTZ = 128
const LIGHTZSHIFT = 20
const NUMCOLORMAPS = 32
const DISTMAP = 2

// cross-module render state (vanilla globals)
const R = {
    viewplayer: null,
    viewx: 0, viewy: 0, viewz: 0,
    viewangle: 0,               // uint32
    viewsin: 0, viewcos: 0,
    extralight: 0,
    fixedcolormapOfs: -1,       // -1 = none, else byte offset
    validcount: 1,
    framecount: 0,
    // set by r_bsp, read by r_segs:
    curline: -1, frontsector: -1, backsector: -1,
    rw_angle1: 0,
    // visplane refs (objects from r_plane)
    floorplane: null, ceilingplane: null,
    // current wall light table (Int32Array of colormap offsets)
    walllights: null,
}

// view window
let viewwidth = SCREENWIDTH
let viewheight = SCREENHEIGHT
let scaledviewwidth = SCREENWIDTH
let centerx = 160, centery = 100
let centerxfrac = 160 << 16, centeryfrac = 100 << 16
let projection = 160 << 16
let pspritescale = FRACUNIT
let pspriteiscale = FRACUNIT

// sky (r_sky.c): texture set per episode/map by the game shell
let skytexture = 0
let skytexturemid = 100 * FRACUNIT

function R_InitSkyMap() { skytexturemid = 100 * FRACUNIT }

let clipangle = 0               // uint32
const viewangletox = new Int32Array(FINEANGLES / 2)
const xtoviewangle = new Float64Array(SCREENWIDTH + 1)  // uint32 values
const yslope = new Int32Array(SCREENHEIGHT)
const distscale = new Int32Array(SCREENWIDTH)
const screenheightarray = new Int16Array(SCREENWIDTH)
const negonearray = new Int16Array(SCREENWIDTH).fill(-1)

// light tables: colormap byte offsets
const scalelight = []           // [LIGHTLEVELS][MAXLIGHTSCALE]
const scalelightfixed = new Int32Array(MAXLIGHTSCALE)
const zlight = []               // [LIGHTLEVELS][MAXLIGHTZ]
for (let i = 0; i < LIGHTLEVELS; i++) {
    scalelight.push(new Int32Array(MAXLIGHTSCALE))
    zlight.push(new Int32Array(MAXLIGHTZ))
}

function FixedMul(a, b) { return T.FixedMul(a, b) }
function FixedDiv(a, b) { return T.FixedDiv(a, b) }

// node partition-line side test; sign-bit fast path like vanilla
function R_PointOnSide(x, y, node) {
    const nx = L.node_x[node], ny = L.node_y[node]
    const ndx = L.node_dx[node], ndy = L.node_dy[node]
    if (ndx === 0) {
        if (x <= nx) return ndy > 0 ? 1 : 0
        return ndy < 0 ? 1 : 0
    }
    if (ndy === 0) {
        if (y <= ny) return ndx < 0 ? 1 : 0
        return ndx > 0 ? 1 : 0
    }
    const dx = (x - nx) | 0
    const dy = (y - ny) | 0
    if ((ndy ^ ndx ^ dx ^ dy) & 0x80000000) {
        return (ndy ^ dx) & 0x80000000 ? 1 : 0
    }
    const left = FixedMul(ndy >> 16, dx)
    const right = FixedMul(dy, ndx >> 16)
    return right < left ? 0 : 1
}

function R_PointOnSegSide(x, y, seg) {
    const lx = L.vertex_x[L.seg_v1[seg]], ly = L.vertex_y[L.seg_v1[seg]]
    const ldx = (L.vertex_x[L.seg_v2[seg]] - lx) | 0
    const ldy = (L.vertex_y[L.seg_v2[seg]] - ly) | 0
    if (ldx === 0) {
        if (x <= lx) return ldy > 0 ? 1 : 0
        return ldy < 0 ? 1 : 0
    }
    if (ldy === 0) {
        if (y <= ly) return ldx < 0 ? 1 : 0
        return ldx > 0 ? 1 : 0
    }
    const dx = (x - lx) | 0
    const dy = (y - ly) | 0
    if ((ldy ^ ldx ^ dx ^ dy) & 0x80000000) {
        return (ldy ^ dx) & 0x80000000 ? 1 : 0
    }
    const left = FixedMul(ldy >> 16, dx)
    const right = FixedMul(dy, ldx >> 16)
    return right < left ? 0 : 1
}

// global angle to a point, octant-folded through tantoangle (uint32 result)
function R_PointToAngle(x, y) {
    x = (x - R.viewx) | 0
    y = (y - R.viewy) | 0
    if (x === 0 && y === 0) return 0
    const tta = T.tantoangle
    if (x >= 0) {
        if (y >= 0) {
            if (x > y) return tta[T.SlopeDiv(y, x)]                       // 0
            return (ANG90 - 1 - tta[T.SlopeDiv(x, y)]) >>> 0              // 1
        }
        y = -y
        if (x > y) return (0 - tta[T.SlopeDiv(y, x)]) >>> 0               // 8
        return (ANG270 + tta[T.SlopeDiv(x, y)]) >>> 0                     // 7
    }
    x = -x
    if (y >= 0) {
        if (x > y) return (ANG180 - 1 - tta[T.SlopeDiv(y, x)]) >>> 0      // 3
        return (ANG90 + tta[T.SlopeDiv(x, y)]) >>> 0                      // 2
    }
    y = -y
    if (x > y) return (ANG180 + tta[T.SlopeDiv(y, x)]) >>> 0              // 4
    return (ANG270 - 1 - tta[T.SlopeDiv(x, y)]) >>> 0                     // 5
}

function R_PointToAngle2(x1, y1, x2, y2) {
    const sx = R.viewx, sy = R.viewy
    R.viewx = x1; R.viewy = y1
    const a = R_PointToAngle(x2, y2)
    R.viewx = sx; R.viewy = sy
    return a
}

function R_PointToDist(x, y) {
    let dx = Math.abs((x - R.viewx) | 0)
    let dy = Math.abs((y - R.viewy) | 0)
    if (dy > dx) { const t = dx; dx = dy; dy = t }
    const angle = ((T.tantoangle[FixedDiv(dy, dx) >>> T.DBITS] + ANG90) >>> 0)
        >>> ANGLETOFINESHIFT
    return FixedDiv(dx, T.finesine[angle])
}

// rw_distance must be set by the caller (r_segs) first
let rw_normalangle = 0          // uint32, shared with r_segs via accessors
let rw_distance = 0

function R_ScaleFromGlobalAngle(visangle) {
    const anglea = (ANG90 + (visangle - R.viewangle)) >>> 0
    const angleb = (ANG90 + (visangle - rw_normalangle)) >>> 0
    const sinea = T.finesine[anglea >>> ANGLETOFINESHIFT]
    const sineb = T.finesine[angleb >>> ANGLETOFINESHIFT]
    const num = FixedMul(projection, sineb)
    const den = FixedMul(rw_distance, sinea)
    let scale
    if (den > num >> 16) {
        scale = FixedDiv(num, den)
        if (scale > 64 * FRACUNIT) scale = 64 * FRACUNIT
        else if (scale < 256) scale = 256
    } else {
        scale = 64 * FRACUNIT
    }
    return scale
}

function R_InitTextureMapping() {
    // focal length so FIELDOFVIEW fineangles cover the view width
    const focallength = FixedDiv(centerxfrac,
        T.finetangent[FINEANGLES / 4 + FIELDOFVIEW / 2])
    for (let i = 0; i < FINEANGLES / 2; i++) {
        let t
        if (T.finetangent[i] > FRACUNIT * 2) t = -1
        else if (T.finetangent[i] < -FRACUNIT * 2) t = viewwidth + 1
        else {
            t = FixedMul(T.finetangent[i], focallength)
            t = (centerxfrac - t + FRACUNIT - 1) >> 16
            if (t < -1) t = -1
            else if (t > viewwidth + 1) t = viewwidth + 1
        }
        viewangletox[i] = t
    }
    for (let x = 0; x <= viewwidth; x++) {
        let i = 0
        while (viewangletox[i] > x) i++
        xtoviewangle[x] = ((i << ANGLETOFINESHIFT) - ANG90) >>> 0
    }
    for (let i = 0; i < FINEANGLES / 2; i++) {
        if (viewangletox[i] === -1) viewangletox[i] = 0
        else if (viewangletox[i] === viewwidth + 1) viewangletox[i] = viewwidth
    }
    clipangle = xtoviewangle[0]
}

function R_InitLightTables() {
    for (let i = 0; i < LIGHTLEVELS; i++) {
        const startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0
        for (let j = 0; j < MAXLIGHTZ; j++) {
            let scale = FixedDiv(SCREENWIDTH / 2 * FRACUNIT, (j + 1) << LIGHTZSHIFT)
            scale >>= LIGHTSCALESHIFT
            let level = startmap - ((scale / DISTMAP) | 0)
            if (level < 0) level = 0
            if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1
            zlight[i][j] = level * 256
        }
    }
}

function R_ExecuteSetViewSize(blocks) {
    if (blocks === 11) {
        scaledviewwidth = SCREENWIDTH
        viewheight = SCREENHEIGHT
    } else {
        scaledviewwidth = blocks * 32
        viewheight = ((blocks * 168 / 10) | 0) & ~7
    }
    viewwidth = scaledviewwidth
    centery = viewheight >> 1
    centerx = viewwidth >> 1
    centerxfrac = centerx << 16
    centeryfrac = centery << 16
    projection = centerxfrac

    RDraw.R_InitBuffer(scaledviewwidth, viewheight)
    RDraw.setCentery(centery)
    RDraw.setFuzzViewheight(viewheight)
    R_InitTextureMapping()

    pspritescale = ((FRACUNIT * viewwidth) / SCREENWIDTH) | 0
    pspriteiscale = ((FRACUNIT * SCREENWIDTH) / viewwidth) | 0

    for (let i = 0; i < viewwidth; i++) screenheightarray[i] = viewheight

    for (let i = 0; i < viewheight; i++) {
        let dy = ((i - viewheight / 2) << 16) + FRACUNIT / 2
        dy = Math.abs(dy | 0)
        yslope[i] = FixedDiv((viewwidth / 2) * FRACUNIT, dy)
    }
    for (let i = 0; i < viewwidth; i++) {
        const cosadj = Math.abs(T.finecosine[xtoviewangle[i] >>> ANGLETOFINESHIFT])
        distscale[i] = FixedDiv(FRACUNIT, cosadj)
    }
    for (let i = 0; i < LIGHTLEVELS; i++) {
        const startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0
        for (let j = 0; j < MAXLIGHTSCALE; j++) {
            let level = startmap -
                ((j * SCREENWIDTH / viewwidth / DISTMAP) | 0)
            if (level < 0) level = 0
            if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1
            scalelight[i][j] = level * 256
        }
    }
}

function R_PointInSubsector(x, y) {
    if (L.numnodes === 0) return 0
    let nodenum = L.numnodes - 1
    const NF = DD.NF_SUBSECTOR
    while (!(nodenum & NF)) {
        const side = R_PointOnSide(x, y, nodenum)
        nodenum = L.node_children[nodenum * 2 + side]
    }
    return nodenum & ~NF
}

// player: { mo: {x, y, angle}, viewz, extralight, fixedcolormap }
function R_SetupFrame(player) {
    R.viewplayer = player
    R.viewx = player.mo.x
    R.viewy = player.mo.y
    R.viewangle = player.mo.angle >>> 0
    R.extralight = player.extralight
    R.viewz = player.viewz
    R.viewsin = T.finesine[R.viewangle >>> ANGLETOFINESHIFT]
    R.viewcos = T.finecosine[R.viewangle >>> ANGLETOFINESHIFT]
    if (player.fixedcolormap) {
        R.fixedcolormapOfs = player.fixedcolormap * 256
        R.walllights = scalelightfixed
        for (let i = 0; i < MAXLIGHTSCALE; i++)
            scalelightfixed[i] = R.fixedcolormapOfs
    } else {
        R.fixedcolormapOfs = -1
    }
    R.framecount++
    R.validcount++
}

function R_RenderPlayerView(player) {
    R_SetupFrame(player)
    RB.R_ClearClipSegs()
    RB.R_ClearDrawSegs()
    RP.R_ClearPlanes()
    RT.R_ClearSprites()
    RB.R_RenderBSPNode(L.numnodes - 1)
    RP.R_DrawPlanes()
    RT.R_DrawMasked()
}

exports = {
    R,
    LIGHTLEVELS, LIGHTSEGSHIFT, MAXLIGHTSCALE, LIGHTSCALESHIFT,
    MAXLIGHTZ, LIGHTZSHIFT, NUMCOLORMAPS,
    R_PointOnSide, R_PointOnSegSide, R_PointToAngle, R_PointToAngle2,
    R_PointToDist, R_ScaleFromGlobalAngle,
    R_InitTextureMapping, R_InitLightTables, R_ExecuteSetViewSize,
    R_PointInSubsector, R_SetupFrame, R_RenderPlayerView,
    viewangletox, xtoviewangle, yslope, distscale,
    screenheightarray, negonearray, scalelight, zlight,
    getViewwidth: () => viewwidth,
    getViewheight: () => viewheight,
    getCenterx: () => centerx,
    getCentery: () => centery,
    getCenteryfrac: () => centeryfrac,
    getCenterxfrac: () => centerxfrac,
    getProjection: () => projection,
    getClipangle: () => clipangle,
    setRwNormalangle: (a) => { rw_normalangle = a },
    getRwNormalangle: () => rw_normalangle,
    setRwDistance: (d) => { rw_distance = d },
    getRwDistance: () => rw_distance,
    getPspritescale: () => pspritescale,
    getPspriteiscale: () => pspriteiscale,
    getSkytexture: () => skytexture,
    setSkytexture: (t) => { skytexture = t },
    getSkytexturemid: () => skytexturemid,
    R_InitSkyMap,
    init: function (D) {
        DD = D.defs; T = D.tables; RD = D.r_data
        RDraw = D.r_draw; RB = D.r_bsp; RP = D.r_plane
        L = D.p_setup.level; RT = D.r_things
    },
}
