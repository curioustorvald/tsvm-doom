// r_segs.mjs -- wall segment rendering (r_segs.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// M3 scope: R_StoreWallRange + R_RenderSegLoop (solid and two-sided wall
// tiers, plane marking, silhouette bookkeeping, masked column capture).
// R_RenderMaskedSegRange (drawing the captured masked columns) is M4.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, RM = null, RB = null, RP = null, RD = null
let RDraw = null, L = null, R = null, dc = null

const ANG90 = 0x40000000
const ANG180 = 0x80000000
const HEIGHTBITS = 12
const HEIGHTUNIT = 1 << HEIGHTBITS
const MAXSHORT = 0x7FFF
const MAXINT = 0x7fffffff
const MININT = -0x80000000

const SIL_NONE = 0, SIL_BOTTOM = 1, SIL_TOP = 2, SIL_BOTH = 3

// wall-render state (vanilla rw_* globals)
let rw_x = 0, rw_stopx = 0
let rw_scale = 0, rw_scalestep = 0
let rw_offset = 0, rw_centerangle = 0
let rw_midtexturemid = 0, rw_toptexturemid = 0, rw_bottomtexturemid = 0
let worldtop = 0, worldbottom = 0, worldhigh = 0, worldlow = 0
let topfrac = 0, topstep = 0
let bottomfrac = 0, bottomstep = 0
let pixhigh = 0, pixhighstep = 0
let pixlow = 0, pixlowstep = 0
let midtexture = 0, toptexture = 0, bottomtexture = 0
let maskedtexture = false
let markfloor = false, markceiling = false
let segtextured = false
let maskedtexturecolBase = 0    // openings base for current seg

function R_RenderSegLoop() {
    const floorclip = RP.floorclip
    const ceilingclip = RP.ceilingclip
    const openings = RP.openings
    const viewheight = RM.getViewheight()
    const floorplane = R.floorplane
    const ceilingplane = R.ceilingplane
    const walllights = R.walllights
    const xtoviewangle = RM.xtoviewangle
    const finetangent = T.finetangent

    for (; rw_x < rw_stopx; rw_x++) {
        let yl = (topfrac + HEIGHTUNIT - 1) >> HEIGHTBITS
        if (yl < ceilingclip[rw_x] + 1) yl = ceilingclip[rw_x] + 1

        if (markceiling) {
            const top = ceilingclip[rw_x] + 1
            let bottom = yl - 1
            if (bottom >= floorclip[rw_x]) bottom = floorclip[rw_x] - 1
            if (top <= bottom) {
                ceilingplane.top[rw_x + 1] = top
                ceilingplane.bottom[rw_x + 1] = bottom
            }
        }

        let yh = bottomfrac >> HEIGHTBITS
        if (yh >= floorclip[rw_x]) yh = floorclip[rw_x] - 1

        if (markfloor) {
            let top = yh + 1
            const bottom = floorclip[rw_x] - 1
            if (top <= ceilingclip[rw_x]) top = ceilingclip[rw_x] + 1
            if (top <= bottom) {
                floorplane.top[rw_x + 1] = top
                floorplane.bottom[rw_x + 1] = bottom
            }
        }

        let texturecolumn = 0
        if (segtextured) {
            const angle = (((rw_centerangle + xtoviewangle[rw_x]) >>> 0) >>> 19) & 4095
            texturecolumn = (rw_offset - T.FixedMul(finetangent[angle], RM.getRwDistance())) >> 16
            let index = rw_scale >> 12         // LIGHTSCALESHIFT
            if (index >= 48) index = 47        // MAXLIGHTSCALE
            dc.colormapOfs = walllights[index]
            dc.x = rw_x
            dc.iscale = Math.floor(4294967295 / rw_scale)
        }

        if (midtexture) {
            dc.yl = yl
            dc.yh = yh
            dc.texturemid = rw_midtexturemid
            dc.source = RD.R_GetTexture(midtexture)
            dc.sourceOfs = RD.R_GetColumnOfs(midtexture, texturecolumn)
            RDraw.R_DrawColumn()
            ceilingclip[rw_x] = viewheight
            floorclip[rw_x] = -1
        } else {
            if (toptexture) {
                let mid = pixhigh >> HEIGHTBITS
                pixhigh = (pixhigh + pixhighstep) | 0
                if (mid >= floorclip[rw_x]) mid = floorclip[rw_x] - 1
                if (mid >= yl) {
                    dc.yl = yl
                    dc.yh = mid
                    dc.texturemid = rw_toptexturemid
                    dc.source = RD.R_GetTexture(toptexture)
                    dc.sourceOfs = RD.R_GetColumnOfs(toptexture, texturecolumn)
                    RDraw.R_DrawColumn()
                    ceilingclip[rw_x] = mid
                } else {
                    ceilingclip[rw_x] = yl - 1
                }
            } else {
                if (markceiling) ceilingclip[rw_x] = yl - 1
            }

            if (bottomtexture) {
                let mid = (pixlow + HEIGHTUNIT - 1) >> HEIGHTBITS
                pixlow = (pixlow + pixlowstep) | 0
                if (mid <= ceilingclip[rw_x]) mid = ceilingclip[rw_x] + 1
                if (mid <= yh) {
                    dc.yl = mid
                    dc.yh = yh
                    dc.texturemid = rw_bottomtexturemid
                    dc.source = RD.R_GetTexture(bottomtexture)
                    dc.sourceOfs = RD.R_GetColumnOfs(bottomtexture, texturecolumn)
                    RDraw.R_DrawColumn()
                    floorclip[rw_x] = mid
                } else {
                    floorclip[rw_x] = yh + 1
                }
            } else {
                if (markfloor) floorclip[rw_x] = yh + 1
            }

            if (maskedtexture) {
                openings[maskedtexturecolBase + rw_x] = texturecolumn
            }
        }

        rw_scale = (rw_scale + rw_scalestep) | 0
        topfrac = (topfrac + topstep) | 0
        bottomfrac = (bottomfrac + bottomstep) | 0
    }
}

