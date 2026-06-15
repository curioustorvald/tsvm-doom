// p_inter.mjs -- pickups, damage, death (p_inter.c) + weaponinfo (d_items.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PM = null
let RM = null, L = null, S = null

const FRACUNIT = 65536
const ANG180 = 0x80000000
const BONUSADD = 6
const MAXHEALTH = 100
const BASETHRESHOLD = 100

function P_Random() { return R.P_Random() }

// d_items.c: weaponinfo[] -- ammo type + psprite states per weapon
// (states resolved at init when info is available)
let weaponinfo = null

function buildWeaponinfo() {
    const A = DD.Ammo, ST = I.S
    weaponinfo = [
        { ammo: A.noammo, upstate: ST.S_PUNCHUP, downstate: ST.S_PUNCHDOWN,
          readystate: ST.S_PUNCH, atkstate: ST.S_PUNCH1, flashstate: ST.S_NULL },
        { ammo: A.clip, upstate: ST.S_PISTOLUP, downstate: ST.S_PISTOLDOWN,
          readystate: ST.S_PISTOL, atkstate: ST.S_PISTOL1, flashstate: ST.S_PISTOLFLASH },
        { ammo: A.shell, upstate: ST.S_SGUNUP, downstate: ST.S_SGUNDOWN,
          readystate: ST.S_SGUN, atkstate: ST.S_SGUN1, flashstate: ST.S_SGUNFLASH1 },
        { ammo: A.clip, upstate: ST.S_CHAINUP, downstate: ST.S_CHAINDOWN,
          readystate: ST.S_CHAIN, atkstate: ST.S_CHAIN1, flashstate: ST.S_CHAINFLASH1 },
        { ammo: A.misl, upstate: ST.S_MISSILEUP, downstate: ST.S_MISSILEDOWN,
          readystate: ST.S_MISSILE, atkstate: ST.S_MISSILE1, flashstate: ST.S_MISSILEFLASH1 },
        { ammo: A.cell, upstate: ST.S_PLASMAUP, downstate: ST.S_PLASMADOWN,
          readystate: ST.S_PLASMA, atkstate: ST.S_PLASMA1, flashstate: ST.S_PLASMAFLASH1 },
        { ammo: A.cell, upstate: ST.S_BFGUP, downstate: ST.S_BFGDOWN,
          readystate: ST.S_BFG, atkstate: ST.S_BFG1, flashstate: ST.S_BFGFLASH1 },
        { ammo: A.noammo, upstate: ST.S_SAWUP, downstate: ST.S_SAWDOWN,
          readystate: ST.S_SAW, atkstate: ST.S_SAW1, flashstate: ST.S_NULL },
        { ammo: A.shell, upstate: ST.S_DSGUNUP, downstate: ST.S_DSGUNDOWN,
          readystate: ST.S_DSGUN, atkstate: ST.S_DSGUN1, flashstate: ST.S_DSGUNFLASH1 },
    ]
}

// vanilla ammo tables
const maxammo = new Int32Array([200, 50, 300, 50])
const clipammo = new Int32Array([10, 4, 20, 1])

// ---- give functions ----

function P_GiveAmmo(player, ammo, num) {
    if (ammo === DD.Ammo.noammo) return false
    if (player.ammo[ammo] === player.maxammo[ammo]) return false

    if (num) num *= clipammo[ammo]
    else num = clipammo[ammo] / 2

    if (G.state.gameskill === DD.Skill.baby ||
        G.state.gameskill === DD.Skill.nightmare)
        num <<= 1               // double ammo in trainer/nightmare

    const oldammo = player.ammo[ammo]
    player.ammo[ammo] += num
    if (player.ammo[ammo] > player.maxammo[ammo])
        player.ammo[ammo] = player.maxammo[ammo]

    // if non-zero ammo, don't change weapons: player was lower on purpose
    if (oldammo) return true

    const W = DD.Weapon, A = DD.Ammo
    switch (ammo) {
        case A.clip:
            if (player.readyweapon === W.fist) {
                if (player.weaponowned[W.chaingun])
                    player.pendingweapon = W.chaingun
                else player.pendingweapon = W.pistol
            }
            break
        case A.shell:
            if (player.readyweapon === W.fist ||
                player.readyweapon === W.pistol) {
                if (player.weaponowned[W.shotgun])
                    player.pendingweapon = W.shotgun
            }
            break
        case A.cell:
            if (player.readyweapon === W.fist ||
                player.readyweapon === W.pistol) {
                if (player.weaponowned[W.plasma])
                    player.pendingweapon = W.plasma
            }
            break
        case A.misl:
            if (player.readyweapon === W.fist) {
                if (player.weaponowned[W.missile])
                    player.pendingweapon = W.missile
            }
            break
    }
    return true
}

