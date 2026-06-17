// p_pspr.mjs -- player weapon sprites and attacks (p_pspr.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Psprite states dispatch through their own table with the (player, psp)
// signature; mobj-signature actions defined here (A_BFGSpray) register
// into p_mobj's table instead. psp.state is a state index, -1 = inactive.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PM = null
let PMap = null, PEnemy = null, PInter = null, RM = null, L = null, S = null

const FRACUNIT = 65536
const ANG90 = 0x40000000
const ANG180 = 0x80000000
const LOWERSPEED = FRACUNIT * 6
const RAISESPEED = FRACUNIT * 6
const WEAPONBOTTOM = 128 * FRACUNIT
const WEAPONTOP = 32 * FRACUNIT
const BFGCELLS = 40
const ps_weapon = 0, ps_flash = 1
const NUMPSPRITES = 2

function P_Random() { return R.P_Random() }
function FixedMul(a, b) { return T.FixedMul(a, b) }

// Free-aim base angle: the player's facing plus the mouse free-aim offset
// (g_game sets player.aimAngleOffset). 0 for keyboard play, demos and tests,
// so the firing angle is then bit-identical to player.mo.angle.
function P_PlayerAimAngle(player) {
    return (player.mo.angle + (player.aimAngleOffset | 0)) >>> 0
}

// (player, psp) action dispatch, indexed like p_mobj's actionTable
const psprActionTable = new Array(74).fill(undefined)

function registerPsprAction(name, fn) {
    const id = I.actionNames.indexOf(name)
    if (id >= 0) psprActionTable[id] = fn
}

let weaponinfo = null           // bound from p_inter at init

// ---- psprite state machine ----

function P_SetPsprite(player, position, stnum) {
    const psp = player.psprites[position]
    do {
        if (!stnum) {
            psp.state = -1      // object removed itself
            break
        }
        psp.state = stnum
        psp.tics = I.stateTics[stnum]
        if (I.stateMisc1[stnum]) {
            // coordinate set
            psp.sx = I.stateMisc1[stnum] << 16
            psp.sy = I.stateMisc2[stnum] << 16
        }
        const action = I.stateAction[stnum]
        if (action >= 0 && psprActionTable[action] !== undefined) {
            psprActionTable[action](player, psp)
            if (psp.state === -1) break
        }
        stnum = I.stateNext[psp.state]
    } while (!psp.tics)
}

// ---- weapon bring-up / ammo ----

function P_BringUpWeapon(player) {
    if (player.pendingweapon === DD.Weapon.nochange)
        player.pendingweapon = player.readyweapon

    if (player.pendingweapon === DD.Weapon.chainsaw)
        S.StartSound(player.mo, SFX.sfx_sawup)

    const newstate = weaponinfo[player.pendingweapon].upstate
    player.pendingweapon = DD.Weapon.nochange
    player.psprites[ps_weapon].sy = WEAPONBOTTOM
    P_SetPsprite(player, ps_weapon, newstate)
}

function P_CheckAmmo(player) {
    const W = DD.Weapon, A = DD.Ammo
    const ammo = weaponinfo[player.readyweapon].ammo

    let count = 1
    if (player.readyweapon === W.bfg) count = BFGCELLS
    else if (player.readyweapon === W.supershotgun) count = 2

    if (ammo === A.noammo || player.ammo[ammo] >= count)
        return true

    // out of ammo: pick a new weapon (vanilla preference order)
    const st = G.state
    do {
        if (player.weaponowned[W.plasma] && player.ammo[A.cell] &&
            st.gamemode !== DD.GameMode.shareware) {
            player.pendingweapon = W.plasma
        } else if (player.weaponowned[W.supershotgun] &&
            player.ammo[A.shell] > 2 &&
            st.gamemode === DD.GameMode.commercial) {
            player.pendingweapon = W.supershotgun
        } else if (player.weaponowned[W.chaingun] && player.ammo[A.clip]) {
            player.pendingweapon = W.chaingun
        } else if (player.weaponowned[W.shotgun] && player.ammo[A.shell]) {
            player.pendingweapon = W.shotgun
        } else if (player.ammo[A.clip]) {
            player.pendingweapon = W.pistol
        } else if (player.weaponowned[W.chainsaw]) {
            player.pendingweapon = W.chainsaw
        } else if (player.weaponowned[W.missile] && player.ammo[A.misl]) {
            player.pendingweapon = W.missile
        } else if (player.weaponowned[W.bfg] && player.ammo[A.cell] > 40 &&
            st.gamemode !== DD.GameMode.shareware) {
            player.pendingweapon = W.bfg
        } else {
            player.pendingweapon = W.fist
        }
    } while (player.pendingweapon === W.nochange)

    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].downstate)
    return false
}

