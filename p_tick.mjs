// p_tick.mjs -- thinkers and per-tic orchestration (p_tick.c) plus
// player thinking (p_user.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Thinker list discipline is demo-critical: doubly-linked with a sentinel
// (thinkercap), lazy removal (tfunc === REMOVED swept during the run),
// iteration order exactly as vanilla.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, G = null, PM = null, PMap = null, PS = null
let I = null, RM = null, L = null

const FRACUNIT = 65536
const MAXBOB = 0x100000
const INVERSECOLORMAP = 32
const ANG5 = 59652323           // trunc(ANG90/18): C integer division
const ANG90 = 0x40000000
const ANG180 = 0x80000000

// removal sentinel for tfunc
const REMOVED = -1

// thinkercap: sentinel of the circular doubly-linked thinker list
const thinkercap = { prev: null, next: null, tfunc: null }
thinkercap.prev = thinkercap.next = thinkercap

function P_InitThinkers() {
    thinkercap.prev = thinkercap.next = thinkercap
}

function P_AddThinker(thinker) {
    thinkercap.prev.next = thinker
    thinker.next = thinkercap
    thinker.prev = thinkercap.prev
    thinkercap.prev = thinker
}

function P_RemoveThinker(thinker) {
    thinker.tfunc = REMOVED
}

function P_RunThinkers() {
    let currentthinker = thinkercap.next
    while (currentthinker !== thinkercap) {
        if (currentthinker.tfunc === REMOVED) {
            currentthinker.next.prev = currentthinker.prev
            currentthinker.prev.next = currentthinker.next
        } else if (currentthinker.tfunc !== null) {
            currentthinker.tfunc(currentthinker)
        }
        currentthinker = currentthinker.next
    }
}

// ---- p_user.c ----

let onground = false

function P_Thrust(player, angle, move) {
    const a = (angle >>> 19) & 8191
    player.mo.momx = (player.mo.momx + T.FixedMul(move, T.finecosine[a])) | 0
    player.mo.momy = (player.mo.momy + T.FixedMul(move, T.finesine[a])) | 0
}

function P_CalcHeight(player) {
    const VIEWHEIGHT = DD.VIEWHEIGHT
    player.bob = (T.FixedMul(player.mo.momx, player.mo.momx) +
        T.FixedMul(player.mo.momy, player.mo.momy)) | 0
    player.bob >>= 2
    if (player.bob > MAXBOB) player.bob = MAXBOB

    if ((player.cheats & DD.CF.NOMOMENTUM) || !onground) {
        player.viewz = (player.mo.z + VIEWHEIGHT) | 0
        if (player.viewz > player.mo.ceilingz - 4 * FRACUNIT)
            player.viewz = (player.mo.ceilingz - 4 * FRACUNIT) | 0
        player.viewz = (player.mo.z + player.viewheight) | 0
        return
    }

    // C: (FINEANGLES/20*leveltime) -- the division truncates FIRST (409)
    const angle = (409 * G.state.leveltime) & 8191
    const bob = T.FixedMul((player.bob / 2) | 0, T.finesine[angle])

    if (player.playerstate === DD.PST.LIVE) {
        player.viewheight = (player.viewheight + player.deltaviewheight) | 0
        if (player.viewheight > VIEWHEIGHT) {
            player.viewheight = VIEWHEIGHT
            player.deltaviewheight = 0
        }
        if (player.viewheight < VIEWHEIGHT / 2) {
            player.viewheight = VIEWHEIGHT / 2
            if (player.deltaviewheight <= 0) player.deltaviewheight = 1
        }
        if (player.deltaviewheight) {
            player.deltaviewheight = (player.deltaviewheight + FRACUNIT / 4) | 0
            if (player.deltaviewheight === 0) player.deltaviewheight = 1
        }
    }
    player.viewz = (player.mo.z + player.viewheight + bob) | 0
    if (player.viewz > player.mo.ceilingz - 4 * FRACUNIT)
        player.viewz = (player.mo.ceilingz - 4 * FRACUNIT) | 0
}

function P_MovePlayer(player) {
    const cmd = player.cmd
    player.mo.angle = (player.mo.angle + (cmd.angleturn << 16)) | 0

    onground = player.mo.z <= player.mo.floorz

    if (cmd.forwardmove && onground)
        P_Thrust(player, player.mo.angle, cmd.forwardmove * 2048)
    if (cmd.sidemove && onground)
        P_Thrust(player, (player.mo.angle - ANG90) | 0, cmd.sidemove * 2048)

    if ((cmd.forwardmove || cmd.sidemove) &&
        player.mo.state === I.S.S_PLAY) {
        PM.P_SetMobjState(player.mo, I.S.S_PLAY_RUN1)
    }
}

function P_DeathThink(player) {
    if (movePsprites !== null) movePsprites(player)

    // fall to the ground
    if (player.viewheight > 6 * FRACUNIT)
        player.viewheight = (player.viewheight - FRACUNIT) | 0
    if (player.viewheight < 6 * FRACUNIT)
        player.viewheight = 6 * FRACUNIT
    player.deltaviewheight = 0
    onground = player.mo.z <= player.mo.floorz
    P_CalcHeight(player)

    if (player.attacker && player.attacker !== player.mo) {
        const angle = RM.R_PointToAngle2(player.mo.x, player.mo.y,
            player.attacker.x, player.attacker.y)
        const delta = (angle - player.mo.angle) >>> 0
        if (delta < ANG5 || delta > ((0 - ANG5) >>> 0)) {
            // looking at killer: fade damage flash
            player.mo.angle = angle | 0
            if (player.damagecount) player.damagecount--
        } else if (delta < ANG180) {
            player.mo.angle = (player.mo.angle + ANG5) | 0
        } else {
            player.mo.angle = (player.mo.angle - ANG5) | 0
        }
    } else if (player.damagecount) {
        player.damagecount--
    }

    if (player.cmd.buttons & DD.BT.USE)
        player.playerstate = DD.PST.REBORN
}

