// p_enemy.mjs -- monster AI and action functions (p_enemy.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Registers all mobj-signature action functions into p_mobj's dispatch
// table. P_Random call order is demo-critical throughout.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PT = null
let PM = null, PMap = null, PMU = null, PMov = null, PS = null
let PInter = null, RM = null, L = null, S = null

const FRACUNIT = 65536
const ANG45 = 0x20000000
const ANG90 = 0x40000000
const ANG180 = 0x80000000
const ANG270 = -0x40000000

function P_Random() { return R.P_Random() }
function FixedMul(a, b) { return T.FixedMul(a, b) }

// dirtype_t
const DI_EAST = 0, DI_NORTHEAST = 1, DI_NORTH = 2, DI_NORTHWEST = 3,
    DI_WEST = 4, DI_SOUTHWEST = 5, DI_SOUTH = 6, DI_SOUTHEAST = 7,
    DI_NODIR = 8

const opposite = [DI_WEST, DI_SOUTHWEST, DI_SOUTH, DI_SOUTHEAST,
    DI_EAST, DI_NORTHEAST, DI_NORTH, DI_NORTHWEST, DI_NODIR]
const diags = [DI_NORTHWEST, DI_NORTHEAST, DI_SOUTHWEST, DI_SOUTHEAST]

const xspeed = new Int32Array([FRACUNIT, 47000, 0, -47000, -FRACUNIT, -47000, 0, 47000])
const yspeed = new Int32Array([0, 47000, FRACUNIT, 47000, 0, -47000, -FRACUNIT, -47000])

// ---- sound propagation ----

let soundtarget = null

function P_RecursiveSound(sec, soundblocks) {
    // wake up all monsters in this sector
    if (L.sec_validcount[sec] === PMU.getValidcount() &&
        L.sec_soundtraversed[sec] <= soundblocks + 1)
        return                  // already flooded

    L.sec_validcount[sec] = PMU.getValidcount()
    L.sec_soundtraversed[sec] = soundblocks + 1
    L.sec_soundtarget[sec] = soundtarget

    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const check = lines[i]
        if (!(L.line_flags[check] & DD.ML.TWOSIDED)) continue

        PMU.P_LineOpening(check)
        if (PMU.opening.openrange <= 0) continue   // closed door

        let other
        if (L.side_sector[L.line_sidenum0[check]] === sec)
            other = L.side_sector[L.line_sidenum1[check]]
        else
            other = L.side_sector[L.line_sidenum0[check]]

        if (L.line_flags[check] & DD.ML.SOUNDBLOCK) {
            if (!soundblocks) P_RecursiveSound(other, 1)
        } else {
            P_RecursiveSound(other, soundblocks)
        }
    }
}

function P_NoiseAlert(target, emmiter) {
    soundtarget = target
    PMU.incValidcount()
    P_RecursiveSound(L.ssec_sector[emmiter.subsector], 0)
}

// ---- attack decisions ----

function P_CheckMeleeRange(actor) {
    if (!actor.target) return false
    const pl = actor.target
    const dist = PMU.P_AproxDistance((pl.x - actor.x) | 0, (pl.y - actor.y) | 0)
    if (dist >= DD.MELEERANGE - 20 * FRACUNIT + I.mobjinfo.radius[pl.type])
        return false
    if (!PMap.P_CheckSight(actor, actor.target)) return false
    return true
}

function P_CheckMissileRange(actor) {
    if (!PMap.P_CheckSight(actor, actor.target)) return false

    if (actor.flags & I.MF.MF_JUSTHIT) {
        // the target just hit the enemy, so fight back!
        actor.flags &= ~I.MF.MF_JUSTHIT
        return true
    }

    if (actor.reactiontime) return false    // do not attack yet

    let dist = (PMU.P_AproxDistance((actor.x - actor.target.x) | 0,
        (actor.y - actor.target.y) | 0) - 64 * FRACUNIT) | 0

    if (!I.mobjinfo.meleestate[actor.type])
        dist = (dist - 128 * FRACUNIT) | 0  // no melee, so fire more

    dist >>= 16

    const MT = I.MT
    if (actor.type === MT.MT_VILE) {
        if (dist > 14 * 64) return false    // too far away
    }
    if (actor.type === MT.MT_UNDEAD) {
        if (dist < 196) return false        // close for fist attack
        dist >>= 1
    }
    if (actor.type === MT.MT_CYBORG || actor.type === MT.MT_SPIDER ||
        actor.type === MT.MT_SKULL) {
        dist >>= 1
    }
    if (dist > 200) dist = 200
    if (actor.type === MT.MT_CYBORG && dist > 160) dist = 160

    if (P_Random() < dist) return false
    return true
}

// ---- movement ----

