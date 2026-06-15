// p_maputl.mjs -- movement/collision utilities (p_maputl.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, RM = null, L = null, I = null

const FRACUNIT = 65536
const MAXINT = 0x7fffffff

function FixedMul(a, b) { return T.FixedMul(a, b) }
function FixedDiv(a, b) { return T.FixedDiv(a, b) }

function P_AproxDistance(dx, dy) {
    dx = Math.abs(dx)
    dy = Math.abs(dy)
    if (dx < dy) return (dx + dy - (dx >> 1)) | 0
    return (dx + dy - (dy >> 1)) | 0
}

function P_PointOnLineSide(x, y, line) {
    const ldx = L.line_dx[line], ldy = L.line_dy[line]
    const v1x = L.vertex_x[L.line_v1[line]], v1y = L.vertex_y[L.line_v1[line]]
    if (ldx === 0) {
        if (x <= v1x) return ldy > 0 ? 1 : 0
        return ldy < 0 ? 1 : 0
    }
    if (ldy === 0) {
        if (y <= v1y) return ldx < 0 ? 1 : 0
        return ldx > 0 ? 1 : 0
    }
    const dx = (x - v1x) | 0
    const dy = (y - v1y) | 0
    const left = FixedMul(ldy >> 16, dx)
    const right = FixedMul(dy, ldx >> 16)
    return right < left ? 0 : 1
}

// box vs infinite line: 0/1 = side, -1 = crosses
function P_BoxOnLineSide(tmbox, line) {
    const ST = DD.SlopeType
    const BOXTOP = DD.BOXTOP, BOXBOTTOM = DD.BOXBOTTOM
    const BOXLEFT = DD.BOXLEFT, BOXRIGHT = DD.BOXRIGHT
    let p1 = 0, p2 = 0
    switch (L.line_slopetype[line]) {
        case ST.horizontal: {
            const v1y = L.vertex_y[L.line_v1[line]]
            p1 = tmbox[BOXTOP] > v1y ? 1 : 0
            p2 = tmbox[BOXBOTTOM] > v1y ? 1 : 0
            if (L.line_dx[line] < 0) { p1 ^= 1; p2 ^= 1 }
            break
        }
        case ST.vertical: {
            const v1x = L.vertex_x[L.line_v1[line]]
            p1 = tmbox[BOXRIGHT] < v1x ? 1 : 0
            p2 = tmbox[BOXLEFT] < v1x ? 1 : 0
            if (L.line_dy[line] < 0) { p1 ^= 1; p2 ^= 1 }
            break
        }
        case ST.positive:
            p1 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXTOP], line)
            p2 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXBOTTOM], line)
            break
        case ST.negative:
            p1 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXTOP], line)
            p2 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXBOTTOM], line)
            break
    }
    if (p1 === p2) return p1
    return -1
}

// divline objects: { x, y, dx, dy }
function P_PointOnDivlineSide(x, y, line) {
    if (line.dx === 0) {
        if (x <= line.x) return line.dy > 0 ? 1 : 0
        return line.dy < 0 ? 1 : 0
    }
    if (line.dy === 0) {
        if (y <= line.y) return line.dx < 0 ? 1 : 0
        return line.dx > 0 ? 1 : 0
    }
    const dx = (x - line.x) | 0
    const dy = (y - line.y) | 0
    // sign-bit fast path
    if ((line.dy ^ line.dx ^ dx ^ dy) & 0x80000000)
        return (line.dy ^ dx) & 0x80000000 ? 1 : 0
    const left = FixedMul(line.dy >> 8, dx >> 8)
    const right = FixedMul(dy >> 8, line.dx >> 8)
    return right < left ? 0 : 1
}

function P_MakeDivline(line, dl) {
    dl.x = L.vertex_x[L.line_v1[line]]
    dl.y = L.vertex_y[L.line_v1[line]]
    dl.dx = L.line_dx[line]
    dl.dy = L.line_dy[line]
}

// fractional intercept of v2 along v1
function P_InterceptVector(v2, v1) {
    const den = (FixedMul(v1.dy >> 8, v2.dx) - FixedMul(v1.dx >> 8, v2.dy)) | 0
    if (den === 0) return 0
    const num = (FixedMul((v1.x - v2.x) >> 8, v1.dy) +
        FixedMul((v2.y - v1.y) >> 8, v1.dx)) | 0
    return FixedDiv(num, den)
}

