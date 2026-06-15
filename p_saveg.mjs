// p_saveg.mjs -- savegame archiving (p_saveg.c + g_game.c save/load)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Vanilla-shaped format: same record sequence (24-byte description,
// 16-byte version, header, players, world shorts, thinkers, specials,
// 0x1d terminator) with explicit little-endian fields instead of raw
// struct dumps (vanilla's are pointer-laden and never portable anyway).
// Load semantics match vanilla: mobj targets are nulled, players are
// relinked, in-stasis plats are lost on save (vanilla bug, preserved).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, I = null, G = null, PT = null, PM = null, PMU = null
let PMov = null, PS = null, RM = null, L = null

const SAVESTRINGSIZE = 24
const VERSIONSIZE = 16
const SAVEGAMESIZE = 0x2c000
const TERMINATOR = 0x1d

// thinker classes
const tc_end = 0, tc_mobj = 1
// specials classes
const tc_ceiling = 0, tc_door = 1, tc_floor = 2, tc_plat = 3
const tc_flash = 4, tc_strobe = 5, tc_glow = 6, tc_endspecials = 7

let buf = null
let view = null
let p = 0

function wU8(v) { buf[p++] = v & 0xFF }
function wI16(v) { view.setInt16(p, v, true); p += 2 }
function wI32(v) { view.setInt32(p, v, true); p += 4 }
function rU8() { return buf[p++] }
function rI16() { const v = view.getInt16(p, true); p += 2; return v }
function rI32() { const v = view.getInt32(p, true); p += 4; return v }

function wStr(s, len) {
    for (let i = 0; i < len; i++)
        buf[p++] = i < s.length ? s.charCodeAt(i) & 0xFF : 0
}

function rStr(len) {
    let s = ""
    for (let i = 0; i < len; i++) {
        const c = buf[p + i]
        if (c !== 0 && s.length === i) s += String.fromCharCode(c)
    }
    p += len
    return s
}

// ---- players ----

function P_ArchivePlayers() {
    const st = G.state
    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        if (!st.playeringame[i]) continue
        const pl = st.players[i]
        wI32(pl.playerstate)
        wI32(pl.viewz); wI32(pl.viewheight); wI32(pl.deltaviewheight)
        wI32(pl.bob)
        wI32(pl.health); wI32(pl.armorpoints); wI32(pl.armortype)
        for (let j = 0; j < DD.Power.NUMPOWERS; j++) wI32(pl.powers[j])
        for (let j = 0; j < DD.Card.NUMCARDS; j++) wI32(pl.cards[j])
        wI32(pl.backpack ? 1 : 0)
        for (let j = 0; j < DD.MAXPLAYERS; j++) wI32(pl.frags[j])
        wI32(pl.readyweapon); wI32(pl.pendingweapon)
        for (let j = 0; j < DD.Weapon.NUMWEAPONS; j++) wI32(pl.weaponowned[j])
        for (let j = 0; j < DD.Ammo.NUMAMMO; j++) wI32(pl.ammo[j])
        for (let j = 0; j < DD.Ammo.NUMAMMO; j++) wI32(pl.maxammo[j])
        wI32(pl.attackdown ? 1 : 0); wI32(pl.usedown ? 1 : 0)
        wI32(pl.cheats); wI32(pl.refire)
        wI32(pl.killcount); wI32(pl.itemcount); wI32(pl.secretcount)
        wI32(pl.damagecount); wI32(pl.bonuscount)
        wI32(pl.extralight); wI32(pl.fixedcolormap); wI32(pl.colormap)
        for (let j = 0; j < 2; j++) {
            const psp = pl.psprites[j]
            // vanilla: 0 = inactive, else state index (S_NULL never live)
            wI32(psp.state === -1 ? 0 : psp.state)
            wI32(psp.tics); wI32(psp.sx); wI32(psp.sy)
        }
        wI32(pl.didsecret ? 1 : 0)
    }
}