function P_GiveWeapon(player, weapon, dropped) {
    const st = G.state
    if (st.netgame && st.deathmatch !== 2 && !dropped) {
        // leave placed weapons forever in net games
        if (player.weaponowned[weapon]) return false
        player.bonuscount += BONUSADD
        player.weaponowned[weapon] = 1
        P_GiveAmmo(player, weaponinfo[weapon].ammo, st.deathmatch ? 5 : 2)
        player.pendingweapon = weapon
        if (player === st.players[st.consoleplayer])
            S.StartSound(null, SFX.sfx_wpnup)
        return false
    }

    let gaveammo = false
    if (weaponinfo[weapon].ammo !== DD.Ammo.noammo) {
        gaveammo = P_GiveAmmo(player, weaponinfo[weapon].ammo, dropped ? 1 : 2)
    }

    let gaveweapon = false
    if (!player.weaponowned[weapon]) {
        gaveweapon = true
        player.weaponowned[weapon] = 1
        player.pendingweapon = weapon
    }
    return gaveweapon || gaveammo
}

function P_GiveBody(player, num) {
    if (player.health >= MAXHEALTH) return false
    player.health += num
    if (player.health > MAXHEALTH) player.health = MAXHEALTH
    player.mo.health = player.health
    return true
}

function P_GiveArmor(player, armortype) {
    const hits = armortype * 100
    if (player.armorpoints >= hits) return false
    player.armortype = armortype
    player.armorpoints = hits
    return true
}

function P_GiveCard(player, card) {
    if (player.cards[card]) return
    player.bonuscount = BONUSADD
    player.cards[card] = 1
}

function P_GivePower(player, power) {
    const pw = DD.Power, PD = DD.PowerDuration
    if (power === pw.invulnerability) {
        player.powers[power] = PD.INVULNTICS
        return true
    }
    if (power === pw.invisibility) {
        player.powers[power] = PD.INVISTICS
        player.mo.flags |= I.MF.MF_SHADOW
        return true
    }
    if (power === pw.infrared) {
        player.powers[power] = PD.INFRATICS
        return true
    }
    if (power === pw.ironfeet) {
        player.powers[power] = PD.IRONTICS
        return true
    }
    if (power === pw.strength) {
        P_GiveBody(player, 100)
        player.powers[power] = 1
        return true
    }
    if (player.powers[power]) return false
    player.powers[power] = 1
    return true
}

// ---- pickups ----

