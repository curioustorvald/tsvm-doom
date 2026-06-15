// s_sound.mjs -- sound channel logic (s_sound.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Engine side only: channel allocation, priority eviction, distance
// attenuation and stereo separation. The actual mixing/output lives in
// i_sound (platform). Exported names match the stub shape the playsim
// modules already call (StartSound/StopSound/ChangeMusic).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, R = null, G = null, RM = null, T = null, SND = null
let IS = null                   // i_sound platform (null in headless tests)

const S_CLIPPING_DIST = 1200 * 65536
const S_CLOSE_DIST = 160 * 65536
const S_ATTENUATOR = (S_CLIPPING_DIST - S_CLOSE_DIST) >> 16
const S_STEREO_SWING = 96 * 65536
const NORM_SEP = 128
const NUM_CHANNELS = 8

let snd_SfxVolume = 8
let snd_MusicVolume = 8

// channel: { sfxinfo: sfx id or -1, origin, handle }
const channels = []
for (let i = 0; i < NUM_CHANNELS; i++)
    channels.push({ sfx: -1, origin: null, handle: -1 })

function S_SetSfxVolume(v) {
    snd_SfxVolume = v
    if (IS !== null) IS.I_SetSfxVolume(v)
}

function S_SetMusicVolume(v) {
    snd_MusicVolume = v
    if (IS !== null) IS.I_SetMusicVolume(v)
}

function listenerMobj() {
    const st = G.state
    const p = st.players[st.consoleplayer]
    return p !== undefined ? p.mo : null
}

// vanilla S_AdjustSoundParams: returns null when inaudible, else
// { vol, sep }
function S_AdjustSoundParams(listener, source) {
    const adx = Math.abs(listener.x - source.x)
    const ady = Math.abs(listener.y - source.y)
    let approx_dist = (adx + ady - ((adx < ady ? adx : ady) >> 1)) | 0

    const gamemap = G.state.gamemap
    if (gamemap !== 8 && approx_dist > S_CLIPPING_DIST) return null

    // stereo separation from the angle to the source
    let angle = RM.R_PointToAngle2(listener.x, listener.y, source.x, source.y)
    const lang = listener.angle >>> 0
    if (angle > lang) angle = (angle - lang) >>> 0
    else angle = (angle + (0xffffffff - lang)) >>> 0
    const fa = angle >>> 19

    const sep = 128 - (T.FixedMul(S_STEREO_SWING, T.finesine[fa]) >> 16)

    let vol
    if (approx_dist < S_CLOSE_DIST) {
        vol = snd_SfxVolume
    } else if (gamemap === 8) {
        if (approx_dist > S_CLIPPING_DIST) approx_dist = S_CLIPPING_DIST
        vol = 15 + (((snd_SfxVolume - 15) *
            ((S_CLIPPING_DIST - approx_dist) >> 16)) / S_ATTENUATOR) | 0
    } else {
        vol = ((snd_SfxVolume *
            ((S_CLIPPING_DIST - approx_dist) >> 16)) / S_ATTENUATOR) | 0
    }
    return vol > 0 ? { vol, sep } : null
}

function S_StopChannel(cnum) {
    const c = channels[cnum]
    if (c.sfx !== -1) {
        if (IS !== null) IS.I_StopSound(c.handle)
        c.sfx = -1
        c.origin = null
        c.handle = -1
    }
}

// origin may be null (UI sounds) or an {x, y} carrier (mobj / soundorg)
function StopSound(origin) {
    if (origin === null) return
    for (let i = 0; i < NUM_CHANNELS; i++) {
        if (channels[i].sfx !== -1 && channels[i].origin === origin)
            S_StopChannel(i)
    }
}

function S_getChannel(origin, sfx_id) {
    // channel to use, killing same-origin sounds first (done by caller)
    let cnum
    for (cnum = 0; cnum < NUM_CHANNELS; cnum++) {
        if (channels[cnum].sfx === -1) break
        if (origin !== null && channels[cnum].origin === origin) {
            S_StopChannel(cnum)
            break
        }
    }
    if (cnum === NUM_CHANNELS) {
        // kick out a lower-priority sound
        for (cnum = 0; cnum < NUM_CHANNELS; cnum++) {
            if (SND.sfxPriority[channels[cnum].sfx] >=
                SND.sfxPriority[sfx_id]) break
        }
        if (cnum === NUM_CHANNELS) return -1
        S_StopChannel(cnum)
    }
    channels[cnum].sfx = sfx_id
    channels[cnum].origin = origin
    return cnum
}

