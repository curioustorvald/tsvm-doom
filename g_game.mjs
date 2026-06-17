// g_game.mjs -- game state, ticcmd building, level orchestration (g_game.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// M5 scope: state object, G_BuildTiccmd (keyboard), G_InitNew/G_DoLoadLevel,
// G_PlayerReborn, exit recording. Demo I/O and the episode/intermission flow
// arrive with M6/M7.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, PT = null, PM = null
let PMap = null, PS = null, PSet = null, PInter = null, RM = null, RD = null
let W = null, L = null

// ---- shared game state (vanilla doomstat.h globals) ----

const state = {
    gamemode: 4,                // GameMode.indetermined
    gameskill: 2,
    gameepisode: 1,
    gamemap: 1,
    respawnmonsters: false,
    netgame: false,
    deathmatch: 0,
    nomonsters: false,
    fastparm: false,
    gamestate: 3,               // GS.DEMOSCREEN until a game starts
    paused: false,
    menuactive: false,
    automapactive: false,
    demoplayback: false,
    demorecording: false,
    usergame: false,
    leveltime: 0,
    gametic: 0,
    totalkills: 0, totalitems: 0, totalsecret: 0,
    consoleplayer: 0,
    playeringame: [true, false, false, false],
    players: [],
    // level exit bookkeeping (M7 turns this into the episode flow)
    exitRequested: false,
    secretExit: false,
}

// ---- ticcmd building (g_game.c) ----

const forwardmove = [0x19, 0x32]
const sidemove = [0x18, 0x28]
const angleturn = [640, 1280, 320]      // [2] = slow turn
const SLOWTURNTICS = 6
const NUMKEYS = 256
const FRACUNIT = 65536
const SCREENWIDTH = _G.DOOM.SCREENWIDTH

// live mouse input, written by i_input every poll. Absolute cursor fraction
// (0..1 across the screen), button bits, and an `active` gate; the whole
// mouse path is skipped when inactive (demos, tests, kbd-only). See the
// _G.DOOM.MOUSE tunables published by wadplayer.js.
const mouseInput = { fracX: 0.5, left: 0, right: 0, active: false }
function setMouseInput(fracX, left, right, active) {
    mouseInput.fracX = fracX
    mouseInput.left = left
    mouseInput.right = right
    mouseInput.active = !!active
}

// keyboard state, indexed by raw libGDX keycode (filled by i_input)
const gamekeydown = new Uint8Array(NUMKEYS)

// default bindings (raw libGDX codes; doomrc overrides in M10)
const keys = {
    up: 19, down: 20, left: 21, right: 22,
    w: 51, a: 29, s: 47, d: 32,
    strafeleft: 29, straferight: 32,    // A/D strafe like modern defaults
    fire: 129,                          // left ctrl
    use: 62,                            // space
    strafe: 57,                         // left alt
    speed: 59,                          // left shift
    weap1: 8, weap2: 9, weap3: 10, weap4: 11,
    weap5: 12, weap6: 13, weap7: 14,
}

let turnheld = 0
let autorun = false             // doomrc [options] autorun: invert the run key