function P_Move(actor) {
    if (actor.movedir === DI_NODIR) return false

    const speed = I.mobjinfo.speed[actor.type]
    const tryx = (actor.x + speed * xspeed[actor.movedir]) | 0
    const tryy = (actor.y + speed * yspeed[actor.movedir]) | 0

    const try_ok = PMap.P_TryMove(actor, tryx, tryy)

    if (!try_ok) {
        // open any specials
        if ((actor.flags & I.MF.MF_FLOAT) && PMap.getFloatok()) {
            // must adjust height
            if (actor.z < PMap.getTmfloorz())
                actor.z = (actor.z + DD.FLOATSPEED) | 0
            else
                actor.z = (actor.z - DD.FLOATSPEED) | 0
            actor.flags |= I.MF.MF_INFLOAT
            return true
        }

        if (!PMap.getNumspechit()) return false

        actor.movedir = DI_NODIR
        let good = false
        let n
        while ((n = PMap.decNumspechit()) >= 0) {
            const ld = PMap.getSpechit(n)
            // if the special is not a door that can be opened, return false
            if (PS.P_UseSpecialLine(actor, ld, 0)) good = true
        }
        return good
    } else {
        actor.flags &= ~I.MF.MF_INFLOAT
    }

    if (!(actor.flags & I.MF.MF_FLOAT))
        actor.z = actor.floorz
    return true
}

function P_TryWalk(actor) {
    if (!P_Move(actor)) return false
    actor.movecount = P_Random() & 15
    return true
}

function P_NewChaseDir(actor) {
    if (!actor.target) throw Error("P_NewChaseDir: called with no target")

    const olddir = actor.movedir
    const turnaround = opposite[olddir]

    const deltax = (actor.target.x - actor.x) | 0
    const deltay = (actor.target.y - actor.y) | 0

    const d = [0, 0, 0]
    if (deltax > 10 * FRACUNIT) d[1] = DI_EAST
    else if (deltax < -10 * FRACUNIT) d[1] = DI_WEST
    else d[1] = DI_NODIR

    if (deltay < -10 * FRACUNIT) d[2] = DI_SOUTH
    else if (deltay > 10 * FRACUNIT) d[2] = DI_NORTH
    else d[2] = DI_NODIR

    // try direct route
    if (d[1] !== DI_NODIR && d[2] !== DI_NODIR) {
        actor.movedir = diags[((deltay < 0 ? 1 : 0) << 1) + (deltax > 0 ? 1 : 0)]
        if (actor.movedir !== turnaround && P_TryWalk(actor)) return
    }

    // try other directions
    if (P_Random() > 200 || Math.abs(deltay) > Math.abs(deltax)) {
        const tdir = d[1]
        d[1] = d[2]
        d[2] = tdir
    }

    if (d[1] === turnaround) d[1] = DI_NODIR
    if (d[2] === turnaround) d[2] = DI_NODIR

    if (d[1] !== DI_NODIR) {
        actor.movedir = d[1]
        if (P_TryWalk(actor)) return    // either moved forward or attacked
    }
    if (d[2] !== DI_NODIR) {
        actor.movedir = d[2]
        if (P_TryWalk(actor)) return
    }

    // no direct path to the player: pick another direction
    if (olddir !== DI_NODIR) {
        actor.movedir = olddir
        if (P_TryWalk(actor)) return
    }

    // randomly determine direction of search
    if (P_Random() & 1) {
        for (let tdir = DI_EAST; tdir <= DI_SOUTHEAST; tdir++) {
            if (tdir !== turnaround) {
                actor.movedir = tdir
                if (P_TryWalk(actor)) return
            }
        }
    } else {
        for (let tdir = DI_SOUTHEAST; tdir !== DI_EAST - 1; tdir--) {
            if (tdir !== turnaround) {
                actor.movedir = tdir
                if (P_TryWalk(actor)) return
            }
        }
    }

    if (turnaround !== DI_NODIR) {
        actor.movedir = turnaround
        if (P_TryWalk(actor)) return
    }

    actor.movedir = DI_NODIR    // cannot move
}

function P_LookForPlayers(actor, allaround) {
    const st = G.state
    let c = 0
    const stop = (actor.lastlook - 1) & 3

    for (; ; actor.lastlook = (actor.lastlook + 1) & 3) {
        if (!st.playeringame[actor.lastlook]) continue

        if (c++ === 2 || actor.lastlook === stop)
            return false        // done looking

        const player = st.players[actor.lastlook]
        if (player.health <= 0) continue            // dead
        if (!PMap.P_CheckSight(actor, player.mo)) continue  // out of sight

        if (!allaround) {
            const an = (RM.R_PointToAngle2(actor.x, actor.y,
                player.mo.x, player.mo.y) - actor.angle) >>> 0
            if (an > ANG90 && an < (ANG270 >>> 0)) {
                const dist = PMU.P_AproxDistance(
                    (player.mo.x - actor.x) | 0, (player.mo.y - actor.y) | 0)
                // if real close, react anyway
                if (dist > DD.MELEERANGE) continue  // behind back
            }
        }

        actor.target = player.mo
        return true
    }
}

// ---- action routines ----

function A_KeenDie(mo) {
    A_Fall(mo)
    // see if all Keens are dead
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc !== PM.P_MobjThinker) continue
        if (th !== mo && th.type === mo.type && th.health > 0)
            return              // other Keen not dead
    }
    PMov.EV_DoDoor(makeJunkLine(666), PMov.DOOR.open)
}

// some actions trigger movers by tag with a fake line (vanilla stack
// `line_t junk`); the movers only read tag/special/sidenum0/frontsector,
// so a scratch slot is appended past numlines. Level loads rebuild the
// arrays, so re-grow whenever the slot is missing.
function makeJunkLine(tag) {
    if (L.line_tag.length <= L.numlines) ensureJunkSlot()
    const junkLine = L.numlines
    L.line_tag[junkLine] = tag
    return junkLine
}

