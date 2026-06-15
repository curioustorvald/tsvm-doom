// f_finale.mjs -- end-of-episode finale (f_finale.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// DOOM 1 scope: the typed-out text screen on a flat background, then the
// episode end picture (E1 CREDIT, E2 VICTORY2, E3 bunny scroll). The
// DOOM 2 cast call is not needed for episodic play.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, G = null, W = null, V = null, HU = null, S = null, RD = null

const TEXTSPEED = 3
const TEXTWAIT = 250

const e1text = "Once you beat the big badasses and\n" +
    "clean out the moon base you're supposed\n" +
    "to win, aren't you? Aren't you? Where's\n" +
    "your fat reward and ticket home? What\n" +
    "the hell is this? It's not supposed to\n" +
    "end this way!\n\n" +
    "It stinks like rotten meat, but looks\n" +
    "like the lost Deimos base.  Looks like\n" +
    "you're stuck on The Shores of Hell.\n" +
    "The only way out is through.\n\n" +
    "To continue the DOOM experience, play\n" +
    "The Shores of Hell and its amazing\n" +
    "sequel, Inferno!\n"

const e2text = "You've done it! The hideous cyber-\n" +
    "demon lord that ruled the lost Deimos\n" +
    "moon base has been slain and you\n" +
    "are triumphant! But ... where are\n" +
    "you? You clamber to the edge of the\n" +
    "moon and look down to see the awful\n" +
    "truth.\n\n" +
    "Deimos floats above Hell itself!\n" +
    "You've never heard of anyone escaping\n" +
    "from Hell, but you'll make the bastards\n" +
    "sorry they ever heard of you! Quickly,\n" +
    "you rappel down to  the surface of\n" +
    "Hell.\n\n" +
    "Now, it's on to the final chapter of\n" +
    "DOOM! -- Inferno."

const e3text = "The loathsome spiderdemon that\n" +
    "masterminded the invasion of the moon\n" +
    "bases and caused so much death has had\n" +
    "its ass kicked for all time.\n\n" +
    "A hidden doorway opens and you enter.\n" +
    "You've proven too tough for Hell to\n" +
    "contain, and now Hell at last plays\n" +
    "fair -- for you emerge from the door\n" +
    "to see the green fields of Earth!\n" +
    "Home at last.\n\n" +
    "You wonder what's been happening on\n" +
    "Earth while you were battling evil\n" +
    "unleashed. It's good that no Hell-\n" +
    "spawn could have come through that\n" +
    "door with you ..."

let finalestage = 0             // 0 = text, 1 = art screen
let finalecount = 0
let finaletext = ""
let finaleflat = ""

function F_StartFinale() {
    const st = G.state
    st.gamestate = DD.GS.FINALE
    st.automapactive = false

    switch (st.gameepisode) {
        case 1: finaleflat = "FLOOR4_8"; finaletext = e1text; break
        case 2: finaleflat = "SFLR6_1"; finaletext = e2text; break
        case 3: finaleflat = "MFLR8_4"; finaletext = e3text; break
        default: finaleflat = "F_SKY1"; finaletext = e1text; break
    }
    if (S.ChangeMusic) S.ChangeMusic(MUS.mus_victor, true)
    finalestage = 0
    finalecount = 0
}

// returns true when the responder consumed the event (vanilla F_Responder
// only handles the cast call; text advances via G_Responder acceleration)
function F_Responder(ev) { return false }

function F_Ticker() {
    const st = G.state
    finalecount++

    // check for skipping to the art screen
    if (finalestage === 0 &&
        finalecount > finaletext.length * TEXTSPEED + TEXTWAIT) {
        finalecount = 0
        finalestage = 1
        if (st.gameepisode === 3) {
            if (S.ChangeMusic) S.ChangeMusic(MUS.mus_bunny, true)
        }
    }
}

// accelerate via use/fire (the shell calls this on keydown during finale)
function F_Accelerate() {
    if (finalestage === 0 &&
        finalecount > 50 &&
        finalecount <= finaletext.length * TEXTSPEED) {
        // skip to full text
        finalecount = finaletext.length * TEXTSPEED
    }
}