function G_BuildTiccmd(cmd) {
    cmd.forwardmove = 0
    cmd.sidemove = 0
    cmd.angleturn = 0
    cmd.chatchar = 0
    cmd.buttons = 0
    cmd.consistancy = 0

    const strafeOn = gamekeydown[keys.strafe]
    const speed = (gamekeydown[keys.speed] ? 1 : 0) ^ (autorun ? 1 : 0)

    let forward = 0
    let side = 0

    // use two stage accelerative turning on the keyboard
    if (gamekeydown[keys.right] || gamekeydown[keys.left]) turnheld++
    else turnheld = 0
    const tspeed = (turnheld < SLOWTURNTICS) ? 2 : speed

    if (strafeOn) {
        if (gamekeydown[keys.right]) side += sidemove[speed]
        if (gamekeydown[keys.left]) side -= sidemove[speed]
    } else {
        if (gamekeydown[keys.right]) cmd.angleturn -= angleturn[tspeed]
        if (gamekeydown[keys.left]) cmd.angleturn += angleturn[tspeed]
    }

    if (gamekeydown[keys.up] || gamekeydown[keys.w])
        forward += forwardmove[speed]
    if (gamekeydown[keys.down] || gamekeydown[keys.s])
        forward -= forwardmove[speed]
    if (gamekeydown[keys.straferight]) side += sidemove[speed]
    if (gamekeydown[keys.strafeleft]) side -= sidemove[speed]

    if (gamekeydown[keys.fire]) cmd.buttons |= DD.BT.ATTACK
    if (gamekeydown[keys.use]) cmd.buttons |= DD.BT.USE

    // weapon change
    const weapkeys = [keys.weap1, keys.weap2, keys.weap3, keys.weap4,
        keys.weap5, keys.weap6, keys.weap7]
    for (let i = 0; i < 7; i++) {
        if (gamekeydown[weapkeys[i]]) {
            cmd.buttons |= DD.BT.CHANGE
            cmd.buttons |= i << DD.BT.WEAPONSHIFT
            break
        }
    }

    G_ApplyMouse(cmd)

    const MAXPLMOVE = forwardmove[1]
    if (forward > MAXPLMOVE) forward = MAXPLMOVE
    else if (forward < -MAXPLMOVE) forward = -MAXPLMOVE
    if (side > MAXPLMOVE) side = MAXPLMOVE
    else if (side < -MAXPLMOVE) side = -MAXPLMOVE

    cmd.forwardmove += forward
    cmd.sidemove += side
}

// Mouse steering + free aim (TSVM extension). Splits the screen into a centre
// dead-zone 'a' (no turn, free aim only) and left/right wings 'b' (turn, speed
// ramping from ~0 at the inner edge to MAXTURNSPEED at the screen edge). The
// weapon and the bullets follow the cursor across the WHOLE screen, so aiming
// works in both zones. Tunables live under _G.DOOM.MOUSE. A no-op for kbd-only
// play, demos and the headless tests (mouseInput.active stays false there).
function G_ApplyMouse(cmd) {
    const M = (typeof _G !== "undefined" && _G.DOOM) ? _G.DOOM.MOUSE : null
    if (!M || M.ENABLE === false || !mouseInput.active) return

    const player = state.players[state.consoleplayer]
    if (!player || !player.mo) return

    const fx = mouseInput.fracX             // 0..1 across the screen
    const d = fx - 0.5                      // signed offset from the centre

    // 'a' dead-zone reaches +/- half; each wing 'b' is the remainder
    const centreFrac = (M.CENTREWIDTH !== undefined) ? M.CENTREWIDTH : 0.5
    const half = centreFrac * 0.5
    const wing = 0.5 - half

    // wing -> camera turn. angleturn sign matches the keyboard (left = +).
    if (wing > 0 && (d > half || d < -half)) {
        const maxturn = (M.MAXTURNSPEED !== undefined) ? M.MAXTURNSPEED : 1600
        const gamma = (M.TURNGAMMA !== undefined) ? M.TURNGAMMA : 1.0
        if (d > half) {                     // right wing
            let t = (d - half) / wing
            if (t > 1) t = 1
            cmd.angleturn = (cmd.angleturn - maxturn * Math.pow(t, gamma)) | 0
        } else {                            // left wing
            let t = (-d - half) / wing
            if (t > 1) t = 1
            cmd.angleturn = (cmd.angleturn + maxturn * Math.pow(t, gamma)) | 0
        }
    }

    // free aim: map the cursor column to a view angle (xtoviewangle, exact for
    // the firing direction) and to a weapon x-offset (160-based, like the
    // psprite renderer). Read back by p_pspr (bullets) and r_things (hand).
    const vw = RM.getViewwidth()
    let ixv = Math.round(fx * vw)
    if (ixv < 0) ixv = 0; else if (ixv > vw) ixv = vw
    player.aimAngleOffset = RM.xtoviewangle[ixv] | 0

    const follow = (M.HANDFOLLOW !== undefined) ? M.HANDFOLLOW : 1.0
    let ixs = Math.round(fx * SCREENWIDTH)
    if (ixs < 0) ixs = 0; else if (ixs > SCREENWIDTH) ixs = SCREENWIDTH
    player.aimPspriteOffset = ((ixs - (SCREENWIDTH >> 1)) * FRACUNIT * follow) | 0

    // natural mouse buttons: left fires, right uses
    if (mouseInput.left) cmd.buttons |= DD.BT.ATTACK
    if (mouseInput.right) cmd.buttons |= DD.BT.USE
}