function ensureJunkSlot() {
    // grow the per-line arrays the movers read by one scratch entry
    const n = L.numlines
    const grow = (arr) => {
        const na = new arr.constructor(arr.length + 1)
        na.set(arr)
        return na
    }
    L.line_tag = grow(L.line_tag)
    L.line_special = grow(L.line_special)
    L.line_sidenum0 = grow(L.line_sidenum0)
    L.line_frontsector = grow(L.line_frontsector)
    return n
}

function A_Look(actor) {
    actor.threshold = 0         // any shot will wake up
    const targ = L.sec_soundtarget[L.ssec_sector[actor.subsector]]

    let seeyou = false
    if (targ && (targ.flags & I.MF.MF_SHOOTABLE)) {
        actor.target = targ
        if (actor.flags & I.MF.MF_AMBUSH) {
            if (PMap.P_CheckSight(actor, actor.target)) seeyou = true
        } else {
            seeyou = true
        }
    }

    if (!seeyou) {
        if (!P_LookForPlayers(actor, false)) return
    }

    // go into chase state
    const seesound = I.mobjinfo.seesound[actor.type]
    if (seesound) {
        let sound
        const sfx = SFX
        switch (seesound) {
            case sfx.sfx_posit1:
            case sfx.sfx_posit2:
            case sfx.sfx_posit3:
                sound = sfx.sfx_posit1 + P_Random() % 3
                break
            case sfx.sfx_bgsit1:
            case sfx.sfx_bgsit2:
                sound = sfx.sfx_bgsit1 + P_Random() % 2
                break
            default:
                sound = seesound
                break
        }
        if (actor.type === I.MT.MT_SPIDER || actor.type === I.MT.MT_CYBORG)
            S.StartSound(null, sound)       // full volume
        else
            S.StartSound(actor, sound)
    }

    PM.P_SetMobjState(actor, I.mobjinfo.seestate[actor.type])
}

function A_Chase(actor) {
    if (actor.reactiontime) actor.reactiontime--

    // modify target threshold
    if (actor.threshold) {
        if (!actor.target || actor.target.health <= 0)
            actor.threshold = 0
        else
            actor.threshold--
    }

    // turn towards movement direction if not there yet
    if (actor.movedir < 8) {
        actor.angle = actor.angle & (7 << 29)
        const delta = (actor.angle - (actor.movedir << 29)) | 0
        if (delta > 0) actor.angle = (actor.angle - ANG90 / 2) | 0
        else if (delta < 0) actor.angle = (actor.angle + ANG90 / 2) | 0
    }

    if (!actor.target || !(actor.target.flags & I.MF.MF_SHOOTABLE)) {
        // look for a new target
        if (P_LookForPlayers(actor, true)) return
        PM.P_SetMobjState(actor, I.mobjinfo.spawnstate[actor.type])
        return
    }

    // do not attack twice in a row
    if (actor.flags & I.MF.MF_JUSTATTACKED) {
        actor.flags &= ~I.MF.MF_JUSTATTACKED
        if (G.state.gameskill !== DD.Skill.nightmare && !G.state.fastparm)
            P_NewChaseDir(actor)
        return
    }

    // melee attack
    if (I.mobjinfo.meleestate[actor.type] && P_CheckMeleeRange(actor)) {
        if (I.mobjinfo.attacksound[actor.type])
            S.StartSound(actor, I.mobjinfo.attacksound[actor.type])
        PM.P_SetMobjState(actor, I.mobjinfo.meleestate[actor.type])
        return
    }

    // missile attack
    let nomissile = false
    if (I.mobjinfo.missilestate[actor.type]) {
        if (G.state.gameskill < DD.Skill.nightmare &&
            !G.state.fastparm && actor.movecount) {
            nomissile = true
        } else if (!P_CheckMissileRange(actor)) {
            nomissile = true
        }
        if (!nomissile) {
            PM.P_SetMobjState(actor, I.mobjinfo.missilestate[actor.type])
            actor.flags |= I.MF.MF_JUSTATTACKED
            return
        }
    }

    // possibly choose another target
    if (G.state.netgame && !actor.threshold &&
        !PMap.P_CheckSight(actor, actor.target)) {
        if (P_LookForPlayers(actor, true)) return
    }

    // chase towards player
    if (--actor.movecount < 0 || !P_Move(actor))
        P_NewChaseDir(actor)

    // make active sound
    if (I.mobjinfo.activesound[actor.type] && P_Random() < 3)
        S.StartSound(actor, I.mobjinfo.activesound[actor.type])
}

function A_FaceTarget(actor) {
    if (!actor.target) return
    actor.flags &= ~I.MF.MF_AMBUSH
    actor.angle = RM.R_PointToAngle2(actor.x, actor.y,
        actor.target.x, actor.target.y) | 0
    if (actor.target.flags & I.MF.MF_SHADOW)
        actor.angle = (actor.angle + ((P_Random() - P_Random()) << 21)) | 0
}

function A_PosAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    let angle = actor.angle
    const slope = PMap.P_AimLineAttack(actor, angle >>> 0, DD.MISSILERANGE)
    S.StartSound(actor, SFX.sfx_pistol)
    angle = (angle + ((P_Random() - P_Random()) << 20)) | 0
    const damage = ((P_Random() % 5) + 1) * 3
    PMap.P_LineAttack(actor, angle >>> 0, DD.MISSILERANGE, slope, damage)
}