function P_UnArchivePlayers() {
    const st = G.state
    for (let i = 0; i < DD.MAXPLAYERS; i++) {
        if (!st.playeringame[i]) continue
        const pl = st.players[i]
        pl.playerstate = rI32()
        pl.viewz = rI32(); pl.viewheight = rI32(); pl.deltaviewheight = rI32()
        pl.bob = rI32()
        pl.health = rI32(); pl.armorpoints = rI32(); pl.armortype = rI32()
        for (let j = 0; j < DD.Power.NUMPOWERS; j++) pl.powers[j] = rI32()
        for (let j = 0; j < DD.Card.NUMCARDS; j++) pl.cards[j] = rI32()
        pl.backpack = rI32() !== 0
        for (let j = 0; j < DD.MAXPLAYERS; j++) pl.frags[j] = rI32()
        pl.readyweapon = rI32(); pl.pendingweapon = rI32()
        for (let j = 0; j < DD.Weapon.NUMWEAPONS; j++) pl.weaponowned[j] = rI32()
        for (let j = 0; j < DD.Ammo.NUMAMMO; j++) pl.ammo[j] = rI32()
        for (let j = 0; j < DD.Ammo.NUMAMMO; j++) pl.maxammo[j] = rI32()
        pl.attackdown = rI32() !== 0; pl.usedown = rI32() !== 0
        pl.cheats = rI32(); pl.refire = rI32()
        pl.killcount = rI32(); pl.itemcount = rI32(); pl.secretcount = rI32()
        pl.damagecount = rI32(); pl.bonuscount = rI32()
        pl.extralight = rI32(); pl.fixedcolormap = rI32(); pl.colormap = rI32()
        for (let j = 0; j < 2; j++) {
            const psp = pl.psprites[j]
            const stnum = rI32()
            psp.state = stnum === 0 ? -1 : stnum
            psp.tics = rI32(); psp.sx = rI32(); psp.sy = rI32()
        }
        pl.didsecret = rI32() !== 0
        // relinked by the thinker unarchive
        pl.mo = null
        pl.message = null
        pl.attacker = null
    }
}

// ---- world state (shorts, exactly vanilla's layout) ----

function P_ArchiveWorld() {
    for (let i = 0; i < L.numsectors; i++) {
        wI16(L.sec_floorheight[i] >> 16)
        wI16(L.sec_ceilingheight[i] >> 16)
        wI16(L.sec_floorpic[i])
        wI16(L.sec_ceilingpic[i])
        wI16(L.sec_lightlevel[i])
        wI16(L.sec_special[i])
        wI16(L.sec_tag[i])
    }
    for (let i = 0; i < L.numlines; i++) {
        wI16(L.line_flags[i])
        wI16(L.line_special[i])
        wI16(L.line_tag[i])
        for (let j = 0; j < 2; j++) {
            const sn = j === 0 ? L.line_sidenum0[i] : L.line_sidenum1[i]
            if (sn === -1) continue
            wI16(L.side_textureoffset[sn] >> 16)
            wI16(L.side_rowoffset[sn] >> 16)
            wI16(L.side_toptexture[sn])
            wI16(L.side_bottomtexture[sn])
            wI16(L.side_midtexture[sn])
        }
    }
}

function P_UnArchiveWorld() {
    for (let i = 0; i < L.numsectors; i++) {
        L.sec_floorheight[i] = rI16() << 16
        L.sec_ceilingheight[i] = rI16() << 16
        L.sec_floorpic[i] = rI16()
        L.sec_ceilingpic[i] = rI16()
        L.sec_lightlevel[i] = rI16()
        L.sec_special[i] = rI16()
        L.sec_tag[i] = rI16()
        L.sec_specialdata[i] = null
        L.sec_soundtarget[i] = null
    }
    for (let i = 0; i < L.numlines; i++) {
        L.line_flags[i] = rI16()
        L.line_special[i] = rI16()
        L.line_tag[i] = rI16()
        for (let j = 0; j < 2; j++) {
            const sn = j === 0 ? L.line_sidenum0[i] : L.line_sidenum1[i]
            if (sn === -1) continue
            L.side_textureoffset[sn] = rI16() << 16
            L.side_rowoffset[sn] = rI16() << 16
            L.side_toptexture[sn] = rI16()
            L.side_bottomtexture[sn] = rI16()
            L.side_midtexture[sn] = rI16()
        }
    }
}

// ---- thinkers (mobjs) ----