function P_TouchSpecialThing(special, toucher) {
    const delta = (special.z - toucher.z) | 0
    if (delta > toucher.height || delta < -8 * FRACUNIT) return

    let sound = SFX.sfx_itemup
    const player = toucher.player
    if (toucher.health <= 0) return        // sliding corpse

    const SPR = I.SPR, W = DD.Weapon, A = DD.Ammo, C = DD.Card, pw = DD.Power
    const MF = I.MF
    const st = G.state

    switch (special.sprite) {
        // armour
        case SPR.SPR_ARM1:
            if (!P_GiveArmor(player, 1)) return
            player.message = "Picked up the armor."
            break
        case SPR.SPR_ARM2:
            if (!P_GiveArmor(player, 2)) return
            player.message = "Picked up the MegaArmor!"
            break

        // bonus items
        case SPR.SPR_BON1:
            player.health++                // can go over 100%
            if (player.health > 200) player.health = 200
            player.mo.health = player.health
            player.message = "Picked up a health bonus."
            break
        case SPR.SPR_BON2:
            player.armorpoints++           // can go over 100%
            if (player.armorpoints > 200) player.armorpoints = 200
            if (!player.armortype) player.armortype = 1
            player.message = "Picked up an armor bonus."
            break
        case SPR.SPR_SOUL:
            player.health += 100
            if (player.health > 200) player.health = 200
            player.mo.health = player.health
            player.message = "Supercharge!"
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_MEGA:
            if (st.gamemode !== DD.GameMode.commercial) return
            player.health = 200
            player.mo.health = player.health
            P_GiveArmor(player, 2)
            player.message = "MegaSphere!"
            sound = SFX.sfx_getpow
            break

        // cards: leave for everyone in netgames
        case SPR.SPR_BKEY:
            if (!player.cards[C.bluecard])
                player.message = "Picked up a blue keycard."
            P_GiveCard(player, C.bluecard)
            if (!st.netgame) break
            return
        case SPR.SPR_YKEY:
            if (!player.cards[C.yellowcard])
                player.message = "Picked up a yellow keycard."
            P_GiveCard(player, C.yellowcard)
            if (!st.netgame) break
            return
        case SPR.SPR_RKEY:
            if (!player.cards[C.redcard])
                player.message = "Picked up a red keycard."
            P_GiveCard(player, C.redcard)
            if (!st.netgame) break
            return
        case SPR.SPR_BSKU:
            if (!player.cards[C.blueskull])
                player.message = "Picked up a blue skull key."
            P_GiveCard(player, C.blueskull)
            if (!st.netgame) break
            return
        case SPR.SPR_YSKU:
            if (!player.cards[C.yellowskull])
                player.message = "Picked up a yellow skull key."
            P_GiveCard(player, C.yellowskull)
            if (!st.netgame) break
            return
        case SPR.SPR_RSKU:
            if (!player.cards[C.redskull])
                player.message = "Picked up a red skull key."
            P_GiveCard(player, C.redskull)
            if (!st.netgame) break
            return

        // heals
        case SPR.SPR_STIM:
            if (!P_GiveBody(player, 10)) return
            player.message = "Picked up a stimpack."
            break
        case SPR.SPR_MEDI:
            if (!P_GiveBody(player, 25)) return
            if (player.health < 25)
                player.message = "Picked up a medikit that you REALLY need!"
            else
                player.message = "Picked up a medikit."
            break

        // power ups
        case SPR.SPR_PINV:
            if (!P_GivePower(player, pw.invulnerability)) return
            player.message = "Invulnerability!"
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_PSTR:
            if (!P_GivePower(player, pw.strength)) return
            player.message = "Berserk!"
            if (player.readyweapon !== W.fist)
                player.pendingweapon = W.fist
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_PINS:
            if (!P_GivePower(player, pw.invisibility)) return
            player.message = "Partial Invisibility"
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_SUIT:
            if (!P_GivePower(player, pw.ironfeet)) return
            player.message = "Radiation Shielding Suit"
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_PMAP:
            if (!P_GivePower(player, pw.allmap)) return
            player.message = "Computer Area Map"
            sound = SFX.sfx_getpow
            break
        case SPR.SPR_PVIS:
            if (!P_GivePower(player, pw.infrared)) return
            player.message = "Light Amplification Visor"
            sound = SFX.sfx_getpow
            break

        // ammo
        case SPR.SPR_CLIP:
            if (special.flags & MF.MF_DROPPED) {
                if (!P_GiveAmmo(player, A.clip, 0)) return
            } else {
                if (!P_GiveAmmo(player, A.clip, 1)) return
            }
            player.message = "Picked up a clip."
            break
        case SPR.SPR_AMMO:
            if (!P_GiveAmmo(player, A.clip, 5)) return
            player.message = "Picked up a box of bullets."
            break
        case SPR.SPR_ROCK:
            if (!P_GiveAmmo(player, A.misl, 1)) return
            player.message = "Picked up a rocket."
            break
        case SPR.SPR_BROK:
            if (!P_GiveAmmo(player, A.misl, 5)) return
            player.message = "Picked up a box of rockets."
            break
        case SPR.SPR_CELL:
            if (!P_GiveAmmo(player, A.cell, 1)) return
            player.message = "Picked up an energy cell."
            break
        case SPR.SPR_CELP:
            if (!P_GiveAmmo(player, A.cell, 5)) return
            player.message = "Picked up an energy cell pack."
            break
        case SPR.SPR_SHEL:
            if (!P_GiveAmmo(player, A.shell, 1)) return
            player.message = "Picked up 4 shotgun shells."
            break
        case SPR.SPR_SBOX:
            if (!P_GiveAmmo(player, A.shell, 5)) return
            player.message = "Picked up a box of shotgun shells."
            break
        case SPR.SPR_BPAK:
            if (!player.backpack) {
                for (let i = 0; i < A.NUMAMMO; i++)
                    player.maxammo[i] *= 2
                player.backpack = true
            }
            for (let i = 0; i < A.NUMAMMO; i++)
                P_GiveAmmo(player, i, 1)
            player.message = "Picked up a backpack full of ammo!"
            break

        // weapons
        case SPR.SPR_BFUG:
            if (!P_GiveWeapon(player, W.bfg, false)) return
            player.message = "You got the BFG9000!  Oh, yes."
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_MGUN:
            if (!P_GiveWeapon(player, W.chaingun,
                (special.flags & MF.MF_DROPPED) !== 0)) return
            player.message = "You got the chaingun!"
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_CSAW:
            if (!P_GiveWeapon(player, W.chainsaw, false)) return
            player.message = "A chainsaw!  Find some meat!"
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_LAUN:
            if (!P_GiveWeapon(player, W.missile, false)) return
            player.message = "You got the rocket launcher!"
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_PLAS:
            if (!P_GiveWeapon(player, W.plasma, false)) return
            player.message = "You got the plasma gun!"
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_SHOT:
            if (!P_GiveWeapon(player, W.shotgun,
                (special.flags & MF.MF_DROPPED) !== 0)) return
            player.message = "You got the shotgun!"
            sound = SFX.sfx_wpnup
            break
        case SPR.SPR_SGN2:
            if (!P_GiveWeapon(player, W.supershotgun,
                (special.flags & MF.MF_DROPPED) !== 0)) return
            player.message = "You got the super shotgun!"
            sound = SFX.sfx_wpnup
            break

        default:
            throw Error("P_SpecialThing: unknown gettable thing")
    }

    if (special.flags & MF.MF_COUNTITEM) player.itemcount++
    PM.P_RemoveMobj(special)
    player.bonuscount += BONUSADD
    if (player === st.players[st.consoleplayer])
        S.StartSound(null, sound)
}

