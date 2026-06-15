// wi_stuff.mjs -- intermission screens (wi_stuff.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Single-player DOOM 1 scope: stat count-up with acceleration, the
// episode world map with splats and the blinking you-are-here pointer.
// Netgame/deathmatch panels and the decorative background animations
// are omitted (cosmetic only).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, G = null, W = null, V = null, S = null

const WI_TITLEY = 2
const SP_STATSX = 50
const SP_STATSY = 50
const SP_TIMEX = 16
const SP_TIMEY = _G.DOOM.SCREENHEIGHT - 32
const TICRATE = 35

// per-episode level locations on the world map (wi_stuff.c lnodes)
const lnodes = [
    [[185, 164], [148, 143], [69, 122], [209, 102], [116, 89],
        [166, 55], [71, 56], [135, 29], [71, 24]],
    [[254, 25], [97, 50], [188, 64], [128, 78], [214, 92],
        [133, 130], [208, 136], [148, 140], [235, 158]],
    [[156, 168], [48, 154], [174, 95], [265, 75], [130, 48],
        [279, 23], [198, 48], [140, 25], [281, 136]],
]

// states
const StatCount = 0, ShowNextLoc = 1, NoState = 2

let wbs = null                      // wbstartstruct from g_game
let plrs = null
let wi_state = 0
let acceleratestage = 0
let cnt = 0
let bcnt = 0
let cnt_kills = -1
let cnt_items = -1
let cnt_secret = -1
let cnt_time = -1
let cnt_par = -1
let cnt_pause = 0
let sp_state = 1
let snl_pointeron = false
let oldAttackdown = false, oldUsedown = false

// patches
let bg = null
let pWiF = null, pEntering = null
let pKills = null, pItems = null, pSecret = null
let pTime = null, pPar = null, pColon = null, pSucks = null, pPercent = null
const pNum = []
let pSplat = null
const pPointer = []
const pLevels = []                  // [epsd][map] WILV name patches
let loadedFor = -1

function WI_LoadData(epsd) {
    bg = W.W_CacheLumpName("WIMAP" + epsd)
    pWiF = W.W_CacheLumpName("WIF")
    pEntering = W.W_CacheLumpName("WIENTER")
    pKills = W.W_CacheLumpName("WIOSTK")
    pItems = W.W_CacheLumpName("WIOSTI")
    pSecret = W.W_CacheLumpName("WISCRT2")
    pTime = W.W_CacheLumpName("WITIME")
    pPar = W.W_CacheLumpName("WIPAR")
    pColon = W.W_CacheLumpName("WICOLON")
    pSucks = W.W_CacheLumpName("WISUCKS")
    pPercent = W.W_CacheLumpName("WIPCNT")
    for (let i = 0; i < 10; i++)
        pNum[i] = W.W_CacheLumpName("WINUM" + i)
    pSplat = W.W_CacheLumpName("WISPLAT")
    pPointer[0] = W.W_CacheLumpName("WIURH0")
    pPointer[1] = W.W_CacheLumpName("WIURH1")
    for (let e = 0; e < 3; e++) {
        pLevels[e] = []
        for (let m = 0; m < 9; m++)
            pLevels[e][m] = W.W_CacheLumpName(
                "WILV" + e + m)
    }
    loadedFor = epsd
}

function WI_Start(wbstartstruct) {
    wbs = wbstartstruct
    plrs = wbs.plyr
    if (loadedFor !== wbs.epsd) WI_LoadData(wbs.epsd)

    acceleratestage = 0
    cnt = bcnt = 0
    wi_state = StatCount
    cnt_kills = cnt_items = cnt_secret = -1
    cnt_time = cnt_par = -1
    cnt_pause = TICRATE
    sp_state = 1
    oldAttackdown = true                 // require a fresh press
    oldUsedown = true
}

// percent targets (vanilla guards div-by-zero by forcing max to 1)
function pct(n, max) { return max ? ((n * 100 / max) | 0) : 0 }

function WI_checkForAccelerate() {
    const player = G.state.players[G.state.consoleplayer]
    const attack = (player.cmd.buttons & DD.BT.ATTACK) !== 0
    const use = (player.cmd.buttons & DD.BT.USE) !== 0
    if (attack && !oldAttackdown) acceleratestage = 1
    if (use && !oldUsedown) acceleratestage = 1
    oldAttackdown = attack
    oldUsedown = use
}

