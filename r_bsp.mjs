// r_bsp.mjs -- BSP traversal and seg clipping (r_bsp.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, RM = null, RS = null, RD = null, L = null
let R = null                    // r_main shared state

const ANG180 = 0x80000000

// solid clip ranges; generous allocation (vanilla MAXSEGS=32 overflows
// silently on some PWADs -- rendering damage only, playsim unaffected)
const MAXSEGS = 64
const cs_first = new Int32Array(MAXSEGS)
const cs_last = new Int32Array(MAXSEGS)
let newend = 0

// drawsegs: preallocated objects (silhouette data is used from M4 on)
const MAXDRAWSEGS = 256
function makeDrawseg() {
    return {
        curline: -1, x1: 0, x2: 0,
        scale1: 0, scale2: 0, scalestep: 0,
        silhouette: 0, bsilheight: 0, tsilheight: 0,
        // clip arrays are (array, offset) pairs into openings or the
        // shared screenheightarray/negonearray
        sprtopclip: null, sprtopclipOfs: 0,
        sprbottomclip: null, sprbottomclipOfs: 0,
        maskedtexturecol: null, maskedtexturecolOfs: 0,
    }
}
const drawsegs = []
for (let i = 0; i < MAXDRAWSEGS; i++) drawsegs.push(makeDrawseg())
let ds_p = 0

function R_ClearDrawSegs() { ds_p = 0 }

function R_ClearClipSegs() {
    cs_first[0] = -0x7fffffff
    cs_last[0] = -1
    cs_first[1] = RM.getViewwidth()
    cs_last[1] = 0x7fffffff
    newend = 2
}

// R_ClipSolidWallSegment: pointer arithmetic becomes index juggling, but
// the control flow mirrors vanilla exactly (including the crunch step)
function R_ClipSolidWallSegment(first, last) {
    let start = 0
    while (cs_last[start] < first - 1) start++

    if (first < cs_first[start]) {
        if (last < cs_first[start] - 1) {
            // entirely visible: insert a new clippost
            RS.R_StoreWallRange(first, last)
            let next = newend
            newend++
            while (next !== start) {
                cs_first[next] = cs_first[next - 1]
                cs_last[next] = cs_last[next - 1]
                next--
            }
            cs_first[next] = first
            cs_last[next] = last
            return
        }
        // fragment above start
        RS.R_StoreWallRange(first, cs_first[start] - 1)
        cs_first[start] = first
    }

    if (last <= cs_last[start]) return

    let next = start
    let crunch = false
    while (last >= cs_first[next + 1] - 1) {
        RS.R_StoreWallRange(cs_last[next] + 1, cs_first[next + 1] - 1)
        next++
        if (last <= cs_last[next]) {
            cs_last[start] = cs_last[next]
            crunch = true
            break
        }
    }
    if (!crunch) {
        RS.R_StoreWallRange(cs_last[next] + 1, last)
        cs_last[start] = last
    }
    // crunch: remove start+1..next
    if (next === start) return
    while (next++ !== newend) {
        start++
        cs_first[start] = cs_first[next]
        cs_last[start] = cs_last[next]
    }
    newend = start + 1
}

function R_ClipPassWallSegment(first, last) {
    let start = 0
    while (cs_last[start] < first - 1) start++

    if (first < cs_first[start]) {
        if (last < cs_first[start] - 1) {
            RS.R_StoreWallRange(first, last)
            return
        }
        RS.R_StoreWallRange(first, cs_first[start] - 1)
    }

    if (last <= cs_last[start]) return

    while (last >= cs_first[start + 1] - 1) {
        RS.R_StoreWallRange(cs_last[start] + 1, cs_first[start + 1] - 1)
        start++
        if (last <= cs_last[start]) return
    }
    RS.R_StoreWallRange(cs_last[start] + 1, last)
}

