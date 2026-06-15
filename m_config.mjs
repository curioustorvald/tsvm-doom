// m_config.mjs -- doomrc configuration: keymap + options (m_misc.c defaults)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Pure parse / serialise / apply -- no host globals. doom.js does the disk I/O
// (read text -> parseConfig -> applyConfig at boot; serializeConfig -> write
// text at exit), which keeps this module headlessly testable. The INI-style
// format mirrors zfm.js's zfmrc: `[section]` headers, `key = value`, `#`/`;`
// line and inline comments.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let G = null, M = null

// key name -> raw libGDX keycode (subset of tvdos/include/keysym.mjs; the same
// numbering g_game.keys uses). Matched case-insensitively. A bare integer is
// also accepted as a keycode.
const KEYNAMES = {
    NUM_0: 7, NUM_1: 8, NUM_2: 9, NUM_3: 10, NUM_4: 11, NUM_5: 12,
    NUM_6: 13, NUM_7: 14, NUM_8: 15, NUM_9: 16,
    A: 29, B: 30, C: 31, D: 32, E: 33, F: 34, G: 35, H: 36, I: 37,
    J: 38, K: 39, L: 40, M: 41, N: 42, O: 43, P: 44, Q: 45, R: 46,
    S: 47, T: 48, U: 49, V: 50, W: 51, X: 52, Y: 53, Z: 54,
    UP: 19, DOWN: 20, LEFT: 21, RIGHT: 22,
    ENTER: 66, ESCAPE: 111, SPACE: 62, TAB: 61, BACKSPACE: 67,
    COMMA: 55, PERIOD: 56, MINUS: 69, EQUALS: 70, SLASH: 76,
    BACKSLASH: 73, SEMICOLON: 74, APOSTROPHE: 75, GRAVE: 68,
    LEFT_BRACKET: 71, RIGHT_BRACKET: 72,
    SHIFT_LEFT: 59, SHIFT_RIGHT: 60,
    CONTROL_LEFT: 129, CONTROL_RIGHT: 130,
    ALT_LEFT: 57, ALT_RIGHT: 58,
    HOME: 3, END: 123, INSERT: 124, PAGE_UP: 92, PAGE_DOWN: 93,
}

// friendlier aliases accepted in doomrc
const KEYALIASES = {
    CTRL: "CONTROL_LEFT", LCTRL: "CONTROL_LEFT", RCTRL: "CONTROL_RIGHT",
    CONTROL: "CONTROL_LEFT",
    ALT: "ALT_LEFT", LALT: "ALT_LEFT", RALT: "ALT_RIGHT",
    SHIFT: "SHIFT_LEFT", LSHIFT: "SHIFT_LEFT", RSHIFT: "SHIFT_RIGHT",
    RETURN: "ENTER", ESC: "ESCAPE", SPACEBAR: "SPACE", DELETE: "BACKSPACE",
}

// reverse map (code -> canonical name) for serialisation
const CODENAMES = {}
for (const name in KEYNAMES)
    if (CODENAMES[KEYNAMES[name]] === undefined) CODENAMES[KEYNAMES[name]] = name

// doomrc [keys] action -> field in g_game.keys. Order also drives serialisation.
const KEY_ACTIONS = [
    ["forward", "up"], ["back", "down"],
    ["turnleft", "left"], ["turnright", "right"],
    ["altforward", "w"], ["altback", "s"],
    ["strafeleft", "strafeleft"], ["straferight", "straferight"],
    ["fire", "fire"], ["use", "use"], ["strafe", "strafe"], ["run", "speed"],
    ["weapon1", "weap1"], ["weapon2", "weap2"], ["weapon3", "weap3"],
    ["weapon4", "weap4"], ["weapon5", "weap5"], ["weapon6", "weap6"],
    ["weapon7", "weap7"],
]
const ACTION_TO_FIELD = {}
for (const [a, f] of KEY_ACTIONS) ACTION_TO_FIELD[a] = f

function keyNameToCode(tok) {
    const up = String(tok).trim().toUpperCase()
    if (up.length === 0) return null
    if (/^[0-9]+$/.test(up)) {
        const n = parseInt(up, 10)
        return (n >= 0 && n < 256) ? n : null
    }
    const canon = KEYALIASES[up] || up
    return (KEYNAMES[canon] !== undefined) ? KEYNAMES[canon] : null
}

function codeToKeyName(code) {
    return (CODENAMES[code] !== undefined) ? CODENAMES[code] : String(code)
}

function parseBool(v, dflt) {
    const s = String(v).trim().toLowerCase()
    if (s === "on" || s === "true" || s === "yes" || s === "1") return true
    if (s === "off" || s === "false" || s === "no" || s === "0") return false
    return dflt
}

function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n) }