function WI_updateStats() {
    const p = plrs[wbs.pnum]
    if (acceleratestage && sp_state !== 10) {
        acceleratestage = 0
        cnt_kills = pct(p.skills, wbs.maxkills || 1)
        cnt_items = pct(p.sitems, wbs.maxitems || 1)
        cnt_secret = pct(p.ssecret, wbs.maxsecret || 1)
        cnt_time = (p.stime / TICRATE) | 0
        cnt_par = (wbs.partime / TICRATE) | 0
        S.StartSound(null, SFX.sfx_barexp)
        sp_state = 10
    }

    if (sp_state === 2) {
        cnt_kills += 2
        if (!(bcnt & 3)) S.StartSound(null, SFX.sfx_pistol)
        if (cnt_kills >= pct(p.skills, wbs.maxkills || 1)) {
            cnt_kills = pct(p.skills, wbs.maxkills || 1)
            S.StartSound(null, SFX.sfx_barexp)
            sp_state++
        }
    } else if (sp_state === 4) {
        cnt_items += 2
        if (!(bcnt & 3)) S.StartSound(null, SFX.sfx_pistol)
        if (cnt_items >= pct(p.sitems, wbs.maxitems || 1)) {
            cnt_items = pct(p.sitems, wbs.maxitems || 1)
            S.StartSound(null, SFX.sfx_barexp)
            sp_state++
        }
    } else if (sp_state === 6) {
        cnt_secret += 2
        if (!(bcnt & 3)) S.StartSound(null, SFX.sfx_pistol)
        if (cnt_secret >= pct(p.ssecret, wbs.maxsecret || 1)) {
            cnt_secret = pct(p.ssecret, wbs.maxsecret || 1)
            S.StartSound(null, SFX.sfx_barexp)
            sp_state++
        }
    } else if (sp_state === 8) {
        if (!(bcnt & 3)) S.StartSound(null, SFX.sfx_pistol)
        cnt_time += 3
        if (cnt_time >= ((p.stime / TICRATE) | 0))
            cnt_time = (p.stime / TICRATE) | 0
        cnt_par += 3
        if (cnt_par >= ((wbs.partime / TICRATE) | 0)) {
            cnt_par = (wbs.partime / TICRATE) | 0
            if (cnt_time >= ((p.stime / TICRATE) | 0)) {
                S.StartSound(null, SFX.sfx_barexp)
                sp_state++
            }
        }
    } else if (sp_state === 10) {
        if (acceleratestage) {
            S.StartSound(null, SFX.sfx_sgcock)
            WI_initShowNextLoc()
        }
    } else if (sp_state & 1) {
        if (!--cnt_pause) {
            sp_state++
            cnt_pause = TICRATE
        }
    }
}

function WI_initShowNextLoc() {
    wi_state = ShowNextLoc
    acceleratestage = 0
    cnt = 4 * TICRATE
}

function WI_updateShowNextLoc() {
    if (!--cnt || acceleratestage) {
        // no-state: brief pause, then world done
        wi_state = NoState
        cnt = 10
    } else {
        snl_pointeron = (cnt & 31) < 20
    }
}

function WI_updateNoState() {
    if (!--cnt) {
        G.G_WorldDone()
    }
}

function WI_Ticker() {
    bcnt++
    if (bcnt === 1) {
        if (S.ChangeMusic) S.ChangeMusic(MUS.mus_inter, true)
    }
    WI_checkForAccelerate()
    switch (wi_state) {
        case StatCount: WI_updateStats(); break
        case ShowNextLoc: WI_updateShowNextLoc(); break
        case NoState: WI_updateNoState(); break
    }
}

// ---- drawing ----

function WI_slamBackground() {
    V.screens[0].fill(0)
    V.V_DrawPatch(0, 0, 0, bg)
}

// right-justified number, returns new x
function WI_drawNum(x, y, n, digits) {
    const w = V.patchWidth(pNum[0])
    if (digits < 0) {
        if (!n) digits = 1
        else { digits = 0; let t = n; while (t) { t = (t / 10) | 0; digits++ } }
    }
    if (n < 0) n = 0
    while (digits--) {
        x -= w
        V.V_DrawPatch(x, y, 0, pNum[n % 10])
        n = (n / 10) | 0
    }
    return x
}

function WI_drawPercent(x, y, p) {
    if (p < 0) return
    V.V_DrawPatch(x, y, 0, pPercent)
    WI_drawNum(x, y, p, -1)
}