function A_SPosAttack(actor) {
    if (!actor.target) return
    S.StartSound(actor, SFX.sfx_shotgn)
    A_FaceTarget(actor)
    const bangle = actor.angle
    const slope = PMap.P_AimLineAttack(actor, bangle >>> 0, DD.MISSILERANGE)
    for (let i = 0; i < 3; i++) {
        const angle = (bangle + ((P_Random() - P_Random()) << 20)) | 0
        const damage = ((P_Random() % 5) + 1) * 3
        PMap.P_LineAttack(actor, angle >>> 0, DD.MISSILERANGE, slope, damage)
    }
}

function A_CPosAttack(actor) {
    if (!actor.target) return
    S.StartSound(actor, SFX.sfx_shotgn)
    A_FaceTarget(actor)
    const bangle = actor.angle
    const slope = PMap.P_AimLineAttack(actor, bangle >>> 0, DD.MISSILERANGE)
    const angle = (bangle + ((P_Random() - P_Random()) << 20)) | 0
    const damage = ((P_Random() % 5) + 1) * 3
    PMap.P_LineAttack(actor, angle >>> 0, DD.MISSILERANGE, slope, damage)
}

function A_CPosRefire(actor) {
    // keep firing unless target got out of sight
    A_FaceTarget(actor)
    if (P_Random() < 40) return
    if (!actor.target || actor.target.health <= 0 ||
        !PMap.P_CheckSight(actor, actor.target)) {
        PM.P_SetMobjState(actor, I.mobjinfo.seestate[actor.type])
    }
}

function A_SpidRefire(actor) {
    A_FaceTarget(actor)
    if (P_Random() < 10) return
    if (!actor.target || actor.target.health <= 0 ||
        !PMap.P_CheckSight(actor, actor.target)) {
        PM.P_SetMobjState(actor, I.mobjinfo.seestate[actor.type])
    }
}

function A_BspiAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_ARACHPLAZ)
}

function A_TroopAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    if (P_CheckMeleeRange(actor)) {
        S.StartSound(actor, SFX.sfx_claw)
        const damage = (P_Random() % 8 + 1) * 3
        PInter.P_DamageMobj(actor.target, actor, actor, damage)
        return
    }
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_TROOPSHOT)
}

function A_SargAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    if (P_CheckMeleeRange(actor)) {
        const damage = ((P_Random() % 10) + 1) * 4
        PInter.P_DamageMobj(actor.target, actor, actor, damage)
    }
}

function A_HeadAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    if (P_CheckMeleeRange(actor)) {
        const damage = (P_Random() % 6 + 1) * 10
        PInter.P_DamageMobj(actor.target, actor, actor, damage)
        return
    }
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_HEADSHOT)
}

function A_CyberAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_ROCKET)
}

function A_BruisAttack(actor) {
    if (!actor.target) return
    if (P_CheckMeleeRange(actor)) {
        S.StartSound(actor, SFX.sfx_claw)
        const damage = (P_Random() % 8 + 1) * 10
        PInter.P_DamageMobj(actor.target, actor, actor, damage)
        return
    }
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_BRUISERSHOT)
}

function A_SkelMissile(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    actor.z = (actor.z + 16 * FRACUNIT) | 0     // missile spawns higher
    const mo = PM.P_SpawnMissile(actor, actor.target, I.MT.MT_TRACER)
    actor.z = (actor.z - 16 * FRACUNIT) | 0
    mo.x = (mo.x + mo.momx) | 0
    mo.y = (mo.y + mo.momy) | 0
    mo.tracer = actor.target
}

const TRACEANGLE = 0xc000000

function A_Tracer(actor) {
    if (G.state.gametic & 3) return

    // smoke trail
    PM.P_SpawnPuff(actor.x, actor.y, actor.z)
    const th = PM.P_SpawnMobj((actor.x - actor.momx) | 0,
        (actor.y - actor.momy) | 0, actor.z, I.MT.MT_SMOKE)
    th.momz = FRACUNIT
    th.tics -= P_Random() & 3
    if (th.tics < 1) th.tics = 1

    const dest = actor.tracer
    if (!dest || dest.health <= 0) return

    // change angle
    const exact = RM.R_PointToAngle2(actor.x, actor.y, dest.x, dest.y)
    if (exact !== (actor.angle >>> 0)) {
        if (((exact - actor.angle) >>> 0) > 0x80000000) {
            actor.angle = (actor.angle - TRACEANGLE) | 0
            if (((exact - actor.angle) >>> 0) < 0x80000000)
                actor.angle = exact | 0
        } else {
            actor.angle = (actor.angle + TRACEANGLE) | 0
            if (((exact - actor.angle) >>> 0) > 0x80000000)
                actor.angle = exact | 0
        }
    }

    let fa = (actor.angle >>> 19) & 8191
    const speed = I.mobjinfo.speed[actor.type]
    actor.momx = FixedMul(speed, T.finecosine[fa])
    actor.momy = FixedMul(speed, T.finesine[fa])

    // change slope
    let dist = PMU.P_AproxDistance((dest.x - actor.x) | 0, (dest.y - actor.y) | 0)
    dist = (dist / speed) | 0
    if (dist < 1) dist = 1
    const slope = ((dest.z + 40 * FRACUNIT - actor.z) / dist) | 0
    if (slope < actor.momz) actor.momz = (actor.momz - FRACUNIT / 8) | 0
    else actor.momz = (actor.momz + FRACUNIT / 8) | 0
}