function R_AddLine(seg) {
    R.curline = seg
    const v1 = L.seg_v1[seg], v2 = L.seg_v2[seg]
    let angle1 = RM.R_PointToAngle(L.vertex_x[v1], L.vertex_y[v1])
    let angle2 = RM.R_PointToAngle(L.vertex_x[v2], L.vertex_y[v2])

    const span = (angle1 - angle2) >>> 0
    if (span >= ANG180) return                 // back side

    R.rw_angle1 = angle1
    angle1 = (angle1 - R.viewangle) >>> 0
    angle2 = (angle2 - R.viewangle) >>> 0

    const clipangle = RM.getClipangle()
    const clipangle2 = (2 * clipangle) >>> 0
    let tspan = (angle1 + clipangle) >>> 0
    if (tspan > clipangle2) {
        tspan = (tspan - clipangle2) >>> 0
        if (tspan >= span) return              // totally off the left edge
        angle1 = clipangle
    }
    tspan = (clipangle - angle2) >>> 0
    if (tspan > clipangle2) {
        tspan = (tspan - clipangle2) >>> 0
        if (tspan >= span) return
        angle2 = (0 - clipangle) >>> 0
    }

    const a1 = ((angle1 + 0x40000000) >>> 0) >>> 19
    const a2 = ((angle2 + 0x40000000) >>> 0) >>> 19
    const x1 = RM.viewangletox[a1]
    const x2 = RM.viewangletox[a2]
    if (x1 === x2) return                      // does not cross a pixel

    const backsector = L.seg_backsector[seg]
    R.backsector = backsector

    let solid = false
    if (backsector === -1) {
        solid = true                           // single sided
    } else if (L.sec_ceilingheight[backsector] <= L.sec_floorheight[R.frontsector] ||
        L.sec_floorheight[backsector] >= L.sec_ceilingheight[R.frontsector]) {
        solid = true                           // closed door
    } else if (L.sec_ceilingheight[backsector] !== L.sec_ceilingheight[R.frontsector] ||
        L.sec_floorheight[backsector] !== L.sec_floorheight[R.frontsector]) {
        solid = false                          // window
    } else {
        // reject empty trigger lines: identical planes/light, no midtexture
        if (L.sec_ceilingpic[backsector] === L.sec_ceilingpic[R.frontsector] &&
            L.sec_floorpic[backsector] === L.sec_floorpic[R.frontsector] &&
            L.sec_lightlevel[backsector] === L.sec_lightlevel[R.frontsector] &&
            L.side_midtexture[L.seg_sidedef[seg]] === 0)
            return
        solid = false
    }

    if (solid) R_ClipSolidWallSegment(x1, x2 - 1)
    else R_ClipPassWallSegment(x1, x2 - 1)
}

// bbox corner table (r_bsp.c checkcoord)
const checkcoord = [
    [3, 0, 2, 1], [3, 0, 2, 0], [3, 1, 2, 0], [0, 0, 0, 0],
    [2, 0, 2, 1], [0, 0, 0, 0], [3, 1, 3, 0], [0, 0, 0, 0],
    [2, 0, 3, 1], [2, 1, 3, 1], [2, 1, 3, 0],
]

