// i_sound.mjs -- TSVM audio platform layer (replaces i_sound.c + DMX)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Two playheads: tracker music (loaded from the <WADNAME>-MUSPACK.lfs pack
// next to the app -- a shared SOUNDFONT.tsii sample+instrument bank plus one
// M_<SONG>.tpif pattern file per track; silently skipped when the pack is
// absent) and PCM sound effects (8 software-mixed channels; mono 11025 Hz DMX
// lumps resampled on the fly to 32 kHz stereo PCMu8, pumped with the tvnes
// queue pattern).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let W = null, SND = null

const MIX_CHANNELS = 8
const CHUNK_FRAMES = 1024           // stereo frames per upload
const QUEUE_TARGET = 4              // keep this many chunks queued

let sfxHead = -1
let musicHead = -1
let stagingPtr = 0
let inited = false
let sfxEnabled = true
let musicEnabled = true

// pitch -> playback step scale (vanilla steptable: 2^((p-128)/64) << 16)
const steptable = new Int32Array(256)
for (let i = 0; i < 256; i++)
    steptable[i] = (Math.pow(2, (i - 128) / 64) * 65536) | 0

// mixer channel slots
function makeSlot() {
    return { active: false, data: null, ofs: 0, end: 0,
        pos: 0, step: 0, leftvol: 0, rightvol: 0, handle: 0 }
}
const slots = []
for (let i = 0; i < MIX_CHANNELS; i++) slots.push(makeSlot())
let nextHandle = 1

const mixBuf = new Uint8Array(CHUNK_FRAMES * 2)
const accL = new Int32Array(CHUNK_FRAMES)
const accR = new Int32Array(CHUNK_FRAMES)

// sfx lump cache: id -> { data: Uint8Array, ofs, len, rate }
const sfxCache = []

let masterSfxVol = 8                // 0-15

function I_InitSound() {
    if (inited) return
    // distinct fallbacks: a second getFreePlayhead(0) can return the same
    // head before the first one starts playing
    musicHead = audio.getFreePlayhead(0)
    audio.resetParams(musicHead)
    audio.purgeQueue(musicHead)
    audio.stop(musicHead)

    sfxHead = audio.getFreePlayhead(1)
    if (sfxHead === musicHead) sfxHead = musicHead === 1 ? 2 : 1
    audio.resetParams(sfxHead)
    audio.purgeQueue(sfxHead)
    audio.setPcmMode(sfxHead)
    audio.setMasterVolume(sfxHead, masterSfxVol * 17)
    audio.setPcmQueueCapacityIndex(sfxHead, 2)      // 8 chunks
    audio.play(sfxHead)

    stagingPtr = sys.calloc(CHUNK_FRAMES * 2)
    inited = true
}

function I_ShutdownSound() {
    if (!inited) return
    audio.stop(sfxHead)
    audio.purgeQueue(sfxHead)
    audio.stop(musicHead)
    audio.purgeQueue(musicHead)
    sys.free(stagingPtr)
    inited = false
}

function getSfx(id) {
    if (sfxCache[id] !== undefined) return sfxCache[id]
    const name = "DS" + SND.sfxNames[id].toUpperCase()
    let entry = null
    if (W.W_CheckNumForName(name) >= 0) {
        const lump = W.W_CacheLumpName(name)
        // DMX: u16 format(3), u16 rate, u32 length, then sample data
        const rate = lump[2] | (lump[3] << 8)
        entry = { data: lump, ofs: 8, len: lump.length - 8,
            rate: rate || 11025 }
    }
    sfxCache[id] = entry
    return entry
}

// returns a handle (or -1); vol 0-15, sep 1-256ish, pitch 0-255
function I_StartSound(id, vol, sep, pitch) {
    if (!inited || !sfxEnabled) return -1
    const sfx = getSfx(id)
    if (sfx === null) return -1

    // pick the oldest/free slot (s_sound already did priority logic)
    let slot = null
    for (let i = 0; i < MIX_CHANNELS; i++) {
        if (!slots[i].active) { slot = slots[i]; break }
    }
    if (slot === null) slot = slots[0]

    // vanilla-style separation volumes (vol scaled to 0-120)
    const v = vol * 8
    let s = sep + 1
    const leftvol = v - ((v * s * s) >> 16)
    s -= 257
    const rightvol = v - ((v * s * s) >> 16)

    slot.active = true
    slot.data = sfx.data
    slot.ofs = sfx.ofs
    slot.end = sfx.ofs + sfx.len
    slot.pos = 0
    slot.step = ((sfx.rate * steptable[pitch] / 32000)) | 0
    slot.leftvol = leftvol < 0 ? 0 : leftvol
    slot.rightvol = rightvol < 0 ? 0 : rightvol
    slot.handle = nextHandle++
    return slot.handle
}

function I_StopSound(handle) {
    for (let i = 0; i < MIX_CHANNELS; i++)
        if (slots[i].handle === handle) slots[i].active = false
}

function I_SoundIsPlaying(handle) {
    for (let i = 0; i < MIX_CHANNELS; i++)
        if (slots[i].handle === handle) return slots[i].active
    return false
}

function I_UpdateSoundParams(handle, vol, sep) {
    for (let i = 0; i < MIX_CHANNELS; i++) {
        const sl = slots[i]
        if (sl.handle === handle && sl.active) {
            const v = vol * 8
            let s = sep + 1
            sl.leftvol = Math.max(0, v - ((v * s * s) >> 16))
            s -= 257
            sl.rightvol = Math.max(0, v - ((v * s * s) >> 16))
        }
    }
}