function WI_drawTime(x, y, t) {
    if (t < 0) return
    if (t <= 61 * 59) {
        let div = 1
        do {
            const n = ((t / div) | 0) % 60
            x = WI_drawNum(x, y, n, 2) - V.patchWidth(pColon)
            div *= 60
            if (div === 60 || ((t / div) | 0))
                V.V_DrawPatch(x, y, 0, pColon)
        } while ((t / div) | 0)
    } else {
        V.V_DrawPatch(x - V.patchWidth(pSucks), y, 0, pSucks)
    }
}

// "<level name> FINISHED" at the top
function WI_drawLF() {
    const lname = pLevels[wbs.epsd][wbs.last]
    let y = WI_TITLEY
    V.V_DrawPatch(((_G.DOOM.SCREENWIDTH - V.patchWidth(lname)) / 2) | 0, y, 0, lname)
    y += (5 * V.patchHeight(lname)) >> 2
    V.V_DrawPatch(((_G.DOOM.SCREENWIDTH - V.patchWidth(pWiF)) / 2) | 0, y, 0, pWiF)
}

// "ENTERING <level name>"
function WI_drawEL() {
    const lname = pLevels[wbs.epsd][wbs.next]
    let y = WI_TITLEY
    V.V_DrawPatch(((_G.DOOM.SCREENWIDTH - V.patchWidth(pEntering)) / 2) | 0, y, 0, pEntering)
    y += (5 * V.patchHeight(lname)) >> 2
    V.V_DrawPatch(((_G.DOOM.SCREENWIDTH - V.patchWidth(lname)) / 2) | 0, y, 0, lname)
}

function WI_drawOnLnode(n, patch) {
    const x = lnodes[wbs.epsd][n][0]
    const y = lnodes[wbs.epsd][n][1]
    // vanilla bounds-checks against fitting on screen; the stock
    // coordinates all fit, draw directly
    V.V_DrawPatch(x, y, 0, patch)
}

function WI_drawStats() {
    const lh = (3 * V.patchHeight(pNum[0])) >> 1
    WI_slamBackground()
    WI_drawLF()
    V.V_DrawPatch(SP_STATSX, SP_STATSY, 0, pKills)
    WI_drawPercent(_G.DOOM.SCREENWIDTH - SP_STATSX, SP_STATSY, cnt_kills)
    V.V_DrawPatch(SP_STATSX, SP_STATSY + lh, 0, pItems)
    WI_drawPercent(_G.DOOM.SCREENWIDTH - SP_STATSX, SP_STATSY + lh, cnt_items)
    V.V_DrawPatch(SP_STATSX, SP_STATSY + 2 * lh, 0, pSecret)
    WI_drawPercent(_G.DOOM.SCREENWIDTH - SP_STATSX, SP_STATSY + 2 * lh, cnt_secret)
    V.V_DrawPatch(SP_TIMEX, SP_TIMEY, 0, pTime)
    WI_drawTime(_G.DOOM.SCREENHEIGHT - 40 - SP_TIMEX, SP_TIMEY, cnt_time)
    if (wbs.epsd < 3) {
        V.V_DrawPatch(_G.DOOM.SCREENHEIGHT - 40 + SP_TIMEX, SP_TIMEY, 0, pPar)
        WI_drawTime(_G.DOOM.SCREENWIDTH - SP_TIMEX, SP_TIMEY, cnt_par)
    }
}

function WI_drawShowNextLoc() {
    WI_slamBackground()

    const last = (wbs.last === 8) ? wbs.next - 1 : wbs.last
    // splats on visited levels
    for (let i = 0; i <= last; i++) WI_drawOnLnode(i, pSplat)
    if (wbs.didsecret) WI_drawOnLnode(8, pSplat)
    // blinking you-are-here pointer on the next level
    if (snl_pointeron) WI_drawOnLnode(wbs.next, pPointer[0])

    WI_drawEL()
}

function WI_drawNoState() {
    snl_pointeron = true
    WI_drawShowNextLoc()
}

function WI_Drawer() {
    switch (wi_state) {
        case StatCount: WI_drawStats(); break
        case ShowNextLoc: WI_drawShowNextLoc(); break
        case NoState: WI_drawNoState(); break
    }
}

let SFX = null, MUS = null

exports = {
    WI_Start, WI_Ticker, WI_Drawer,
    init: function (D) {
        DD = D.defs; G = D.g_game; W = D.w_wad; V = D.v_video
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {}, ChangeMusic: () => {} }
        SFX = D.sounds.sfx; MUS = D.sounds.mus
    },
}
