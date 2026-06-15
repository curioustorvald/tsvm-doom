// w_wad.mjs -- WAD file layer (w_wad.c, redesigned for JS)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Platform-free: the platform layer reads each WAD into a Uint8Array and
// hands it to W_AddFile. Lumps are zero-copy subarray views; there is no
// zone memory -- composed artifacts are cached by their owner modules.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let lumpName = []        // canonical upper-case names
let lumpData = []        // Uint8Array views into their WAD
let lumpWad = []         // index into wadIdents, for diagnostics
let wadIdents = []       // "IWAD"/"PWAD" per added file
let numlumps = 0
let nameLookup = new Map()   // name -> highest lump number (PWAD override)

function readI32(bytes, ofs) {
    return (bytes[ofs] | (bytes[ofs + 1] << 8) | (bytes[ofs + 2] << 16) |
        (bytes[ofs + 3] << 24)) | 0
}

function lumpNameAt(bytes, ofs) {
    let s = ""
    for (let i = 0; i < 8; i++) {
        const c = bytes[ofs + i]
        if (c === 0) break
        s += String.fromCharCode(c)
    }
    return s.toUpperCase()
}

// Register one WAD file's directory. Later files override earlier ones
// (name lookups search backwards, like vanilla W_CheckNumForName).
function W_AddFile(bytes) {
    const ident = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    if (ident !== "IWAD" && ident !== "PWAD")
        throw Error("W_AddFile: not a WAD (ident " + ident + ")")
    const count = readI32(bytes, 4)
    const dirofs = readI32(bytes, 8)
    const wadIndex = wadIdents.length
    wadIdents.push(ident)
    for (let i = 0; i < count; i++) {
        const e = dirofs + 16 * i
        const ofs = readI32(bytes, e)
        const size = readI32(bytes, e + 4)
        const name = lumpNameAt(bytes, e + 8)
        lumpName.push(name)
        lumpData.push(bytes.subarray(ofs, ofs + size))
        lumpWad.push(wadIndex)
        nameLookup.set(name, numlumps)
        numlumps++
    }
    return ident
}

function W_NumLumps() { return numlumps }

// -1 when absent. Map holds the highest-numbered (= last-added) match,
// giving PWAD-over-IWAD precedence in O(1).
function W_CheckNumForName(name) {
    const n = nameLookup.get(name.toUpperCase())
    return n === undefined ? -1 : n
}

function W_GetNumForName(name) {
    const n = W_CheckNumForName(name)
    if (n < 0) throw Error("W_GetNumForName: " + name + " not found")
    return n
}

function W_LumpLength(num) { return lumpData[num].length }

function W_LumpName(num) { return lumpName[num] }

function W_CacheLumpNum(num) { return lumpData[num] }

function W_CacheLumpName(name) { return lumpData[W_GetNumForName(name)] }

// Search forward from `start` for an exact name; vanilla uses this pattern
// for marker scans (S_START..S_END etc.) where directory ORDER matters and
// the backwards-override Map must not short-circuit it.
function W_FindLumpFrom(name, start) {
    name = name.toUpperCase()
    for (let i = start; i < numlumps; i++)
        if (lumpName[i] === name) return i
    return -1
}

// little-endian readers over a lump view
function lumpI16(lump, ofs) {
    const v = lump[ofs] | (lump[ofs + 1] << 8)
    return v >= 0x8000 ? v - 0x10000 : v
}

function lumpU16(lump, ofs) { return lump[ofs] | (lump[ofs + 1] << 8) }

function lumpI32(lump, ofs) { return readI32(lump, ofs) }

function W_Reset() {
    lumpName = []; lumpData = []; lumpWad = []
    wadIdents = []; numlumps = 0; nameLookup = new Map()
}

exports = {
    W_AddFile, W_NumLumps, W_CheckNumForName, W_GetNumForName,
    W_LumpLength, W_LumpName, W_CacheLumpNum, W_CacheLumpName,
    W_FindLumpFrom, W_Reset,
    lumpI16, lumpU16, lumpI32,
    init: function (D) {},
}
