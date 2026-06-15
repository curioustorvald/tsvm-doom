// r_things.mjs -- sprite rendering (r_things.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, W = null, RD = null, RM = null, RB = null
let RDraw = null, RS = null, RP = null, I = null, L = null
let R = null, dc = null

const SCREENWIDTH = _G.DOOM.SCREENWIDTH
const FRACUNIT = 65536
const MINZ = FRACUNIT * 4
const BASEYCENTER = 100
const FF_FULLBRIGHT = 0x8000
const FF_FRAMEMASK = 0x7fff
const MAXVISSPRITES = 128
const MAXINT = 0x7fffffff
const MAXSHORT = 0x7FFF

// ---- sprite definitions (R_InitSpriteDefs) ----

// per sprite: { numframes, frames: [{ rotate, lump[8], flip[8] }] }
let sprites = []
let numsprites = 0

function R_InitSpriteDefs() {
    const sprnames = I.sprnames
    numsprites = sprnames.length
    sprites = new Array(numsprites)
    const firstspritelump = RD.getFirstspritelump()
    const lastspritelump = RD.getLastspritelump()

    for (let i = 0; i < numsprites; i++) {
        const name = sprnames[i]
        const sprtemp = []
        for (let f = 0; f < 29; f++)
            sprtemp.push({ rotate: -1, lump: new Int32Array(8).fill(-1),
                flip: new Uint8Array(8) })
        let maxframe = -1

        for (let l = firstspritelump; l <= lastspritelump; l++) {
            const ln = W.W_LumpName(l)
            if (ln.substring(0, 4) !== name) continue
            const install = (frame, rotation, flipped, lump) => {
                if (frame >= 29 || rotation > 8)
                    throw Error("R_InstallSpriteLump: bad frame chars in " + ln)
                if (frame > maxframe) maxframe = frame
                const st = sprtemp[frame]
                if (rotation === 0) {
                    st.rotate = 0
                    for (let r = 0; r < 8; r++) {
                        st.lump[r] = lump - firstspritelump
                        st.flip[r] = flipped ? 1 : 0
                    }
                    return
                }
                st.rotate = 1
                st.lump[rotation - 1] = lump - firstspritelump
                st.flip[rotation - 1] = flipped ? 1 : 0
            }
            install(ln.charCodeAt(4) - 65, ln.charCodeAt(5) - 48, false, l)
            if (ln.length >= 8)
                install(ln.charCodeAt(6) - 65, ln.charCodeAt(7) - 48, true, l)
        }

        if (maxframe === -1) {
            sprites[i] = { numframes: 0, frames: [] }
            continue
        }
        maxframe++
        for (let f = 0; f < maxframe; f++) {
            if (sprtemp[f].rotate === -1)
                throw Error("R_InitSprites: no patches for " + name +
                    " frame " + String.fromCharCode(65 + f))
            if (sprtemp[f].rotate === 1) {
                for (let r = 0; r < 8; r++)
                    if (sprtemp[f].lump[r] === -1)
                        throw Error("R_InitSprites: " + name + " frame " +
                            String.fromCharCode(65 + f) + " missing rotations")
            }
        }
        sprites[i] = { numframes: maxframe, frames: sprtemp.slice(0, maxframe) }
    }
}

// ---- vissprites ----

function makeVissprite() {
    return {
        x1: 0, x2: 0, gx: 0, gy: 0, gz: 0, gzt: 0,
        startfrac: 0, scale: 0, xiscale: 0,
        texturemid: 0, patch: 0,
        colormapOfs: 0,             // -1 = shadow (fuzz), -2 = full bright? no:
                                    // -1 = fuzz; >=0 = colormap offset
        mobjflags: 0,
    }
}
const vissprites = []
for (let i = 0; i < MAXVISSPRITES; i++) vissprites.push(makeVissprite())
const overflowsprite = makeVissprite()
let vissprite_p = 0
const sortedIdx = new Int32Array(MAXVISSPRITES)

function R_ClearSprites() { vissprite_p = 0 }

function R_NewVisSprite() {
    if (vissprite_p === MAXVISSPRITES) return overflowsprite
    return vissprites[vissprite_p++]
}

// ---- masked column drawing (shared with r_segs masked ranges) ----

