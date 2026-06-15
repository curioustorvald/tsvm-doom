// am_map.mjs -- automap (am_map.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// M2 scope: the renderer core (map window, clip+Bresenham line draw,
// vanilla wall colour rules, player arrow, thing triangles) plus a direct
// pan/zoom API for the free-cam debug viewer. Game integration
// (AM_Responder, follow mode, marks) arrives with the game shell.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, V = null, L = null    // defs, tables, v_video, level

// vanilla palette ranges
const REDS = 256 - 5 * 16
const BLUES = 256 - 4 * 16 + 8
const GREENS = 7 * 16
const GRAYS = 6 * 16
const BROWNS = 4 * 16
const YELLOWS = 256 - 32 + 7
const BLACK = 0
const WHITE = 256 - 47

const BACKGROUND = BLACK
const YOURCOLORS = WHITE
const WALLCOLORS = REDS
const TSWALLCOLORS = GRAYS
const FDWALLCOLORS = BROWNS
const CDWALLCOLORS = YELLOWS
const THINGCOLORS = GREENS
const SECRETWALLCOLORS = WALLCOLORS

const FRACUNIT = 65536
const PLAYERRADIUS = 16 * FRACUNIT

const INITSCALEMTOF = (0.2 * FRACUNIT) | 0
const M_ZOOMIN = (1.02 * FRACUNIT) | 0
const M_ZOOMOUT = (FRACUNIT / 1.02) | 0

// player arrow vector shape (map units, 16.16), player at origin facing 0
const AR = ((8 * PLAYERRADIUS) / 7) | 0
const player_arrow = [
    [-AR + AR / 8, 0, AR, 0],
    [AR, 0, AR - AR / 2, AR / 4],
    [AR, 0, AR - AR / 2, -AR / 4],
    [-AR + AR / 8, 0, -AR - AR / 8, AR / 4],
    [-AR + AR / 8, 0, -AR - AR / 8, -AR / 4],
    [-AR + 3 * AR / 8, 0, -AR + AR / 8, AR / 4],
    [-AR + 3 * AR / 8, 0, -AR + AR / 8, -AR / 4],
].map(v => v.map(c => c | 0))

const thintriangle_guy = [
    [-0.5 * FRACUNIT, -0.7 * FRACUNIT, FRACUNIT, 0],
    [FRACUNIT, 0, -0.5 * FRACUNIT, 0.7 * FRACUNIT],
    [-0.5 * FRACUNIT, 0.7 * FRACUNIT, -0.5 * FRACUNIT, -0.7 * FRACUNIT],
].map(v => v.map(c => c | 0))

// frame window (in screens[0] pixels)
let f_x = 0, f_y = 0, f_w = _G.DOOM.SCREENWIDTH, f_h = _G.DOOM.SCREENHEIGHT

// map window: m_x/m_y = lower-left corner (fixed map coords)
let m_x = 0, m_y = 0, m_w = 0, m_h = 0
let min_x = 0, min_y = 0, max_x = 0, max_y = 0
let min_scale_mtof = 0, max_scale_mtof = 0
let scale_mtof = INITSCALEMTOF
let scale_ftom = FRACUNIT

let showThings = true      // free-cam debug shows things; game mode won't

function FixedMul(a, b) { return T.FixedMul(a, b) }
function FixedDiv(a, b) { return T.FixedDiv(a, b) }

function MTOF(x) { return FixedMul(x, scale_mtof) >> 16 }
function CXMTOF(x) { return f_x + MTOF(x - m_x) }
function CYMTOF(y) { return f_y + (f_h - MTOF(y - m_y)) }

function AM_SetWindow(x, y, w, h) { f_x = x; f_y = y; f_w = w; f_h = h }

function AM_findMinMaxBoundaries() {
    min_x = min_y = 0x7fffffff
    max_x = max_y = -0x80000000
    const vx = L.vertex_x, vy = L.vertex_y
    for (let i = 0; i < L.numvertexes; i++) {
        if (vx[i] < min_x) min_x = vx[i]
        if (vx[i] > max_x) max_x = vx[i]
        if (vy[i] < min_y) min_y = vy[i]
        if (vy[i] > max_y) max_y = vy[i]
    }
    const max_w = max_x - min_x
    const max_h = max_y - min_y
    const a = FixedDiv(f_w << 16, max_w)
    const b = FixedDiv(f_h << 16, max_h)
    min_scale_mtof = a < b ? a : b
    max_scale_mtof = FixedDiv(f_h << 16, 2 * PLAYERRADIUS)
}