// ---- player reborn (g_game.c G_PlayerReborn) ----

function G_PlayerReborn(playernum) {
    const p = state.players[playernum]
    const frags = Int32Array.from(p.frags)
    const killcount = p.killcount
    const itemcount = p.itemcount
    const secretcount = p.secretcount

    // vanilla memsets the struct in place: identity must be preserved
    // (callers hold references to this player object)
    Object.assign(p, DD.makePlayer())
    p.frags.set(frags)
    p.killcount = killcount
    p.itemcount = itemcount
    p.secretcount = secretcount

    p.usedown = p.attackdown = true     // don't do anything immediately
    p.playerstate = DD.PST.LIVE
    p.health = 100                      // MAXHEALTH
    p.readyweapon = p.pendingweapon = DD.Weapon.pistol
    p.weaponowned[DD.Weapon.fist] = 1
    p.weaponowned[DD.Weapon.pistol] = 1
    p.ammo[DD.Ammo.clip] = 50
    for (let i = 0; i < DD.Ammo.NUMAMMO; i++)
        p.maxammo[i] = PInter.maxammo[i]
    return p
}

// ---- level loading orchestration ----

function G_InitNew(skill, episode, map) {
    if (state.paused) state.paused = false

    if (skill > DD.Skill.nightmare) skill = DD.Skill.nightmare

    // episode clamping (registered: 1-3)
    if (episode < 1) episode = 1
    if (state.gamemode === DD.GameMode.retail) {
        if (episode > 4) episode = 4
    } else if (state.gamemode === DD.GameMode.shareware) {
        if (episode > 1) episode = 1
    } else {
        if (episode > 3) episode = 3
    }
    if (map < 1) map = 1
    if (map > 9 && state.gamemode !== DD.GameMode.commercial) map = 9

    R.M_ClearRandom()

    state.respawnmonsters =
        (skill === DD.Skill.nightmare || respawnparm)

    // fast-monster adjustments mutate the generated tables, exactly like
    // vanilla pokes states[] / mobjinfo[] (compares OLD gameskill)
    const NM = DD.Skill.nightmare
    const MT = I.MT
    if (state.fastparm || (skill === NM && state.gameskill !== NM)) {
        for (let i = I.S.S_SARG_RUN1; i <= I.S.S_SARG_PAIN2; i++)
            I.stateTics[i] >>= 1
        I.mobjinfo.speed[MT.MT_BRUISERSHOT] = 20 * 65536
        I.mobjinfo.speed[MT.MT_HEADSHOT] = 20 * 65536
        I.mobjinfo.speed[MT.MT_TROOPSHOT] = 20 * 65536
    } else if (skill !== NM && state.gameskill === NM) {
        for (let i = I.S.S_SARG_RUN1; i <= I.S.S_SARG_PAIN2; i++)
            I.stateTics[i] <<= 1
        I.mobjinfo.speed[MT.MT_BRUISERSHOT] = 15 * 65536
        I.mobjinfo.speed[MT.MT_HEADSHOT] = 10 * 65536
        I.mobjinfo.speed[MT.MT_TROOPSHOT] = 10 * 65536
    }

    // force players to be initialized upon first level load
    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        if (state.players[i] === undefined)
            state.players[i] = DD.makePlayer()
        state.players[i].playerstate = DD.PST.REBORN
    }

    state.usergame = true
    state.paused = false
    state.demoplayback = false
    state.automapactive = false
    state.gamestate = DD.GS.LEVEL
    state.gameepisode = episode
    state.gamemap = map
    state.gameskill = skill

    G_DoLoadLevel()
}