// parse doomrc text -> { keys:{field:code}, options:{...}, game:{...}, warnings }
function parseConfig(text) {
    const out = { keys: {}, options: {}, game: {}, warnings: [] }
    if (typeof text !== "string") return out
    const lines = text.split(/\r?\n/)
    let section = null
    for (let li = 0; li < lines.length; li++) {
        // strip inline + whole-line comments (# or ;)
        let line = lines[li]
        const hash = line.indexOf("#"), semi = line.indexOf(";")
        let cut = -1
        if (hash >= 0) cut = hash
        if (semi >= 0 && (cut < 0 || semi < cut)) cut = semi
        if (cut >= 0) line = line.slice(0, cut)
        line = line.trim()
        if (line.length === 0) continue

        if (line.startsWith("[") && line.endsWith("]")) {
            section = line.slice(1, -1).trim().toLowerCase()
            continue
        }
        const eq = line.indexOf("=")
        if (eq < 0) { out.warnings.push("line " + (li + 1) + ": no '='"); continue }
        const key = line.slice(0, eq).trim().toLowerCase()
        const val = line.slice(eq + 1).trim()

        if (section === "keys") {
            const field = ACTION_TO_FIELD[key]
            if (field === undefined) {
                out.warnings.push("line " + (li + 1) + ": unknown action '" + key + "'")
                continue
            }
            const code = keyNameToCode(val)
            if (code === null) {
                out.warnings.push("line " + (li + 1) + ": unknown key '" + val + "'")
                continue
            }
            out.keys[field] = code
        } else if (section === "options") {
            if (key === "sfxvolume") out.options.sfxvolume = clamp(parseInt(val, 10) || 0, 0, 15)
            else if (key === "musicvolume") out.options.musicvolume = clamp(parseInt(val, 10) || 0, 0, 15)
            else if (key === "screensize") out.options.screensize = clamp(parseInt(val, 10) || 0, 3, 11)
            else if (key === "frameskip") out.options.frameskip = clamp(parseInt(val, 10) || 0, 0, 4)
            else if (key === "messages") out.options.messages = parseBool(val, true)
            else if (key === "autorun") out.options.autorun = parseBool(val, false)
            else out.warnings.push("line " + (li + 1) + ": unknown option '" + key + "'")
        } else if (section === "game") {
            if (key === "skill") out.game.skill = clamp((parseInt(val, 10) || 1) - 1, 0, 4)
            else out.warnings.push("line " + (li + 1) + ": unknown game setting '" + key + "'")
        } else {
            out.warnings.push("line " + (li + 1) + ": outside any [section]")
        }
    }
    return out
}

// apply a parsed config to the live engine (keymap, menu options, autorun)
function applyConfig(cfg) {
    for (const field in cfg.keys)
        if (G.keys[field] !== undefined) G.keys[field] = cfg.keys[field]

    const o = cfg.options
    if (o.sfxvolume !== undefined || o.musicvolume !== undefined) {
        const sv = o.sfxvolume !== undefined ? o.sfxvolume : M.getSfxVolume()
        const mv = o.musicvolume !== undefined ? o.musicvolume : M.getMusicVolume()
        M.setVolumes(sv, mv)
    }
    if (o.screensize !== undefined) M.setScreenSize(o.screensize)
    if (o.frameskip !== undefined && M.setFrameskip) M.setFrameskip(o.frameskip)
    if (o.messages !== undefined) M.setShowMessages(o.messages)
    if (o.autorun !== undefined) G.setAutorun(o.autorun)
    if (cfg.game.skill !== undefined && M.setDefaultSkill) M.setDefaultSkill(cfg.game.skill)
}

// serialise the live engine state back into doomrc text
function serializeConfig() {
    const L = []
    L.push("# tsvm-doom configuration (doomrc)")
    L.push("# Lines starting with # or ; are comments; inline comments too.")
    L.push("# Rewritten on exit -- edits to comments/order are not preserved.")
    L.push("")
    L.push("[keys]")
    L.push("# action = key name (see `doom keys`) or a raw numeric keycode")
    for (const [action, field] of KEY_ACTIONS)
        L.push(pad(action, 12) + "= " + codeToKeyName(G.keys[field]))
    L.push("")
    L.push("[options]")
    L.push(pad("sfxvolume", 12) + "= " + M.getSfxVolume() + "      ; 0..15")
    L.push(pad("musicvolume", 12) + "= " + M.getMusicVolume() + "      ; 0..15")
    L.push(pad("screensize", 12) + "= " + M.getScreenSize() + "     ; 3..11")
    L.push(pad("frameskip", 12) + "= " + (M.getFrameskip ? M.getFrameskip() : 0) + "      ; 0..4 (0 = draw every frame)")
    L.push(pad("messages", 12) + "= " + (M.getShowMessages() ? "on" : "off"))
    L.push(pad("autorun", 12) + "= " + (G.getAutorun && G.getAutorun() ? "on" : "off"))
    L.push("")
    L.push("[game]")
    L.push(pad("skill", 12) + "= " + ((M.getDefaultSkill ? M.getDefaultSkill() : 1) + 1) + "      ; 1..5 (1=ITYTD .. 5=Nightmare)")
    L.push("")
    return L.join("\n")
}

function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s }

exports = {
    parseConfig, applyConfig, serializeConfig,
    keyNameToCode, codeToKeyName,
    KEY_ACTIONS,
    init: function (D) { G = D.g_game; M = D.m_menu },
}