// mfloorclip/mceilingclip: (Int16Array, offset) pairs
let mfloorclip = null, mfloorclipOfs = 0
let mceilingclip = null, mceilingclipOfs = 0
let spryscale = 0
let sprtopscreen = 0
let colfunc = null              // current column func for masked draws

// column = (patchData, columnOfs): walk the posts
function R_DrawMaskedColumn(patch, colOfs) {
    const basetexturemid = dc.texturemid
    let ofs = colOfs
    for (;;) {
        const topdelta = patch[ofs]
        if (topdelta === 0xFF) break
        const length = patch[ofs + 1]
        const topscreen = (sprtopscreen + spryscale * topdelta) | 0
        const bottomscreen = (topscreen + spryscale * length) | 0
        dc.yl = (topscreen + FRACUNIT - 1) >> 16
        dc.yh = (bottomscreen - 1) >> 16
        if (dc.yh >= mfloorclip[mfloorclipOfs + dc.x])
            dc.yh = mfloorclip[mfloorclipOfs + dc.x] - 1
        if (dc.yl <= mceilingclip[mceilingclipOfs + dc.x])
            dc.yl = mceilingclip[mceilingclipOfs + dc.x] + 1
        if (dc.yl <= dc.yh) {
            dc.source = patch
            dc.sourceOfs = ofs + 3
            dc.texturemid = (basetexturemid - (topdelta << 16)) | 0
            colfunc()
        }
        ofs += length + 4
    }
    dc.texturemid = basetexturemid
}

function R_DrawVisSprite(vis) {
    const patch = W.W_CacheLumpNum(vis.patch + RD.getFirstspritelump())

    if (vis.colormapOfs < 0) {
        colfunc = RDraw.R_DrawFuzzColumn            // shadow draw
    } else if (vis.mobjflags & I.MF.MF_TRANSLATION) {
        colfunc = RDraw.R_DrawTranslatedColumn
        dc.colormapOfs = vis.colormapOfs
        dc.translation = RD.getTranslationtables()
        dc.translationOfs =
            ((vis.mobjflags & I.MF.MF_TRANSLATION) >> (26 - 8)) - 256
    } else {
        colfunc = RDraw.R_DrawColumn
        dc.colormapOfs = vis.colormapOfs
    }

    dc.iscale = Math.abs(vis.xiscale)
    dc.texturemid = vis.texturemid
    let frac = vis.startfrac
    spryscale = vis.scale
    sprtopscreen = (RM.getCenteryfrac() - T.FixedMul(dc.texturemid, spryscale)) | 0

    for (dc.x = vis.x1; dc.x <= vis.x2; dc.x++, frac = (frac + vis.xiscale) | 0) {
        const texturecolumn = frac >> 16
        const colOfs = W.lumpI32(patch, 8 + 4 * texturecolumn)
        R_DrawMaskedColumn(patch, colOfs)
    }
}

// spritelights set per sector in R_AddSprites
let spritelights = null