function G_DoLoadLevel() {
    // sky per episode (DOOM 1); commercial logic arrives with DOOM2 support
    RM.setSkytexture(RD.R_TextureNumForName("SKY" + state.gameepisode))

    state.leveltime = 0
    state.totalkills = 0
    state.totalitems = 0
    state.totalsecret = 0
    state.exitRequested = false
    state.secretExit = false

    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        if (state.playeringame[i] &&
            state.players[i].playerstate === DD.PST.DEAD)
            state.players[i].playerstate = DD.PST.REBORN
        state.players[i].frags.fill(0)
        // vanilla P_SetupLevel zeroes these per level; without it, kills
        // from attract demos / previous maps leak into the intermission
        // percentages (the 350%-kills bug)
        state.players[i].killcount = 0
        state.players[i].itemcount = 0
        state.players[i].secretcount = 0
    }

    PT.P_InitThinkers()
    PM.P_ResetRespawnQueue()
    PSet.setSpawnMapThing(PM.P_SpawnMapThing)
    PSet.P_SetupLevel(state.gameepisode, state.gamemap)
    PS.P_SpawnSpecials()
    if (sStart !== null) sStart()       // level music + stop stale sounds

    state.players[state.consoleplayer].viewz = 1    // 'not rendered yet' mark
    gamekeydown.fill(0)
}

// ---- gameaction state machine (g_game.c G_Ticker head) ----

const GA = {
    nothing: 0, loadlevel: 1, newgame: 2, loadgame: 3, savegame: 4,
    playdemo: 5, completed: 6, victory: 7, worlddone: 8, screenshot: 9,
}
let gameaction = GA.nothing

// DOOM 1 par times (seconds), [episode][map]
const pars = [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 30, 75, 120, 90, 165, 180, 180, 30, 165],
    [0, 90, 90, 90, 120, 90, 360, 240, 30, 170],
    [0, 90, 45, 90, 150, 90, 90, 165, 30, 135],
]

// intermission parameters (wbstartstruct_t)
const wminfo = {
    epsd: 0, didsecret: false, last: 0, next: 0,
    maxkills: 0, maxitems: 0, maxsecret: 0, maxfrags: 0,
    partime: 0, pnum: 0,
    plyr: [],
}
for (let i = 0; i < 4; i++)
    wminfo.plyr.push({ inGame: false, skills: 0, sitems: 0, ssecret: 0,
        stime: 0, frags: new Int32Array(4) })

function G_ExitLevel() {
    secretexit = false
    gameaction = GA.completed
    state.exitRequested = true          // headless demo driver flag
    state.secretExit = false
}

function G_SecretExitLevel() {
    secretexit = true
    gameaction = GA.completed
    state.exitRequested = true
    state.secretExit = true
}

let secretexit = false
let d_skill = 0, d_episode = 0, d_map = 0

function G_DeferedInitNew(skill, episode, map) {
    d_skill = skill
    d_episode = episode
    d_map = map
    gameaction = GA.newgame
}

function G_DoNewGame() {
    state.demoplayback = false
    state.netgame = false
    state.deathmatch = 0
    state.playeringame[1] = state.playeringame[2] = state.playeringame[3] = false
    respawnparm = false
    state.fastparm = false
    state.nomonsters = false
    state.consoleplayer = 0
    G_InitNew(d_skill, d_episode, d_map)
    gameaction = GA.nothing
}

function G_PlayerFinishLevel(i) {
    const p = state.players[i]
    p.powers.fill(0)
    p.cards.fill(0)
    p.mo.flags &= ~I.MF.MF_SHADOW       // cancel invisibility
    p.extralight = 0
    p.fixedcolormap = 0
    p.damagecount = 0
    p.bonuscount = 0
}

