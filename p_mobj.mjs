// p_mobj.mjs -- map object (mobj) engine (p_mobj.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Mobjs are JS objects with embedded thinker fields; cross-references hold
// object refs (target/tracer/player), level geometry is referenced by
// index. P_Random call order matches vanilla exactly (demo-critical).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PT = null
let PMap = null, PMU = null, RM = null, L = null, S = null

const FRACUNIT = 65536
const STOPSPEED = 0x1000
const FRICTION = 0xe800
const ANG45 = 0x20000000

function P_Random() { return R.P_Random() }

// ---- mobj factory ----

function makeMobjShell() {
    return {
        // thinker
        prev: null, next: null, tfunc: null,
        // position / geometry
        x: 0, y: 0, z: 0,
        snext: null, sprev: null,
        angle: 0,
        sprite: 0, frame: 0,
        bnext: null, bprev: null,
        subsector: -1,
        floorz: 0, ceilingz: 0,
        radius: 0, height: 0,
        momx: 0, momy: 0, momz: 0,
        validcount: 0,
        type: 0,
        tics: 0, state: 0,
        flags: 0, health: 0,
        movedir: 0, movecount: 0,
        target: null,
        reactiontime: 0, threshold: 0,
        player: null,
        lastlook: 0,
        spawnpoint: null,
        tracer: null,
    }
}

// ---- state machine ----

function P_SetMobjState(mobj, state) {
    do {
        if (state === I.S.S_NULL) {
            mobj.state = I.S.S_NULL
            P_RemoveMobj(mobj)
            return false
        }
        mobj.state = state
        mobj.tics = I.stateTics[state]
        mobj.sprite = I.stateSprite[state]
        mobj.frame = I.stateFrame[state]
        const action = I.stateAction[state]
        if (action >= 0 && actionTable[action] !== undefined)
            actionTable[action](mobj)
        state = I.stateNext[state]
    } while (!mobj.tics)
    return true
}

// action dispatch table: index = action id (info.mjs actionNames order);
// p_enemy/p_pspr register their functions here by name in M6
const actionTable = new Array(74).fill(undefined)

function registerAction(name, fn) {
    const id = I.actionNames.indexOf(name)
    if (id >= 0) actionTable[id] = fn
}

// ---- missiles ----

function P_ExplodeMissile(mo) {
    mo.momx = mo.momy = mo.momz = 0
    P_SetMobjState(mo, I.mobjinfo.deathstate[mo.type])
    mo.tics -= P_Random() & 3
    if (mo.tics < 1) mo.tics = 1
    mo.flags &= ~I.MF.MF_MISSILE
    if (I.mobjinfo.deathsound[mo.type])
        S.StartSound(mo, I.mobjinfo.deathsound[mo.type])
}

// ---- movement ----