function P_FireWeapon(player) {
    if (!P_CheckAmmo(player)) return
    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK1)
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].atkstate)
    PEnemy.P_NoiseAlert(player.mo, player.mo)
}

function P_DropWeapon(player) {
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].downstate)
}

// ---- psprite actions ----

function A_WeaponReady(player, psp) {
    // get out of attack state
    if (player.mo.state === I.S.S_PLAY_ATK1 ||
        player.mo.state === I.S.S_PLAY_ATK2) {
        PM.P_SetMobjState(player.mo, I.S.S_PLAY)
    }

    if (player.readyweapon === DD.Weapon.chainsaw &&
        psp.state === I.S.S_SAW) {
        S.StartSound(player.mo, SFX.sfx_sawidl)
    }

    // weapon change / dead: put the weapon away
    if (player.pendingweapon !== DD.Weapon.nochange || !player.health) {
        P_SetPsprite(player, ps_weapon,
            weaponinfo[player.readyweapon].downstate)
        return
    }

    // fire? (missile launcher and bfg do not auto fire)
    if (player.cmd.buttons & DD.BT.ATTACK) {
        if (!player.attackdown ||
            (player.readyweapon !== DD.Weapon.missile &&
                player.readyweapon !== DD.Weapon.bfg)) {
            player.attackdown = true
            P_FireWeapon(player)
            return
        }
    } else {
        player.attackdown = false
    }

    // bob the weapon
    let angle = (128 * G.state.leveltime) & 8191
    psp.sx = (FRACUNIT + FixedMul(player.bob, T.finecosine[angle])) | 0
    angle &= 4095
    psp.sy = (WEAPONTOP + FixedMul(player.bob, T.finesine[angle])) | 0
}

function A_ReFire(player, psp) {
    // (if a weapon change is pending, let it go through instead)
    if ((player.cmd.buttons & DD.BT.ATTACK) &&
        player.pendingweapon === DD.Weapon.nochange && player.health) {
        player.refire++
        P_FireWeapon(player)
    } else {
        player.refire = 0
        P_CheckAmmo(player)
    }
}

function A_CheckReload(player, psp) {
    P_CheckAmmo(player)
}

function A_Lower(player, psp) {
    psp.sy = (psp.sy + LOWERSPEED) | 0
    if (psp.sy < WEAPONBOTTOM) return

    if (player.playerstate === DD.PST.DEAD) {
        psp.sy = WEAPONBOTTOM
        return                  // don't bring weapon back up
    }
    if (!player.health) {
        // player is dead: keep the weapon off screen
        P_SetPsprite(player, ps_weapon, I.S.S_NULL)
        return
    }

    player.readyweapon = player.pendingweapon
    P_BringUpWeapon(player)
}

function A_Raise(player, psp) {
    psp.sy = (psp.sy - RAISESPEED) | 0
    if (psp.sy > WEAPONTOP) return
    psp.sy = WEAPONTOP
    P_SetPsprite(player, ps_weapon,
        weaponinfo[player.readyweapon].readystate)
}

function A_GunFlash(player, psp) {
    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK2)
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate)
}

// ---- attacks ----

function A_Punch(player, psp) {
    let damage = (P_Random() % 10 + 1) << 1
    if (player.powers[DD.Power.strength]) damage *= 10

    let angle = P_PlayerAimAngle(player)
    angle = (angle + ((P_Random() - P_Random()) << 18)) | 0
    const slope = PMap.P_AimLineAttack(player.mo, angle >>> 0, DD.MELEERANGE)
    PMap.P_LineAttack(player.mo, angle >>> 0, DD.MELEERANGE, slope, damage)

    // turn to face target
    const lt = PMap.getLinetarget()
    if (lt) {
        S.StartSound(player.mo, SFX.sfx_punch)
        player.mo.angle = RM.R_PointToAngle2(player.mo.x, player.mo.y,
            lt.x, lt.y) | 0
    }
}

function A_Saw(player, psp) {
    const damage = 2 * (P_Random() % 10 + 1)
    let angle = P_PlayerAimAngle(player)
    angle = (angle + ((P_Random() - P_Random()) << 18)) | 0

    // meleerange+1 so the puff doesn't skip the flash
    const slope = PMap.P_AimLineAttack(player.mo, angle >>> 0, DD.MELEERANGE + 1)
    PMap.P_LineAttack(player.mo, angle >>> 0, DD.MELEERANGE + 1, slope, damage)

    const lt = PMap.getLinetarget()
    if (!lt) {
        S.StartSound(player.mo, SFX.sfx_sawful)
        return
    }
    S.StartSound(player.mo, SFX.sfx_sawhit)

    // turn to face target (unsigned angle deltas like vanilla);
    // ANG90/20 and /21 are C integer divisions: precomputed truncated
    const A20 = 53687091      // ANG90/20
    const A21 = 51130563      // ANG90/21
    angle = RM.R_PointToAngle2(player.mo.x, player.mo.y, lt.x, lt.y)
    const diff = ((angle - player.mo.angle) >>> 0)
    if (diff > ANG180) {
        if (diff < ((-A20) >>> 0))
            player.mo.angle = (angle + A21) | 0
        else
            player.mo.angle = (player.mo.angle - A20) | 0
    } else {
        if (diff > A20)
            player.mo.angle = (angle - A21) | 0
        else
            player.mo.angle = (player.mo.angle + A20) | 0
    }
    player.mo.flags |= I.MF.MF_JUSTATTACKED
}

