// r_data.mjs -- texture/flat/colormap data management (r_data.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Flat range, TEXTURE1/2 + PNAMES parsing and name lookups; colormaps;
// lazy composite texture generation for the wall renderer.
//
// Texture storage: every texture composites into one column-major
// Uint8Array with a per-column stride of max(128, height), so the column
// drawer's vanilla `& 127` wrap always lands inside the column (vanilla
// reads neighbouring columns there -- "tutti frutti"; we tile instead).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let W = null

// flats
let firstflat = 0
let lastflat = 0
let numflats = 0

// textures (parallel arrays, texture number indexed)
let numtextures = 0
let textureName = []
let textureWidth = null         // Int32Array
let textureHeight = null        // Int32Array
let texturePatchCount = null    // Int32Array
let texturePatchOfs = null      // Int32Array: offset into the patch arrays
let patchOriginX = null         // Int32Array (flattened per-texture patches)
let patchOriginY = null
let patchLump = null            // lump number of the patch
let textureLookup = new Map()   // NAME -> texture number

function R_InitFlats() {
    // Use the first F_START (the IWAD's): vanilla takes the last, which a
    // flat-bearing PWAD would break for every stock flat.
    firstflat = W.W_FindLumpFrom("F_START", 0) + 1
    lastflat = W.W_FindLumpFrom("F_END", firstflat) - 1
    numflats = lastflat - firstflat + 1
}

function R_FlatNumForName(name) {
    const i = W.W_CheckNumForName(name)
    if (i < 0) throw Error("R_FlatNumForName: " + name + " not found")
    return i - firstflat
}

function R_InitTextures() {
    // PNAMES: i32 count, then count x 8-char patch names -> lump numbers
    const pnames = W.W_CacheLumpName("PNAMES")
    const nummappatches = W.lumpI32(pnames, 0)
    const patchlookup = new Int32Array(nummappatches)
    for (let i = 0; i < nummappatches; i++) {
        let nm = ""
        for (let j = 0; j < 8; j++) {
            const c = pnames[4 + i * 8 + j]
            if (c === 0) break
            nm += String.fromCharCode(c)
        }
        patchlookup[i] = W.W_CheckNumForName(nm)
    }

    // TEXTURE1 (+TEXTURE2 in registered/retail)
    const texlumps = [W.W_CacheLumpName("TEXTURE1")]
    if (W.W_CheckNumForName("TEXTURE2") >= 0)
        texlumps.push(W.W_CacheLumpName("TEXTURE2"))

    numtextures = 0
    for (const tl of texlumps) numtextures += W.lumpI32(tl, 0)

    textureName = new Array(numtextures)
    textureWidth = new Int32Array(numtextures)
    textureHeight = new Int32Array(numtextures)
    texturePatchCount = new Int32Array(numtextures)
    texturePatchOfs = new Int32Array(numtextures)
    textureLookup = new Map()

    // count total patches first so the flattened arrays can be typed
    let totalPatches = 0
    for (const tl of texlumps) {
        const n = W.lumpI32(tl, 0)
        for (let i = 0; i < n; i++) {
            const ofs = W.lumpI32(tl, 4 + 4 * i)
            totalPatches += W.lumpU16(tl, ofs + 20)
        }
    }
    patchOriginX = new Int32Array(totalPatches)
    patchOriginY = new Int32Array(totalPatches)
    patchLump = new Int32Array(totalPatches)

    let tex = 0
    let pofs = 0
    for (const tl of texlumps) {
        const n = W.lumpI32(tl, 0)
        for (let i = 0; i < n; i++, tex++) {
            // maptexture_t: name[8], masked i32, width i16, height i16,
            // columndirectory i32 (obsolete), patchcount i16, then
            // mappatch_t[]: originx i16, originy i16, patch i16,
            // stepdir i16, colormap i16
            const ofs = W.lumpI32(tl, 4 + 4 * i)
            let nm = ""
            for (let j = 0; j < 8; j++) {
                const c = tl[ofs + j]
                if (c === 0) break
                nm += String.fromCharCode(c)
            }
            nm = nm.toUpperCase()
            textureName[tex] = nm
            textureWidth[tex] = W.lumpI16(tl, ofs + 12)
            textureHeight[tex] = W.lumpI16(tl, ofs + 14)
            const pc = W.lumpU16(tl, ofs + 20)
            texturePatchCount[tex] = pc
            texturePatchOfs[tex] = pofs
            for (let p = 0; p < pc; p++) {
                const po = ofs + 22 + 10 * p
                patchOriginX[pofs] = W.lumpI16(tl, po)
                patchOriginY[pofs] = W.lumpI16(tl, po + 2)
                patchLump[pofs] = patchlookup[W.lumpU16(tl, po + 4)]
                pofs++
            }
            if (!textureLookup.has(nm)) textureLookup.set(nm, tex)
        }
    }
}