function P_XYMovement(mo) {
    const MF = I.MF
    const MAXMOVE = DD.MAXMOVE

    if (!mo.momx && !mo.momy) {
        if (mo.flags & MF.MF_SKULLFLY) {
            // the skull slammed into something
            mo.flags &= ~MF.MF_SKULLFLY
            mo.momx = mo.momy = mo.momz = 0
            P_SetMobjState(mo, I.mobjinfo.spawnstate[mo.type])
        }
        return
    }

    const player = mo.player

    if (mo.momx > MAXMOVE) mo.momx = MAXMOVE
    else if (mo.momx < -MAXMOVE) mo.momx = -MAXMOVE
    if (mo.momy > MAXMOVE) mo.momy = MAXMOVE
    else if (mo.momy < -MAXMOVE) mo.momy = -MAXMOVE

    let xmove = mo.momx
    let ymove = mo.momy

    do {
        let ptryx, ptryy
        if (xmove > MAXMOVE / 2 || ymove > MAXMOVE / 2) {
            // C truncates xmove/2 BEFORE the add; truncating the sum
            // instead is off by one for odd negative halves (demo-sync)
            ptryx = (mo.x + ((xmove / 2) | 0)) | 0
            ptryy = (mo.y + ((ymove / 2) | 0)) | 0
            xmove >>= 1
            ymove >>= 1
        } else {
            ptryx = (mo.x + xmove) | 0
            ptryy = (mo.y + ymove) | 0
            xmove = ymove = 0
        }

        if (!PMap.P_TryMove(mo, ptryx, ptryy)) {
            // blocked move
            if (mo.player) {
                PMap.P_SlideMove(mo)
            } else if (mo.flags & MF.MF_MISSILE) {
                // explode, unless against the sky hack wall
                const cl = PMap.getCeilingline()
                if (cl !== -1 && L.line_backsector[cl] !== -1 &&
                    L.sec_ceilingpic[L.line_backsector[cl]] ===
                    RDgetSkyflatnum()) {
                    P_RemoveMobj(mo)
                    return
                }
                P_ExplodeMissile(mo)
            } else {
                mo.momx = mo.momy = 0
            }
        }
    } while (xmove || ymove)

    // slow down
    if (player && (player.cheats & DD.CF.NOMOMENTUM)) {
        mo.momx = mo.momy = 0
        return
    }

    if (mo.flags & (MF.MF_MISSILE | MF.MF_SKULLFLY))
        return                  // no friction for missiles
    if (mo.z > mo.floorz)
        return                  // no friction when airborne

    if (mo.flags & MF.MF_CORPSE) {
        // sliding corpses don't stop halfway off a step
        if (mo.momx > FRACUNIT / 4 || mo.momx < -FRACUNIT / 4 ||
            mo.momy > FRACUNIT / 4 || mo.momy < -FRACUNIT / 4) {
            if (mo.floorz !== L.sec_floorheight[L.ssec_sector[mo.subsector]])
                return
        }
    }

    if (mo.momx > -STOPSPEED && mo.momx < STOPSPEED &&
        mo.momy > -STOPSPEED && mo.momy < STOPSPEED &&
        (!player || (player.cmd.forwardmove === 0 &&
            player.cmd.sidemove === 0))) {
        // if in a walking frame, stop moving
        if (player &&
            ((player.mo.state - I.S.S_PLAY_RUN1) >>> 0) < 4)
            P_SetMobjState(player.mo, I.S.S_PLAY)
        mo.momx = 0
        mo.momy = 0
    } else {
        mo.momx = T.FixedMul(mo.momx, FRICTION)
        mo.momy = T.FixedMul(mo.momy, FRICTION)
    }
}

function P_ZMovement(mo) {
    const MF = I.MF
    const GRAVITY = DD.GRAVITY

    // smooth step up
    if (mo.player && mo.z < mo.floorz) {
        mo.player.viewheight = (mo.player.viewheight - (mo.floorz - mo.z)) | 0
        mo.player.deltaviewheight =
            (DD.VIEWHEIGHT - mo.player.viewheight) >> 3
    }

    mo.z = (mo.z + mo.momz) | 0

    if ((mo.flags & MF.MF_FLOAT) && mo.target) {
        // float toward target if too close
        if (!(mo.flags & MF.MF_SKULLFLY) && !(mo.flags & MF.MF_INFLOAT)) {
            const dist = PMU.P_AproxDistance(
                (mo.x - mo.target.x) | 0, (mo.y - mo.target.y) | 0)
            const delta = ((mo.target.z + (mo.height >> 1)) - mo.z) | 0
            if (delta < 0 && dist < -(delta * 3))
                mo.z = (mo.z - DD.FLOATSPEED) | 0
            else if (delta > 0 && dist < delta * 3)
                mo.z = (mo.z + DD.FLOATSPEED) | 0
        }
    }

    // clip movement
    if (mo.z <= mo.floorz) {
        // hit the floor
        if (mo.flags & MF.MF_SKULLFLY) mo.momz = -mo.momz
        if (mo.momz < 0) {
            if (mo.player && mo.momz < -GRAVITY * 8) {
                // squat down after a hard landing
                mo.player.deltaviewheight = mo.momz >> 3
                S.StartSound(mo, SFX.sfx_oof)
            }
            mo.momz = 0
        }
        mo.z = mo.floorz
        if ((mo.flags & MF.MF_MISSILE) && !(mo.flags & MF.MF_NOCLIP)) {
            P_ExplodeMissile(mo)
            return
        }
    } else if (!(mo.flags & MF.MF_NOGRAVITY)) {
        if (mo.momz === 0) mo.momz = -GRAVITY * 2
        else mo.momz = (mo.momz - GRAVITY) | 0
    }

    if (mo.z + mo.height > mo.ceilingz) {
        // hit the ceiling
        if (mo.momz > 0) mo.momz = 0
        mo.z = (mo.ceilingz - mo.height) | 0
        if (mo.flags & MF.MF_SKULLFLY) mo.momz = -mo.momz
        if ((mo.flags & MF.MF_MISSILE) && !(mo.flags & MF.MF_NOCLIP)) {
            P_ExplodeMissile(mo)
            return
        }
    }
}