function A_SkelWhoosh(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    S.StartSound(actor, SFX.sfx_skeswg)
}

function A_SkelFist(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    if (P_CheckMeleeRange(actor)) {
        const damage = ((P_Random() % 10) + 1) * 6
        S.StartSound(actor, SFX.sfx_skepch)
        PInter.P_DamageMobj(actor.target, actor, actor, damage)
    }
}

// ---- arch-vile ----

let corpsehit = null
let viletryx = 0, viletryy = 0

function PIT_VileCheck(thing) {
    if (!(thing.flags & I.MF.MF_CORPSE)) return true   // not a monster
    if (thing.tics !== -1) return true                 // not lying still yet
    if (I.mobjinfo.raisestate[thing.type] === I.S.S_NULL)
        return true                                    // no raise state

    const maxdist = (I.mobjinfo.radius[thing.type] +
        I.mobjinfo.radius[I.MT.MT_VILE]) | 0
    if (Math.abs(thing.x - viletryx) > maxdist ||
        Math.abs(thing.y - viletryy) > maxdist)
        return true                                    // not touching

    corpsehit = thing
    corpsehit.momx = corpsehit.momy = 0
    corpsehit.height <<= 2
    const check = PMap.P_CheckPosition(corpsehit, corpsehit.x, corpsehit.y)
    corpsehit.height >>= 2

    if (!check) return true                            // doesn't fit here
    return false                                       // got one
}

function A_VileChase(actor) {
    if (actor.movedir !== DI_NODIR) {
        // check for corpses to raise
        const speed = I.mobjinfo.speed[actor.type]
        viletryx = (actor.x + speed * xspeed[actor.movedir]) | 0
        viletryy = (actor.y + speed * yspeed[actor.movedir]) | 0

        const xl = (viletryx - L.bmaporgx - DD.MAXRADIUS * 2) >> DD.MAPBLOCKSHIFT
        const xh = (viletryx - L.bmaporgx + DD.MAXRADIUS * 2) >> DD.MAPBLOCKSHIFT
        const yl = (viletryy - L.bmaporgy - DD.MAXRADIUS * 2) >> DD.MAPBLOCKSHIFT
        const yh = (viletryy - L.bmaporgy + DD.MAXRADIUS * 2) >> DD.MAPBLOCKSHIFT

        for (let bx = xl; bx <= xh; bx++) {
            for (let by = yl; by <= yh; by++) {
                if (!PMU.P_BlockThingsIterator(bx, by, PIT_VileCheck)) {
                    // got one!
                    const temp = actor.target
                    actor.target = corpsehit
                    A_FaceTarget(actor)
                    actor.target = temp

                    PM.P_SetMobjState(actor, I.S.S_VILE_HEAL1)
                    S.StartSound(corpsehit, SFX.sfx_slop)

                    PM.P_SetMobjState(corpsehit,
                        I.mobjinfo.raisestate[corpsehit.type])
                    corpsehit.height <<= 2
                    corpsehit.flags = I.mobjinfo.flags[corpsehit.type]
                    corpsehit.health = I.mobjinfo.spawnhealth[corpsehit.type]
                    corpsehit.target = null
                    return
                }
            }
        }
    }
    A_Chase(actor)
}

function A_VileStart(actor) { S.StartSound(actor, SFX.sfx_vilatk) }

function A_StartFire(actor) {
    S.StartSound(actor, SFX.sfx_flamst)
    A_Fire(actor)
}

function A_FireCrackle(actor) {
    S.StartSound(actor, SFX.sfx_flame)
    A_Fire(actor)
}

function A_Fire(actor) {
    const dest = actor.tracer
    if (!dest) return
    // don't move it if the vile lost sight
    if (!PMap.P_CheckSight(actor.target, dest)) return

    const an = (dest.angle >>> 19) & 8191
    PMU.P_UnsetThingPosition(actor)
    actor.x = (dest.x + FixedMul(24 * FRACUNIT, T.finecosine[an])) | 0
    actor.y = (dest.y + FixedMul(24 * FRACUNIT, T.finesine[an])) | 0
    actor.z = dest.z
    PMU.P_SetThingPosition(actor)
}

function A_VileTarget(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    // vanilla bug preserved: fog spawned at (target->x, target->x)
    const fog = PM.P_SpawnMobj(actor.target.x, actor.target.x,
        actor.target.z, I.MT.MT_FIRE)
    actor.tracer = fog
    fog.target = actor
    fog.tracer = actor.target
    A_Fire(fog)
}

function A_VileAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    if (!PMap.P_CheckSight(actor, actor.target)) return

    S.StartSound(actor, SFX.sfx_barexp)
    PInter.P_DamageMobj(actor.target, actor, actor, 20)
    actor.target.momz =
        ((1000 * FRACUNIT) / I.mobjinfo.mass[actor.target.type]) | 0

    const an = (actor.angle >>> 19) & 8191
    const fire = actor.tracer
    if (!fire) return

    // move the fire between the vile and the player
    fire.x = (actor.target.x - FixedMul(24 * FRACUNIT, T.finecosine[an])) | 0
    fire.y = (actor.target.y - FixedMul(24 * FRACUNIT, T.finesine[an])) | 0
    PMap.P_RadiusAttack(fire, actor, 70)
}