function archiveMobj(mo) {
    wI32(mo.x); wI32(mo.y); wI32(mo.z)
    wI32(mo.angle | 0)
    wI32(mo.sprite); wI32(mo.frame)
    wI32(mo.floorz); wI32(mo.ceilingz)
    wI32(mo.radius); wI32(mo.height)
    wI32(mo.momx); wI32(mo.momy); wI32(mo.momz)
    wI32(mo.validcount)
    wI32(mo.type)
    wI32(mo.tics); wI32(mo.state)
    wI32(mo.flags); wI32(mo.health)
    wI32(mo.movedir); wI32(mo.movecount)
    // target/tracer: vanilla dumps dangling pointers and nulls on load
    wI32(0)
    wI32(mo.reactiontime); wI32(mo.threshold)
    wI32(mo.player !== null ? G.state.players.indexOf(mo.player) + 1 : 0)
    wI32(mo.lastlook)
    if (mo.spawnpoint !== null) {
        wI16(mo.spawnpoint.x); wI16(mo.spawnpoint.y)
        wI16(mo.spawnpoint.angle); wI16(mo.spawnpoint.type)
        wI16(mo.spawnpoint.options)
    } else {
        wI16(0); wI16(0); wI16(0); wI16(0); wI16(0)
    }
    wI32(0)     // tracer slot
}

function unarchiveMobj() {
    const mo = PM.makeMobjShell()
    mo.x = rI32(); mo.y = rI32(); mo.z = rI32()
    mo.angle = rI32()
    mo.sprite = rI32(); mo.frame = rI32()
    mo.floorz = rI32(); mo.ceilingz = rI32()
    mo.radius = rI32(); mo.height = rI32()
    mo.momx = rI32(); mo.momy = rI32(); mo.momz = rI32()
    mo.validcount = rI32()
    mo.type = rI32()
    mo.tics = rI32(); mo.state = rI32()
    mo.flags = rI32(); mo.health = rI32()
    mo.movedir = rI32(); mo.movecount = rI32()
    rI32()                              // target (nulled like vanilla)
    mo.target = null
    mo.reactiontime = rI32(); mo.threshold = rI32()
    const pnum = rI32()
    mo.lastlook = rI32()
    const sp = { x: rI16(), y: rI16(), angle: rI16(), type: rI16(),
        options: rI16() }
    mo.spawnpoint = sp
    rI32()                              // tracer (nulled)
    mo.tracer = null

    if (pnum !== 0) {
        mo.player = G.state.players[pnum - 1]
        mo.player.mo = mo
    }
    PMU.P_SetThingPosition(mo)
    const sec = L.ssec_sector[mo.subsector]
    mo.floorz = L.sec_floorheight[sec]
    mo.ceilingz = L.sec_ceilingheight[sec]
    mo.tfunc = PM.P_MobjThinker
    PT.P_AddThinker(mo)
    return mo
}

function P_ArchiveThinkers() {
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc === PM.P_MobjThinker) {
            wU8(tc_mobj)
            archiveMobj(th)
        }
    }
    wU8(tc_end)
}

function P_UnArchiveThinkers() {
    // remove all current mobj thinkers (the fresh-loaded level's spawns)
    let cur = PT.thinkercap.next
    while (cur !== PT.thinkercap) {
        const next = cur.next
        if (cur.tfunc === PM.P_MobjThinker) PM.P_RemoveMobj(cur)
        cur = next
    }
    PT.P_InitThinkers()

    for (;;) {
        const tclass = rU8()
        if (tclass === tc_end) return
        if (tclass !== tc_mobj)
            throw Error("Unknown tclass " + tclass + " in savegame")
        unarchiveMobj()
    }
}

// ---- specials ----