// ---- nightmare / item respawning ----

function P_NightmareRespawn(mobj) {
    const x = mobj.spawnpoint.x << 16
    const y = mobj.spawnpoint.y << 16

    if (!PMap.P_CheckPosition(mobj, x, y)) return      // no respawn

    // teleport fog at old spot
    let mo = P_SpawnMobj(mobj.x, mobj.y,
        L.sec_floorheight[L.ssec_sector[mobj.subsector]], I.MT.MT_TFOG)
    S.StartSound(mo, SFX.sfx_telept)

    // teleport fog at new spot
    const ss = RM.R_PointInSubsector(x, y)
    mo = P_SpawnMobj(x, y, L.sec_floorheight[L.ssec_sector[ss]], I.MT.MT_TFOG)
    S.StartSound(mo, SFX.sfx_telept)

    const mthing = mobj.spawnpoint
    const z = (I.mobjinfo.flags[mobj.type] & I.MF.MF_SPAWNCEILING)
        ? DD.ONCEILINGZ : DD.ONFLOORZ

    mo = P_SpawnMobj(x, y, z, mobj.type)
    mo.spawnpoint = mobj.spawnpoint
    mo.angle = (ANG45 * Math.floor(mthing.angle / 45)) | 0
    if (mthing.options & DD.MTF_AMBUSH) mo.flags |= I.MF.MF_AMBUSH
    mo.reactiontime = 18

    P_RemoveMobj(mobj)
}

// ---- thinker ----

function P_MobjThinker(mobj) {
    if (mobj.momx || mobj.momy || (mobj.flags & I.MF.MF_SKULLFLY)) {
        P_XYMovement(mobj)
        if (mobj.tfunc === PT.REMOVED) return
    }
    if (mobj.z !== mobj.floorz || mobj.momz) {
        P_ZMovement(mobj)
        if (mobj.tfunc === PT.REMOVED) return
    }

    if (mobj.tics !== -1) {
        mobj.tics--
        // you can cycle through multiple states in a tic
        if (!mobj.tics)
            if (!P_SetMobjState(mobj, I.stateNext[mobj.state]))
                return          // freed itself
    } else {
        // check for nightmare respawn
        if (!(mobj.flags & I.MF.MF_COUNTKILL)) return
        if (!G.state.respawnmonsters) return
        mobj.movecount++
        if (mobj.movecount < 12 * 35) return
        if (G.state.leveltime & 31) return
        if (P_Random() > 4) return
        P_NightmareRespawn(mobj)
    }
}

// ---- spawning ----