// thing: mobj-like { x, y, z, angle, sprite, frame, flags, snext }
function R_ProjectSprite(thing) {
    const tr_x = (thing.x - R.viewx) | 0
    const tr_y = (thing.y - R.viewy) | 0
    let gxt = T.FixedMul(tr_x, R.viewcos)
    let gyt = -T.FixedMul(tr_y, R.viewsin)
    const tz = (gxt - gyt) | 0
    if (tz < MINZ) return

    const xscale = T.FixedDiv(RM.getProjection(), tz)
    gxt = -T.FixedMul(tr_x, R.viewsin)
    gyt = T.FixedMul(tr_y, R.viewcos)
    let tx = (-(gyt + gxt)) | 0
    if (Math.abs(tx) > (tz << 2)) return          // too far off the side

    const sprdef = sprites[thing.sprite]
    const sprframe = sprdef.frames[thing.frame & FF_FRAMEMASK]
    let lump, flip
    if (sprframe.rotate) {
        // vanilla: (ang - thing->angle + (unsigned)(ANG45/2)*9) >> 29
        // (ANG45/2)*9 wraps to 0x90000000 in uint32
        const ang = RM.R_PointToAngle(thing.x, thing.y)
        const rot = ((((ang - thing.angle) >>> 0) + 0x90000000) % 4294967296) >>> 29
        lump = sprframe.lump[rot]
        flip = sprframe.flip[rot] !== 0
    } else {
        lump = sprframe.lump[0]
        flip = sprframe.flip[0] !== 0
    }

    const spriteoffset = RD.getSpriteoffset()
    const spritewidth = RD.getSpritewidth()
    const spritetopoffset = RD.getSpritetopoffset()
    const viewwidth = RM.getViewwidth()

    tx = (tx - spriteoffset[lump]) | 0
    const x1 = (RM.getCenterxfrac() + T.FixedMul(tx, xscale)) >> 16
    if (x1 > viewwidth) return
    tx = (tx + spritewidth[lump]) | 0
    const x2 = ((RM.getCenterxfrac() + T.FixedMul(tx, xscale)) >> 16) - 1
    if (x2 < 0) return

    const vis = R_NewVisSprite()
    vis.mobjflags = thing.flags
    vis.scale = xscale
    vis.gx = thing.x
    vis.gy = thing.y
    vis.gz = thing.z
    vis.gzt = (thing.z + spritetopoffset[lump]) | 0
    vis.texturemid = (vis.gzt - R.viewz) | 0
    vis.x1 = x1 < 0 ? 0 : x1
    vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2
    const iscale = T.FixedDiv(FRACUNIT, xscale)
    if (flip) {
        vis.startfrac = (spritewidth[lump] - 1) | 0
        vis.xiscale = -iscale
    } else {
        vis.startfrac = 0
        vis.xiscale = iscale
    }
    if (vis.x1 > x1)
        vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0
    vis.patch = lump

    if (thing.flags & I.MF.MF_SHADOW) {
        vis.colormapOfs = -1                       // fuzz
    } else if (R.fixedcolormapOfs >= 0) {
        vis.colormapOfs = R.fixedcolormapOfs
    } else if (thing.frame & FF_FULLBRIGHT) {
        vis.colormapOfs = 0
    } else {
        let index = xscale >> 12                   // LIGHTSCALESHIFT
        if (index >= 48) index = 47                // MAXLIGHTSCALE
        vis.colormapOfs = spritelights[index]
    }
}

function R_AddSprites(sec) {
    // renderer-private marks: sec_validcount belongs to the playsim
    if (L.sec_rvalidcount[sec] === R.validcount) return
    L.sec_rvalidcount[sec] = R.validcount

    let lightnum = (L.sec_lightlevel[sec] >> 4) + R.extralight
    if (lightnum < 0) spritelights = RM.scalelight[0]
    else if (lightnum >= 16) spritelights = RM.scalelight[15]
    else spritelights = RM.scalelight[lightnum]

    for (let thing = L.sec_thinglist[sec]; thing !== null; thing = thing.snext)
        R_ProjectSprite(thing)
}

// vanilla scale-ascending selection sort (back-to-front draw order)
function R_SortVisSprites() {
    const count = vissprite_p
    const used = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
        let bestscale = MAXINT
        let best = -1
        for (let j = 0; j < count; j++) {
            if (!used[j] && vissprites[j].scale < bestscale) {
                bestscale = vissprites[j].scale
                best = j
            }
        }
        used[best] = 1
        sortedIdx[i] = best
    }
}

// reused clip buffers (vanilla had them on the stack)
const clipbot = new Int16Array(SCREENWIDTH)
const cliptop = new Int16Array(SCREENWIDTH)

