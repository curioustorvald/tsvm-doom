// v_video.mjs -- 320x200 indexed screen buffers and patch drawing (v_video.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

const SCREENWIDTH = _G.DOOM.SCREENWIDTH
const SCREENHEIGHT = _G.DOOM.SCREENHEIGHT

// screens[0] = game view, [1] = status-bar backing store, [2]/[3] = wipe
// start/end frames, [4] = status-bar scratch (vanilla's layout)
const screens = []
for (let i = 0; i < 5; i++)
    screens.push(new Uint8Array(SCREENWIDTH * SCREENHEIGHT))

let W = null    // wired in init

// Patch header: i16 width, height, leftoffset, topoffset, then
// width x i32 column offsets. Column = posts: (topdelta, length, pad,
// length bytes of palette indices, pad), terminated by topdelta 0xFF.
function patchWidth(p) { return p[0] | (p[1] << 8) }
function patchHeight(p) { return p[2] | (p[3] << 8) }
function patchLeftOffset(p) { return W.lumpI16(p, 4) }
function patchTopOffset(p) { return W.lumpI16(p, 6) }

// V_DrawPatch: x,y are the patch origin in screen space; the patch's own
// left/top offsets are subtracted, exactly like vanilla.
function V_DrawPatch(x, y, scrn, patch) {
    x -= patchLeftOffset(patch)
    y -= patchTopOffset(patch)
    const w = patchWidth(patch)
    const screen = screens[scrn]

    for (let col = 0; col < w; col++) {
        const sx = x + col
        if (sx < 0 || sx >= SCREENWIDTH) continue
        let ofs = W.lumpI32(patch, 8 + 4 * col)
        // walk posts
        for (;;) {
            const topdelta = patch[ofs]
            if (topdelta === 0xFF) break
            const len = patch[ofs + 1]
            let src = ofs + 3                  // skip topdelta, length, pad
            let sy = y + topdelta
            let dest = sy * SCREENWIDTH + sx
            for (let i = 0; i < len; i++) {
                if (sy >= 0 && sy < SCREENHEIGHT) screen[dest] = patch[src]
                src++; sy++; dest += SCREENWIDTH
            }
            ofs += len + 4                     // post header + pixels + pad
        }
    }
}

// Identical under TSVM (vanilla split direct-VGA drawing off; we always
// draw into the indexed buffer).
const V_DrawPatchDirect = V_DrawPatch

// Translated-colour patch draw (multiplayer body colours, menus); trans is
// a 256-byte index map.
function V_DrawPatchTranslated(x, y, scrn, patch, trans) {
    x -= patchLeftOffset(patch)
    y -= patchTopOffset(patch)
    const w = patchWidth(patch)
    const screen = screens[scrn]
    for (let col = 0; col < w; col++) {
        const sx = x + col
        if (sx < 0 || sx >= SCREENWIDTH) continue
        let ofs = W.lumpI32(patch, 8 + 4 * col)
        for (;;) {
            const topdelta = patch[ofs]
            if (topdelta === 0xFF) break
            const len = patch[ofs + 1]
            let src = ofs + 3
            let sy = y + topdelta
            let dest = sy * SCREENWIDTH + sx
            for (let i = 0; i < len; i++) {
                if (sy >= 0 && sy < SCREENHEIGHT) screen[dest] = trans[patch[src]]
                src++; sy++; dest += SCREENWIDTH
            }
            ofs += len + 4
        }
    }
}

function V_CopyRect(srcx, srcy, srcscrn, width, height, destx, desty, destscrn) {
    const src = screens[srcscrn]
    const dest = screens[destscrn]
    for (let row = 0; row < height; row++) {
        const s = (srcy + row) * SCREENWIDTH + srcx
        const d = (desty + row) * SCREENWIDTH + destx
        dest.set(src.subarray(s, s + width), d)
    }
}

// Draw a raw (headerless, row-major) block -- used for flats-as-graphics
// and the intermission background copy.
function V_DrawBlock(x, y, scrn, width, height, block) {
    const dest = screens[scrn]
    for (let row = 0; row < height; row++) {
        dest.set(block.subarray(row * width, (row + 1) * width),
            (y + row) * SCREENWIDTH + x)
    }
}

function V_FillRect(x, y, scrn, width, height, colour) {
    const dest = screens[scrn]
    for (let row = 0; row < height; row++) {
        const d = (y + row) * SCREENWIDTH + x
        dest.fill(colour, d, d + width)
    }
}

// ---- melt wipe (f_wipe.c) ----
// screens[2] = start capture, screens[3] = end capture; the melt runs in
// 2-pixel-wide columns falling at randomised speeds. Uses M_Random
// (cosmetic RNG) like vanilla.

let wipeY = null
let MR = null                   // m_random, bound at init

function WipeStart() {
    screens[2].set(screens[0])  // capture the "from" frame
}

function WipeEndCapture() {
    screens[3].set(screens[0])  // capture the "to" frame
}

function WipeInitMelt() {
    wipeY = new Int32Array(160)
    wipeY[0] = -(MR.M_Random() % 16)
    for (let i = 1; i < 160; i++) {
        const r = (MR.M_Random() % 3) - 1
        wipeY[i] = wipeY[i - 1] + r
        if (wipeY[i] > 0) wipeY[i] = 0
        else if (wipeY[i] === -16) wipeY[i] = -15
    }
}

// advance `ticks` melt steps and compose into screens[0];
// returns true when done
function WipeDoMelt(ticks) {
    let done = true
    while (ticks--) {
        for (let i = 0; i < 160; i++) {
            if (wipeY[i] < 0) {
                wipeY[i]++
                done = false
            } else if (wipeY[i] < _G.DOOM.SCREENHEIGHT) {
                let dy = (wipeY[i] < 16) ? wipeY[i] + 1 : 8
                if (wipeY[i] + dy >= _G.DOOM.SCREENHEIGHT) dy = _G.DOOM.SCREENHEIGHT - wipeY[i]
                wipeY[i] += dy
                done = false
            }
        }
    }
    // compose: end screen above the melt line, start screen sliding below
    const scr = screens[0], start = screens[2], end = screens[3]
    for (let i = 0; i < 160; i++) {
        const x = i * 2
        const y = wipeY[i] < 0 ? 0 : wipeY[i]
        for (let row = 0; row < y; row++) {
            const d = row * SCREENWIDTH + x
            scr[d] = end[d]
            scr[d + 1] = end[d + 1]
        }
        for (let row = y; row < SCREENHEIGHT; row++) {
            const s = (row - y) * SCREENWIDTH + x
            const d = row * SCREENWIDTH + x
            scr[d] = start[s]
            scr[d + 1] = start[s + 1]
        }
    }
    return done
}

exports = {
    SCREENWIDTH, SCREENHEIGHT, screens,
    patchWidth, patchHeight, patchLeftOffset, patchTopOffset,
    V_DrawPatch, V_DrawPatchDirect, V_DrawPatchTranslated,
    V_CopyRect, V_DrawBlock, V_FillRect,
    WipeStart, WipeEndCapture, WipeInitMelt, WipeDoMelt,
    init: function (D) { W = D.w_wad; MR = D.m_random },
}