function P_SpawnMobj(x, y, z, type) {
    const mobj = makeMobjShell()
    mobj.type = type
    mobj.x = x
    mobj.y = y
    mobj.radius = I.mobjinfo.radius[type]
    mobj.height = I.mobjinfo.height[type]
    mobj.flags = I.mobjinfo.flags[type]
    mobj.health = I.mobjinfo.spawnhealth[type]

    if (G.state.gameskill !== DD.Skill.nightmare)
        mobj.reactiontime = I.mobjinfo.reactiontime[type]
    mobj.lastlook = P_Random() % DD.MAXPLAYERS

    // no P_SetMobjState here: action routines cannot be called yet
    const st = I.mobjinfo.spawnstate[type]
    mobj.state = st
    mobj.tics = I.stateTics[st]
    mobj.sprite = I.stateSprite[st]
    mobj.frame = I.stateFrame[st]

    PMU.P_SetThingPosition(mobj)

    const sec = L.ssec_sector[mobj.subsector]
    mobj.floorz = L.sec_floorheight[sec]
    mobj.ceilingz = L.sec_ceilingheight[sec]

    if (z === DD.ONFLOORZ) mobj.z = mobj.floorz
    else if (z === DD.ONCEILINGZ)
        mobj.z = (mobj.ceilingz - I.mobjinfo.height[type]) | 0
    else mobj.z = z

    mobj.tfunc = P_MobjThinker
    PT.P_AddThinker(mobj)
    return mobj
}

// ---- removal & item respawn queue ----

const ITEMQUESIZE = 128
const itemrespawnque = new Array(ITEMQUESIZE).fill(null)
const itemrespawntime = new Int32Array(ITEMQUESIZE)
let iquehead = 0
let iquetail = 0

function P_RemoveMobj(mobj) {
    const MF = I.MF
    if ((mobj.flags & MF.MF_SPECIAL) && !(mobj.flags & MF.MF_DROPPED) &&
        mobj.type !== I.MT.MT_INV && mobj.type !== I.MT.MT_INS) {
        itemrespawnque[iquehead] = mobj.spawnpoint
        itemrespawntime[iquehead] = G.state.leveltime
        iquehead = (iquehead + 1) & (ITEMQUESIZE - 1)
        if (iquehead === iquetail)
            iquetail = (iquetail + 1) & (ITEMQUESIZE - 1)
    }
    PMU.P_UnsetThingPosition(mobj)
    S.StopSound(mobj)
    PT.P_RemoveThinker(mobj)
}

function P_RespawnSpecials() {
    // only respawn items in deathmatch 2
    if (G.state.deathmatch !== 2) return
    if (iquehead === iquetail) return
    if (G.state.leveltime - itemrespawntime[iquetail] < 30 * 35) return

    const mthing = itemrespawnque[iquetail]
    const x = mthing.x << 16
    const y = mthing.y << 16

    const ss = RM.R_PointInSubsector(x, y)
    let mo = P_SpawnMobj(x, y, L.sec_floorheight[L.ssec_sector[ss]],
        I.MT.MT_IFOG)
    S.StartSound(mo, SFX.sfx_itmbk)

    let i
    for (i = 0; i < I.NUMMOBJTYPES; i++)
        if (mthing.type === I.mobjinfo.doomednum[i]) break

    const z = (I.mobjinfo.flags[i] & I.MF.MF_SPAWNCEILING)
        ? DD.ONCEILINGZ : DD.ONFLOORZ
    mo = P_SpawnMobj(x, y, z, i)
    mo.spawnpoint = mthing
    mo.angle = (ANG45 * Math.floor(mthing.angle / 45)) | 0

    iquetail = (iquetail + 1) & (ITEMQUESIZE - 1)
}

function P_ResetRespawnQueue() { iquehead = iquetail = 0 }

// ---- player / map thing spawning ----

function P_SpawnPlayer(mthing) {
    const st = G.state
    if (!st.playeringame[mthing.type - 1]) return

    const p = st.players[mthing.type - 1]
    if (p.playerstate === DD.PST.REBORN)
        G.G_PlayerReborn(mthing.type - 1)

    const mobj = P_SpawnMobj(mthing.x << 16, mthing.y << 16,
        DD.ONFLOORZ, I.MT.MT_PLAYER)

    // colour translation for players 2-4
    if (mthing.type > 1)
        mobj.flags |= (mthing.type - 1) << 26       // MF_TRANSSHIFT

    mobj.angle = (ANG45 * Math.floor(mthing.angle / 45)) | 0
    mobj.player = p
    mobj.health = p.health

    p.mo = mobj
    p.playerstate = DD.PST.LIVE
    p.refire = 0
    p.message = null
    p.damagecount = 0
    p.bonuscount = 0
    p.extralight = 0
    p.fixedcolormap = 0
    p.viewheight = DD.VIEWHEIGHT

    if (setupPsprites !== null) setupPsprites(p)

    if (st.deathmatch)
        for (let i = 0; i < DD.Card.NUMCARDS; i++) p.cards[i] = 1

    if (mthing.type - 1 === st.consoleplayer) {
        if (stStart !== null) stStart()
        if (huStart !== null) huStart()
    }
}