// ---- colormaps, texture metadata, composites ----

let colormaps = null            // Uint8Array, 34 x 256
let textureheight = null       // Int32Array, fixed-point heights
let texturewidthmask = null    // Int32Array
let textureColStride = null    // Int32Array: max(128, height)
let texturetranslation = null  // Int32Array (wall animations remap this)
let textureComposite = []      // lazily built per-texture Uint8Array
let skyflatnum = -1

function R_LoadColormaps() {
    colormaps = W.W_CacheLumpName("COLORMAP")
}

function R_BuildDerivedTables() {
    textureheight = new Int32Array(numtextures)
    texturewidthmask = new Int32Array(numtextures)
    textureColStride = new Int32Array(numtextures)
    texturetranslation = new Int32Array(numtextures)
    textureComposite = new Array(numtextures).fill(null)
    for (let i = 0; i < numtextures; i++) {
        textureheight[i] = textureHeight[i] << 16
        let j = 1
        while (j * 2 <= textureWidth[i]) j <<= 1
        texturewidthmask[i] = j - 1
        textureColStride[i] = textureHeight[i] > 128 ? textureHeight[i] : 128
        texturetranslation[i] = i
    }
}

// Composite every patch of the texture into a flat column-major buffer.
// Columns are pre-tiled to the stride so frac wrap never reads garbage.
function R_GenerateComposite(tex) {
    const w = textureWidth[tex]
    const h = textureHeight[tex]
    const stride = textureColStride[tex]
    const buf = new Uint8Array(w * stride)
    const pc = texturePatchCount[tex]
    const base = texturePatchOfs[tex]
    for (let p = 0; p < pc; p++) {
        const originx = patchOriginX[base + p]
        const originy = patchOriginY[base + p]
        const patch = W.W_CacheLumpNum(patchLump[base + p])
        const pw = patch[0] | (patch[1] << 8)
        const x1 = originx < 0 ? 0 : originx
        let x2 = originx + pw
        if (x2 > w) x2 = w
        for (let x = x1; x < x2; x++) {
            let ofs = W.lumpI32(patch, 8 + 4 * (x - originx))
            for (;;) {
                const topdelta = patch[ofs]
                if (topdelta === 0xFF) break
                const len = patch[ofs + 1]
                let src = ofs + 3
                let y = originy + topdelta
                let n = len
                if (y < 0) { src -= y; n += y; y = 0 }
                if (y + n > h) n = h - y
                const dst = x * stride + y
                for (let i = 0; i < n; i++) buf[dst + i] = patch[src + i]
                ofs += len + 4
            }
        }
    }
    // tile shorter-than-stride columns so (frac>>16)&127 stays meaningful
    if (h < stride) {
        for (let x = 0; x < w; x++) {
            const colBase = x * stride
            for (let y = h; y < stride; y++)
                buf[colBase + y] = buf[colBase + (y % h)]
        }
    }
    textureComposite[tex] = buf
    return buf
}

function R_GetTexture(tex) {
    const buf = textureComposite[tex]
    return buf !== null ? buf : R_GenerateComposite(tex)
}

// byte offset of the (wrapped) column inside R_GetTexture(tex)'s buffer
function R_GetColumnOfs(tex, col) {
    return (col & texturewidthmask[tex]) * textureColStride[tex]
}

// flat lump data; raw 64x64 bytes
function R_GetFlat(flatnum) {
    return W.W_CacheLumpNum(firstflat + flattranslation[flatnum])
}

let flattranslation = null      // Int32Array (flat animations remap this)

// ---- sprite lumps ----

let firstspritelump = 0
let lastspritelump = 0
let spritewidth = null          // Int32Array, fixed
let spriteoffset = null
let spritetopoffset = null

