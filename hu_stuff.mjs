// hu_stuff.mjs -- heads-up messages and map title (hu_stuff.c + hu_lib.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Single-player scope: the message line (player.message, 4s timeout) and
// the automap map title. Netgame chat is omitted.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, G = null, W = null, V = null

const HU_FONTSTART = 33             // '!'
const HU_FONTEND = 95               // '_'
const HU_FONTSIZE = HU_FONTEND - HU_FONTSTART + 1
const HU_MSGTIMEOUT = 4 * 35

const mapnamesDoom1 = [
    "E1M1: Hangar", "E1M2: Nuclear Plant", "E1M3: Toxin Refinery",
    "E1M4: Command Control", "E1M5: Phobos Lab", "E1M6: Central Processing",
    "E1M7: Computer Station", "E1M8: Phobos Anomaly", "E1M9: Military Base",
    "E2M1: Deimos Anomaly", "E2M2: Containment Area", "E2M3: Refinery",
    "E2M4: Deimos Lab", "E2M5: Command Center", "E2M6: Halls of the Damned",
    "E2M7: Spawning Vats", "E2M8: Tower of Babel", "E2M9: Fortress of Mystery",
    "E3M1: Hell Keep", "E3M2: Slough of Despair", "E3M3: Pandemonium",
    "E3M4: House of Pain", "E3M5: Unholy Cathedral", "E3M6: Mt. Erebus",
    "E3M7: Limbo", "E3M8: Dis", "E3M9: Warrens",
]

const font = []                     // hu_font patches
let fontLoaded = false
let plyr = null
let message = null
let messageCounter = 0
let messageOn = false
let mapTitle = ""

function HU_LoadFont() {
    let j = HU_FONTSTART
    for (let i = 0; i < HU_FONTSIZE; i++) {
        const name = "STCFN" + String(j).padStart(3, "0")
        font[i] = W.W_CacheLumpName(name)
        j++
    }
    fontLoaded = true
}

function HU_Start(player) {
    if (!fontLoaded) HU_LoadFont()
    plyr = player
    message = null
    messageOn = false
    messageCounter = 0
    const st = G.state
    const idx = (st.gameepisode - 1) * 9 + (st.gamemap - 1)
    mapTitle = mapnamesDoom1[idx] !== undefined ? mapnamesDoom1[idx]
        : "E" + st.gameepisode + "M" + st.gamemap
}

function HU_Ticker() {
    if (messageCounter && !--messageCounter) {
        messageOn = false
    }
    // new message from the playsim?
    if (plyr.message !== null) {
        message = plyr.message
        plyr.message = null
        messageOn = true
        messageCounter = HU_MSGTIMEOUT
    }
}

// draw a text string with the HU font at (x, y); '\n' unsupported (vanilla
// uses single-line widgets here)
function HU_DrawText(x, y, str) {
    let cx = x
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i)
        if (c >= 97 && c <= 122) c -= 32       // toupper
        if (c < HU_FONTSTART || c > HU_FONTEND) {
            cx += 4                            // space
            continue
        }
        const patch = font[c - HU_FONTSTART]
        const w = V.patchWidth(patch)
        if (cx + w > _G.DOOM.SCREENWIDTH) break
        V.V_DrawPatch(cx, y, 0, patch)
        cx += w
    }
    return cx
}

function HU_TextWidth(str) {
    let w = 0
    for (let i = 0; i < str.length; i++) {
        let c = str.charCodeAt(i)
        if (c >= 97 && c <= 122) c -= 32
        if (c < HU_FONTSTART || c > HU_FONTEND) w += 4
        else w += V.patchWidth(font[c - HU_FONTSTART])
    }
    return w
}

function HU_Drawer() {
    if (messageOn && message !== null)
        HU_DrawText(0, 0, message)
    if (G.state.automapactive)
        HU_DrawText(0, 200 - 32 - 10, mapTitle)
}

function HU_Erase() {}              // borders handled by full redraw

exports = {
    HU_Start, HU_Ticker, HU_Drawer, HU_Erase, HU_DrawText, HU_TextWidth,
    HU_LoadFont,                       // load the HU font at boot (vanilla HU_Init)
    getFont: () => font,
    HU_FONTSTART, HU_FONTEND,
    init: function (D) {
        DD = D.defs; G = D.g_game; W = D.w_wad; V = D.v_video
    },
}