function A_FireMissile(player, psp) {
    player.ammo[weaponinfo[player.readyweapon].ammo]--
    PM.P_SpawnPlayerMissile(player.mo, I.MT.MT_ROCKET, P_PlayerAimAngle(player))
}

function A_FireBFG(player, psp) {
    player.ammo[weaponinfo[player.readyweapon].ammo] -= BFGCELLS
    PM.P_SpawnPlayerMissile(player.mo, I.MT.MT_BFG, P_PlayerAimAngle(player))
}

function A_FirePlasma(player, psp) {
    player.ammo[weaponinfo[player.readyweapon].ammo]--
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate + (P_Random() & 1))
    PM.P_SpawnPlayerMissile(player.mo, I.MT.MT_PLASMA, P_PlayerAimAngle(player))
}

let bulletslope = 0

// baseAngle defaults to mo.angle (demos / kbd); p_pspr passes the free-aim
// angle so the autoaim slope is searched along the cursor direction.
function P_BulletSlope(mo, baseAngle) {
    let an = (baseAngle === undefined ? mo.angle : baseAngle) >>> 0
    const base = an
    bulletslope = PMap.P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT)
    if (!PMap.getLinetarget()) {
        an = (base + (1 << 26)) >>> 0
        bulletslope = PMap.P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT)
        if (!PMap.getLinetarget()) {
            an = (base - (1 << 26)) >>> 0
            bulletslope = PMap.P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT)
        }
    }
}

function P_GunShot(mo, accurate, baseAngle) {
    const damage = 5 * (P_Random() % 3 + 1)
    let angle = (baseAngle === undefined ? mo.angle : baseAngle)
    if (!accurate) angle = (angle + ((P_Random() - P_Random()) << 18)) | 0
    PMap.P_LineAttack(mo, angle >>> 0, DD.MISSILERANGE, bulletslope, damage)
}

function A_FirePistol(player, psp) {
    S.StartSound(player.mo, SFX.sfx_pistol)
    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK2)
    player.ammo[weaponinfo[player.readyweapon].ammo]--
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate)
    const ba = P_PlayerAimAngle(player)
    P_BulletSlope(player.mo, ba)
    P_GunShot(player.mo, !player.refire, ba)
}

function A_FireShotgun(player, psp) {
    S.StartSound(player.mo, SFX.sfx_shotgn)
    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK2)
    player.ammo[weaponinfo[player.readyweapon].ammo]--
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate)
    const ba = P_PlayerAimAngle(player)
    P_BulletSlope(player.mo, ba)
    for (let i = 0; i < 7; i++)
        P_GunShot(player.mo, false, ba)
}

function A_FireShotgun2(player, psp) {
    S.StartSound(player.mo, SFX.sfx_dshtgn)
    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK2)
    player.ammo[weaponinfo[player.readyweapon].ammo] -= 2
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate)
    const ba = P_PlayerAimAngle(player)
    P_BulletSlope(player.mo, ba)
    for (let i = 0; i < 20; i++) {
        const damage = 5 * (P_Random() % 3 + 1)
        let angle = ba
        angle = (angle + ((P_Random() - P_Random()) << 19)) | 0
        PMap.P_LineAttack(player.mo, angle >>> 0, DD.MISSILERANGE,
            (bulletslope + ((P_Random() - P_Random()) << 5)) | 0, damage)
    }
}

function A_FireCGun(player, psp) {
    S.StartSound(player.mo, SFX.sfx_pistol)
    if (!player.ammo[weaponinfo[player.readyweapon].ammo]) return

    PM.P_SetMobjState(player.mo, I.S.S_PLAY_ATK2)
    player.ammo[weaponinfo[player.readyweapon].ammo]--
    P_SetPsprite(player, ps_flash,
        weaponinfo[player.readyweapon].flashstate +
        psp.state - I.S.S_CHAIN1)
    const ba = P_PlayerAimAngle(player)
    P_BulletSlope(player.mo, ba)
    P_GunShot(player.mo, !player.refire, ba)
}