function R_DrawSprite(spr) {
    for (let x = spr.x1; x <= spr.x2; x++) {
        clipbot[x] = -2
        cliptop[x] = -2
    }

    // scan drawsegs back-to-front for obscuring segs
    const drawsegs = RB.drawsegs
    for (let i = RB.getDsP() - 1; i >= 0; i--) {
        const ds = drawsegs[i]
        if (ds.x1 > spr.x2 || ds.x2 < spr.x1 ||
            (ds.silhouette === 0 && ds.maskedtexturecol === null))
            continue

        const r1 = ds.x1 < spr.x1 ? spr.x1 : ds.x1
        const r2 = ds.x2 > spr.x2 ? spr.x2 : ds.x2
        let scale, lowscale
        if (ds.scale1 > ds.scale2) { lowscale = ds.scale2; scale = ds.scale1 }
        else { lowscale = ds.scale1; scale = ds.scale2 }

        if (scale < spr.scale || (lowscale < spr.scale &&
            !RM.R_PointOnSegSide(spr.gx, spr.gy, ds.curline))) {
            if (ds.maskedtexturecol !== null)
                RS.R_RenderMaskedSegRange(ds, r1, r2)
            continue                               // seg is behind sprite
        }

        let silhouette = ds.silhouette
        if (spr.gz >= ds.bsilheight) silhouette &= ~1   // SIL_BOTTOM
        if (spr.gzt <= ds.tsilheight) silhouette &= ~2  // SIL_TOP

        if (silhouette === 1) {
            for (let x = r1; x <= r2; x++)
                if (clipbot[x] === -2)
                    clipbot[x] = ds.sprbottomclip[ds.sprbottomclipOfs + x]
        } else if (silhouette === 2) {
            for (let x = r1; x <= r2; x++)
                if (cliptop[x] === -2)
                    cliptop[x] = ds.sprtopclip[ds.sprtopclipOfs + x]
        } else if (silhouette === 3) {
            for (let x = r1; x <= r2; x++) {
                if (clipbot[x] === -2)
                    clipbot[x] = ds.sprbottomclip[ds.sprbottomclipOfs + x]
                if (cliptop[x] === -2)
                    cliptop[x] = ds.sprtopclip[ds.sprtopclipOfs + x]
            }
        }
    }

    const viewheight = RM.getViewheight()
    for (let x = spr.x1; x <= spr.x2; x++) {
        if (clipbot[x] === -2) clipbot[x] = viewheight
        if (cliptop[x] === -2) cliptop[x] = -1
    }
    mfloorclip = clipbot
    mfloorclipOfs = 0
    mceilingclip = cliptop
    mceilingclipOfs = 0
    R_DrawVisSprite(spr)
}

// ---- player weapon sprites (r_things.c R_DrawPSprite) ----

// reused vissprite for the psprite pass (vanilla stack avis)
const avis = makeVissprite()

function R_DrawPSprite(psp) {
    const player = R.viewplayer
    const state = psp.state
    const sprdef = sprites[I.stateSprite[state]]
    const sprframe = sprdef.frames[I.stateFrame[state] & FF_FRAMEMASK]
    const lump = sprframe.lump[0]
    const flip = sprframe.flip[0] !== 0

    const spriteoffset = RD.getSpriteoffset()
    const spritewidth = RD.getSpritewidth()
    const spritetopoffset = RD.getSpritetopoffset()
    const pspritescale = RM.getPspritescale()
    const pspriteiscale = RM.getPspriteiscale()
    const viewwidth = RM.getViewwidth()

    // horizontal placement
    let tx = (psp.sx - 160 * FRACUNIT) | 0
    tx = (tx - spriteoffset[lump]) | 0
    const x1 = (RM.getCenterxfrac() + T.FixedMul(tx, pspritescale)) >> 16
    if (x1 > viewwidth) return
    tx = (tx + spritewidth[lump]) | 0
    const x2 = ((RM.getCenterxfrac() + T.FixedMul(tx, pspritescale)) >> 16) - 1
    if (x2 < 0) return

    const vis = avis
    vis.mobjflags = 0
    vis.texturemid = ((BASEYCENTER << 16) + (FRACUNIT >> 1) -
        (psp.sy - spritetopoffset[lump])) | 0
    vis.x1 = x1 < 0 ? 0 : x1
    vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2
    vis.scale = pspritescale
    if (flip) {
        vis.xiscale = -pspriteiscale
        vis.startfrac = (spritewidth[lump] - 1) | 0
    } else {
        vis.xiscale = pspriteiscale
        vis.startfrac = 0
    }
    if (vis.x1 > x1)
        vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0
    vis.patch = lump

    const inv = player.powers[DD.Power.invisibility]
    if (inv > 4 * 32 || (inv & 8)) {
        vis.colormapOfs = -1               // shadow draw
    } else if (R.fixedcolormapOfs >= 0) {
        vis.colormapOfs = R.fixedcolormapOfs
    } else if (I.stateFrame[state] & FF_FULLBRIGHT) {
        vis.colormapOfs = 0
    } else {
        vis.colormapOfs = spritelights[47] // MAXLIGHTSCALE-1
    }

    R_DrawVisSprite(vis)
}

