// st_stuff.mjs -- status bar (st_stuff.c + st_lib.c) and cheats
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// The st_lib dirty-rectangle widget machinery is condensed: the bar is
// redrawn into screens[0] every frame (visually identical, presentation
// only). Face logic, palette logic and cheats are exact. Cheats match on
// plaintext (vanilla scrambles the sequences; behaviour is the same).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, R = null, I = null, G = null, W = null, V = null
let RM = null, PInter = null, IV = null, S = null

const ST_HEIGHT = 32
const ST_WIDTH = _G.DOOM.SCREENWIDTH
const ST_Y = _G.DOOM.SCREENHEIGHT - ST_HEIGHT
const ST_X = 0
const ST_FX = 143

// face constants
const ST_NUMPAINFACES = 5
const ST_NUMSTRAIGHTFACES = 3
const ST_NUMTURNFACES = 2
const ST_NUMSPECIALFACES = 3
const ST_FACESTRIDE =
    ST_NUMSTRAIGHTFACES + ST_NUMTURNFACES + ST_NUMSPECIALFACES
const ST_NUMEXTRAFACES = 2
const ST_NUMFACES = ST_FACESTRIDE * ST_NUMPAINFACES + ST_NUMEXTRAFACES
const ST_TURNOFFSET = ST_NUMSTRAIGHTFACES
const ST_OUCHOFFSET = ST_TURNOFFSET + ST_NUMTURNFACES
const ST_EVILGRINOFFSET = ST_OUCHOFFSET + 1
const ST_RAMPAGEOFFSET = ST_EVILGRINOFFSET + 1
const ST_GODFACE = ST_NUMPAINFACES * ST_FACESTRIDE
const ST_DEADFACE = ST_GODFACE + 1
const ST_EVILGRINCOUNT = 2 * 35
const ST_STRAIGHTFACECOUNT = 17         // TICRATE/2
const ST_TURNCOUNT = 35
const ST_RAMPAGEDELAY = 2 * 35
const ST_MUCHPAIN = 20

const ANG45 = 0x20000000
const ANG180_U = 0x80000000

// patches
let sbar = null
const tallnum = []
let tallpercent = null
const shortnum = []
const keys = []
const faces = []
let faceback = null
let armsbg = null
const arms = []                 // [6][2]

// state
let plyr = null
let st_statusbaron = false
let st_clock = 0
let st_randomnumber = 0
let st_oldhealth = -1
let oldweaponsowned = new Uint8Array(9)
let st_facecount = 0
let st_faceindex = 0
const keyboxes = [-1, -1, -1]
let lastattackdown = -1
let facePriority = 0
let painLastcalc = 0
let painOldhealth = -1

function ST_LoadGraphics() {
    sbar = W.W_CacheLumpName("STBAR")
    for (let i = 0; i < 10; i++) {
        tallnum[i] = W.W_CacheLumpName("STTNUM" + i)
        shortnum[i] = W.W_CacheLumpName("STYSNUM" + i)
    }
    tallpercent = W.W_CacheLumpName("STTPRCNT")
    for (let i = 0; i < 6; i++)
        keys[i] = W.W_CacheLumpName("STKEYS" + i)
    armsbg = W.W_CacheLumpName("STARMS")
    for (let i = 0; i < 6; i++) {
        arms[i] = [
            W.W_CacheLumpName("STGNUM" + (i + 2)),  // grey
            shortnum[i + 2],                        // yellow (lit)
        ]
    }
    faceback = W.W_CacheLumpName("STFB0")
    let facenum = 0
    for (let i = 0; i < ST_NUMPAINFACES; i++) {
        for (let j = 0; j < ST_NUMSTRAIGHTFACES; j++)
            faces[facenum++] = W.W_CacheLumpName("STFST" + i + j)
        faces[facenum++] = W.W_CacheLumpName("STFTR" + i + "0")
        faces[facenum++] = W.W_CacheLumpName("STFTL" + i + "0")
        faces[facenum++] = W.W_CacheLumpName("STFOUCH" + i)
        faces[facenum++] = W.W_CacheLumpName("STFEVL" + i)
        faces[facenum++] = W.W_CacheLumpName("STFKILL" + i)
    }
    faces[facenum++] = W.W_CacheLumpName("STFGOD0")
    faces[facenum++] = W.W_CacheLumpName("STFDEAD0")
}