// ---- mancubus ----

const FATSPREAD = ANG90 / 8

function A_FatRaise(actor) {
    A_FaceTarget(actor)
    S.StartSound(actor, SFX.sfx_manatk)
}

function A_FatAttack1(actor) {
    A_FaceTarget(actor)
    actor.angle = (actor.angle + FATSPREAD) | 0
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    const mo = PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    mo.angle = (mo.angle + FATSPREAD) | 0
    const an = (mo.angle >>> 19) & 8191
    const speed = I.mobjinfo.speed[mo.type]
    mo.momx = FixedMul(speed, T.finecosine[an])
    mo.momy = FixedMul(speed, T.finesine[an])
}

function A_FatAttack2(actor) {
    A_FaceTarget(actor)
    actor.angle = (actor.angle - FATSPREAD) | 0
    PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    const mo = PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    mo.angle = (mo.angle - FATSPREAD * 2) | 0
    const an = (mo.angle >>> 19) & 8191
    const speed = I.mobjinfo.speed[mo.type]
    mo.momx = FixedMul(speed, T.finecosine[an])
    mo.momy = FixedMul(speed, T.finesine[an])
}

function A_FatAttack3(actor) {
    A_FaceTarget(actor)
    let mo = PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    mo.angle = (mo.angle - FATSPREAD / 2) | 0
    let an = (mo.angle >>> 19) & 8191
    let speed = I.mobjinfo.speed[mo.type]
    mo.momx = FixedMul(speed, T.finecosine[an])
    mo.momy = FixedMul(speed, T.finesine[an])

    mo = PM.P_SpawnMissile(actor, actor.target, I.MT.MT_FATSHOT)
    mo.angle = (mo.angle + FATSPREAD / 2) | 0
    an = (mo.angle >>> 19) & 8191
    speed = I.mobjinfo.speed[mo.type]
    mo.momx = FixedMul(speed, T.finecosine[an])
    mo.momy = FixedMul(speed, T.finesine[an])
}

// ---- lost soul / pain elemental ----

const SKULLSPEED = 20 * FRACUNIT

function A_SkullAttack(actor) {
    if (!actor.target) return
    const dest = actor.target
    actor.flags |= I.MF.MF_SKULLFLY

    S.StartSound(actor, I.mobjinfo.attacksound[actor.type])
    A_FaceTarget(actor)
    const an = (actor.angle >>> 19) & 8191
    actor.momx = FixedMul(SKULLSPEED, T.finecosine[an])
    actor.momy = FixedMul(SKULLSPEED, T.finesine[an])
    let dist = PMU.P_AproxDistance((dest.x - actor.x) | 0, (dest.y - actor.y) | 0)
    dist = (dist / SKULLSPEED) | 0
    if (dist < 1) dist = 1
    actor.momz = ((dest.z + (dest.height >> 1) - actor.z) / dist) | 0
}

function A_PainShootSkull(actor, angle) {
    // count skulls on level
    let count = 0
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc === PM.P_MobjThinker && th.type === I.MT.MT_SKULL)
            count++
    }
    if (count > 20) return      // 20 skulls already

    const an = (angle >>> 19) & 8191
    const prestep = (4 * FRACUNIT + ((3 * (I.mobjinfo.radius[actor.type] +
        I.mobjinfo.radius[I.MT.MT_SKULL]) / 2) | 0)) | 0
    const x = (actor.x + FixedMul(prestep, T.finecosine[an])) | 0
    const y = (actor.y + FixedMul(prestep, T.finesine[an])) | 0
    const z = (actor.z + 8 * FRACUNIT) | 0

    const newmobj = PM.P_SpawnMobj(x, y, z, I.MT.MT_SKULL)

    if (!PMap.P_TryMove(newmobj, newmobj.x, newmobj.y)) {
        // kill it immediately
        PInter.P_DamageMobj(newmobj, actor, actor, 10000)
        return
    }
    newmobj.target = actor.target
    A_SkullAttack(newmobj)
}

function A_PainAttack(actor) {
    if (!actor.target) return
    A_FaceTarget(actor)
    A_PainShootSkull(actor, actor.angle >>> 0)
}

function A_PainDie(actor) {
    A_Fall(actor)
    A_PainShootSkull(actor, (actor.angle + ANG90) >>> 0)
    A_PainShootSkull(actor, (actor.angle + ANG180) >>> 0)
    A_PainShootSkull(actor, (actor.angle + ANG90 * 3) >>> 0)
}

// ---- death / misc ----

function A_Scream(actor) {
    const deathsound = I.mobjinfo.deathsound[actor.type]
    let sound
    switch (deathsound) {
        case 0: return
        case SFX.sfx_podth1:
        case SFX.sfx_podth2:
        case SFX.sfx_podth3:
            sound = SFX.sfx_podth1 + P_Random() % 3
            break
        case SFX.sfx_bgdth1:
        case SFX.sfx_bgdth2:
            sound = SFX.sfx_bgdth1 + P_Random() % 2
            break
        default:
            sound = deathsound
            break
    }
    if (actor.type === I.MT.MT_SPIDER || actor.type === I.MT.MT_CYBORG)
        S.StartSound(null, sound)       // full volume
    else
        S.StartSound(actor, sound)
}

function A_XScream(actor) { S.StartSound(actor, SFX.sfx_slop) }