function R_StoreWallRange(start, stop) {
    if (RB.getDsP() >= RB.MAXDRAWSEGS) return  // vanilla overflow guard

    const seg = R.curline
    const sidedef = L.seg_sidedef[seg]
    const linedef = L.seg_linedef[seg]
    const frontsector = R.frontsector
    const backsector = R.backsector
    const texturetranslation = RD.getTexturetranslation()
    const textureheight = RD.getTextureheight()
    const skyflatnum = RD.getSkyflatnum()
    const ds = RB.drawsegs[RB.getDsP()]
    const openings = RP.openings
    const ML = DD.ML

    // mark for automap
    L.line_flags[linedef] |= ML.MAPPED

    // rw_distance for scale calculation
    const rw_normalangle = (L.seg_angle[seg] + ANG90) >>> 0
    RM.setRwNormalangle(rw_normalangle)
    let offsetangle = Math.abs((rw_normalangle - R.rw_angle1) | 0)
    if (offsetangle > ANG90) offsetangle = ANG90
    const distangle = (ANG90 - offsetangle) >>> 0
    const hyp = RM.R_PointToDist(
        L.vertex_x[L.seg_v1[seg]], L.vertex_y[L.seg_v1[seg]])
    const sineval = T.finesine[distangle >>> 19]
    const rw_distance = T.FixedMul(hyp, sineval)
    RM.setRwDistance(rw_distance)

    ds.x1 = rw_x = start
    ds.x2 = stop
    ds.curline = seg
    rw_stopx = stop + 1

    ds.scale1 = rw_scale =
        RM.R_ScaleFromGlobalAngle((R.viewangle + RM.xtoviewangle[start]) >>> 0)
    if (stop > start) {
        ds.scale2 = RM.R_ScaleFromGlobalAngle((R.viewangle + RM.xtoviewangle[stop]) >>> 0)
        ds.scalestep = rw_scalestep = ((ds.scale2 - rw_scale) / (stop - start)) | 0
    } else {
        ds.scale2 = ds.scale1
        rw_scalestep = 0
        ds.scalestep = 0
    }

    // texture boundaries / plane marks
    worldtop = (L.sec_ceilingheight[frontsector] - R.viewz) | 0
    worldbottom = (L.sec_floorheight[frontsector] - R.viewz) | 0

    midtexture = toptexture = bottomtexture = 0
    maskedtexture = false
    ds.maskedtexturecol = null
    ds.maskedtexturecolOfs = 0

    if (backsector === -1) {
        // single sided line
        midtexture = texturetranslation[L.side_midtexture[sidedef]]
        markfloor = markceiling = true
        if (L.line_flags[linedef] & ML.DONTPEGBOTTOM) {
            const vtop = (L.sec_floorheight[frontsector] +
                textureheight[L.side_midtexture[sidedef]]) | 0
            rw_midtexturemid = (vtop - R.viewz) | 0
        } else {
            rw_midtexturemid = worldtop
        }
        rw_midtexturemid = (rw_midtexturemid + L.side_rowoffset[sidedef]) | 0

        ds.silhouette = SIL_BOTH
        ds.sprtopclip = RM.screenheightarray
        ds.sprtopclipOfs = 0
        ds.sprbottomclip = RM.negonearray
        ds.sprbottomclipOfs = 0
        ds.bsilheight = MAXINT
        ds.tsilheight = MININT
    } else {
        // two sided line
        ds.sprtopclip = ds.sprbottomclip = null
        ds.sprtopclipOfs = ds.sprbottomclipOfs = 0
        ds.silhouette = 0

        if (L.sec_floorheight[frontsector] > L.sec_floorheight[backsector]) {
            ds.silhouette = SIL_BOTTOM
            ds.bsilheight = L.sec_floorheight[frontsector]
        } else if (L.sec_floorheight[backsector] > R.viewz) {
            ds.silhouette = SIL_BOTTOM
            ds.bsilheight = MAXINT
        }
        if (L.sec_ceilingheight[frontsector] < L.sec_ceilingheight[backsector]) {
            ds.silhouette |= SIL_TOP
            ds.tsilheight = L.sec_ceilingheight[frontsector]
        } else if (L.sec_ceilingheight[backsector] < R.viewz) {
            ds.silhouette |= SIL_TOP
            ds.tsilheight = MININT
        }

        if (L.sec_ceilingheight[backsector] <= L.sec_floorheight[frontsector]) {
            ds.sprbottomclip = RM.negonearray
            ds.sprbottomclipOfs = 0
            ds.bsilheight = MAXINT
            ds.silhouette |= SIL_BOTTOM
        }
        if (L.sec_floorheight[backsector] >= L.sec_ceilingheight[frontsector]) {
            ds.sprtopclip = RM.screenheightarray
            ds.sprtopclipOfs = 0
            ds.tsilheight = MININT
            ds.silhouette |= SIL_TOP
        }

        worldhigh = (L.sec_ceilingheight[backsector] - R.viewz) | 0
        worldlow = (L.sec_floorheight[backsector] - R.viewz) | 0

        // sky hack: height changes between sky ceilings are invisible
        if (L.sec_ceilingpic[frontsector] === skyflatnum &&
            L.sec_ceilingpic[backsector] === skyflatnum) {
            worldtop = worldhigh
        }

        markfloor = (worldlow !== worldbottom ||
            L.sec_floorpic[backsector] !== L.sec_floorpic[frontsector] ||
            L.sec_lightlevel[backsector] !== L.sec_lightlevel[frontsector])
        markceiling = (worldhigh !== worldtop ||
            L.sec_ceilingpic[backsector] !== L.sec_ceilingpic[frontsector] ||
            L.sec_lightlevel[backsector] !== L.sec_lightlevel[frontsector])

        if (L.sec_ceilingheight[backsector] <= L.sec_floorheight[frontsector] ||
            L.sec_floorheight[backsector] >= L.sec_ceilingheight[frontsector]) {
            // closed door
            markceiling = markfloor = true
        }

        if (worldhigh < worldtop) {
            toptexture = texturetranslation[L.side_toptexture[sidedef]]
            if (L.line_flags[linedef] & ML.DONTPEGTOP) {
                rw_toptexturemid = worldtop
            } else {
                const vtop = (L.sec_ceilingheight[backsector] +
                    textureheight[L.side_toptexture[sidedef]]) | 0
                rw_toptexturemid = (vtop - R.viewz) | 0
            }
        }
        if (worldlow > worldbottom) {
            bottomtexture = texturetranslation[L.side_bottomtexture[sidedef]]
            if (L.line_flags[linedef] & ML.DONTPEGBOTTOM) {
                rw_bottomtexturemid = worldtop
            } else {
                rw_bottomtexturemid = worldlow
            }
        }
        rw_toptexturemid = (rw_toptexturemid + L.side_rowoffset[sidedef]) | 0
        rw_bottomtexturemid = (rw_bottomtexturemid + L.side_rowoffset[sidedef]) | 0

        if (L.side_midtexture[sidedef] !== 0) {
            // masked midtexture: capture columns for back-to-front draw
            maskedtexture = true
            maskedtexturecolBase = RP.getLastopening() - rw_x
            ds.maskedtexturecol = openings
            ds.maskedtexturecolOfs = maskedtexturecolBase
            // initialise to MAXSHORT sentinel
            for (let x = rw_x; x < rw_stopx; x++)
                openings[maskedtexturecolBase + x] = MAXSHORT
            RP.setLastopening(RP.getLastopening() + (rw_stopx - rw_x))
        }
    }

    segtextured = (midtexture | toptexture | bottomtexture) !== 0 || maskedtexture

    if (segtextured) {
        let offa = (rw_normalangle - R.rw_angle1) >>> 0
        if (offa > ANG180) offa = (0 - offa) >>> 0
        if (offa > ANG90) offa = ANG90
        const sine = T.finesine[offa >>> 19]
        rw_offset = T.FixedMul(hyp, sine)
        if (((rw_normalangle - R.rw_angle1) >>> 0) < ANG180)
            rw_offset = -rw_offset
        rw_offset = (rw_offset + L.side_textureoffset[sidedef] + L.seg_offset[seg]) | 0
        rw_centerangle = (ANG90 + R.viewangle - rw_normalangle) >>> 0

        if (R.fixedcolormapOfs < 0) {
            let lightnum = (L.sec_lightlevel[frontsector] >> 4) + R.extralight
            const v1 = L.seg_v1[seg], v2 = L.seg_v2[seg]
            if (L.vertex_y[v1] === L.vertex_y[v2]) lightnum--
            else if (L.vertex_x[v1] === L.vertex_x[v2]) lightnum++
            if (lightnum < 0) R.walllights = RM.scalelight[0]
            else if (lightnum >= 16) R.walllights = RM.scalelight[15]
            else R.walllights = RM.scalelight[lightnum]
        }
    }

    // planes on the wrong side of the view plane are invisible
    if (L.sec_floorheight[frontsector] >= R.viewz) markfloor = false
    if (L.sec_ceilingheight[frontsector] <= R.viewz &&
        L.sec_ceilingpic[frontsector] !== skyflatnum) markceiling = false

    // incremental stepping
    worldtop >>= 4
    worldbottom >>= 4
    topstep = -T.FixedMul(rw_scalestep, worldtop)
    topfrac = ((RM.getCenteryfrac() >> 4) - T.FixedMul(worldtop, rw_scale)) | 0
    bottomstep = -T.FixedMul(rw_scalestep, worldbottom)
    bottomfrac = ((RM.getCenteryfrac() >> 4) - T.FixedMul(worldbottom, rw_scale)) | 0

    if (backsector !== -1) {
        worldhigh >>= 4
        worldlow >>= 4
        if (worldhigh < worldtop) {
            pixhigh = ((RM.getCenteryfrac() >> 4) - T.FixedMul(worldhigh, rw_scale)) | 0
            pixhighstep = -T.FixedMul(rw_scalestep, worldhigh)
        }
        if (worldlow > worldbottom) {
            pixlow = ((RM.getCenteryfrac() >> 4) - T.FixedMul(worldlow, rw_scale)) | 0
            pixlowstep = -T.FixedMul(rw_scalestep, worldlow)
        }
    }

    if (markceiling)
        R.ceilingplane = RP.R_CheckPlane(R.ceilingplane, rw_x, rw_stopx - 1)
    if (markfloor)
        R.floorplane = RP.R_CheckPlane(R.floorplane, rw_x, rw_stopx - 1)

    R_RenderSegLoop()

    // save sprite clipping info
    const floorclip = RP.floorclip
    const ceilingclip = RP.ceilingclip
    if (((ds.silhouette & SIL_TOP) || maskedtexture) && ds.sprtopclip === null) {
        const lo = RP.getLastopening()
        openings.set(ceilingclip.subarray(start, rw_stopx), lo)
        ds.sprtopclip = openings
        ds.sprtopclipOfs = lo - start
        RP.setLastopening(lo + (rw_stopx - start))
    }
    if (((ds.silhouette & SIL_BOTTOM) || maskedtexture) && ds.sprbottomclip === null) {
        const lo = RP.getLastopening()
        openings.set(floorclip.subarray(start, rw_stopx), lo)
        ds.sprbottomclip = openings
        ds.sprbottomclipOfs = lo - start
        RP.setLastopening(lo + (rw_stopx - start))
    }
    if (maskedtexture && !(ds.silhouette & SIL_TOP)) {
        ds.silhouette |= SIL_TOP
        ds.tsilheight = MININT
    }
    if (maskedtexture && !(ds.silhouette & SIL_BOTTOM)) {
        ds.silhouette |= SIL_BOTTOM
        ds.bsilheight = MAXINT
    }
    RB.incDsP()
}