let loaded = false

function ST_Start(player) {
    if (!loaded) { ST_LoadGraphics(); loaded = true }
    plyr = player
    st_statusbaron = true
    st_faceindex = 0
    facePriority = 0
    st_oldhealth = -1
    lastattackdown = -1
    painOldhealth = -1
    for (let i = 0; i < 9; i++)
        oldweaponsowned[i] = plyr.weaponowned[i]
}

// ---- cheats (plaintext matchers) ----

function makeCheat(seq, params) {
    return { seq, params: params || 0, pos: 0, buf: [] }
}

const cheats = {
    god: makeCheat("iddqd"),
    ammonokey: makeCheat("idfa"),
    ammo: makeCheat("idkfa"),
    mus: makeCheat("idmus", 2),
    noclip: makeCheat("idspispopd"),
    noclip2: makeCheat("idclip"),
    beholdv: makeCheat("idbeholdv"),
    beholds: makeCheat("idbeholds"),
    beholdi: makeCheat("idbeholdi"),
    beholdr: makeCheat("idbeholdr"),
    beholda: makeCheat("idbeholda"),
    beholdl: makeCheat("idbeholdl"),
    behold: makeCheat("idbehold"),
    choppers: makeCheat("idchoppers"),
    clev: makeCheat("idclev", 2),
    mypos: makeCheat("idmypos"),
}

// feed one typed character; returns true when the sequence (plus params)
// completes
function cheatCheck(cht, ch) {
    if (cht.pos < cht.seq.length) {
        if (ch === cht.seq.charCodeAt(cht.pos)) {
            cht.pos++
            if (cht.pos === cht.seq.length && cht.params === 0) {
                cht.pos = 0
                return true
            }
        } else {
            cht.pos = ch === cht.seq.charCodeAt(0) ? 1 : 0
            cht.buf.length = 0
        }
        return false
    }
    // collecting parameters
    cht.buf.push(ch)
    if (cht.buf.length >= cht.params) {
        cht.pos = 0
        const buf = cht.buf.slice()
        cht.buf.length = 0
        cht.lastParams = buf
        return true
    }
    return false
}