function A_Pain(actor) {
    if (I.mobjinfo.painsound[actor.type])
        S.StartSound(actor, I.mobjinfo.painsound[actor.type])
}

function A_Fall(actor) {
    // actor is on ground, it can be walked over
    actor.flags &= ~I.MF.MF_SOLID
}

function A_Explode(thingy) {
    PMap.P_RadiusAttack(thingy, thingy.target, 128)
}

function A_BossDeath(mo) {
    const st = G.state
    const MT = I.MT

    if (st.gamemode === DD.GameMode.commercial) {
        if (st.gamemap !== 7) return
        if (mo.type !== MT.MT_FATSO && mo.type !== MT.MT_BABY) return
    } else {
        switch (st.gameepisode) {
            case 1:
                if (st.gamemap !== 8) return
                if (mo.type !== MT.MT_BRUISER) return
                break
            case 2:
                if (st.gamemap !== 8) return
                if (mo.type !== MT.MT_CYBORG) return
                break
            case 3:
                if (st.gamemap !== 8) return
                if (mo.type !== MT.MT_SPIDER) return
                break
            case 4:
                switch (st.gamemap) {
                    case 6:
                        if (mo.type !== MT.MT_CYBORG) return
                        break
                    case 8:
                        if (mo.type !== MT.MT_SPIDER) return
                        break
                    default:
                        return
                }
                break
            default:
                if (st.gamemap !== 8) return
                break
        }
    }

    // a player must be alive for victory
    let i
    for (i = 0; i < DD.MAXPLAYERS; i++)
        if (st.playeringame[i] && st.players[i].health > 0) break
    if (i === DD.MAXPLAYERS) return

    // all bosses dead?
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc !== PM.P_MobjThinker) continue
        if (th !== mo && th.type === mo.type && th.health > 0)
            return              // other boss not dead
    }

    // victory!
    if (st.gamemode === DD.GameMode.commercial) {
        if (st.gamemap === 7) {
            if (mo.type === MT.MT_FATSO) {
                PMov.EV_DoFloor(makeJunkLine(666), PMov.F.lowerFloorToLowest)
                return
            }
            if (mo.type === MT.MT_BABY) {
                PMov.EV_DoFloor(makeJunkLine(667), PMov.F.raiseToTexture)
                return
            }
        }
    } else {
        switch (st.gameepisode) {
            case 1:
                PMov.EV_DoFloor(makeJunkLine(666), PMov.F.lowerFloorToLowest)
                return
            case 4:
                if (st.gamemap === 6) {
                    PMov.EV_DoDoor(makeJunkLine(666), PMov.DOOR.blazeOpen)
                    return
                }
                if (st.gamemap === 8) {
                    PMov.EV_DoFloor(makeJunkLine(666), PMov.F.lowerFloorToLowest)
                    return
                }
        }
    }

    G.G_ExitLevel()
}

function A_Hoof(mo) {
    S.StartSound(mo, SFX.sfx_hoof)
    A_Chase(mo)
}

function A_Metal(mo) {
    S.StartSound(mo, SFX.sfx_metal)
    A_Chase(mo)
}

function A_BabyMetal(mo) {
    S.StartSound(mo, SFX.sfx_bspwlk)
    A_Chase(mo)
}

// ---- boss brain (DOOM2) ----

const braintargets = []
let numbraintargets = 0
let braintargeton = 0
let brainEasy = 0               // vanilla static

function A_BrainAwake(mo) {
    numbraintargets = 0
    braintargeton = 0
    braintargets.length = 0
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc !== PM.P_MobjThinker) continue
        if (th.type === I.MT.MT_BOSSTARGET) {
            braintargets.push(th)
            numbraintargets++
        }
    }
    S.StartSound(null, SFX.sfx_bossit)
}

function A_BrainPain(mo) { S.StartSound(null, SFX.sfx_bospn) }

function A_BrainScream(mo) {
    for (let x = mo.x - 196 * FRACUNIT; x < mo.x + 320 * FRACUNIT;
        x += FRACUNIT * 8) {
        const y = (mo.y - 320 * FRACUNIT) | 0
        const z = (128 + P_Random() * 2 * FRACUNIT) | 0
        const th = PM.P_SpawnMobj(x | 0, y, z, I.MT.MT_ROCKET)
        th.momz = P_Random() * 512
        PM.P_SetMobjState(th, I.S.S_BRAINEXPLODE1)
        th.tics -= P_Random() & 7
        if (th.tics < 1) th.tics = 1
    }
    S.StartSound(null, SFX.sfx_bosdth)
}

function A_BrainExplode(mo) {
    const x = (mo.x + (P_Random() - P_Random()) * 2048) | 0
    const y = mo.y
    const z = (128 + P_Random() * 2 * FRACUNIT) | 0
    const th = PM.P_SpawnMobj(x, y, z, I.MT.MT_ROCKET)
    th.momz = P_Random() * 512
    PM.P_SetMobjState(th, I.S.S_BRAINEXPLODE1)
    th.tics -= P_Random() & 7
    if (th.tics < 1) th.tics = 1
}

function A_BrainDie(mo) { G.G_ExitLevel() }