function AM_activateNewScale() {
    // keep centre fixed while m_w/m_h change
    m_x += m_w >> 1; m_y += m_h >> 1
    m_w = FixedMul(f_w << 16, scale_ftom)
    m_h = FixedMul(f_h << 16, scale_ftom)
    m_x -= m_w >> 1; m_y -= m_h >> 1
}

// initialise view: scale-to-fit slightly zoomed out, centred on (cx, cy)
function AM_LevelInit(cx, cy) {
    AM_findMinMaxBoundaries()
    scale_mtof = FixedDiv(min_scale_mtof, (0.7 * FRACUNIT) | 0)
    if (scale_mtof > max_scale_mtof) scale_mtof = min_scale_mtof
    scale_ftom = FixedDiv(FRACUNIT, scale_mtof)
    m_w = FixedMul(f_w << 16, scale_ftom)
    m_h = FixedMul(f_h << 16, scale_ftom)
    m_x = cx - (m_w >> 1)
    m_y = cy - (m_h >> 1)
}

function AM_changeWindowScale(zoomIn) {
    if (zoomIn) {
        scale_mtof = FixedMul(scale_mtof, M_ZOOMIN)
        scale_ftom = FixedDiv(FRACUNIT, scale_mtof)
        if (scale_mtof > max_scale_mtof) {
            scale_mtof = max_scale_mtof
            scale_ftom = FixedDiv(FRACUNIT, scale_mtof)
        }
    } else {
        scale_mtof = FixedMul(scale_mtof, M_ZOOMOUT)
        scale_ftom = FixedDiv(FRACUNIT, scale_mtof)
        if (scale_mtof < min_scale_mtof) {
            scale_mtof = min_scale_mtof
            scale_ftom = FixedDiv(FRACUNIT, scale_mtof)
        }
    }
    AM_activateNewScale()
}

// pan in frame pixels (converted through current scale)
function AM_pan(dxPixels, dyPixels) {
    m_x += FixedMul(dxPixels << 16, scale_ftom)
    m_y += FixedMul(dyPixels << 16, scale_ftom)
}

// ---- frame-buffer line drawing ----

// Cohen-Sutherland outcodes
const LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8

function outcode(x, y) {
    let oc = 0
    if (y < 0) oc |= TOP
    else if (y >= f_h) oc |= BOTTOM
    if (x < 0) oc |= LEFT
    else if (x >= f_w) oc |= RIGHT
    return oc
}

// clip to the frame window then Bresenham into screens[0]
function AM_drawFline(ax, ay, bx, by, colour) {
    let oc0 = outcode(ax, ay)
    let oc1 = outcode(bx, by)
    while (oc0 | oc1) {
        if (oc0 & oc1) return
        const oc = oc0 !== 0 ? oc0 : oc1
        let nx = 0, ny = 0
        const dx = bx - ax, dy = by - ay
        if (oc & TOP) { nx = ax + (((dx * (0 - ay)) / dy) | 0); ny = 0 }
        else if (oc & BOTTOM) { nx = ax + (((dx * (f_h - 1 - ay)) / dy) | 0); ny = f_h - 1 }
        else if (oc & RIGHT) { ny = ay + (((dy * (f_w - 1 - ax)) / dx) | 0); nx = f_w - 1 }
        else { ny = ay + (((dy * (0 - ax)) / dx) | 0); nx = 0 }
        if (oc === oc0) { ax = nx; ay = ny; oc0 = outcode(ax, ay) }
        else { bx = nx; by = ny; oc1 = outcode(bx, by) }
    }

    const screen = V.screens[0]
    let dx = Math.abs(bx - ax), sx = ax < bx ? 1 : -1
    let dy = -Math.abs(by - ay), sy = ay < by ? 1 : -1
    let err = dx + dy
    let x = ax, y = ay
    for (;;) {
        screen[(f_y + y) * _G.DOOM.SCREENWIDTH + (f_x + x)] = colour
        if (x === bx && y === by) break
        const e2 = 2 * err
        if (e2 >= dy) { err += dy; x += sx }
        if (e2 <= dx) { err += dx; y += sy }
    }
}