// ev: { type: Ev.keydown, data1: charCode } -- chars are lowercase ascii
function ST_Responder(ev) {
    if (ev.type !== DD.Ev.keydown) return false
    const st = G.state
    const ch = ev.data1

    if (!st.netgame) {
        if (cheatCheck(cheats.god, ch)) {
            plyr.cheats ^= DD.CF.GODMODE
            if (plyr.cheats & DD.CF.GODMODE) {
                if (plyr.mo) plyr.mo.health = 100
                plyr.health = 100
                plyr.message = "Degreelessness Mode On"
            } else {
                plyr.message = "Degreelessness Mode Off"
            }
        } else if (cheatCheck(cheats.ammonokey, ch)) {
            plyr.armorpoints = 200
            plyr.armortype = 2
            for (let i = 0; i < DD.Weapon.NUMWEAPONS; i++)
                plyr.weaponowned[i] = 1
            for (let i = 0; i < DD.Ammo.NUMAMMO; i++)
                plyr.ammo[i] = plyr.maxammo[i]
            plyr.message = "Ammo (no keys) Added"
        } else if (cheatCheck(cheats.ammo, ch)) {
            plyr.armorpoints = 200
            plyr.armortype = 2
            for (let i = 0; i < DD.Weapon.NUMWEAPONS; i++)
                plyr.weaponowned[i] = 1
            for (let i = 0; i < DD.Ammo.NUMAMMO; i++)
                plyr.ammo[i] = plyr.maxammo[i]
            for (let i = 0; i < DD.Card.NUMCARDS; i++)
                plyr.cards[i] = 1
            plyr.message = "Very Happy Ammo Added"
        } else if (cheatCheck(cheats.mus, ch)) {
            plyr.message = "Music Change"
            const b = cheats.mus.lastParams
            const n = (b[0] - 49) * 9 + (b[1] - 49)
            if (n > 31 || n < 0) plyr.message = "IMPOSSIBLE SELECTION"
            else S.ChangeMusic(MUS.mus_e1m1 + n, true)
        } else if (cheatCheck(cheats.noclip, ch) ||
            cheatCheck(cheats.noclip2, ch)) {
            plyr.cheats ^= DD.CF.NOCLIP
            plyr.message = (plyr.cheats & DD.CF.NOCLIP)
                ? "No Clipping Mode ON" : "No Clipping Mode OFF"
        }
        const beholds = [cheats.beholdv, cheats.beholds, cheats.beholdi,
            cheats.beholdr, cheats.beholda, cheats.beholdl]
        for (let i = 0; i < 6; i++) {
            if (cheatCheck(beholds[i], ch)) {
                if (!plyr.powers[i]) PInter.P_GivePower(plyr, i)
                else if (i !== DD.Power.strength) plyr.powers[i] = 1
                else plyr.powers[i] = 0
                plyr.message = "Power-up Toggled"
            }
        }
        if (cheatCheck(cheats.behold, ch)) {
            plyr.message = "inVuln, Str, Inviso, Rad, Allmap, or Lite-amp"
        } else if (cheatCheck(cheats.choppers, ch)) {
            plyr.weaponowned[DD.Weapon.chainsaw] = 1
            plyr.powers[DD.Power.invulnerability] = 1
            plyr.message = "... doesn't suck - GM"
        } else if (cheatCheck(cheats.mypos, ch)) {
            plyr.message = "ang=0x" + (plyr.mo.angle >>> 0).toString(16) +
                ";x,y=(0x" + (plyr.mo.x >>> 0).toString(16) +
                ",0x" + (plyr.mo.y >>> 0).toString(16) + ")"
        }
    }

    if (cheatCheck(cheats.clev, ch)) {
        const b = cheats.clev.lastParams
        const epsd = b[0] - 48
        const map = b[1] - 48
        if (epsd < 1 || map < 1) return false
        if (st.gamemode === DD.GameMode.retail && (epsd > 4 || map > 9))
            return false
        if (st.gamemode === DD.GameMode.registered && (epsd > 3 || map > 9))
            return false
        if (st.gamemode === DD.GameMode.shareware && (epsd > 1 || map > 9))
            return false
        plyr.message = "Changing Level..."
        G.G_DeferedInitNew(st.gameskill, epsd, map)
    }
    return false
}

// ---- face logic (exact) ----

function ST_calcPainOffset() {
    const health = plyr.health > 100 ? 100 : plyr.health
    if (health !== painOldhealth) {
        painLastcalc =
            ST_FACESTRIDE * ((((100 - health) * ST_NUMPAINFACES) / 101) | 0)
        painOldhealth = health
    }
    return painLastcalc
}