// ---- line opening (two-sided window) ----

const opening = { opentop: 0, openbottom: 0, openrange: 0, lowfloor: 0 }

function P_LineOpening(linedef) {
    if (L.line_sidenum1[linedef] === -1) {
        opening.openrange = 0
        return
    }
    const front = L.line_frontsector[linedef]
    const back = L.line_backsector[linedef]

    opening.opentop = L.sec_ceilingheight[front] < L.sec_ceilingheight[back]
        ? L.sec_ceilingheight[front] : L.sec_ceilingheight[back]

    if (L.sec_floorheight[front] > L.sec_floorheight[back]) {
        opening.openbottom = L.sec_floorheight[front]
        opening.lowfloor = L.sec_floorheight[back]
    } else {
        opening.openbottom = L.sec_floorheight[back]
        opening.lowfloor = L.sec_floorheight[front]
    }
    opening.openrange = (opening.opentop - opening.openbottom) | 0
}

// ---- thing position (un)linking ----

function P_UnsetThingPosition(thing) {
    const MF = I.MF
    if (!(thing.flags & MF.MF_NOSECTOR)) {
        if (thing.snext) thing.snext.sprev = thing.sprev
        if (thing.sprev) thing.sprev.snext = thing.snext
        else L.sec_thinglist[L.ssec_sector[thing.subsector]] = thing.snext
    }
    if (!(thing.flags & MF.MF_NOBLOCKMAP)) {
        if (thing.bnext) thing.bnext.bprev = thing.bprev
        if (thing.bprev) {
            thing.bprev.bnext = thing.bnext
        } else {
            const blockx = (thing.x - L.bmaporgx) >> DD.MAPBLOCKSHIFT
            const blocky = (thing.y - L.bmaporgy) >> DD.MAPBLOCKSHIFT
            if (blockx >= 0 && blockx < L.bmapwidth &&
                blocky >= 0 && blocky < L.bmapheight)
                L.blocklinks[blocky * L.bmapwidth + blockx] = thing.bnext
        }
    }
}

function P_SetThingPosition(thing) {
    const MF = I.MF
    const ss = RM.R_PointInSubsector(thing.x, thing.y)
    thing.subsector = ss

    if (!(thing.flags & MF.MF_NOSECTOR)) {
        const sec = L.ssec_sector[ss]
        thing.sprev = null
        thing.snext = L.sec_thinglist[sec]
        if (L.sec_thinglist[sec]) L.sec_thinglist[sec].sprev = thing
        L.sec_thinglist[sec] = thing
    }

    if (!(thing.flags & MF.MF_NOBLOCKMAP)) {
        const blockx = (thing.x - L.bmaporgx) >> DD.MAPBLOCKSHIFT
        const blocky = (thing.y - L.bmaporgy) >> DD.MAPBLOCKSHIFT
        if (blockx >= 0 && blockx < L.bmapwidth &&
            blocky >= 0 && blocky < L.bmapheight) {
            const idx = blocky * L.bmapwidth + blockx
            thing.bprev = null
            thing.bnext = L.blocklinks[idx]
            if (L.blocklinks[idx]) L.blocklinks[idx].bprev = thing
            L.blocklinks[idx] = thing
        } else {
            thing.bnext = thing.bprev = null
        }
    }
}

// ---- blockmap iterators ----

// validcount lives here (vanilla r_main/p_maputl shared global); the
// renderer uses r_main.R.validcount for sprite dedup -- the playsim uses
// this one for line dedup. Kept separate like vanilla's single counter
// would be incremented by both; to stay demo-deterministic the playsim
// only ever uses THIS counter.
let validcount = 1

function getValidcount() { return validcount }
function incValidcount() { validcount++ }