function P_ArchiveSpecials() {
    for (let th = PT.thinkercap.next; th !== PT.thinkercap; th = th.next) {
        if (th.tfunc === null) {
            // in stasis: vanilla only recovers ceilings here (in-stasis
            // plats are silently lost -- bug preserved)
            if (isActiveCeiling(th)) {
                wU8(tc_ceiling)
                archiveCeiling(th, false)
            }
            continue
        }
        if (th.tfunc === PMov.T_MoveCeiling) {
            wU8(tc_ceiling)
            archiveCeiling(th, true)
        } else if (th.tfunc === PMov.T_VerticalDoor) {
            wU8(tc_door)
            wI32(th.sector); wI32(th.type)
            wI32(th.topheight); wI32(th.speed)
            wI32(th.direction); wI32(th.topwait); wI32(th.topcountdown)
        } else if (th.tfunc === PMov.T_MoveFloor) {
            wU8(tc_floor)
            wI32(th.sector); wI32(th.type)
            wI32(th.crush ? 1 : 0); wI32(th.direction)
            wI32(th.newspecial); wI32(th.texture)
            wI32(th.floordestheight); wI32(th.speed)
        } else if (th.tfunc === PMov.T_PlatRaise) {
            wU8(tc_plat)
            archivePlat(th, true)
        } else if (tfuncIs(th, "T_LightFlash")) {
            wU8(tc_flash)
            wI32(th.sector); wI32(th.count)
            wI32(th.maxlight); wI32(th.minlight)
            wI32(th.maxtime); wI32(th.mintime)
        } else if (tfuncIs(th, "T_StrobeFlash")) {
            wU8(tc_strobe)
            wI32(th.sector); wI32(th.count)
            wI32(th.minlight); wI32(th.maxlight)
            wI32(th.darktime); wI32(th.brighttime)
        } else if (tfuncIs(th, "T_Glow")) {
            wU8(tc_glow)
            wI32(th.sector)
            wI32(th.minlight); wI32(th.maxlight)
            wI32(th.direction)
        }
    }
    wU8(tc_endspecials)
}

function tfuncIs(th, name) {
    return th.tfunc !== null && th.tfunc.name === name
}

function isActiveCeiling(th) {
    // an in-stasis ceiling is in activeceilings with tfunc null
    return th.sector !== undefined && th.bottomheight !== undefined &&
        th.topheight !== undefined && th.olddirection !== undefined
}

function archiveCeiling(th, active) {
    wI32(th.sector); wI32(th.type)
    wI32(th.bottomheight); wI32(th.topheight)
    wI32(th.speed); wI32(th.crush ? 1 : 0)
    wI32(th.direction); wI32(th.tag); wI32(th.olddirection)
    wU8(active ? 1 : 0)
}

function archivePlat(th, active) {
    wI32(th.sector); wI32(th.speed)
    wI32(th.low); wI32(th.high)
    wI32(th.wait); wI32(th.count)
    wI32(th.status); wI32(th.oldstatus)
    wI32(th.crush ? 1 : 0); wI32(th.tag); wI32(th.type)
    wU8(active ? 1 : 0)
}

function P_UnArchiveSpecials() {
    for (;;) {
        const tclass = rU8()
        switch (tclass) {
            case tc_endspecials:
                return
            case tc_ceiling: {
                const c = {
                    prev: null, next: null, tfunc: null,
                    sector: rI32(), type: rI32(),
                    bottomheight: rI32(), topheight: rI32(),
                    speed: rI32(), crush: rI32() !== 0,
                    direction: rI32(), tag: rI32(), olddirection: rI32(),
                }
                const active = rU8() !== 0
                if (active) c.tfunc = PMov.T_MoveCeiling
                PT.P_AddThinker(c)
                L.sec_specialdata[c.sector] = c
                PMov.P_AddActiveCeiling(c)
                break
            }
            case tc_door: {
                const d = {
                    prev: null, next: null, tfunc: PMov.T_VerticalDoor,
                    sector: rI32(), type: rI32(),
                    topheight: rI32(), speed: rI32(),
                    direction: rI32(), topwait: rI32(), topcountdown: rI32(),
                }
                PT.P_AddThinker(d)
                L.sec_specialdata[d.sector] = d
                break
            }
            case tc_floor: {
                const f = {
                    prev: null, next: null, tfunc: PMov.T_MoveFloor,
                    sector: rI32(), type: rI32(),
                    crush: rI32() !== 0, direction: rI32(),
                    newspecial: rI32(), texture: rI32(),
                    floordestheight: rI32(), speed: rI32(),
                }
                PT.P_AddThinker(f)
                L.sec_specialdata[f.sector] = f
                break
            }
            case tc_plat: {
                const pl = {
                    prev: null, next: null, tfunc: null,
                    sector: rI32(), speed: rI32(),
                    low: rI32(), high: rI32(),
                    wait: rI32(), count: rI32(),
                    status: rI32(), oldstatus: rI32(),
                    crush: rI32() !== 0, tag: rI32(), type: rI32(),
                }
                const active = rU8() !== 0
                if (active) pl.tfunc = PMov.T_PlatRaise
                PT.P_AddThinker(pl)
                L.sec_specialdata[pl.sector] = pl
                PMov.P_AddActivePlat(pl)
                break
            }
            case tc_flash: {
                const fl = {
                    prev: null, next: null, tfunc: PS.getTLightFlash(),
                    sector: rI32(), count: rI32(),
                    maxlight: rI32(), minlight: rI32(),
                    maxtime: rI32(), mintime: rI32(),
                }
                PT.P_AddThinker(fl)
                break
            }
            case tc_strobe: {
                const sb = {
                    prev: null, next: null, tfunc: PS.getTStrobeFlash(),
                    sector: rI32(), count: rI32(),
                    minlight: rI32(), maxlight: rI32(),
                    darktime: rI32(), brighttime: rI32(),
                }
                PT.P_AddThinker(sb)
                break
            }
            case tc_glow: {
                const g = {
                    prev: null, next: null, tfunc: PS.getTGlow(),
                    sector: rI32(),
                    minlight: rI32(), maxlight: rI32(),
                    direction: rI32(),
                }
                PT.P_AddThinker(g)
                break
            }
            default:
                throw Error("P_UnArchiveSpecials: unknown tclass " + tclass)
        }
    }
}