function ST_updateFaceWidget() {
    if (facePriority < 10) {
        if (!plyr.health) {
            facePriority = 9
            st_faceindex = ST_DEADFACE
            st_facecount = 1
        }
    }

    if (facePriority < 9) {
        if (plyr.bonuscount) {
            let doevilgrin = false
            for (let i = 0; i < DD.Weapon.NUMWEAPONS; i++) {
                if (oldweaponsowned[i] !== plyr.weaponowned[i]) {
                    doevilgrin = true
                    oldweaponsowned[i] = plyr.weaponowned[i]
                }
            }
            if (doevilgrin) {
                facePriority = 8
                st_facecount = ST_EVILGRINCOUNT
                st_faceindex = ST_calcPainOffset() + ST_EVILGRINOFFSET
            }
        }
    }

    if (facePriority < 8) {
        if (plyr.damagecount && plyr.attacker && plyr.attacker !== plyr.mo) {
            facePriority = 7
            if (plyr.health - st_oldhealth > ST_MUCHPAIN) {
                st_facecount = ST_TURNCOUNT
                st_faceindex = ST_calcPainOffset() + ST_OUCHOFFSET
            } else {
                const badguyangle = RM.R_PointToAngle2(plyr.mo.x, plyr.mo.y,
                    plyr.attacker.x, plyr.attacker.y)
                const myangle = plyr.mo.angle >>> 0
                let diffang, right
                if (badguyangle > myangle) {
                    diffang = (badguyangle - myangle) >>> 0
                    right = diffang > ANG180_U ? 1 : 0
                } else {
                    diffang = (myangle - badguyangle) >>> 0
                    right = diffang <= ANG180_U ? 1 : 0
                }
                st_facecount = ST_TURNCOUNT
                st_faceindex = ST_calcPainOffset()
                if (diffang < ANG45) st_faceindex += ST_RAMPAGEOFFSET
                else if (right) st_faceindex += ST_TURNOFFSET
                else st_faceindex += ST_TURNOFFSET + 1
            }
        }
    }

    if (facePriority < 7) {
        if (plyr.damagecount) {
            if (plyr.health - st_oldhealth > ST_MUCHPAIN) {
                facePriority = 7
                st_facecount = ST_TURNCOUNT
                st_faceindex = ST_calcPainOffset() + ST_OUCHOFFSET
            } else {
                facePriority = 6
                st_facecount = ST_TURNCOUNT
                st_faceindex = ST_calcPainOffset() + ST_RAMPAGEOFFSET
            }
        }
    }

    if (facePriority < 6) {
        // rapid firing
        if (plyr.attackdown) {
            if (lastattackdown === -1) lastattackdown = ST_RAMPAGEDELAY
            else if (!--lastattackdown) {
                facePriority = 5
                st_faceindex = ST_calcPainOffset() + ST_RAMPAGEOFFSET
                st_facecount = 1
                lastattackdown = 1
            }
        } else {
            lastattackdown = -1
        }
    }

    if (facePriority < 5) {
        if ((plyr.cheats & DD.CF.GODMODE) ||
            plyr.powers[DD.Power.invulnerability]) {
            facePriority = 4
            st_faceindex = ST_GODFACE
            st_facecount = 1
        }
    }

    if (!st_facecount) {
        st_faceindex = ST_calcPainOffset() + (st_randomnumber % 3)
        st_facecount = ST_STRAIGHTFACECOUNT
        facePriority = 0
    }
    st_facecount--
}

function ST_Ticker() {
    st_clock++
    st_randomnumber = R.M_Random()
    // keycards
    for (let i = 0; i < 3; i++) {
        keyboxes[i] = plyr.cards[i] ? i : -1
        if (plyr.cards[i + 3]) keyboxes[i] = i + 3
    }
    ST_updateFaceWidget()
    st_oldhealth = plyr.health
}

// ---- palette flashes (ST_doPaletteStuff) ----

function ST_doPaletteStuff() {
    let cnt = plyr.damagecount
    if (plyr.powers[DD.Power.strength]) {
        const bzc = 12 - (plyr.powers[DD.Power.strength] >> 6)
        if (bzc > cnt) cnt = bzc
    }
    let palette
    if (cnt) {
        palette = (cnt + 7) >> 3
        if (palette >= 8) palette = 7          // NUMREDPALS
        palette += 1                           // STARTREDPALS
    } else if (plyr.bonuscount) {
        palette = (plyr.bonuscount + 7) >> 3
        if (palette >= 4) palette = 3          // NUMBONUSPALS
        palette += 9                           // STARTBONUSPALS
    } else if (plyr.powers[DD.Power.ironfeet] > 4 * 32 ||
        (plyr.powers[DD.Power.ironfeet] & 8)) {
        palette = 13                           // RADIATIONPAL
    } else {
        palette = 0
    }
    IV.I_SetPalette(palette)
}

