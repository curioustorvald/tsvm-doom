// i_video.mjs -- TSVM video platform layer (replaces i_video.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Owns every graphics/sys call the engine needs for video:
//  - mode 0 setup/teardown (560x448, 8bpp indexed, text plane cleared)
//  - PLAYPAL upload: all 14 palettes pre-converted to RGB4444 MMIO images,
//    so a palette swap (pain/bonus/radsuit flash) is one 512-byte pokeBytes
//  - frame presentation: 320x200 screens[0] -> LUT nearest-neighbour
//    upscale -> single full-frame pokeBytes

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

const FB_ADDR = -1048577        // GPU framebuffer offset 0
const PAL_ADDR = -1310209       // GPU palette entry 0 (2 bytes/entry, RG, BA)
const [FB_W, FB_H] = graphics.getPixelDimension()
const SRC_W = _G.DOOM.SCREENWIDTH, SRC_H = _G.DOOM.SCREENHEIGHT

let V = null                    // v_video

// upscale machinery
const xmap = new Uint16Array(FB_W)
const ymap = new Uint16Array(FB_H)
const out = new Uint8Array(FB_W * FB_H)

// 14 PLAYPAL palettes as ready-to-poke 512-byte MMIO images
const palImages = []
let currentPalette = -1

// The TSVM default palette as a 512-byte MMIO image (RG / BA nibble pairs),
// generated from GraphicsAdapter.kt's DEFAULT_PALETTE. We restore it on exit
// by poking the palette directly, which is reliable on every core build
// (graphics.resetPalette() relies on a GPU command that older builds botch).
const DEFAULT_PAL_HEX =
    "00000007004f008f00bf00ff020f024f028f02bf02ff040f044f048f04bf04ff060f064f068f06bf06ff090f094f098f09bf09ff0b0f0b4f0b8f0bbf" +
    "0bff0d0f0d4f0d8f0dbf0dff0f0f0f4f0f8f0fbf0fff300f304f308f30bf30ff320f324f328f32bf32ff340f344f348f34bf34ff360f364f368f36bf" +
    "36ff390f394f398f39bf39ff3b0f3b4f3b8f3bbf3bff3d0f3d4f3d8f3dbf3dff3f0f3f4f3f8f3fbf3fff600f604f608f60bf60ff620f624f628f62bf" +
    "62ff640f644f648f64bf64ff660f664f668f66bf66ff690f694f698f69bf69ff6b0f6b4f6b8f6bbf6bff6d0f6d4f6d8f6dbf6dff6f0f6f4f6f8f6fbf" +
    "6fff900f904f908f90bf90ff920f924f928f92bf92ff940f944f948f94bf94ff960f964f968f96bf96ff990f994f998f99bf99ff9b0f9b4f9b8f9bbf" +
    "9bff9d0f9d4f9d8f9dbf9dff9f0f9f4f9f8f9fbf9fffc00fc04fc08fc0bfc0ffc20fc24fc28fc2bfc2ffc40fc44fc48fc4bfc4ffc60fc64fc68fc6bf" +
    "c6ffc90fc94fc98fc9bfc9ffcb0fcb4fcb8fcbbfcbffcd0fcd4fcd8fcdbfcdffcf0fcf4fcf8fcfbfcffff00ff04ff08ff0bff0fff20ff24ff28ff2bf" +
    "f2fff40ff44ff48ff4bff4fff60ff64ff68ff6bff6fff90ff94ff98ff9bff9fffb0ffb4ffb8ffbbffbfffd0ffd4ffd8ffdbffdffff0fff4fff8fffbf" +
    "ffff000f111f222f333f444f555f666f777f888f999faaafbbbfcccfdddfeeef"
const defaultPalImg = new Uint8Array(512)
for (let i = 0; i < 512; i++)
    defaultPalImg[i] = parseInt(DEFAULT_PAL_HEX.substr(i * 2, 2), 16)

function I_RestoreDefaultPalette() {
    sys.pokeBytes(PAL_ADDR, defaultPalImg, 512)
    currentPalette = -1
}

function I_InitGraphics() {
    for (let x = 0; x < FB_W; x++) xmap[x] = (x * SRC_W / FB_W) | 0
    for (let y = 0; y < FB_H; y++) ymap[y] = (y * SRC_H / FB_H) | 0
    graphics.setGraphicsMode(0)
    graphics.clearText()
    con.curs_set(0)
    out.fill(0)
    sys.pokeBytes(FB_ADDR, out, out.length)
    // DOOM reads the raw keyboard snapshot (-41..-48) directly, bypassing the
    // cooked VT input ring, and paints the whole screen — i.e. it is a fullscreen
    // app. One declaration covers everything: under vtmgr it grabs so the
    // dispatcher stops piling cooked chars into our pane's ring (they'd flood the
    // shell on exit); on bare metal it is a harmless no-op. Always present.
    con.setFullscreen(true)
}

// playpal: the PLAYPAL lump (14 x 768 bytes of 8-bit RGB triplets).
// TSVM palette entries are two bytes of packed 4-bit channels: RG, BA.
function I_RegisterPlaypal(playpal) {
    palImages.length = 0
    const count = Math.floor(playpal.length / 768)
    for (let p = 0; p < count; p++) {
        const img = new Uint8Array(512)
        for (let i = 0; i < 256; i++) {
            const rF = playpal[p * 768 + i * 3] / 255.0
            const gF = playpal[p * 768 + i * 3 + 1] / 255.0
            const bF = playpal[p * 768 + i * 3 + 2] / 255.0
            let r = Math.round(Math.pow(rF, _G.DOOM.SCREENGAMMA) * 15)|0
            let g = Math.round(Math.pow(gF, _G.DOOM.SCREENGAMMA) * 15)|0
            let b = Math.round(Math.pow(bF, _G.DOOM.SCREENGAMMA) * 15)|0
            img[2 * i] = (r << 4) | g
            img[2 * i + 1] = (b << 4) | 0x0F     // alpha 15 = opaque
        }
        palImages.push(img)
    }
    currentPalette = -1
}

function I_SetPalette(n) {
    if (n === currentPalette || palImages[n] === undefined) return
    sys.pokeBytes(PAL_ADDR, palImages[n], 512)
    currentPalette = n
}

// Present screens[0]. Consecutive duplicate output rows are copied with
// copyWithin instead of re-sampling (200 -> 448 repeats most rows).
function I_FinishUpdate() {
    const src = V.screens[0]
    let o = 0
    let prevSy = -1
    for (let y = 0; y < FB_H; y++) {
        const sy = ymap[y]
        if (sy === prevSy) {
            out.copyWithin(o, o - FB_W, o)
        } else {
            const rowBase = sy * SRC_W
            for (let x = 0; x < FB_W; x++) out[o + x] = src[rowBase + xmap[x]]
            prevSy = sy
        }
        o += FB_W
    }
    sys.pokeBytes(FB_ADDR, out, out.length)
}

function I_ShutdownGraphics() {
    con.setFullscreen(false)
    I_RestoreDefaultPalette()                  // reliable on every core build
    out.fill(255)                              // 255 = background-colour index
    sys.pokeBytes(FB_ADDR, out, out.length)
    graphics.clearText()
    con.curs_set(1)
    con.reset_graphics()                       // clear SGR state for the shell
}

exports = {
    I_InitGraphics, I_RegisterPlaypal, I_SetPalette,
    I_FinishUpdate, I_ShutdownGraphics, I_RestoreDefaultPalette,
    init: function (D) { V = D.v_video },
}
