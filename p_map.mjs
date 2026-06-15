// p_map.mjs -- movement clipping, attacks, sector changes (p_map.c)
// plus line-of-sight checking (p_sight.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PM = null
let PMU = null, RM = null, RD = null, L = null, S = null
let PInter = null, PSpec = null

const FRACUNIT = 65536
const MAXINT = 0x7fffffff
const ANG90 = 0x40000000
const ANG180 = 0x80000000
const MAXSPECIALCROSS = 8

function FixedMul(a, b) { return T.FixedMul(a, b) }
function FixedDiv(a, b) { return T.FixedDiv(a, b) }
function P_Random() { return R.P_Random() }

// ---- shared movement state (vanilla globals) ----

let tmthing = null
let tmflags = 0
let tmx = 0, tmy = 0
const tmbbox = new Int32Array(4)

let floatok = false
let tmfloorz = 0, tmceilingz = 0, tmdropoffz = 0

let ceilingline = -1            // line index, -1 = none

const spechit = new Int32Array(MAXSPECIALCROSS)
let numspechit = 0

// ---- teleport move ----

function PIT_StompThing(thing) {
    const MF = I.MF
    if (!(thing.flags & MF.MF_SHOOTABLE)) return true
    const blockdist = (thing.radius + tmthing.radius) | 0
    if (Math.abs(thing.x - tmx) >= blockdist ||
        Math.abs(thing.y - tmy) >= blockdist) return true
    if (thing === tmthing) return true     // don't clip against self
    // monsters don't stomp things except on the boss level
    if (!tmthing.player && G.state.gamemap !== 30) return false
    PInter.P_DamageMobj(thing, tmthing, tmthing, 10000)
    return true
}