function P_BlockLinesIterator(x, y, func) {
    if (x < 0 || y < 0 || x >= L.bmapwidth || y >= L.bmapheight) return true
    let offset = L.blockmaplump[4 + y * L.bmapwidth + x] & 0xFFFF
    for (; L.blockmaplump[offset] !== -1; offset++) {
        const ld = L.blockmaplump[offset] & 0xFFFF
        if (L.line_validcount[ld] === validcount) continue
        L.line_validcount[ld] = validcount
        if (!func(ld)) return false
    }
    return true
}

function P_BlockThingsIterator(x, y, func) {
    if (x < 0 || y < 0 || x >= L.bmapwidth || y >= L.bmapheight) return true
    for (let mobj = L.blocklinks[y * L.bmapwidth + x]; mobj;
        mobj = mobj.bnext) {
        if (!func(mobj)) return false
    }
    return true
}

// ---- intercepts ----

const MAXINTERCEPTS = 128
function makeIntercept() { return { frac: 0, isaline: false, line: -1, thing: null } }
const intercepts = []
for (let i = 0; i < MAXINTERCEPTS; i++) intercepts.push(makeIntercept())
let intercept_n = 0

const trace = { x: 0, y: 0, dx: 0, dy: 0 }
let earlyout = false

const dlScratch = { x: 0, y: 0, dx: 0, dy: 0 }

function PIT_AddLineIntercepts(ld) {
    let s1, s2
    // avoid precision problems with long traces
    if (trace.dx > FRACUNIT * 16 || trace.dy > FRACUNIT * 16 ||
        trace.dx < -FRACUNIT * 16 || trace.dy < -FRACUNIT * 16) {
        s1 = P_PointOnDivlineSide(
            L.vertex_x[L.line_v1[ld]], L.vertex_y[L.line_v1[ld]], trace)
        s2 = P_PointOnDivlineSide(
            L.vertex_x[L.line_v2[ld]], L.vertex_y[L.line_v2[ld]], trace)
    } else {
        s1 = P_PointOnLineSide(trace.x, trace.y, ld)
        s2 = P_PointOnLineSide((trace.x + trace.dx) | 0, (trace.y + trace.dy) | 0, ld)
    }
    if (s1 === s2) return true              // not crossed

    P_MakeDivline(ld, dlScratch)
    const frac = P_InterceptVector(trace, dlScratch)
    if (frac < 0) return true               // behind source

    if (earlyout && frac < FRACUNIT && L.line_backsector[ld] === -1)
        return false                        // stop checking

    const inx = intercepts[intercept_n++]
    inx.frac = frac
    inx.isaline = true
    inx.line = ld
    inx.thing = null
    return true
}

function PIT_AddThingIntercepts(thing) {
    const tracepositive = (trace.dx ^ trace.dy) > 0
    let x1, y1, x2, y2
    if (tracepositive) {
        x1 = (thing.x - thing.radius) | 0
        y1 = (thing.y + thing.radius) | 0
        x2 = (thing.x + thing.radius) | 0
        y2 = (thing.y - thing.radius) | 0
    } else {
        x1 = (thing.x - thing.radius) | 0
        y1 = (thing.y - thing.radius) | 0
        x2 = (thing.x + thing.radius) | 0
        y2 = (thing.y + thing.radius) | 0
    }
    const s1 = P_PointOnDivlineSide(x1, y1, trace)
    const s2 = P_PointOnDivlineSide(x2, y2, trace)
    if (s1 === s2) return true

    dlScratch.x = x1
    dlScratch.y = y1
    dlScratch.dx = (x2 - x1) | 0
    dlScratch.dy = (y2 - y1) | 0
    const frac = P_InterceptVector(trace, dlScratch)
    if (frac < 0) return true

    const inx = intercepts[intercept_n++]
    inx.frac = frac
    inx.isaline = false
    inx.line = -1
    inx.thing = thing
    return true
}

function P_TraverseIntercepts(func, maxfrac) {
    let count = intercept_n
    let inx = null
    while (count--) {
        let dist = MAXINT
        for (let i = 0; i < intercept_n; i++) {
            if (intercepts[i].frac < dist) {
                dist = intercepts[i].frac
                inx = intercepts[i]
            }
        }
        if (dist > maxfrac) return true     // checked everything in range
        if (!func(inx)) return false
        inx.frac = MAXINT
    }
    return true
}