function I_SetSfxVolume(v) {
    masterSfxVol = v
    if (inited) audio.setMasterVolume(sfxHead, v * 17)
}

// mix one chunk and upload it
function mixChunk() {
    accL.fill(0)
    accR.fill(0)
    for (let c = 0; c < MIX_CHANNELS; c++) {
        const sl = slots[c]
        if (!sl.active) continue
        const data = sl.data, end = sl.end
        let pos = sl.pos
        const base = sl.ofs
        const lv = sl.leftvol, rv = sl.rightvol
        for (let i = 0; i < CHUNK_FRAMES; i++) {
            const idx = base + (pos >> 16)
            if (idx >= end) { sl.active = false; break }
            const s = data[idx] - 128
            accL[i] += s * lv
            accR[i] += s * rv
            pos += sl.step
        }
        sl.pos = pos
    }
    for (let i = 0; i < CHUNK_FRAMES; i++) {
        let l = 128 + (accL[i] >> 7)
        let r = 128 + (accR[i] >> 7)
        if (l < 0) l = 0; else if (l > 255) l = 255
        if (r < 0) r = 0; else if (r > 255) r = 255
        mixBuf[2 * i] = l
        mixBuf[2 * i + 1] = r
    }
    sys.pokeBytes(stagingPtr, mixBuf, mixBuf.length)
    audio.putPcmDataByPtr(sfxHead, stagingPtr, mixBuf.length, 0)
    audio.setSampleUploadLength(sfxHead, mixBuf.length)
    audio.startSampleUpload(sfxHead)
}

// per-frame pump: keep the queue topped up, restart looping music
function I_UpdateSound() {
    if (!inited) return
    let depth = audio.getPosition(sfxHead)
    let guard = 0
    while (depth < QUEUE_TARGET && guard < QUEUE_TARGET) {
        mixChunk()
        depth++
        guard++
    }
    // music loop: when the tracker reaches the end, start it again
    if (musicEnabled && musicLooping && currentSong !== null &&
        !audio.isPlaying(musicHead)) {
        playTaud(currentSong)
    }
}

// ---- music (taud tracker on its own playhead) ----

let taud = null                     // bound by wadplayer.js (require("taud"))
let lfs = null                      // bound by wadplayer.js (require("lfs"))
let musicDir = ""                   // temp dir the music pack was unpacked into
let musicReady = false              // true once SOUNDFONT.tsii is resident
let currentSong = null
let musicLooping = false
let masterMusVol = 8

// Unpack <base>-MUSPACK.lfs (next to the app) into a temp dir and load its
// shared SOUNDFONT.tsii sample+instrument bank. Individual tracks are pulled
// out lazily by I_PlaySong as M_<SONG>.tpif pattern files. A missing pack just
// leaves musicReady false (silent, by design); a corrupt pack throws and the
// caller logs "music disabled".
function I_InitMusic(taudModule, lfsModule, dir, base) {
    taud = taudModule
    lfs = lfsModule

    const packPath = dir + "\\" + base + "-MUSPACK.lfs"
    if (!files.open(packPath).exists) return     // no music pack: silence

    musicDir = lfs.extractAll(packPath).fullPath

    const sfPath = musicDir + "\\SOUNDFONT.tsii"
    if (!files.open(sfPath).exists) return
    taud.uploadTaudFile(sfPath, 0, musicHead)    // .tsii: bank only
    musicReady = true
}

// original MUS-style lump naming: tracks live in the pack as M_E1M1.tpif,
// M_INTER.tpif, M_INTRO.tpif, ... (patterns only; they reuse the resident
// SOUNDFONT.tsii bank loaded at init)
function songPath(name) {
    return musicDir + "\\M_" + name.toUpperCase() + ".tpif"
}

function playTaud(path) {
    audio.resetParams(musicHead)
    audio.purgeQueue(musicHead)
    audio.stop(musicHead)
    taud.uploadTaudFile(path, 0, musicHead)
    audio.setMasterVolume(musicHead, masterMusVol * 17)
    audio.play(musicHead)
}

// name: e.g. "e1m1", "inter", "victor", "bunny", "intro"
function I_PlaySong(name, looping) {
    if (!inited || taud === null || !musicReady || name === null) return
    const path = songPath(name)
    const fd = files.open(path)
    if (!fd.exists) {
        // no taud for this song: silence (by design)
        I_StopSong()
        currentSong = null
        return
    }
    currentSong = path
    musicLooping = looping
    playTaud(path)
}

function I_StopSong() {
    if (!inited) return
    audio.stop(musicHead)
    audio.purgeQueue(musicHead)
    currentSong = null
}

function I_SetMusicVolume(v) {
    masterMusVol = v
    if (inited && musicHead >= 0)
        audio.setMasterVolume(musicHead, v * 17)
}

exports = {
    I_InitSound, I_ShutdownSound, I_UpdateSound,
    I_StartSound, I_StopSound, I_SoundIsPlaying, I_UpdateSoundParams,
    I_SetSfxVolume, I_SetMusicVolume,
    I_InitMusic, I_PlaySong, I_StopSong,
    init: function (D) {
        W = D.w_wad; SND = D.sounds
    },
}