function A_BrainSpit(mo) {
    brainEasy ^= 1
    if (G.state.gameskill <= DD.Skill.easy && !brainEasy) return

    // shoot a cube at the current target
    const targ = braintargets[braintargeton]
    braintargeton = (braintargeton + 1) % numbraintargets

    const newmobj = PM.P_SpawnMissile(mo, targ, I.MT.MT_SPAWNSHOT)
    newmobj.target = targ
    newmobj.reactiontime =
        ((((targ.y - mo.y) / newmobj.momy) | 0) /
            I.stateTics[newmobj.state]) | 0
    S.StartSound(null, SFX.sfx_bospit)
}

function A_SpawnSound(mo) {
    S.StartSound(mo, SFX.sfx_boscub)
    A_SpawnFly(mo)
}

function A_SpawnFly(mo) {
    if (--mo.reactiontime) return       // still flying

    const targ = mo.target
    const MT = I.MT

    // teleport fog
    const fog = PM.P_SpawnMobj(targ.x, targ.y, targ.z, MT.MT_SPAWNFIRE)
    S.StartSound(fog, SFX.sfx_telept)

    // randomly select monster to spawn
    const r = P_Random()
    let type
    if (r < 50) type = MT.MT_TROOP
    else if (r < 90) type = MT.MT_SERGEANT
    else if (r < 120) type = MT.MT_SHADOWS
    else if (r < 130) type = MT.MT_PAIN
    else if (r < 160) type = MT.MT_HEAD
    else if (r < 162) type = MT.MT_VILE
    else if (r < 172) type = MT.MT_UNDEAD
    else if (r < 192) type = MT.MT_BABY
    else if (r < 222) type = MT.MT_FATSO
    else if (r < 246) type = MT.MT_KNIGHT
    else type = MT.MT_BRUISER

    const newmobj = PM.P_SpawnMobj(targ.x, targ.y, targ.z, type)
    if (P_LookForPlayers(newmobj, true))
        PM.P_SetMobjState(newmobj, I.mobjinfo.seestate[type])

    // telefrag anything in this spot
    PMap.P_TeleportMove(newmobj, newmobj.x, newmobj.y)

    // remove self (the cube)
    PM.P_RemoveMobj(mo)
}

function A_PlayerScream(mo) {
    let sound = SFX.sfx_pldeth
    if (G.state.gamemode === DD.GameMode.commercial && mo.health < -50)
        sound = SFX.sfx_pdiehi
    S.StartSound(mo, sound)
}

let SFX = null

exports = {
    P_NoiseAlert, P_CheckMeleeRange, P_CheckMissileRange,
    P_Move, P_TryWalk, P_NewChaseDir, P_LookForPlayers,
    A_Chase, A_FaceTarget, A_Fall,
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PT = D.p_tick; PM = D.p_mobj; PMap = D.p_map
        PMU = D.p_maputl; PMov = D.p_movers; PS = D.p_spec
        PInter = D.p_inter; RM = D.r_main; L = D.p_setup.level
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx

        // register every mobj-signature action
        const reg = PM.registerAction
        reg("A_Look", A_Look); reg("A_Chase", A_Chase)
        reg("A_FaceTarget", A_FaceTarget); reg("A_PosAttack", A_PosAttack)
        reg("A_SPosAttack", A_SPosAttack); reg("A_CPosAttack", A_CPosAttack)
        reg("A_CPosRefire", A_CPosRefire); reg("A_SpidRefire", A_SpidRefire)
        reg("A_BspiAttack", A_BspiAttack); reg("A_TroopAttack", A_TroopAttack)
        reg("A_SargAttack", A_SargAttack); reg("A_HeadAttack", A_HeadAttack)
        reg("A_CyberAttack", A_CyberAttack); reg("A_BruisAttack", A_BruisAttack)
        reg("A_SkelMissile", A_SkelMissile); reg("A_Tracer", A_Tracer)
        reg("A_SkelWhoosh", A_SkelWhoosh); reg("A_SkelFist", A_SkelFist)
        reg("A_VileChase", A_VileChase); reg("A_VileStart", A_VileStart)
        reg("A_StartFire", A_StartFire); reg("A_FireCrackle", A_FireCrackle)
        reg("A_Fire", A_Fire); reg("A_VileTarget", A_VileTarget)
        reg("A_VileAttack", A_VileAttack); reg("A_FatRaise", A_FatRaise)
        reg("A_FatAttack1", A_FatAttack1); reg("A_FatAttack2", A_FatAttack2)
        reg("A_FatAttack3", A_FatAttack3); reg("A_SkullAttack", A_SkullAttack)
        reg("A_PainAttack", A_PainAttack); reg("A_PainDie", A_PainDie)
        reg("A_Scream", A_Scream); reg("A_XScream", A_XScream)
        reg("A_Pain", A_Pain); reg("A_Fall", A_Fall)
        reg("A_Explode", A_Explode); reg("A_BossDeath", A_BossDeath)
        reg("A_Hoof", A_Hoof); reg("A_Metal", A_Metal)
        reg("A_BabyMetal", A_BabyMetal); reg("A_KeenDie", A_KeenDie)
        reg("A_BrainAwake", A_BrainAwake); reg("A_BrainPain", A_BrainPain)
        reg("A_BrainScream", A_BrainScream); reg("A_BrainExplode", A_BrainExplode)
        reg("A_BrainDie", A_BrainDie); reg("A_BrainSpit", A_BrainSpit)
        reg("A_SpawnSound", A_SpawnSound); reg("A_SpawnFly", A_SpawnFly)
        reg("A_PlayerScream", A_PlayerScream)
    },
}