function F_TextWrite() {
    // background: tiled 64x64 flat
    const flat = W.W_CacheLumpName(finaleflat)
    const screen = V.screens[0]
    for (let y = 0; y < _G.DOOM.SCREENHEIGHT; y++) {
        const fy = (y & 63) << 6
        for (let x = 0; x < _G.DOOM.SCREENWIDTH; x++)
            screen[y * _G.DOOM.SCREENWIDTH + x] = flat[fy + (x & 63)]
    }

    // typed-out text using the HU font
    let count = ((finalecount - 10) / TEXTSPEED) | 0
    if (count < 0) count = 0
    let cx = 10, cy = 10
    const font = HU.getFont()
    for (let i = 0; i < count && i < finaletext.length; i++) {
        let c = finaletext.charCodeAt(i)
        if (c === 10) { cx = 10; cy += 11; continue }
        if (c >= 97 && c <= 122) c -= 32
        if (c < HU.HU_FONTSTART || c > HU.HU_FONTEND) { cx += 4; continue }
        const patch = font[c - HU.HU_FONTSTART]
        const w = V.patchWidth(patch)
        if (cx + w > _G.DOOM.SCREENWIDTH) break
        V.V_DrawPatch(cx, cy, 0, patch)
        cx += w
    }
}

// E3 bunny scroll (f_finale.c F_BunnyScroll)
let laststage = 0

function F_BunnyScroll() {
    const p1 = W.W_CacheLumpName("PFUB2")
    const p2 = W.W_CacheLumpName("PFUB1")

    let scrolled = _G.DOOM.SCREENWIDTH - (((finalecount - 230) / 2) | 0)
    if (scrolled > _G.DOOM.SCREENWIDTH) scrolled = _G.DOOM.SCREENWIDTH
    if (scrolled < 0) scrolled = 0

    // draw both pages shifted by `scrolled` columns
    V.screens[0].fill(0)
    V.V_DrawPatch(0 - scrolled, 0, 0, p1)
    if (scrolled > 0) V.V_DrawPatch(_G.DOOM.SCREENWIDTH - scrolled, 0, 0, p2)

    if (finalecount < 1130) return
    if (finalecount < 1180) {
        V.V_DrawPatch((_G.DOOM.SCREENWIDTH - 13 * 8) / 2, (_G.DOOM.SCREENHEIGHT - 8 * 8) / 2, 0,
            W.W_CacheLumpName("END0"))
        laststage = 0
        return
    }
    let stage = ((finalecount - 1180) / 5) | 0
    if (stage > 6) stage = 6
    if (stage > laststage) {
        S.StartSound(null, SFX.sfx_pistol)
        laststage = stage
    }
    V.V_DrawPatch((_G.DOOM.SCREENWIDTH - 13 * 8) / 2, (_G.DOOM.SCREENHEIGHT - 8 * 8) / 2, 0,
        W.W_CacheLumpName("END" + stage))
}

function F_Drawer() {
    const st = G.state
    if (finalestage === 0) {
        F_TextWrite()
        return
    }
    switch (st.gameepisode) {
        case 1:
            V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName(
                st.gamemode === DD.GameMode.retail ? "CREDIT" : "HELP2"))
            break
        case 2:
            V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName("VICTORY2"))
            break
        case 3:
            F_BunnyScroll()
            break
        default:
            V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName("ENDPIC"))
            break
    }
}

let SFX = null, MUS = null

exports = {
    F_StartFinale, F_Responder, F_Ticker, F_Drawer, F_Accelerate,
    getFinalestage: () => finalestage,
    init: function (D) {
        DD = D.defs; G = D.g_game; W = D.w_wad; V = D.v_video
        HU = D.hu_stuff; RD = D.r_data
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {}, ChangeMusic: () => {} }
        SFX = D.sounds.sfx; MUS = D.sounds.mus
    },
}