function StartSound(origin, sfx_id) {
    if (sfx_id <= 0 || sfx_id >= SND.NUMSFX) return

    // linked sounds use the link's data with fixed volume adjustments
    let id = sfx_id
    let volume = snd_SfxVolume
    if (SND.sfxLink[sfx_id] !== -1) {
        id = SND.sfxLink[sfx_id]
        volume += SND.sfxVolume[sfx_id]
        if (volume < 1) return
        if (volume > snd_SfxVolume) volume = snd_SfxVolume
    }

    let sep = NORM_SEP
    const listener = listenerMobj()
    if (origin !== null && listener !== null && origin !== listener &&
        origin.x !== undefined) {
        const adj = S_AdjustSoundParams(listener, origin)
        if (adj === null) return
        if (origin.x === listener.x && origin.y === listener.y)
            adj.sep = NORM_SEP
        volume = adj.vol
        sep = adj.sep
    }

    // pitch variation (cosmetic M_Random, like vanilla)
    let pitch = 128
    if (sfx_id >= SND.sfx.sfx_sawup && sfx_id <= SND.sfx.sfx_sawhit) {
        pitch += 8 - (R.M_Random() & 15)
    } else if (sfx_id !== SND.sfx.sfx_itemup &&
        sfx_id !== SND.sfx.sfx_tink) {
        pitch += 16 - (R.M_Random() & 31)
    }
    if (pitch < 0) pitch = 0
    if (pitch > 255) pitch = 255

    // kill sounds from the same origin
    StopSound(origin)

    const cnum = S_getChannel(origin, id)
    if (cnum < 0) return

    if (IS !== null)
        channels[cnum].handle = IS.I_StartSound(id, volume, sep, pitch)
}

// per tic: stop finished channels, re-adjust moving origins
function S_UpdateSounds() {
    if (IS === null) return
    const listener = listenerMobj()
    for (let i = 0; i < NUM_CHANNELS; i++) {
        const c = channels[i]
        if (c.sfx === -1) continue
        if (!IS.I_SoundIsPlaying(c.handle)) {
            S_StopChannel(i)
            continue
        }
        if (c.origin !== null && listener !== null &&
            c.origin !== listener && c.origin.x !== undefined) {
            const adj = S_AdjustSoundParams(listener, c.origin)
            if (adj === null) S_StopChannel(i)
            else IS.I_UpdateSoundParams(c.handle, adj.vol, adj.sep)
        }
    }
}

// music control: number -> taud file via the platform
function ChangeMusic(musicnum, looping) {
    if (IS !== null) IS.I_PlaySong(SND.musNames[musicnum], looping)
}

// per-level music start (s_sound.c S_Start)
function S_Start() {
    const st = G.state
    // mus_e1m1 is index 1; (episode-1)*9 + map
    const musicnum = 1 + (st.gameepisode - 1) * 9 + (st.gamemap - 1)
    for (let i = 0; i < NUM_CHANNELS; i++) S_StopChannel(i)
    ChangeMusic(musicnum, true)
}

function S_StopMusic() {
    if (IS !== null) IS.I_StopSong()
}

// test/diagnostic access
function getChannels() { return channels }

exports = {
    StartSound, StopSound, ChangeMusic,
    S_Start, S_StopMusic, S_UpdateSounds,
    S_SetSfxVolume, S_SetMusicVolume, S_AdjustSoundParams,
    SetSfxVolume: S_SetSfxVolume,       // m_menu calls these names
    SetMusicVolume: S_SetMusicVolume,
    getChannels,
    getSfxVolume: () => snd_SfxVolume,
    init: function (D) {
        DD = D.defs; R = D.m_random; G = D.g_game; RM = D.r_main
        T = D.tables; SND = D.sounds
        IS = D.i_sound !== undefined ? D.i_sound : null
    },
}