function P_TeleportMove(thing, x, y) {
    tmthing = thing
    tmflags = thing.flags
    tmx = x
    tmy = y
    tmbbox[DD.BOXTOP] = (y + tmthing.radius) | 0
    tmbbox[DD.BOXBOTTOM] = (y - tmthing.radius) | 0
    tmbbox[DD.BOXRIGHT] = (x + tmthing.radius) | 0
    tmbbox[DD.BOXLEFT] = (x - tmthing.radius) | 0

    const newsubsec = RM.R_PointInSubsector(x, y)
    ceilingline = -1
    const sec = L.ssec_sector[newsubsec]
    tmfloorz = tmdropoffz = L.sec_floorheight[sec]
    tmceilingz = L.sec_ceilingheight[sec]

    PMU.incValidcount()
    numspechit = 0

    const xl = (tmbbox[DD.BOXLEFT] - L.bmaporgx - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    const xh = (tmbbox[DD.BOXRIGHT] - L.bmaporgx + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    const yl = (tmbbox[DD.BOXBOTTOM] - L.bmaporgy - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    const yh = (tmbbox[DD.BOXTOP] - L.bmaporgy + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT

    for (let bx = xl; bx <= xh; bx++)
        for (let by = yl; by <= yh; by++)
            if (!PMU.P_BlockThingsIterator(bx, by, PIT_StompThing))
                return false

    PMU.P_UnsetThingPosition(thing)
    thing.floorz = tmfloorz
    thing.ceilingz = tmceilingz
    thing.x = x
    thing.y = y
    PMU.P_SetThingPosition(thing)
    return true
}

// ---- movement iterators ----

function PIT_CheckLine(ld) {
    if (tmbbox[DD.BOXRIGHT] <= L.line_bbox[ld * 4 + DD.BOXLEFT] ||
        tmbbox[DD.BOXLEFT] >= L.line_bbox[ld * 4 + DD.BOXRIGHT] ||
        tmbbox[DD.BOXTOP] <= L.line_bbox[ld * 4 + DD.BOXBOTTOM] ||
        tmbbox[DD.BOXBOTTOM] >= L.line_bbox[ld * 4 + DD.BOXTOP])
        return true
    if (PMU.P_BoxOnLineSide(tmbbox, ld) !== -1) return true

    // a line has been hit
    if (L.line_backsector[ld] === -1) return false      // one sided

    const ML = DD.ML
    if (!(tmthing.flags & I.MF.MF_MISSILE)) {
        if (L.line_flags[ld] & ML.BLOCKING) return false
        if (!tmthing.player && (L.line_flags[ld] & ML.BLOCKMONSTERS))
            return false
    }

    PMU.P_LineOpening(ld)
    const op = PMU.opening
    if (op.opentop < tmceilingz) {
        tmceilingz = op.opentop
        ceilingline = ld
    }
    if (op.openbottom > tmfloorz) tmfloorz = op.openbottom
    if (op.lowfloor < tmdropoffz) tmdropoffz = op.lowfloor

    if (L.line_special[ld]) {
        spechit[numspechit] = ld
        numspechit++
    }
    return true
}

function PIT_CheckThing(thing) {
    const MF = I.MF
    if (!(thing.flags & (MF.MF_SOLID | MF.MF_SPECIAL | MF.MF_SHOOTABLE)))
        return true
    const blockdist = (thing.radius + tmthing.radius) | 0
    if (Math.abs(thing.x - tmx) >= blockdist ||
        Math.abs(thing.y - tmy) >= blockdist) return true
    if (thing === tmthing) return true

    // skulls slamming into things
    if (tmthing.flags & MF.MF_SKULLFLY) {
        const damage = ((P_Random() % 8) + 1) * I.mobjinfo.damage[tmthing.type]
        PInter.P_DamageMobj(thing, tmthing, tmthing, damage)
        tmthing.flags &= ~MF.MF_SKULLFLY
        tmthing.momx = tmthing.momy = tmthing.momz = 0
        PM.P_SetMobjState(tmthing, I.mobjinfo.spawnstate[tmthing.type])
        return false
    }

    // missiles can hit other things
    if (tmthing.flags & MF.MF_MISSILE) {
        if (tmthing.z > thing.z + thing.height) return true   // overhead
        if (tmthing.z + tmthing.height < thing.z) return true // underneath

        const MT = I.MT
        if (tmthing.target && (
            tmthing.target.type === thing.type ||
            (tmthing.target.type === MT.MT_KNIGHT && thing.type === MT.MT_BRUISER) ||
            (tmthing.target.type === MT.MT_BRUISER && thing.type === MT.MT_KNIGHT))) {
            // don't hit same species as originator
            if (thing === tmthing.target) return true
            if (thing.type !== MT.MT_PLAYER) return false
        }

        if (!(thing.flags & MF.MF_SHOOTABLE))
            return !(thing.flags & MF.MF_SOLID)

        const damage = ((P_Random() % 8) + 1) * I.mobjinfo.damage[tmthing.type]
        PInter.P_DamageMobj(thing, tmthing, tmthing.target, damage)
        return false
    }

    // special pickup
    if (thing.flags & MF.MF_SPECIAL) {
        const solid = thing.flags & MF.MF_SOLID
        if (tmflags & MF.MF_PICKUP)
            PInter.P_TouchSpecialThing(thing, tmthing)
        return !solid
    }

    return !(thing.flags & MF.MF_SOLID)
}

// ---- movement clipping ----

function P_CheckPosition(thing, x, y) {
    tmthing = thing
    tmflags = thing.flags
    tmx = x
    tmy = y
    tmbbox[DD.BOXTOP] = (y + tmthing.radius) | 0
    tmbbox[DD.BOXBOTTOM] = (y - tmthing.radius) | 0
    tmbbox[DD.BOXRIGHT] = (x + tmthing.radius) | 0
    tmbbox[DD.BOXLEFT] = (x - tmthing.radius) | 0

    const newsubsec = RM.R_PointInSubsector(x, y)
    ceilingline = -1
    const sec = L.ssec_sector[newsubsec]
    tmfloorz = tmdropoffz = L.sec_floorheight[sec]
    tmceilingz = L.sec_ceilingheight[sec]

    PMU.incValidcount()
    numspechit = 0

    if (tmflags & I.MF.MF_NOCLIP) return true

    // things first (extended by MAXRADIUS), possibly picking things up
    let xl = (tmbbox[DD.BOXLEFT] - L.bmaporgx - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    let xh = (tmbbox[DD.BOXRIGHT] - L.bmaporgx + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    let yl = (tmbbox[DD.BOXBOTTOM] - L.bmaporgy - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
    let yh = (tmbbox[DD.BOXTOP] - L.bmaporgy + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT

    for (let bx = xl; bx <= xh; bx++)
        for (let by = yl; by <= yh; by++)
            if (!PMU.P_BlockThingsIterator(bx, by, PIT_CheckThing))
                return false

    // then lines
    xl = (tmbbox[DD.BOXLEFT] - L.bmaporgx) >> DD.MAPBLOCKSHIFT
    xh = (tmbbox[DD.BOXRIGHT] - L.bmaporgx) >> DD.MAPBLOCKSHIFT
    yl = (tmbbox[DD.BOXBOTTOM] - L.bmaporgy) >> DD.MAPBLOCKSHIFT
    yh = (tmbbox[DD.BOXTOP] - L.bmaporgy) >> DD.MAPBLOCKSHIFT

    for (let bx = xl; bx <= xh; bx++)
        for (let by = yl; by <= yh; by++)
            if (!PMU.P_BlockLinesIterator(bx, by, PIT_CheckLine))
                return false

    return true
}

function P_TryMove(thing, x, y) {
    const MF = I.MF
    floatok = false
    if (!P_CheckPosition(thing, x, y))
        return false            // solid wall or thing

    if (!(thing.flags & MF.MF_NOCLIP)) {
        if (tmceilingz - tmfloorz < thing.height)
            return false        // doesn't fit
        floatok = true
        if (!(thing.flags & MF.MF_TELEPORT) &&
            tmceilingz - thing.z < thing.height)
            return false        // mobj must lower itself to fit
        if (!(thing.flags & MF.MF_TELEPORT) &&
            tmfloorz - thing.z > 24 * FRACUNIT)
            return false        // too big a step up
        if (!(thing.flags & (MF.MF_DROPOFF | MF.MF_FLOAT)) &&
            tmfloorz - tmdropoffz > 24 * FRACUNIT)
            return false        // don't stand over a dropoff
    }

    // the move is ok: link into new position
    PMU.P_UnsetThingPosition(thing)
    const oldx = thing.x
    const oldy = thing.y
    thing.floorz = tmfloorz
    thing.ceilingz = tmceilingz
    thing.x = x
    thing.y = y
    PMU.P_SetThingPosition(thing)

    // crossed special lines
    if (!(thing.flags & (MF.MF_TELEPORT | MF.MF_NOCLIP))) {
        while (numspechit--) {
            const ld = spechit[numspechit]
            const side = PMU.P_PointOnLineSide(thing.x, thing.y, ld)
            const oldside = PMU.P_PointOnLineSide(oldx, oldy, ld)
            if (side !== oldside) {
                if (L.line_special[ld])
                    PSpec.P_CrossSpecialLine(ld, oldside, thing)
            }
        }
    }
    return true
}

function P_ThingHeightClip(thing) {
    const onfloor = thing.z === thing.floorz
    P_CheckPosition(thing, thing.x, thing.y)
    thing.floorz = tmfloorz
    thing.ceilingz = tmceilingz

    if (onfloor) {
        thing.z = thing.floorz
    } else {
        if (thing.z + thing.height > thing.ceilingz)
            thing.z = (thing.ceilingz - thing.height) | 0
    }
    return thing.ceilingz - thing.floorz >= thing.height
}

// ---- slide move ----

let bestslidefrac = 0
let bestslideline = -1
let slidemo = null
let tmxmove = 0, tmymove = 0

function P_HitSlideLine(ld) {
    const ST = DD.SlopeType
    if (L.line_slopetype[ld] === ST.horizontal) { tmymove = 0; return }
    if (L.line_slopetype[ld] === ST.vertical) { tmxmove = 0; return }

    const side = PMU.P_PointOnLineSide(slidemo.x, slidemo.y, ld)
    let lineangle = RM.R_PointToAngle2(0, 0, L.line_dx[ld], L.line_dy[ld])
    if (side === 1) lineangle = (lineangle + ANG180) >>> 0

    const moveangle = RM.R_PointToAngle2(0, 0, tmxmove, tmymove)
    let deltaangle = (moveangle - lineangle) >>> 0
    if (deltaangle > ANG180) deltaangle = (deltaangle + ANG180) >>> 0

    const la = lineangle >>> 19
    const da = deltaangle >>> 19
    const movelen = PMU.P_AproxDistance(tmxmove, tmymove)
    const newlen = FixedMul(movelen, T.finecosine[da])
    tmxmove = FixedMul(newlen, T.finecosine[la])
    tmymove = FixedMul(newlen, T.finesine[la])
}

function PTR_SlideTraverse(inx) {
    if (!inx.isaline) throw Error("PTR_SlideTraverse: not a line?")
    const li = inx.line

    let blocking = false
    if (!(L.line_flags[li] & DD.ML.TWOSIDED)) {
        if (PMU.P_PointOnLineSide(slidemo.x, slidemo.y, li))
            return true         // don't hit the back side
        blocking = true
    } else {
        PMU.P_LineOpening(li)
        const op = PMU.opening
        if (op.openrange < slidemo.height) blocking = true          // doesn't fit
        else if (op.opentop - slidemo.z < slidemo.height) blocking = true
        else if (op.openbottom - slidemo.z > 24 * FRACUNIT) blocking = true
    }
    if (!blocking) return true

    // the line blocks movement: closest so far?
    if (inx.frac < bestslidefrac) {
        bestslidefrac = inx.frac
        bestslideline = li
    }
    return false                // stop
}

function P_SlideMove(mo) {
    slidemo = mo
    let hitcount = 0

    for (;;) {
        if (++hitcount === 3) {
            // don't loop forever: stairstep
            if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
                P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y)
            return
        }

        // trace along the three leading corners
        let leadx, leady, trailx, traily
        if (mo.momx > 0) { leadx = (mo.x + mo.radius) | 0; trailx = (mo.x - mo.radius) | 0 }
        else { leadx = (mo.x - mo.radius) | 0; trailx = (mo.x + mo.radius) | 0 }
        if (mo.momy > 0) { leady = (mo.y + mo.radius) | 0; traily = (mo.y - mo.radius) | 0 }
        else { leady = (mo.y - mo.radius) | 0; traily = (mo.y + mo.radius) | 0 }

        bestslidefrac = FRACUNIT + 1

        PMU.P_PathTraverse(leadx, leady, (leadx + mo.momx) | 0, (leady + mo.momy) | 0,
            DD.PT_ADDLINES, PTR_SlideTraverse)
        PMU.P_PathTraverse(trailx, leady, (trailx + mo.momx) | 0, (leady + mo.momy) | 0,
            DD.PT_ADDLINES, PTR_SlideTraverse)
        PMU.P_PathTraverse(leadx, traily, (leadx + mo.momx) | 0, (traily + mo.momy) | 0,
            DD.PT_ADDLINES, PTR_SlideTraverse)

        if (bestslidefrac === FRACUNIT + 1) {
            // hit the middle: stairstep
            if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
                P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y)
            return
        }

        // fudge a bit so it doesn't hit
        bestslidefrac -= 0x800
        if (bestslidefrac > 0) {
            const newx = FixedMul(mo.momx, bestslidefrac)
            const newy = FixedMul(mo.momy, bestslidefrac)
            if (!P_TryMove(mo, (mo.x + newx) | 0, (mo.y + newy) | 0)) {
                // stairstep
                if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
                    P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y)
                return
            }
        }

        // continue along the wall with the remainder
        bestslidefrac = (FRACUNIT - (bestslidefrac + 0x800)) | 0
        if (bestslidefrac > FRACUNIT) bestslidefrac = FRACUNIT
        if (bestslidefrac <= 0) return

        tmxmove = FixedMul(mo.momx, bestslidefrac)
        tmymove = FixedMul(mo.momy, bestslidefrac)

        P_HitSlideLine(bestslideline)

        mo.momx = tmxmove
        mo.momy = tmymove

        if (P_TryMove(mo, (mo.x + tmxmove) | 0, (mo.y + tmymove) | 0))
            return
        // else retry
    }
}

// ---- line attacks ----

let linetarget = null
let shootthing = null
let shootz = 0
let la_damage = 0
let attackrange = 0
let aimslope = 0
let topslope = 0, bottomslope = 0          // shared with p_sight part

function PTR_AimTraverse(inx) {
    if (inx.isaline) {
        const li = inx.line
        if (!(L.line_flags[li] & DD.ML.TWOSIDED)) return false

        PMU.P_LineOpening(li)
        const op = PMU.opening
        if (op.openbottom >= op.opentop) return false

        const dist = FixedMul(attackrange, inx.frac)
        const front = L.line_frontsector[li]
        const back = L.line_backsector[li]

        if (L.sec_floorheight[front] !== L.sec_floorheight[back]) {
            const slope = FixedDiv((op.openbottom - shootz) | 0, dist)
            if (slope > bottomslope) bottomslope = slope
        }
        if (L.sec_ceilingheight[front] !== L.sec_ceilingheight[back]) {
            const slope = FixedDiv((op.opentop - shootz) | 0, dist)
            if (slope < topslope) topslope = slope
        }
        if (topslope <= bottomslope) return false
        return true
    }

    // shoot a thing
    const th = inx.thing
    if (th === shootthing) return true
    if (!(th.flags & I.MF.MF_SHOOTABLE)) return true

    const dist = FixedMul(attackrange, inx.frac)
    let thingtopslope = FixedDiv((th.z + th.height - shootz) | 0, dist)
    if (thingtopslope < bottomslope) return true        // shot over
    let thingbottomslope = FixedDiv((th.z - shootz) | 0, dist)
    if (thingbottomslope > topslope) return true        // shot under

    if (thingtopslope > topslope) thingtopslope = topslope
    if (thingbottomslope < bottomslope) thingbottomslope = bottomslope
    aimslope = ((thingtopslope + thingbottomslope) / 2) | 0
    linetarget = th
    return false
}

function PTR_ShootTraverse(inx) {
    const trace = PMU.trace
    if (inx.isaline) {
        const li = inx.line
        if (L.line_special[li]) PSpec.P_ShootSpecialLine(shootthing, li)

        let hit = false
        if (!(L.line_flags[li] & DD.ML.TWOSIDED)) {
            hit = true
        } else {
            PMU.P_LineOpening(li)
            const op = PMU.opening
            const dist = FixedMul(attackrange, inx.frac)
            const front = L.line_frontsector[li]
            const back = L.line_backsector[li]
            if (L.sec_floorheight[front] !== L.sec_floorheight[back]) {
                const slope = FixedDiv((op.openbottom - shootz) | 0, dist)
                if (slope > aimslope) hit = true
            }
            if (!hit && L.sec_ceilingheight[front] !== L.sec_ceilingheight[back]) {
                const slope = FixedDiv((op.opentop - shootz) | 0, dist)
                if (slope < aimslope) hit = true
            }
        }

        if (!hit) return true              // shot continues

        // hit line: position a bit closer
        const frac = (inx.frac - FixedDiv(4 * FRACUNIT, attackrange)) | 0
        const x = (trace.x + FixedMul(trace.dx, frac)) | 0
        const y = (trace.y + FixedMul(trace.dy, frac)) | 0
        const z = (shootz + FixedMul(aimslope, FixedMul(frac, attackrange))) | 0

        const front = L.line_frontsector[li]
        if (L.sec_ceilingpic[front] === RD.getSkyflatnum()) {
            // don't shoot the sky
            if (z > L.sec_ceilingheight[front]) return false
            const back = L.line_backsector[li]
            if (back !== -1 && L.sec_ceilingpic[back] === RD.getSkyflatnum())
                return false
        }

        PM.P_SpawnPuff(x, y, z)
        return false
    }

    // shoot a thing
    const th = inx.thing
    if (th === shootthing) return true
    if (!(th.flags & I.MF.MF_SHOOTABLE)) return true

    const dist = FixedMul(attackrange, inx.frac)
    const thingtopslope = FixedDiv((th.z + th.height - shootz) | 0, dist)
    if (thingtopslope < aimslope) return true
    const thingbottomslope = FixedDiv((th.z - shootz) | 0, dist)
    if (thingbottomslope > aimslope) return true

    // hit thing: position a bit closer
    const frac = (inx.frac - FixedDiv(10 * FRACUNIT, attackrange)) | 0
    const x = (trace.x + FixedMul(trace.dx, frac)) | 0
    const y = (trace.y + FixedMul(trace.dy, frac)) | 0
    const z = (shootz + FixedMul(aimslope, FixedMul(frac, attackrange))) | 0

    if (th.flags & I.MF.MF_NOBLOOD) PM.P_SpawnPuff(x, y, z)
    else PM.P_SpawnBlood(x, y, z, la_damage)

    if (la_damage) PInter.P_DamageMobj(th, shootthing, shootthing, la_damage)
    return false
}

function P_AimLineAttack(t1, angle, distance) {
    const fa = (angle >>> 19) & 8191
    shootthing = t1
    const x2 = (t1.x + (distance >> 16) * T.finecosine[fa]) | 0
    const y2 = (t1.y + (distance >> 16) * T.finesine[fa]) | 0
    shootz = (t1.z + (t1.height >> 1) + 8 * FRACUNIT) | 0

    // can't shoot outside view angles
    topslope = (100 * FRACUNIT / 160) | 0
    bottomslope = (-100 * FRACUNIT / 160) | 0

    attackrange = distance
    linetarget = null

    PMU.P_PathTraverse(t1.x, t1.y, x2, y2,
        DD.PT_ADDLINES | DD.PT_ADDTHINGS, PTR_AimTraverse)

    if (linetarget) return aimslope
    return 0
}

function P_LineAttack(t1, angle, distance, slope, damage) {
    const fa = (angle >>> 19) & 8191
    shootthing = t1
    la_damage = damage
    const x2 = (t1.x + (distance >> 16) * T.finecosine[fa]) | 0
    const y2 = (t1.y + (distance >> 16) * T.finesine[fa]) | 0
    shootz = (t1.z + (t1.height >> 1) + 8 * FRACUNIT) | 0
    attackrange = distance
    aimslope = slope

    PMU.P_PathTraverse(t1.x, t1.y, x2, y2,
        DD.PT_ADDLINES | DD.PT_ADDTHINGS, PTR_ShootTraverse)
}

// ---- use lines ----

let usething = null

function PTR_UseTraverse(inx) {
    if (!L.line_special[inx.line]) {
        PMU.P_LineOpening(inx.line)
        if (PMU.opening.openrange <= 0) {
            S.StartSound(usething, SFX.sfx_noway)
            return false        // can't use through a wall
        }
        return true             // not special, keep checking
    }

    let side = 0
    if (PMU.P_PointOnLineSide(usething.x, usething.y, inx.line) === 1)
        side = 1

    PSpec.P_UseSpecialLine(usething, inx.line, side)
    return false                // one special line at a time
}

function P_UseLines(player) {
    usething = player.mo
    const fa = (player.mo.angle >>> 19) & 8191
    const x1 = player.mo.x
    const y1 = player.mo.y
    const x2 = (x1 + (DD.USERANGE >> 16) * T.finecosine[fa]) | 0
    const y2 = (y1 + (DD.USERANGE >> 16) * T.finesine[fa]) | 0
    PMU.P_PathTraverse(x1, y1, x2, y2, DD.PT_ADDLINES, PTR_UseTraverse)
}

// ---- radius attack ----

let bombsource = null
let bombspot = null
let bombdamage = 0

function PIT_RadiusAttack(thing) {
    if (!(thing.flags & I.MF.MF_SHOOTABLE)) return true
    // bosses take no concussion damage
    if (thing.type === I.MT.MT_CYBORG || thing.type === I.MT.MT_SPIDER)
        return true

    const dx = Math.abs(thing.x - bombspot.x)
    const dy = Math.abs(thing.y - bombspot.y)
    let dist = dx > dy ? dx : dy
    dist = (dist - thing.radius) >> 16
    if (dist < 0) dist = 0
    if (dist >= bombdamage) return true     // out of range

    if (P_CheckSight(thing, bombspot)) {
        PInter.P_DamageMobj(thing, bombspot, bombsource, bombdamage - dist)
    }
    return true
}

function P_RadiusAttack(spot, source, damage) {
    const dist = (damage + DD.MAXRADIUS) << 16
    const yh = (spot.y + dist - L.bmaporgy) >> DD.MAPBLOCKSHIFT
    const yl = (spot.y - dist - L.bmaporgy) >> DD.MAPBLOCKSHIFT
    const xh = (spot.x + dist - L.bmaporgx) >> DD.MAPBLOCKSHIFT
    const xl = (spot.x - dist - L.bmaporgx) >> DD.MAPBLOCKSHIFT
    bombspot = spot
    bombsource = source
    bombdamage = damage

    for (let y = yl; y <= yh; y++)
        for (let x = xl; x <= xh; x++)
            PMU.P_BlockThingsIterator(x, y, PIT_RadiusAttack)
}

// ---- sector height changing ----

let crushchange = false
let nofit = false

function PIT_ChangeSector(thing) {
    if (P_ThingHeightClip(thing)) return true

    // crunch bodies to giblets
    if (thing.health <= 0) {
        PM.P_SetMobjState(thing, I.S.S_GIBS)
        thing.flags &= ~I.MF.MF_SOLID
        thing.height = 0
        thing.radius = 0
        return true
    }

    // crunch dropped items
    if (thing.flags & I.MF.MF_DROPPED) {
        PM.P_RemoveMobj(thing)
        return true
    }

    if (!(thing.flags & I.MF.MF_SHOOTABLE)) return true

    nofit = true
    if (crushchange && !(G.state.leveltime & 3)) {
        PInter.P_DamageMobj(thing, null, null, 10)
        const mo = PM.P_SpawnMobj(thing.x, thing.y,
            (thing.z + ((thing.height / 2) | 0)) | 0, I.MT.MT_BLOOD)
        mo.momx = (P_Random() - P_Random()) << 12
        mo.momy = (P_Random() - P_Random()) << 12
    }
    return true
}

function P_ChangeSector(sector, crunch) {
    nofit = false
    crushchange = crunch
    const bb = L.sec_blockbox
    for (let x = bb[sector * 4 + DD.BOXLEFT]; x <= bb[sector * 4 + DD.BOXRIGHT]; x++)
        for (let y = bb[sector * 4 + DD.BOXBOTTOM]; y <= bb[sector * 4 + DD.BOXTOP]; y++)
            PMU.P_BlockThingsIterator(x, y, PIT_ChangeSector)
    return nofit
}

// ---- p_sight.c: line of sight ----

let sightzstart = 0
const strace = { x: 0, y: 0, dx: 0, dy: 0 }
let t2x = 0, t2y = 0

// 0 = front, 1 = back, 2 = on. Vanilla's `x === node.y` comparison in the
// dy===0 branch is a genuine bug, preserved for demo sync.
function P_DivlineSide(x, y, nx, ny, ndx, ndy) {
    if (ndx === 0) {
        if (x === nx) return 2
        if (x <= nx) return ndy > 0 ? 1 : 0
        return ndy < 0 ? 1 : 0
    }
    if (ndy === 0) {
        if (x === ny) return 2          // vanilla bug: x, not y
        if (y <= ny) return ndx < 0 ? 1 : 0
        return ndx > 0 ? 1 : 0
    }
    const dx = (x - nx) | 0
    const dy = (y - ny) | 0
    const left = Math.imul(ndy >> 16, dx >> 16)
    const right = Math.imul(dy >> 16, ndx >> 16)
    if (right < left) return 0
    if (left === right) return 2
    return 1
}

function P_InterceptVector2(v2, v1x, v1y, v1dx, v1dy) {
    const den = (FixedMul(v1dy >> 8, v2.dx) - FixedMul(v1dx >> 8, v2.dy)) | 0
    if (den === 0) return 0
    const num = (FixedMul((v1x - v2.x) >> 8, v1dy) +
        FixedMul((v2.y - v1y) >> 8, v1dx)) | 0
    return FixedDiv(num, den)
}

function P_CrossSubsector(num) {
    const count0 = L.ssec_numlines[num]
    const first = L.ssec_firstline[num]

    for (let i = 0; i < count0; i++) {
        const seg = first + i
        const line = L.seg_linedef[seg]

        if (L.line_validcount[line] === PMU.getValidcount()) continue
        L.line_validcount[line] = PMU.getValidcount()

        const v1x = L.vertex_x[L.line_v1[line]]
        const v1y = L.vertex_y[L.line_v1[line]]
        const v2x = L.vertex_x[L.line_v2[line]]
        const v2y = L.vertex_y[L.line_v2[line]]
        let s1 = P_DivlineSide(v1x, v1y, strace.x, strace.y, strace.dx, strace.dy)
        let s2 = P_DivlineSide(v2x, v2y, strace.x, strace.y, strace.dx, strace.dy)
        if (s1 === s2) continue            // line isn't crossed

        const divldx = (v2x - v1x) | 0
        const divldy = (v2y - v1y) | 0
        s1 = P_DivlineSide(strace.x, strace.y, v1x, v1y, divldx, divldy)
        s2 = P_DivlineSide(t2x, t2y, v1x, v1y, divldx, divldy)
        if (s1 === s2) continue

        if (!(L.line_flags[line] & DD.ML.TWOSIDED)) return false

        const front = L.seg_frontsector[seg]
        const back = L.seg_backsector[seg]

        // no wall to block sight with?
        if (L.sec_floorheight[front] === L.sec_floorheight[back] &&
            L.sec_ceilingheight[front] === L.sec_ceilingheight[back])
            continue

        const opentop = L.sec_ceilingheight[front] < L.sec_ceilingheight[back]
            ? L.sec_ceilingheight[front] : L.sec_ceilingheight[back]
        const openbottom = L.sec_floorheight[front] > L.sec_floorheight[back]
            ? L.sec_floorheight[front] : L.sec_floorheight[back]

        // totally closed door
        if (openbottom >= opentop) return false

        const frac = P_InterceptVector2(strace, v1x, v1y, divldx, divldy)

        if (L.sec_floorheight[front] !== L.sec_floorheight[back]) {
            const slope = FixedDiv((openbottom - sightzstart) | 0, frac)
            if (slope > bottomslope) bottomslope = slope
        }
        if (L.sec_ceilingheight[front] !== L.sec_ceilingheight[back]) {
            const slope = FixedDiv((opentop - sightzstart) | 0, frac)
            if (slope < topslope) topslope = slope
        }
        if (topslope <= bottomslope) return false
    }
    return true
}

function P_CrossBSPNode(bspnum) {
    const NF = DD.NF_SUBSECTOR
    if (bspnum & NF) {
        if (bspnum === -1) return P_CrossSubsector(0)
        return P_CrossSubsector(bspnum & ~NF)
    }

    const nx = L.node_x[bspnum], ny = L.node_y[bspnum]
    const ndx = L.node_dx[bspnum], ndy = L.node_dy[bspnum]

    let side = P_DivlineSide(strace.x, strace.y, nx, ny, ndx, ndy)
    if (side === 2) side = 0               // "on" crosses both sides

    if (!P_CrossBSPNode(L.node_children[bspnum * 2 + side])) return false

    if (side === P_DivlineSide(t2x, t2y, nx, ny, ndx, ndy))
        return true                        // doesn't touch the other side

    return P_CrossBSPNode(L.node_children[bspnum * 2 + (side ^ 1)])
}

function P_CheckSight(th1, th2) {
    // trivial rejection via REJECT
    const s1 = L.ssec_sector[th1.subsector]
    const s2 = L.ssec_sector[th2.subsector]
    const pnum = s1 * L.numsectors + s2
    if (L.rejectmatrix[pnum >> 3] & (1 << (pnum & 7)))
        return false

    PMU.incValidcount()

    sightzstart = (th1.z + th1.height - (th1.height >> 2)) | 0
    topslope = ((th2.z + th2.height) - sightzstart) | 0
    bottomslope = (th2.z - sightzstart) | 0

    strace.x = th1.x
    strace.y = th1.y
    t2x = th2.x
    t2y = th2.y
    strace.dx = (th2.x - th1.x) | 0
    strace.dy = (th2.y - th1.y) | 0

    return P_CrossBSPNode(L.numnodes - 1)
}

let SFX = null

exports = {
    P_TeleportMove, P_CheckPosition, P_TryMove, P_ThingHeightClip,
    P_SlideMove, P_AimLineAttack, P_LineAttack, P_UseLines,
    P_RadiusAttack, P_ChangeSector, P_CheckSight,
    getFloatok: () => floatok,
    getTmfloorz: () => tmfloorz,
    getTmceilingz: () => tmceilingz,
    getCeilingline: () => ceilingline,
    getLinetarget: () => linetarget,
    getAttackrange: () => attackrange,
    // p_enemy's P_Move consumes spechit like vanilla's `while (numspechit--)`
    getNumspechit: () => numspechit,
    getSpechit: (i) => spechit[i],
    decNumspechit: () => { numspechit--; return numspechit },
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PM = D.p_mobj; PMU = D.p_maputl; RM = D.r_main
        RD = D.r_data; L = D.p_setup.level
        PInter = D.p_inter; PSpec = D.p_spec
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
    },
}