function R_DrawPlayerSprites() {
    const player = R.viewplayer
    if (player === null || player.psprites === undefined) return

    // light level from the player's sector
    const sec = L.ssec_sector[player.mo.subsector]
    let lightnum = (L.sec_lightlevel[sec] >> 4) + R.extralight
    if (lightnum < 0) spritelights = RM.scalelight[0]
    else if (lightnum >= 16) spritelights = RM.scalelight[15]
    else spritelights = RM.scalelight[lightnum]

    // clip to the screen bounds
    mfloorclip = RM.screenheightarray
    mfloorclipOfs = 0
    mceilingclip = RM.negonearray
    mceilingclipOfs = 0

    for (let i = 0; i < player.psprites.length; i++) {
        const psp = player.psprites[i]
        if (psp.state > 0) R_DrawPSprite(psp)
    }
}

let drawPSprites = null         // optional override (tests)

function R_DrawMasked() {
    R_SortVisSprites()
    for (let i = 0; i < vissprite_p; i++)
        R_DrawSprite(vissprites[sortedIdx[i]])

    // remaining masked mid textures, back to front
    const drawsegs = RB.drawsegs
    for (let i = RB.getDsP() - 1; i >= 0; i--) {
        const ds = drawsegs[i]
        if (ds.maskedtexturecol !== null)
            RS.R_RenderMaskedSegRange(ds, ds.x1, ds.x2)
    }
    if (drawPSprites !== null) drawPSprites()
    else R_DrawPlayerSprites()
}

// masked-range entry points used by r_segs
function setMaskedClip(fc, fcOfs, cc, ccOfs) {
    mfloorclip = fc; mfloorclipOfs = fcOfs
    mceilingclip = cc; mceilingclipOfs = ccOfs
}
function setSprYScale(s) { spryscale = s }
function setSprTopScreen(s) { sprtopscreen = s }
function setColfunc(f) { colfunc = f }

// ---- debug helper: static display mobjs from raw mapthings ----
// Used by `doom view` and the harness until the playsim spawns real mobjs
// in M5. Links fake mobjs into sec_thinglist for R_AddSprites.
function debugSpawnStatics() {
    const MTBL = I.mobjinfo
    const ednumToType = new Map()
    for (let t = 0; t < I.NUMMOBJTYPES; t++)
        if (MTBL.doomednum[t] !== -1) ednumToType.set(MTBL.doomednum[t], t)

    for (let s = 0; s < L.numsectors; s++) L.sec_thinglist[s] = null

    for (const t of L.things) {
        if (t.type >= 1 && t.type <= 4) continue       // player starts
        if (t.type === 11 || t.type === 14) continue   // dm start, teleport
        const type = ednumToType.get(t.type)
        if (type === undefined) continue
        if (!(t.options & 4)) continue                 // skill 3 filter
        const state = MTBL.spawnstate[type]
        const ss = RM.R_PointInSubsector(t.x << 16, t.y << 16)
        const sector = L.ssec_sector[ss]
        const flags = MTBL.flags[type]
        let z = L.sec_floorheight[sector]
        if (flags & I.MF.MF_SPAWNCEILING)
            z = (L.sec_ceilingheight[sector] - MTBL.height[type]) | 0
        const mobj = {
            x: t.x << 16, y: t.y << 16, z: z,
            angle: (0x20000000 * Math.floor(t.angle / 45)) | 0,
            sprite: I.stateSprite[state],
            frame: I.stateFrame[state],
            flags: flags,
            snext: L.sec_thinglist[sector],
        }
        L.sec_thinglist[sector] = mobj
    }
}

exports = {
    R_InitSpriteDefs, R_ClearSprites, R_AddSprites, R_DrawMasked,
    R_DrawMaskedColumn, R_ProjectSprite,
    setMaskedClip, setSprYScale, setSprTopScreen, setColfunc,
    setDrawPSprites: (fn) => { drawPSprites = fn },
    debugSpawnStatics,
    init: function (D) {
        DD = D.defs; T = D.tables; W = D.w_wad; RD = D.r_data
        RM = D.r_main; RB = D.r_bsp; RDraw = D.r_draw; RS = D.r_segs
        RP = D.r_plane; I = D.info; L = D.p_setup.level
        R = D.r_main.R; dc = D.r_draw.dc
    },
}