function A_Light0(player, psp) { player.extralight = 0 }
function A_Light1(player, psp) { player.extralight = 1 }
function A_Light2(player, psp) { player.extralight = 2 }

// A_BFGSpray is a MOBJ action (runs on the BFG ball)
function A_BFGSpray(mo) {
    // offset angles from its attack angle
    for (let i = 0; i < 40; i++) {
        // ANG90/40 truncates in C: 26843545 (not .6)
        const an = (mo.angle - ANG90 / 2 + 26843545 * i) >>> 0
        // mo.target is the originator (player) of the missile
        PMap.P_AimLineAttack(mo.target, an, 16 * 64 * FRACUNIT)
        const lt = PMap.getLinetarget()
        if (!lt) continue

        PM.P_SpawnMobj(lt.x, lt.y, (lt.z + (lt.height >> 2)) | 0,
            I.MT.MT_EXTRABFG)
        let damage = 0
        for (let j = 0; j < 15; j++)
            damage += (P_Random() & 7) + 1
        PInter.P_DamageMobj(lt, mo.target, mo.target, damage)
    }
}

function A_BFGsound(player, psp) {
    S.StartSound(player.mo, SFX.sfx_bfg)
}

// SSG sounds (defined in p_enemy.c but psprite-signature)
function A_OpenShotgun2(player, psp) { S.StartSound(player.mo, SFX.sfx_dbopn) }
function A_LoadShotgun2(player, psp) { S.StartSound(player.mo, SFX.sfx_dbload) }
function A_CloseShotgun2(player, psp) {
    S.StartSound(player.mo, SFX.sfx_dbcls)
    A_ReFire(player, psp)
}

// ---- per-level / per-tic ----

function P_SetupPsprites(player) {
    // remove all psprites
    for (let i = 0; i < NUMPSPRITES; i++)
        player.psprites[i].state = -1
    // spawn the gun
    player.pendingweapon = player.readyweapon
    P_BringUpWeapon(player)
}

function P_MovePsprites(player) {
    for (let i = 0; i < NUMPSPRITES; i++) {
        const psp = player.psprites[i]
        if (psp.state !== -1) {
            // a -1 tic count never changes
            if (psp.tics !== -1) {
                psp.tics--
                if (!psp.tics)
                    P_SetPsprite(player, i, I.stateNext[psp.state])
            }
        }
    }
    player.psprites[ps_flash].sx = player.psprites[ps_weapon].sx
    player.psprites[ps_flash].sy = player.psprites[ps_weapon].sy
}

let SFX = null

exports = {
    P_SetPsprite, P_BringUpWeapon, P_CheckAmmo, P_FireWeapon,
    P_DropWeapon, P_SetupPsprites, P_MovePsprites,
    ps_weapon, ps_flash, NUMPSPRITES,
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PM = D.p_mobj; PMap = D.p_map
        PEnemy = D.p_enemy; PInter = D.p_inter; RM = D.r_main
        L = D.p_setup.level
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
        weaponinfo = D.p_inter.getWeaponinfo()

        // psprite-signature actions
        registerPsprAction("A_WeaponReady", A_WeaponReady)
        registerPsprAction("A_ReFire", A_ReFire)
        registerPsprAction("A_CheckReload", A_CheckReload)
        registerPsprAction("A_Lower", A_Lower)
        registerPsprAction("A_Raise", A_Raise)
        registerPsprAction("A_GunFlash", A_GunFlash)
        registerPsprAction("A_Punch", A_Punch)
        registerPsprAction("A_Saw", A_Saw)
        registerPsprAction("A_FireMissile", A_FireMissile)
        registerPsprAction("A_FireBFG", A_FireBFG)
        registerPsprAction("A_FirePlasma", A_FirePlasma)
        registerPsprAction("A_FirePistol", A_FirePistol)
        registerPsprAction("A_FireShotgun", A_FireShotgun)
        registerPsprAction("A_FireShotgun2", A_FireShotgun2)
        registerPsprAction("A_FireCGun", A_FireCGun)
        registerPsprAction("A_Light0", A_Light0)
        registerPsprAction("A_Light1", A_Light1)
        registerPsprAction("A_Light2", A_Light2)
        registerPsprAction("A_BFGsound", A_BFGsound)
        registerPsprAction("A_OpenShotgun2", A_OpenShotgun2)
        registerPsprAction("A_LoadShotgun2", A_LoadShotgun2)
        registerPsprAction("A_CloseShotgun2", A_CloseShotgun2)

        // mobj-signature action owned by this file
        PM.registerAction("A_BFGSpray", A_BFGSpray)

        // engage the p_tick / p_mobj / p_inter hooks
        D.p_tick.setMovePsprites(P_MovePsprites)
        PM.setSetupPsprites(P_SetupPsprites)
        D.p_inter.setDropWeapon(P_DropWeapon)
    },
}