// ---- drawing (condensed widgets, full redraw) ----

function drawNum(x, y, width, num, patches) {
    // st_lib STlib_drawNum: right-justified, max `width` digits
    const w = V.patchWidth(patches[0])
    let neg = num < 0
    if (neg) {
        if (width === 2 && num < -9) num = -9
        else if (width === 3 && num < -99) num = -99
        num = -num
    }
    let xx = x
    if (num === 1994) return                   // largeammo sentinel: blank
    if (!num) V.V_DrawPatch(xx - w, y, 0, patches[0])
    let n = num
    while (n && xx > x - width * w) {
        xx -= w
        V.V_DrawPatch(xx, y, 0, patches[n % 10])
        n = (n / 10) | 0
    }
    if (neg) V.V_DrawPatch(xx - 8, y, 0, W.W_CacheLumpName("STTMINUS"))
}

function drawPercent(x, y, num) {
    V.V_DrawPatch(x, y, 0, tallpercent)
    drawNum(x, y, 3, num, tallnum)
}

function ST_Drawer() {
    if (!st_statusbaron) return
    const st = G.state
    const weaponinfo = PInter.getWeaponinfo()

    // background
    V.V_DrawPatch(ST_X, ST_Y, 0, sbar)
    if (st.netgame) V.V_DrawPatch(ST_FX, ST_Y, 0, faceback)

    // ready weapon ammo (vanilla blanks for no-ammo weapons)
    const ammoType = weaponinfo[plyr.readyweapon].ammo
    const readyAmmo = ammoType === DD.Ammo.noammo ? 1994 : plyr.ammo[ammoType]
    drawNum(44, 171, 3, readyAmmo, tallnum)

    // health / armor percent
    drawPercent(90, 171, plyr.health)
    drawPercent(221, 171, plyr.armorpoints)

    // arms background + weapon numbers
    if (!st.deathmatch) {
        V.V_DrawPatch(104, ST_Y, 0, armsbg)
        for (let i = 0; i < 6; i++) {
            const x = 111 + (i % 3) * 12
            const y = 172 + ((i / 3) | 0) * 10
            V.V_DrawPatch(x, y, 0, arms[i][plyr.weaponowned[i + 1] ? 1 : 0])
        }
    }

    // face
    V.V_DrawPatch(143, ST_Y, 0, faces[st_faceindex])

    // keys
    for (let i = 0; i < 3; i++) {
        if (keyboxes[i] !== -1)
            V.V_DrawPatch(239, 171 + i * 10, 0, keys[keyboxes[i]])
    }

    // ammo / max ammo columns (clip, shell, rocket, cell rows)
    const ammoY = [173, 179, 191, 185]
    for (let i = 0; i < 4; i++) {
        drawNum(288, ammoY[i], 3, plyr.ammo[i], shortnum)
        drawNum(314, ammoY[i], 3, plyr.maxammo[i], shortnum)
    }
}

let SFX = null, MUS = null

exports = {
    ST_Start, ST_Ticker, ST_Drawer, ST_Responder, ST_doPaletteStuff,
    ST_HEIGHT, ST_Y,
    init: function (D) {
        DD = D.defs; R = D.m_random; I = D.info; G = D.g_game
        W = D.w_wad; V = D.v_video; RM = D.r_main; PInter = D.p_inter
        IV = D.i_video
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {}, ChangeMusic: () => {} }
        SFX = D.sounds.sfx; MUS = D.sounds.mus
    },
}