function R_InitSpriteLumps() {
    firstspritelump = W.W_FindLumpFrom("S_START", 0) + 1
    lastspritelump = W.W_FindLumpFrom("S_END", firstspritelump) - 1
    const n = lastspritelump - firstspritelump + 1
    spritewidth = new Int32Array(n)
    spriteoffset = new Int32Array(n)
    spritetopoffset = new Int32Array(n)
    for (let i = 0; i < n; i++) {
        const patch = W.W_CacheLumpNum(firstspritelump + i)
        spritewidth[i] = (patch[0] | (patch[1] << 8)) << 16
        spriteoffset[i] = W.lumpI16(patch, 4) << 16
        spritetopoffset[i] = W.lumpI16(patch, 6) << 16
    }
}

// Masked textures draw from post-format columns. Vanilla only works for
// single-patch masked textures (multi-patch is the Medusa effect); we
// return -1 for those and the caller skips the column.
function R_GetMaskedColumnOfs(tex, col) {
    if (texturePatchCount[tex] !== 1) return -1
    const patch = W.W_CacheLumpNum(patchLump[texturePatchOfs[tex]])
    const pw = patch[0] | (patch[1] << 8)
    col = (col & texturewidthmask[tex]) % pw
    return W.lumpI32(patch, 8 + 4 * col)
}

function R_GetMaskedPatch(tex) {
    if (texturePatchCount[tex] !== 1) return null
    return W.W_CacheLumpNum(patchLump[texturePatchOfs[tex]])
}

// ---- player-colour translation tables (r_data.c R_InitTranslationTables) ----

let translationtables = null    // Uint8Array(256*3)

function R_InitTranslationTables() {
    translationtables = new Uint8Array(256 * 3)
    for (let i = 0; i < 256; i++) {
        if (i >= 0x70 && i <= 0x7f) {
            // remap green ramp to gray, brown, red
            translationtables[i] = 0x60 + (i & 0xf)
            translationtables[i + 256] = 0x40 + (i & 0xf)
            translationtables[i + 512] = 0x20 + (i & 0xf)
        } else {
            translationtables[i] = i
            translationtables[i + 256] = i
            translationtables[i + 512] = i
        }
    }
}

// "-" (no texture) is 0, like vanilla; unknown names are -1
function R_CheckTextureNumForName(name) {
    if (name.charCodeAt(0) === 0x2D) return 0      // '-'
    const n = textureLookup.get(name.toUpperCase())
    return n === undefined ? -1 : n
}

function R_TextureNumForName(name) {
    const n = R_CheckTextureNumForName(name)
    if (n < 0) throw Error("R_TextureNumForName: " + name + " not found")
    return n
}

function R_InitData() {
    R_InitTextures()
    R_InitFlats()
    R_InitSpriteLumps()
    R_LoadColormaps()
    R_BuildDerivedTables()
    R_InitTranslationTables()
    flattranslation = new Int32Array(numflats)
    for (let i = 0; i < numflats; i++) flattranslation[i] = i
    skyflatnum = R_FlatNumForName("F_SKY1")
}

exports = {
    R_InitData, R_InitFlats, R_InitTextures,
    R_FlatNumForName, R_CheckTextureNumForName, R_TextureNumForName,
    R_GetTexture, R_GetColumnOfs, R_GetFlat,
    getNumTextures: () => numtextures,
    getTextureName: (n) => textureName[n],
    getTextureWidth: (n) => textureWidth[n],
    getTextureHeight: (n) => textureHeight[n],
    getFirstFlat: () => firstflat,
    getNumFlats: () => numflats,
    getColormaps: () => colormaps,
    getTextureheight: () => textureheight,
    getTexturetranslation: () => texturetranslation,
    getSkyflatnum: () => skyflatnum,
    R_GetMaskedColumnOfs, R_GetMaskedPatch,
    getFirstspritelump: () => firstspritelump,
    getLastspritelump: () => lastspritelump,
    getSpritewidth: () => spritewidth,
    getSpriteoffset: () => spriteoffset,
    getSpritetopoffset: () => spritetopoffset,
    getTranslationtables: () => translationtables,
    getFlattranslation: () => flattranslation,
    init: function (D) { W = D.w_wad },
}