// ---- death ----

function P_KillMobj(source, target) {
    const MF = I.MF, MT = I.MT
    const st = G.state

    target.flags &= ~(MF.MF_SHOOTABLE | MF.MF_FLOAT | MF.MF_SKULLFLY)
    if (target.type !== MT.MT_SKULL) target.flags &= ~MF.MF_NOGRAVITY
    target.flags |= MF.MF_CORPSE | MF.MF_DROPOFF
    target.height >>= 2

    if (source && source.player) {
        if (target.flags & MF.MF_COUNTKILL)
            source.player.killcount++
        if (target.player) {
            const ti = st.players.indexOf(target.player)
            source.player.frags[ti]++
        }
    } else if (!st.netgame && (target.flags & MF.MF_COUNTKILL)) {
        st.players[0].killcount++
    }

    if (target.player) {
        if (!source) {
            const ti = st.players.indexOf(target.player)
            target.player.frags[ti]++
        }
        target.flags &= ~MF.MF_SOLID
        target.player.playerstate = DD.PST.DEAD
        if (dropWeapon !== null) dropWeapon(target.player)
        if (target.player === st.players[st.consoleplayer] &&
            st.automapactive) {
            if (amStop !== null) amStop()
        }
    }

    if (target.health < -I.mobjinfo.spawnhealth[target.type] &&
        I.mobjinfo.xdeathstate[target.type]) {
        PM.P_SetMobjState(target, I.mobjinfo.xdeathstate[target.type])
    } else {
        PM.P_SetMobjState(target, I.mobjinfo.deathstate[target.type])
    }
    target.tics -= P_Random() & 3
    if (target.tics < 1) target.tics = 1

    // drop items
    let item
    switch (target.type) {
        case MT.MT_WOLFSS:
        case MT.MT_POSSESSED: item = MT.MT_CLIP; break
        case MT.MT_SHOTGUY: item = MT.MT_SHOTGUN; break
        case MT.MT_CHAINGUY: item = MT.MT_CHAINGUN; break
        default: return
    }
    const mo = PM.P_SpawnMobj(target.x, target.y, DD.ONFLOORZ, item)
    mo.flags |= MF.MF_DROPPED
}