function P_SpawnMapThing(mthing) {
    const st = G.state

    // deathmatch start positions
    if (mthing.type === 11) {
        if (L.deathmatchstarts === undefined) L.deathmatchstarts = []
        if (L.deathmatchstarts.length < 10) L.deathmatchstarts.push(mthing)
        return
    }

    // players
    if (mthing.type <= 4) {
        L.playerstarts[mthing.type - 1] = mthing
        if (!st.deathmatch) P_SpawnPlayer(mthing)
        return
    }

    // skill filters
    if (!st.netgame && (mthing.options & 16)) return
    let bit
    if (st.gameskill === DD.Skill.baby) bit = 1
    else if (st.gameskill === DD.Skill.nightmare) bit = 4
    else bit = 1 << (st.gameskill - 1)
    if (!(mthing.options & bit)) return

    // find which type to spawn
    let i
    for (i = 0; i < I.NUMMOBJTYPES; i++)
        if (mthing.type === I.mobjinfo.doomednum[i]) break
    if (i === I.NUMMOBJTYPES)
        throw Error("P_SpawnMapThing: unknown type " + mthing.type +
            " at (" + mthing.x + ", " + mthing.y + ")")

    if (st.deathmatch && (I.mobjinfo.flags[i] & I.MF.MF_NOTDMATCH)) return

    if (st.nomonsters && (i === I.MT.MT_SKULL ||
        (I.mobjinfo.flags[i] & I.MF.MF_COUNTKILL))) return

    const x = mthing.x << 16
    const y = mthing.y << 16
    const z = (I.mobjinfo.flags[i] & I.MF.MF_SPAWNCEILING)
        ? DD.ONCEILINGZ : DD.ONFLOORZ

    const mobj = P_SpawnMobj(x, y, z, i)
    mobj.spawnpoint = mthing

    if (mobj.tics > 0) mobj.tics = 1 + (P_Random() % mobj.tics)
    if (mobj.flags & I.MF.MF_COUNTKILL) st.totalkills++
    if (mobj.flags & I.MF.MF_COUNTITEM) st.totalitems++

    mobj.angle = (ANG45 * Math.floor(mthing.angle / 45)) | 0
    if (mthing.options & DD.MTF_AMBUSH) mobj.flags |= I.MF.MF_AMBUSH
}

// ---- game spawn helpers ----

function P_SpawnPuff(x, y, z) {
    z = (z + ((P_Random() - P_Random()) << 10)) | 0
    const th = P_SpawnMobj(x, y, z, I.MT.MT_PUFF)
    th.momz = FRACUNIT
    th.tics -= P_Random() & 3
    if (th.tics < 1) th.tics = 1
    // punches don't spark on the wall
    if (PMap.getAttackrange() === DD.MELEERANGE)
        P_SetMobjState(th, I.S.S_PUFF3)
}

function P_SpawnBlood(x, y, z, damage) {
    z = (z + ((P_Random() - P_Random()) << 10)) | 0
    const th = P_SpawnMobj(x, y, z, I.MT.MT_BLOOD)
    th.momz = FRACUNIT * 2
    th.tics -= P_Random() & 3
    if (th.tics < 1) th.tics = 1
    if (damage <= 12 && damage >= 9) P_SetMobjState(th, I.S.S_BLOOD2)
    else if (damage < 9) P_SetMobjState(th, I.S.S_BLOOD3)
}