function AM_drawMline(x1, y1, x2, y2, colour) {
    AM_drawFline(CXMTOF(x1), CYMTOF(y1), CXMTOF(x2), CYMTOF(y2), colour)
}

function AM_clearFB() {
    const screen = V.screens[0]
    if (f_x === 0 && f_w === _G.DOOM.SCREENWIDTH) {
        screen.fill(BACKGROUND, f_y * _G.DOOM.SCREENWIDTH, (f_y + f_h) * _G.DOOM.SCREENWIDTH)
    } else {
        for (let y = 0; y < f_h; y++)
            screen.fill(BACKGROUND, (f_y + y) * _G.DOOM.SCREENWIDTH + f_x, (f_y + y) * _G.DOOM.SCREENWIDTH + f_x + f_w)
    }
}

// vanilla AM_drawWalls colour rules. `cheating` reveals never-see and
// unmapped lines (the free-cam debug viewer always cheats; in-game mode
// honours ML_MAPPED, which the playsim sets as lines are seen).
function AM_drawWalls(cheating, allmap) {
    const ML = DD.ML
    const vx = L.vertex_x, vy = L.vertex_y
    for (let i = 0; i < L.numlines; i++) {
        const x1 = vx[L.line_v1[i]], y1 = vy[L.line_v1[i]]
        const x2 = vx[L.line_v2[i]], y2 = vy[L.line_v2[i]]
        const flags = L.line_flags[i]
        if (cheating || (flags & ML.MAPPED)) {
            if ((flags & ML.DONTDRAW) && !cheating) continue
            const back = L.line_backsector[i]
            if (back === -1) {
                AM_drawMline(x1, y1, x2, y2, WALLCOLORS)
            } else if (flags & ML.SECRET) {
                if (cheating) AM_drawMline(x1, y1, x2, y2, SECRETWALLCOLORS)
                else AM_drawMline(x1, y1, x2, y2, WALLCOLORS)
            } else if (L.sec_floorheight[back] !== L.sec_floorheight[L.line_frontsector[i]]) {
                AM_drawMline(x1, y1, x2, y2, FDWALLCOLORS)
            } else if (L.sec_ceilingheight[back] !== L.sec_ceilingheight[L.line_frontsector[i]]) {
                AM_drawMline(x1, y1, x2, y2, CDWALLCOLORS)
            } else if (cheating) {
                AM_drawMline(x1, y1, x2, y2, TSWALLCOLORS)
            }
        } else if (allmap) {
            if (!(flags & ML.DONTDRAW))
                AM_drawMline(x1, y1, x2, y2, GRAYS + 3)
        }
    }
}

// rotate-and-translate a vector shape, then draw it
function AM_drawLineCharacter(shape, scale, angle, colour, x, y) {
    const fineshift = angle >>> 19          // ANGLETOFINESHIFT
    const sin = T.finesine[fineshift]
    const cos = T.finecosine[fineshift]
    for (let i = 0; i < shape.length; i++) {
        let [ax, ay, bx, by] = shape[i]
        if (scale !== 0) {
            ax = FixedMul(scale, ax); ay = FixedMul(scale, ay)
            bx = FixedMul(scale, bx); by = FixedMul(scale, by)
        }
        if (angle !== 0) {
            let nx = (FixedMul(ax, cos) - FixedMul(ay, sin)) | 0
            let ny = (FixedMul(ax, sin) + FixedMul(ay, cos)) | 0
            ax = nx; ay = ny
            nx = (FixedMul(bx, cos) - FixedMul(by, sin)) | 0
            ny = (FixedMul(bx, sin) + FixedMul(by, cos)) | 0
            bx = nx; by = ny
        }
        AM_drawMline(ax + x, ay + y, bx + x, by + y, colour)
    }
}

function AM_drawPlayerArrow(x, y, angle) {
    AM_drawLineCharacter(player_arrow, 0, angle, YOURCOLORS, x, y)
}

function AM_drawThings() {
    // debug view: raw mapthings as thin triangles (vanilla cheat view
    // draws live mobjs; those arrive with the playsim)
    const ts = L.things
    for (let i = 0; i < ts.length; i++) {
        const t = ts[i]
        // mapthing angle is in degrees; vanilla converts with integer
        // division: ANG45 * (angle/45)
        const angle = (0x20000000 * Math.floor(t.angle / 45)) | 0
        AM_drawLineCharacter(thintriangle_guy, 16 * FRACUNIT,
            angle, THINGCOLORS, t.x << 16, t.y << 16)
    }
}