// ---- damage ----

function P_DamageMobj(target, inflictor, source, damage) {
    const MF = I.MF
    const st = G.state

    if (!(target.flags & MF.MF_SHOOTABLE)) return
    if (target.health <= 0) return

    if (target.flags & MF.MF_SKULLFLY)
        target.momx = target.momy = target.momz = 0

    const player = target.player
    if (player && st.gameskill === DD.Skill.baby)
        damage >>= 1            // half damage in trainer mode

    // thrust away (unless chainsaw)
    if (inflictor && !(target.flags & MF.MF_NOCLIP) &&
        (!source || !source.player ||
            source.player.readyweapon !== DD.Weapon.chainsaw)) {
        let ang = RM.R_PointToAngle2(inflictor.x, inflictor.y,
            target.x, target.y)
        // C: damage*(FRACUNIT>>3)*100/mass with int32 wraparound at each
        // step -- telefrag-sized damage (10000) overflows like vanilla
        let thrust = T.IDiv(Math.imul(Math.imul(damage, FRACUNIT >> 3), 100),
            I.mobjinfo.mass[target.type]) | 0

        // fall forwards sometimes
        if (damage < 40 && damage > target.health &&
            target.z - inflictor.z > 64 * FRACUNIT && (P_Random() & 1)) {
            ang = (ang + ANG180) >>> 0
            thrust *= 4
        }

        const fa = ang >>> 19
        target.momx = (target.momx + T.FixedMul(thrust, T.finecosine[fa])) | 0
        target.momy = (target.momy + T.FixedMul(thrust, T.finesine[fa])) | 0
    }

    if (player) {
        // end of game hell hack
        if (L.sec_special[L.ssec_sector[target.subsector]] === 11 &&
            damage >= target.health) {
            damage = target.health - 1
        }

        // god mode / invulnerability
        if (damage < 1000 && ((player.cheats & DD.CF.GODMODE) ||
            player.powers[DD.Power.invulnerability]))
            return

        if (player.armortype) {
            let saved = player.armortype === 1
                ? ((damage / 3) | 0) : ((damage / 2) | 0)
            if (player.armorpoints <= saved) {
                saved = player.armorpoints
                player.armortype = 0
            }
            player.armorpoints -= saved
            damage -= saved
        }
        player.health -= damage
        if (player.health < 0) player.health = 0

        player.attacker = source
        player.damagecount += damage
        if (player.damagecount > 100) player.damagecount = 100
    }

    target.health -= damage
    if (target.health <= 0) {
        P_KillMobj(source, target)
        return
    }

    if (P_Random() < I.mobjinfo.painchance[target.type] &&
        !(target.flags & MF.MF_SKULLFLY)) {
        target.flags |= MF.MF_JUSTHIT      // fight back!
        PM.P_SetMobjState(target, I.mobjinfo.painstate[target.type])
    }

    target.reactiontime = 0                // we're awake now

    if ((!target.threshold || target.type === I.MT.MT_VILE) &&
        source && source !== target && source.type !== I.MT.MT_VILE) {
        // chase after the attacker
        target.target = source
        target.threshold = BASETHRESHOLD
        if (target.state === I.mobjinfo.spawnstate[target.type] &&
            I.mobjinfo.seestate[target.type] !== I.S.S_NULL)
            PM.P_SetMobjState(target, I.mobjinfo.seestate[target.type])
    }
}

// hooks installed later (p_pspr M6, am_map M7)
let dropWeapon = null
let amStop = null

let SFX = null

exports = {
    P_GiveAmmo, P_GiveWeapon, P_GiveBody, P_GiveArmor, P_GiveCard,
    P_GivePower, P_TouchSpecialThing, P_KillMobj, P_DamageMobj,
    maxammo, clipammo,
    getWeaponinfo: () => weaponinfo,
    setDropWeapon: (fn) => { dropWeapon = fn },
    setAmStop: (fn) => { amStop = fn },
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PM = D.p_mobj; RM = D.r_main; L = D.p_setup.level
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
        buildWeaponinfo()
        if (D.p_pspr !== undefined) dropWeapon = D.p_pspr.P_DropWeapon
    },
}