function P_CheckMissileSpawn(th) {
    th.tics -= P_Random() & 3
    if (th.tics < 1) th.tics = 1
    // move forward slightly so an angle can be computed on instant impact
    th.x = (th.x + (th.momx >> 1)) | 0
    th.y = (th.y + (th.momy >> 1)) | 0
    th.z = (th.z + (th.momz >> 1)) | 0
    if (!PMap.P_TryMove(th, th.x, th.y))
        P_ExplodeMissile(th)
}

function P_SpawnMissile(source, dest, type) {
    const th = P_SpawnMobj(source.x, source.y,
        (source.z + 4 * 8 * FRACUNIT) | 0, type)
    if (I.mobjinfo.seesound[type]) S.StartSound(th, I.mobjinfo.seesound[type])
    th.target = source
    let an = RM.R_PointToAngle2(source.x, source.y, dest.x, dest.y)
    if (dest.flags & I.MF.MF_SHADOW)
        an = (an + ((P_Random() - P_Random()) << 20)) >>> 0
    th.angle = an | 0
    const fa = (an >>> 19) & 8191
    const speed = I.mobjinfo.speed[type]
    th.momx = T.FixedMul(speed, T.finecosine[fa])
    th.momy = T.FixedMul(speed, T.finesine[fa])
    let dist = PMU.P_AproxDistance((dest.x - source.x) | 0, (dest.y - source.y) | 0)
    dist = (dist / speed) | 0
    if (dist < 1) dist = 1
    th.momz = ((dest.z - source.z) / dist) | 0
    P_CheckMissileSpawn(th)
    return th
}

function P_SpawnPlayerMissile(source, type) {
    // aim at a nearby monster
    let an = source.angle >>> 0
    let slope = PMap.P_AimLineAttack(source, an, 16 * 64 * FRACUNIT)
    if (!PMap.getLinetarget()) {
        an = (an + (1 << 26)) >>> 0
        slope = PMap.P_AimLineAttack(source, an, 16 * 64 * FRACUNIT)
        if (!PMap.getLinetarget()) {
            an = (an - (2 << 26)) >>> 0
            slope = PMap.P_AimLineAttack(source, an, 16 * 64 * FRACUNIT)
        }
        if (!PMap.getLinetarget()) {
            an = source.angle >>> 0
            slope = 0
        }
    }

    const th = P_SpawnMobj(source.x, source.y,
        (source.z + 4 * 8 * FRACUNIT) | 0, type)
    if (I.mobjinfo.seesound[type]) S.StartSound(th, I.mobjinfo.seesound[type])
    th.target = source
    th.angle = an | 0
    const fa = (an >>> 19) & 8191
    const speed = I.mobjinfo.speed[type]
    th.momx = T.FixedMul(speed, T.finecosine[fa])
    th.momy = T.FixedMul(speed, T.finesine[fa])
    th.momz = T.FixedMul(speed, slope)
    P_CheckMissileSpawn(th)
}

// hooks (p_pspr / st / hu, M6-M7)
let setupPsprites = null
let stStart = null
let huStart = null

// sfx ids used here, bound from sounds module
let SFX = null
let RDgetSkyflatnum = null

exports = {
    P_SetMobjState, P_ExplodeMissile, P_XYMovement, P_ZMovement,
    P_MobjThinker, P_SpawnMobj, P_RemoveMobj, P_RespawnSpecials,
    P_ResetRespawnQueue, P_SpawnPlayer, P_SpawnMapThing,
    P_SpawnPuff, P_SpawnBlood, P_CheckMissileSpawn,
    P_SpawnMissile, P_SpawnPlayerMissile,
    registerAction, actionTable, makeMobjShell,
    setSetupPsprites: (fn) => { setupPsprites = fn },
    setStStart: (fn) => { stStart = fn },
    setHuStart: (fn) => { huStart = fn },
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PT = D.p_tick; PMap = D.p_map; PMU = D.p_maputl
        RM = D.r_main; L = D.p_setup.level
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
        RDgetSkyflatnum = D.r_data.getSkyflatnum
        if (D.p_pspr !== undefined) setupPsprites = D.p_pspr.P_SetupPsprites
    },
}