// bspcoordBase: byte index of this child's 4-entry bbox in node_bbox
function R_CheckBBox(bboxBase) {
    const bb = L.node_bbox
    const BOXTOP = DD.BOXTOP, BOXBOTTOM = DD.BOXBOTTOM
    const BOXLEFT = DD.BOXLEFT, BOXRIGHT = DD.BOXRIGHT

    let boxx, boxy
    if (R.viewx <= bb[bboxBase + BOXLEFT]) boxx = 0
    else if (R.viewx < bb[bboxBase + BOXRIGHT]) boxx = 1
    else boxx = 2
    if (R.viewy >= bb[bboxBase + BOXTOP]) boxy = 0
    else if (R.viewy > bb[bboxBase + BOXBOTTOM]) boxy = 1
    else boxy = 2

    const boxpos = (boxy << 2) + boxx
    if (boxpos === 5) return true

    const cc = checkcoord[boxpos]
    const x1 = bb[bboxBase + cc[0]]
    const y1 = bb[bboxBase + cc[1]]
    const x2 = bb[bboxBase + cc[2]]
    const y2 = bb[bboxBase + cc[3]]

    let angle1 = (RM.R_PointToAngle(x1, y1) - R.viewangle) >>> 0
    let angle2 = (RM.R_PointToAngle(x2, y2) - R.viewangle) >>> 0
    const span = (angle1 - angle2) >>> 0
    if (span >= ANG180) return true            // sitting on a line

    const clipangle = RM.getClipangle()
    const clipangle2 = (2 * clipangle) >>> 0
    let tspan = (angle1 + clipangle) >>> 0
    if (tspan > clipangle2) {
        tspan = (tspan - clipangle2) >>> 0
        if (tspan >= span) return false
        angle1 = clipangle
    }
    tspan = (clipangle - angle2) >>> 0
    if (tspan > clipangle2) {
        tspan = (tspan - clipangle2) >>> 0
        if (tspan >= span) return false
        angle2 = (0 - clipangle) >>> 0
    }

    const a1 = ((angle1 + 0x40000000) >>> 0) >>> 19
    const a2 = ((angle2 + 0x40000000) >>> 0) >>> 19
    const sx1 = RM.viewangletox[a1]
    let sx2 = RM.viewangletox[a2]
    if (sx1 === sx2) return false
    sx2--

    let start = 0
    while (cs_last[start] < sx2) start++
    if (sx1 >= cs_first[start] && sx2 <= cs_last[start])
        return false                           // fully occluded
    return true
}

function R_Subsector(num) {
    R.frontsector = L.ssec_sector[num]
    const fs = R.frontsector
    let count = L.ssec_numlines[num]
    let line = L.ssec_firstline[num]

    if (L.sec_floorheight[fs] < R.viewz) {
        R.floorplane = RPfind(
            L.sec_floorheight[fs], L.sec_floorpic[fs], L.sec_lightlevel[fs])
    } else {
        R.floorplane = null
    }
    if (L.sec_ceilingheight[fs] > R.viewz ||
        L.sec_ceilingpic[fs] === RD.getSkyflatnum()) {
        R.ceilingplane = RPfind(
            L.sec_ceilingheight[fs], L.sec_ceilingpic[fs], L.sec_lightlevel[fs])
    } else {
        R.ceilingplane = null
    }

    if (addSprites !== null) addSprites(fs)    // M4 hook (r_things)

    while (count--) {
        R_AddLine(line)
        line++
    }
}

let RPfind = null               // r_plane.R_FindPlane, bound at init
let addSprites = null           // r_things.R_AddSprites, bound in M4

function R_RenderBSPNode(bspnum) {
    const NF = DD.NF_SUBSECTOR
    if (bspnum & NF) {
        if (bspnum === -1) R_Subsector(0)
        else R_Subsector(bspnum & ~NF)
        return
    }
    const side = RM.R_PointOnSide(R.viewx, R.viewy, bspnum)
    R_RenderBSPNode(L.node_children[bspnum * 2 + side])
    if (R_CheckBBox(bspnum * 8 + (side ^ 1) * 4))
        R_RenderBSPNode(L.node_children[bspnum * 2 + (side ^ 1)])
}

exports = {
    drawsegs,
    R_ClearClipSegs, R_ClearDrawSegs, R_RenderBSPNode,
    R_AddLine, R_CheckBBox,
    getDsP: () => ds_p,
    incDsP: () => { ds_p++ },
    setAddSprites: (fn) => { addSprites = fn },
    MAXDRAWSEGS,
    init: function (D) {
        DD = D.defs; T = D.tables; RM = D.r_main; RS = D.r_segs
        RD = D.r_data; L = D.p_setup.level
        R = D.r_main.R
        RPfind = D.r_plane.R_FindPlane
        if (D.r_things !== undefined) addSprites = D.r_things.R_AddSprites
    },
}