function G_DoCompleted() {
    gameaction = GA.nothing

    for (let i = 0; i < DD.MAXPLAYERS; i++)
        if (state.playeringame[i]) G_PlayerFinishLevel(i)

    if (state.automapactive && amStop !== null) amStop()

    if (state.gamemode !== DD.GameMode.commercial) {
        if (state.gamemap === 8) {
            gameaction = GA.victory
            return
        }
        if (state.gamemap === 9) {
            for (let i = 0; i < DD.MAXPLAYERS; i++)
                state.players[i].didsecret = true
        }
    }

    wminfo.didsecret = state.players[state.consoleplayer].didsecret
    wminfo.epsd = state.gameepisode - 1
    wminfo.last = state.gamemap - 1

    // wminfo.next is 0-based, unlike gamemap
    if (secretexit) {
        wminfo.next = 8                 // go to secret level
    } else if (state.gamemap === 9) {
        // returning from secret level
        switch (state.gameepisode) {
            case 1: wminfo.next = 3; break
            case 2: wminfo.next = 5; break
            case 3: wminfo.next = 6; break
            case 4: wminfo.next = 2; break
        }
    } else {
        wminfo.next = state.gamemap
    }

    wminfo.maxkills = state.totalkills
    wminfo.maxitems = state.totalitems
    wminfo.maxsecret = state.totalsecret
    wminfo.maxfrags = 0
    wminfo.partime = 35 * pars[state.gameepisode][state.gamemap]
    wminfo.pnum = state.consoleplayer

    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        wminfo.plyr[i].inGame = state.playeringame[i]
        wminfo.plyr[i].skills = state.players[i].killcount
        wminfo.plyr[i].sitems = state.players[i].itemcount
        wminfo.plyr[i].ssecret = state.players[i].secretcount
        wminfo.plyr[i].stime = state.leveltime
        wminfo.plyr[i].frags.set(state.players[i].frags)
    }

    state.gamestate = DD.GS.INTERMISSION
    state.automapactive = false
    if (wiStart !== null) wiStart(wminfo)
}

function G_WorldDone() {
    gameaction = GA.worlddone
    if (secretexit)
        state.players[state.consoleplayer].didsecret = true
}

function G_DoWorldDone() {
    state.gamestate = DD.GS.LEVEL
    state.gamemap = wminfo.next + 1
    G_DoLoadLevel()
    gameaction = GA.nothing
}

// single player: reload the level on death + use
function G_DoReborn(playernum) {
    if (!state.netgame) gameaction = GA.loadlevel
}

// full game ticker: reborns, gameaction dispatch, per-state tickers
function G_Ticker(buildCmd) {
    for (let i = 0; i < DD.MAXPLAYERS; i++)
        if (state.playeringame[i] &&
            state.players[i].playerstate === DD.PST.REBORN)
            G_DoReborn(i)

    while (gameaction !== GA.nothing) {
        switch (gameaction) {
            case GA.loadlevel: G_DoLoadLevel(); gameaction = GA.nothing; break
            case GA.newgame: G_DoNewGame(); break
            case GA.completed: G_DoCompleted(); break
            case GA.victory:
                if (fStartFinale !== null) fStartFinale()
                gameaction = GA.nothing
                state.gamestate = DD.GS.FINALE
                break
            case GA.worlddone: G_DoWorldDone(); break
            case GA.savegame:
                if (doSaveGame !== null) doSaveGame(pendingSlot, pendingDesc)
                gameaction = GA.nothing
                break
            case GA.loadgame:
                if (doLoadGame !== null) doLoadGame(pendingSlot)
                gameaction = GA.nothing
                break
            default: gameaction = GA.nothing; break
        }
    }

    // get commands
    if (state.demoplayback) {
        for (let i = 0; i < DD.MAXPLAYERS; i++) {
            if (state.playeringame[i]) {
                G_ReadDemoTiccmd(state.players[i].cmd)
                if (demoEnded) return
            }
        }
    } else if (buildCmd !== undefined) {
        buildCmd()
    }

    state.gametic++

    switch (state.gamestate) {
        case DD.GS.LEVEL:
            PT.P_Ticker()
            if (stTicker !== null) stTicker()
            if (huTicker !== null) huTicker()
            break
        case DD.GS.INTERMISSION:
            if (wiTicker !== null) wiTicker()
            break
        case DD.GS.FINALE:
            if (fTicker !== null) fTicker()
            break
    }
}

// deferred save/load (g_game.c G_SaveGame / G_LoadGame)
let pendingSlot = 0
let pendingDesc = ""

function G_SaveGame(slot, description) {
    pendingSlot = slot
    pendingDesc = description
    gameaction = GA.savegame
}

function G_LoadGame(slot) {
    pendingSlot = slot
    gameaction = GA.loadgame
}

// shell hooks (wired by doom.js after all modules init)
let amStop = null
let wiStart = null, wiTicker = null
let fStartFinale = null, fTicker = null
let stTicker = null, huTicker = null
let doSaveGame = null, doLoadGame = null
let sStart = null

let respawnparm = false