function P_PlayerThink(player) {
    const MF = I.MF
    if (player.cheats & DD.CF.NOCLIP) player.mo.flags |= MF.MF_NOCLIP
    else player.mo.flags &= ~MF.MF_NOCLIP

    // chainsaw run forward
    const cmd = player.cmd
    if (player.mo.flags & MF.MF_JUSTATTACKED) {
        cmd.angleturn = 0
        cmd.forwardmove = 0xc800 / 512
        cmd.sidemove = 0
        player.mo.flags &= ~MF.MF_JUSTATTACKED
    }

    if (player.playerstate === DD.PST.DEAD) {
        P_DeathThink(player)
        return
    }

    // reactiontime freezes movement after a teleport
    if (player.mo.reactiontime) player.mo.reactiontime--
    else P_MovePlayer(player)

    P_CalcHeight(player)

    if (L.sec_special[mobjSector(player.mo)])
        PS.P_PlayerInSpecialSector(player)

    // weapon changes
    if (cmd.buttons & DD.BT.SPECIAL) cmd.buttons = 0

    if (cmd.buttons & DD.BT.CHANGE) {
        let newweapon = (cmd.buttons & DD.BT.WEAPONMASK) >> DD.BT.WEAPONSHIFT
        const W = DD.Weapon
        if (newweapon === W.fist && player.weaponowned[W.chainsaw] &&
            !(player.readyweapon === W.chainsaw &&
                player.powers[DD.Power.strength])) {
            newweapon = W.chainsaw
        }
        if (G.state.gamemode === DD.GameMode.commercial &&
            newweapon === W.shotgun &&
            player.weaponowned[W.supershotgun] &&
            player.readyweapon !== W.supershotgun) {
            newweapon = W.supershotgun
        }
        if (player.weaponowned[newweapon] && newweapon !== player.readyweapon) {
            if ((newweapon !== W.plasma && newweapon !== W.bfg) ||
                G.state.gamemode !== DD.GameMode.shareware) {
                player.pendingweapon = newweapon
            }
        }
    }

    // use
    if (cmd.buttons & DD.BT.USE) {
        if (!player.usedown) {
            PMap.P_UseLines(player)
            player.usedown = true
        }
    } else {
        player.usedown = false
    }

    if (movePsprites !== null) movePsprites(player)

    // powerup counters
    const pw = DD.Power
    if (player.powers[pw.strength]) player.powers[pw.strength]++
    if (player.powers[pw.invulnerability]) player.powers[pw.invulnerability]--
    if (player.powers[pw.invisibility]) {
        if (!--player.powers[pw.invisibility])
            player.mo.flags &= ~I.MF.MF_SHADOW
    }
    if (player.powers[pw.infrared]) player.powers[pw.infrared]--
    if (player.powers[pw.ironfeet]) player.powers[pw.ironfeet]--
    if (player.damagecount) player.damagecount--
    if (player.bonuscount) player.bonuscount--

    // colormaps
    if (player.powers[pw.invulnerability]) {
        if (player.powers[pw.invulnerability] > 4 * 32 ||
            (player.powers[pw.invulnerability] & 8))
            player.fixedcolormap = INVERSECOLORMAP
        else player.fixedcolormap = 0
    } else if (player.powers[pw.infrared]) {
        if (player.powers[pw.infrared] > 4 * 32 ||
            (player.powers[pw.infrared] & 8))
            player.fixedcolormap = 1
        else player.fixedcolormap = 0
    } else {
        player.fixedcolormap = 0
    }
}

function mobjSector(mo) { return L.ssec_sector[mo.subsector] }

// ---- P_Ticker ----

function P_Ticker() {
    const st = G.state
    if (st.paused) return
    // pause in menu (single-player) after at least one tic
    if (!st.netgame && st.menuactive && !st.demoplayback &&
        st.players[st.consoleplayer].viewz !== 1)
        return

    for (let i = 0; i < DD.MAXPLAYERS; i++)
        if (st.playeringame[i]) P_PlayerThink(st.players[i])

    P_RunThinkers()
    PS.P_UpdateSpecials()
    PM.P_RespawnSpecials()

    st.leveltime++
}

// p_pspr hook (M6)
let movePsprites = null

exports = {
    P_InitThinkers, P_AddThinker, P_RemoveThinker, P_RunThinkers,
    P_Ticker, P_PlayerThink, P_CalcHeight, P_Thrust,
    REMOVED, thinkercap,
    setMovePsprites: (fn) => { movePsprites = fn },
    init: function (D) {
        DD = D.defs; T = D.tables; G = D.g_game; PM = D.p_mobj
        PMap = D.p_map; PS = D.p_spec; I = D.info; RM = D.r_main
        L = D.p_setup.level
        if (D.p_pspr !== undefined) movePsprites = D.p_pspr.P_MovePsprites
    },
}
