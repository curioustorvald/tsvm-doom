// i_input.mjs -- TSVM keyboard platform layer
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Polls the raw 8-key snapshot from MMIO (-40 latch, -41..-48 state) and
// maintains g_game.gamekeydown (indexed by raw libGDX keycode). Edge events
// for menus/typing arrive with the game shell milestone.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let G = null, DD = null
let FB_W = 560                  // physical display width in px (set at init)

const held = new Uint8Array(8)
const prevHeld = new Uint8Array(8)

// mouse: absolute cursor position (the VM has no pointer capture, so this is
// positional steering, not relative deltas). `mouseEngaged` stays false until
// the cursor actually moves, so a pointer resting in a wing at boot doesn't
// spin the view before the player has touched the mouse.
let mouseEngaged = false
let prevMouseRawX = -1

// libGDX raw code -> doom key (vanilla doomdef.h codes; ascii lowercase
// for printables). Index = raw code.
const rawToDoom = new Uint8Array(256)
;(function buildTable() {
    for (let i = 0; i < 26; i++) rawToDoom[29 + i] = 97 + i     // a-z
    for (let i = 0; i < 9; i++) rawToDoom[8 + i] = 49 + i       // 1-9
    rawToDoom[7] = 48                                           // 0
    rawToDoom[19] = 0xad        // up
    rawToDoom[20] = 0xaf        // down
    rawToDoom[21] = 0xac        // left
    rawToDoom[22] = 0xae        // right
    rawToDoom[66] = 13          // enter
    rawToDoom[111] = 27         // escape
    rawToDoom[62] = 32          // space
    rawToDoom[61] = 9           // tab
    rawToDoom[67] = 127         // backspace
    rawToDoom[59] = 0x80 + 0x36 // lshift -> KEY_RSHIFT
    rawToDoom[60] = 0x80 + 0x36 // rshift
    rawToDoom[129] = 0x80 + 0x1d // lctrl -> KEY_RCTRL
    rawToDoom[130] = 0x80 + 0x1d // rctrl
    rawToDoom[57] = 0x80 + 0x38 // lalt -> KEY_RALT
    rawToDoom[58] = 0x80 + 0x38 // ralt
    rawToDoom[69] = 0x2d        // minus
    rawToDoom[70] = 0x3d        // equals/plus
    rawToDoom[55] = 44          // comma
    rawToDoom[56] = 46          // period
    for (let i = 0; i < 12; i++)
        rawToDoom[131 + i] = 0x80 + 0x3b + i    // F1-F12 (user-verified 131-142)
})()

// event queue consumed by the shell each frame
const evqueue = []

function I_PollKeys() {
    sys.poke(-40, 1)
    const gamekeydown = G.gamekeydown

    prevHeld.set(held)
    held.fill(0)

    // Only sample the physical keyboard while we own it (we are the foreground
    // console); a backgrounded game must not respond to the foreground console's
    // typing. con.isActiveConsole() is a first-class check: always true on bare
    // metal, and true under vtmgr only while this pane is the active VT. Leaving
    // `held` all-zero when inactive lets the release logic below clear cleanly.
    const active = con.isActiveConsole()
    if (active) {
        let n = 0
        for (let a = -41; a >= -48; a--) {
            const k = sys.peek(a)
            if (k !== 0) held[n++] = k & 0xFF
        }
    }

    // raw key state for G_BuildTiccmd
    for (let i = 0; i < 8; i++)
        if (prevHeld[i] !== 0) gamekeydown[prevHeld[i]] = 0
    for (let i = 0; i < 8; i++)
        if (held[i] !== 0) gamekeydown[held[i]] = 1

    // edge events (doom-key encoded) for menu/cheats/automap
    for (let i = 0; i < 8; i++) {
        const k = held[i]
        if (k === 0) continue
        let was = false
        for (let j = 0; j < 8; j++) if (prevHeld[j] === k) was = true
        if (!was && rawToDoom[k] !== 0)
            evqueue.push({ type: DD.Ev.keydown, data1: rawToDoom[k] })
    }
    for (let i = 0; i < 8; i++) {
        const k = prevHeld[i]
        if (k === 0) continue
        let still = false
        for (let j = 0; j < 8; j++) if (held[j] === k) still = true
        if (!still && rawToDoom[k] !== 0)
            evqueue.push({ type: DD.Ev.keyup, data1: rawToDoom[k] })
    }

    // ---- mouse (captured by the same -40 latch poked above) ----
    // MMIO 32/33 = mouseX (LE), 36 = buttons; sys addr = -(mmio+1). The value
    // is in logical framebuffer pixels (0..FB_W-1), one frame stale like keys.
    if (active) {
        const rawX = (sys.peek(-33) & 0xFF) | ((sys.peek(-34) & 0xFF) << 8)
        const btn = sys.peek(-37) & 0xFF
        if (prevMouseRawX >= 0 && rawX !== prevMouseRawX) mouseEngaged = true
        prevMouseRawX = rawX
        let fracX = FB_W > 0 ? rawX / FB_W : 0.5
        if (fracX < 0) fracX = 0
        else if (fracX > 1) fracX = 1
        G.setMouseInput(fracX, btn & 1, btn & 2, mouseEngaged)
    } else {
        G.setMouseInput(0.5, 0, 0, false)
    }
}

function I_NextEvent() {
    return evqueue.length > 0 ? evqueue.shift() : null
}

function I_ClearEvents() {
    evqueue.length = 0
    held.fill(0)
    prevHeld.fill(0)
    mouseEngaged = false
    prevMouseRawX = -1
}

function I_AnyKeyDown(code) { return G.gamekeydown[code] !== 0 }

exports = {
    I_PollKeys, I_NextEvent, I_ClearEvents, I_AnyKeyDown,
    init: function (D) {
        G = D.g_game; DD = D.defs
        try { FB_W = graphics.getPixelDimension()[0] | 0 } catch (e) { FB_W = 560 }
        if (!FB_W) FB_W = 560
    },
}