// ---- demo playback (g_game.c G_DoPlayDemo / G_ReadDemoTiccmd) ----

const DEMOMARKER = 0x80
let demobuffer = null
let demo_p = 0
let demoEnded = false

function G_ReadDemoTiccmd(cmd) {
    if (demobuffer[demo_p] === DEMOMARKER) {
        demoEnded = true
        return
    }
    cmd.forwardmove = (demobuffer[demo_p++] << 24) >> 24    // signed char
    cmd.sidemove = (demobuffer[demo_p++] << 24) >> 24
    cmd.angleturn = demobuffer[demo_p++] << 8
    cmd.buttons = demobuffer[demo_p++]
    cmd.chatchar = 0
    cmd.consistancy = 0
}

// header: version, skill, episode, map, deathmatch, respawn, fast,
// nomonsters, consoleplayer, playeringame[4]
function G_DoPlayDemo(lumpname) {
    demobuffer = W.W_CacheLumpName(lumpname)
    demo_p = 0
    const version = demobuffer[demo_p++]
    if (version !== DD.VERSION)
        throw Error("Demo is from a different game version (" + version + ")")

    const skill = demobuffer[demo_p++]
    const episode = demobuffer[demo_p++]
    const map = demobuffer[demo_p++]
    state.deathmatch = demobuffer[demo_p++]
    respawnparm = demobuffer[demo_p++] !== 0
    state.fastparm = demobuffer[demo_p++] !== 0
    state.nomonsters = demobuffer[demo_p++] !== 0
    state.consoleplayer = demobuffer[demo_p++]
    for (let i = 0; i < DD.MAXPLAYERS; i++)
        state.playeringame[i] = demobuffer[demo_p++] !== 0
    if (state.playeringame[1]) state.netgame = true

    G_InitNew(skill, episode, map)
    state.usergame = false
    state.demoplayback = true
    demoEnded = false
}

// one demo tic: read each ingame player's cmd, then run the playsim.
// Returns false when the demo has ended (marker or level exit).
function G_DemoTic() {
    if (demoEnded || state.exitRequested) return false
    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        if (state.playeringame[i]) {
            G_ReadDemoTiccmd(state.players[i].cmd)
            if (demoEnded) return false
        }
    }
    PT.P_Ticker()
    state.gametic++
    return !demoEnded && !state.exitRequested
}

function G_DemoEnded() { return demoEnded }

exports = {
    state, gamekeydown, keys, wminfo, GA,
    G_BuildTiccmd, G_PlayerReborn, G_InitNew, G_DoLoadLevel,
    G_ExitLevel, G_SecretExitLevel, G_DeferedInitNew,
    G_Ticker, G_WorldDone, G_DoCompleted,
    G_SaveGame, G_LoadGame,
    G_DoPlayDemo, G_DemoTic, G_DemoEnded, G_ReadDemoTiccmd,
    setMouseInput,
    getGameaction: () => gameaction,
    setGameaction: (a) => { gameaction = a },
    setRespawnparm: (b) => { respawnparm = b },
    setAutorun: (b) => { autorun = !!b },
    getAutorun: () => autorun,
    setShellHooks: (h) => {
        if (h.amStop !== undefined) amStop = h.amStop
        if (h.wiStart !== undefined) wiStart = h.wiStart
        if (h.wiTicker !== undefined) wiTicker = h.wiTicker
        if (h.fStartFinale !== undefined) fStartFinale = h.fStartFinale
        if (h.fTicker !== undefined) fTicker = h.fTicker
        if (h.stTicker !== undefined) stTicker = h.stTicker
        if (h.huTicker !== undefined) huTicker = h.huTicker
        if (h.doSaveGame !== undefined) doSaveGame = h.doSaveGame
        if (h.doLoadGame !== undefined) doLoadGame = h.doLoadGame
        if (h.sStart !== undefined) sStart = h.sStart
    },
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        PT = D.p_tick; PM = D.p_mobj; PMap = D.p_map; PS = D.p_spec
        PSet = D.p_setup; PInter = D.p_inter; RM = D.r_main
        RD = D.r_data; W = D.w_wad; L = D.p_setup.level
        for (let i = 0; i < 4; i++) state.players.push(DD.makePlayer())
    },
}