function P_PathTraverse(x1, y1, x2, y2, flags, trav) {
    earlyout = (flags & DD.PT_EARLYOUT) !== 0

    validcount++
    intercept_n = 0

    if (((x1 - L.bmaporgx) & (DD.MAPBLOCKSIZE - 1)) === 0)
        x1 += FRACUNIT          // don't sit exactly on a line
    if (((y1 - L.bmaporgy) & (DD.MAPBLOCKSIZE - 1)) === 0)
        y1 += FRACUNIT

    trace.x = x1
    trace.y = y1
    trace.dx = (x2 - x1) | 0
    trace.dy = (y2 - y1) | 0

    x1 = (x1 - L.bmaporgx) | 0
    y1 = (y1 - L.bmaporgy) | 0
    const xt1 = x1 >> DD.MAPBLOCKSHIFT
    const yt1 = y1 >> DD.MAPBLOCKSHIFT

    x2 = (x2 - L.bmaporgx) | 0
    y2 = (y2 - L.bmaporgy) | 0
    const xt2 = x2 >> DD.MAPBLOCKSHIFT
    const yt2 = y2 >> DD.MAPBLOCKSHIFT

    let mapxstep, mapystep, partial, xstep, ystep

    if (xt2 > xt1) {
        mapxstep = 1
        partial = FRACUNIT - ((x1 >> DD.MAPBTOFRAC) & (FRACUNIT - 1))
        ystep = FixedDiv((y2 - y1) | 0, Math.abs((x2 - x1) | 0))
    } else if (xt2 < xt1) {
        mapxstep = -1
        partial = (x1 >> DD.MAPBTOFRAC) & (FRACUNIT - 1)
        ystep = FixedDiv((y2 - y1) | 0, Math.abs((x2 - x1) | 0))
    } else {
        mapxstep = 0
        partial = FRACUNIT
        ystep = 256 * FRACUNIT
    }
    let yintercept = ((y1 >> DD.MAPBTOFRAC) + FixedMul(partial, ystep)) | 0

    if (yt2 > yt1) {
        mapystep = 1
        partial = FRACUNIT - ((y1 >> DD.MAPBTOFRAC) & (FRACUNIT - 1))
        xstep = FixedDiv((x2 - x1) | 0, Math.abs((y2 - y1) | 0))
    } else if (yt2 < yt1) {
        mapystep = -1
        partial = (y1 >> DD.MAPBTOFRAC) & (FRACUNIT - 1)
        xstep = FixedDiv((x2 - x1) | 0, Math.abs((y2 - y1) | 0))
    } else {
        mapystep = 0
        partial = FRACUNIT
        xstep = 256 * FRACUNIT
    }
    let xintercept = ((x1 >> DD.MAPBTOFRAC) + FixedMul(partial, xstep)) | 0

    // step through map blocks; count prevents round-off lockup
    let mapx = xt1
    let mapy = yt1
    for (let count = 0; count < 64; count++) {
        if (flags & DD.PT_ADDLINES) {
            if (!P_BlockLinesIterator(mapx, mapy, PIT_AddLineIntercepts))
                return false    // early out
        }
        if (flags & DD.PT_ADDTHINGS) {
            if (!P_BlockThingsIterator(mapx, mapy, PIT_AddThingIntercepts))
                return false
        }
        if (mapx === xt2 && mapy === yt2) break
        if ((yintercept >> 16) === mapy) {
            yintercept = (yintercept + ystep) | 0
            mapx += mapxstep
        } else if ((xintercept >> 16) === mapx) {
            xintercept = (xintercept + xstep) | 0
            mapy += mapystep
        }
    }
    return P_TraverseIntercepts(trav, FRACUNIT)
}

exports = {
    P_AproxDistance, P_PointOnLineSide, P_BoxOnLineSide,
    P_PointOnDivlineSide, P_MakeDivline, P_InterceptVector,
    P_LineOpening, opening,
    P_UnsetThingPosition, P_SetThingPosition,
    P_BlockLinesIterator, P_BlockThingsIterator,
    P_PathTraverse, trace,
    getValidcount, incValidcount,
    init: function (D) {
        DD = D.defs; T = D.tables; RM = D.r_main; L = D.p_setup.level
        I = D.info
    },
}