// one full debug frame into screens[0]
function AM_DrawFreecam(camX, camY, camAngle) {
    AM_clearFB()
    AM_drawWalls(true, true)
    if (showThings) AM_drawThings()
    AM_drawPlayerArrow(camX, camY, camAngle)
}

// ---- in-game automap (responder / ticker / drawer) ----

const AM_PANKEY_SPEED = 4
let G = null                    // g_game (bound at init when present)
let followplayer = true
let am_cheating = 0
let f_oldloc_x = -1

// doomdef-style keys (matching m_menu's constants)
const K_RIGHT = 0xae, K_LEFT = 0xac, K_UP = 0xad, K_DOWN = 0xaf
const K_TAB = 9

function AM_Start() {
    const st = G.state
    const p = st.players[st.consoleplayer]
    AM_SetWindow(0, 0, _G.DOOM.SCREENWIDTH, _G.DOOM.SCREENHEIGHT - 32)       // above the status bar
    AM_LevelInit(p.mo.x, p.mo.y)
    followplayer = true
    st.automapactive = true
}

function AM_Stop() {
    G.state.automapactive = false
}

let panx = 0, pany = 0, zoomin = false, zoomout = false

function AM_Responder(ev) {
    const st = G.state
    if (!st.automapactive) {
        if (ev.type === DD.Ev.keydown && ev.data1 === K_TAB) {
            AM_Start()
            return true
        }
        return false
    }
    if (ev.type === DD.Ev.keydown) {
        switch (ev.data1) {
            case K_TAB: AM_Stop(); return true
            case K_RIGHT: if (!followplayer) panx = AM_PANKEY_SPEED; return !followplayer
            case K_LEFT: if (!followplayer) panx = -AM_PANKEY_SPEED; return !followplayer
            case K_UP: if (!followplayer) pany = AM_PANKEY_SPEED; return !followplayer
            case K_DOWN: if (!followplayer) pany = -AM_PANKEY_SPEED; return !followplayer
            case 0x3d: zoomin = true; return true       // '='
            case 0x2d: zoomout = true; return true      // '-'
            case 102:                                   // 'f' follow toggle
                followplayer = !followplayer
                st.players[st.consoleplayer].message =
                    followplayer ? "Follow Mode ON" : "Follow Mode OFF"
                return true
        }
        return false
    }
    if (ev.type === DD.Ev.keyup) {
        switch (ev.data1) {
            case K_RIGHT: case K_LEFT: panx = 0; return false
            case K_UP: case K_DOWN: pany = 0; return false
            case 0x3d: zoomin = false; return false
            case 0x2d: zoomout = false; return false
        }
    }
    return false
}

function AM_Ticker() {
    const st = G.state
    if (!st.automapactive) return
    const p = st.players[st.consoleplayer]
    if (zoomin) AM_changeWindowScale(true)
    if (zoomout) AM_changeWindowScale(false)
    if (followplayer) {
        // recentre on the player
        m_x = p.mo.x - (m_w >> 1)
        m_y = p.mo.y - (m_h >> 1)
    } else {
        if (panx || pany) AM_pan(panx, pany)
    }
}

// in-game drawer: honours ML_MAPPED + allmap power; arrow at the player
function AM_Drawer() {
    const st = G.state
    const p = st.players[st.consoleplayer]
    AM_clearFB()
    AM_drawWalls(am_cheating, p.powers[DD.Power.allmap] !== 0)
    AM_drawPlayerArrow(p.mo.x, p.mo.y, p.mo.angle)
}

exports = {
    AM_SetWindow, AM_LevelInit, AM_changeWindowScale, AM_pan,
    AM_DrawFreecam, AM_drawWalls, AM_drawPlayerArrow, AM_drawThings,
    AM_clearFB, AM_drawFline,
    AM_Start, AM_Stop, AM_Responder, AM_Ticker, AM_Drawer,
    setShowThings: (b) => { showThings = b },
    setCheating: (c) => { am_cheating = c },
    getScale: () => scale_mtof,
    init: function (D) {
        DD = D.defs; T = D.tables; V = D.v_video; L = D.p_setup.level
        G = D.g_game !== undefined ? D.g_game : null
    },
}