// ---- top level (g_game.c G_DoSaveGame / G_DoLoadGame core) ----

// returns a Uint8Array of the complete savegame
function P_SaveGameToBuffer(description) {
    const st = G.state
    buf = new Uint8Array(SAVEGAMESIZE)
    view = new DataView(buf.buffer)
    p = 0

    wStr(description, SAVESTRINGSIZE)
    wStr("version 109", VERSIONSIZE)
    wU8(st.gameskill)
    wU8(st.gameepisode)
    wU8(st.gamemap)
    for (let i = 0; i < DD.MAXPLAYERS; i++)
        wU8(st.playeringame[i] ? 1 : 0)
    // leveltime as 3 bytes, big-end first (vanilla)
    wU8(st.leveltime >> 16)
    wU8(st.leveltime >> 8)
    wU8(st.leveltime)

    P_ArchivePlayers()
    P_ArchiveWorld()
    P_ArchiveThinkers()
    P_ArchiveSpecials()
    wU8(TERMINATOR)

    return buf.slice(0, p)
}

// reads header only (for menu slot names): returns description or null
function P_ReadSaveDescription(bytes) {
    if (bytes === null || bytes.length < SAVESTRINGSIZE + VERSIONSIZE)
        return null
    let s = ""
    for (let i = 0; i < SAVESTRINGSIZE; i++) {
        if (bytes[i] === 0) break
        s += String.fromCharCode(bytes[i])
    }
    return s
}

// loads a complete savegame buffer; throws on version/terminator mismatch
function P_LoadGameFromBuffer(bytes) {
    const st = G.state
    buf = bytes
    view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    p = 0

    rStr(SAVESTRINGSIZE)                        // description
    const vcheck = rStr(VERSIONSIZE)
    if (vcheck !== "version 109")
        throw Error("Savegame is from a different version")

    const skill = rU8()
    const episode = rU8()
    const map = rU8()
    for (let i = 0; i < DD.MAXPLAYERS; i++)
        st.playeringame[i] = rU8() !== 0
    const lt = (rU8() << 16) | (rU8() << 8) | rU8()

    // load a base level, then overwrite its state
    G.G_InitNew(skill, episode, map)
    st.leveltime = lt

    P_UnArchivePlayers()
    P_UnArchiveWorld()
    P_UnArchiveThinkers()
    P_UnArchiveSpecials()

    if (rU8() !== TERMINATOR)
        throw Error("Bad savegame (missing terminator)")

    st.usergame = true
}

exports = {
    P_SaveGameToBuffer, P_LoadGameFromBuffer, P_ReadSaveDescription,
    SAVESTRINGSIZE,
    init: function (D) {
        DD = D.defs; I = D.info; G = D.g_game; PT = D.p_tick
        PM = D.p_mobj; PMU = D.p_maputl; PMov = D.p_movers
        PS = D.p_spec; RM = D.r_main; L = D.p_setup.level
    },
}