// Draw the captured masked mid-texture columns of a drawseg between
// x1..x2 (called back-to-front from r_things.R_DrawMasked / R_DrawSprite)
function R_RenderMaskedSegRange(ds, x1, x2) {
    const RT = RThings
    const seg = ds.curline
    const frontsector = L.seg_frontsector[seg]
    const backsector = L.seg_backsector[seg]
    const sidedef = L.seg_sidedef[seg]
    const linedef = L.seg_linedef[seg]
    const texnum = RD.getTexturetranslation()[L.side_midtexture[sidedef]]
    const openings = RP.openings
    const textureheight = RD.getTextureheight()

    const maskedPatch = RD.R_GetMaskedPatch(texnum)
    if (maskedPatch === null) return       // multi-patch masked: vanilla Medusa

    let lightnum = (L.sec_lightlevel[frontsector] >> 4) + R.extralight
    const v1 = L.seg_v1[seg], v2 = L.seg_v2[seg]
    if (L.vertex_y[v1] === L.vertex_y[v2]) lightnum--
    else if (L.vertex_x[v1] === L.vertex_x[v2]) lightnum++
    let walllights
    if (lightnum < 0) walllights = RM.scalelight[0]
    else if (lightnum >= 16) walllights = RM.scalelight[15]
    else walllights = RM.scalelight[lightnum]

    const mtcOfs = ds.maskedtexturecolOfs
    const rw_scalestep_m = ds.scalestep
    let spryscale = (ds.scale1 + (x1 - ds.x1) * rw_scalestep_m) | 0
    RT.setMaskedClip(ds.sprbottomclip, ds.sprbottomclipOfs,
        ds.sprtopclip, ds.sprtopclipOfs)

    // vertical positioning
    if (L.line_flags[linedef] & DD.ML.DONTPEGBOTTOM) {
        let mid = L.sec_floorheight[frontsector] > L.sec_floorheight[backsector]
            ? L.sec_floorheight[frontsector] : L.sec_floorheight[backsector]
        dc.texturemid = (mid + textureheight[texnum] - R.viewz) | 0
    } else {
        let mid = L.sec_ceilingheight[frontsector] < L.sec_ceilingheight[backsector]
            ? L.sec_ceilingheight[frontsector] : L.sec_ceilingheight[backsector]
        dc.texturemid = (mid - R.viewz) | 0
    }
    dc.texturemid = (dc.texturemid + L.side_rowoffset[sidedef]) | 0

    if (R.fixedcolormapOfs >= 0) dc.colormapOfs = R.fixedcolormapOfs

    RT.setColfunc(RDraw.R_DrawColumn)
    for (dc.x = x1; dc.x <= x2; dc.x++) {
        const tcol = openings[mtcOfs + dc.x]
        if (tcol !== MAXSHORT) {
            if (R.fixedcolormapOfs < 0) {
                let index = spryscale >> 12        // LIGHTSCALESHIFT
                if (index >= 48) index = 47
                dc.colormapOfs = walllights[index]
            }
            RT.setSprTopScreen(
                (RM.getCenteryfrac() - T.FixedMul(dc.texturemid, spryscale)) | 0)
            RT.setSprYScale(spryscale)
            dc.iscale = Math.floor(4294967295 / spryscale)
            const colOfs = RD.R_GetMaskedColumnOfs(texnum, tcol)
            if (colOfs >= 0) RT.R_DrawMaskedColumn(maskedPatch, colOfs)
            openings[mtcOfs + dc.x] = MAXSHORT
        }
        spryscale = (spryscale + rw_scalestep_m) | 0
    }
}

let RThings = null

exports = {
    R_StoreWallRange, R_RenderMaskedSegRange,
    SIL_NONE, SIL_BOTTOM, SIL_TOP, SIL_BOTH,
    init: function (D) {
        DD = D.defs; T = D.tables; RM = D.r_main; RB = D.r_bsp
        RP = D.r_plane; RD = D.r_data; RDraw = D.r_draw
        L = D.p_setup.level; R = D.r_main.R; dc = D.r_draw.dc
        RThings = D.r_things
    },
}
