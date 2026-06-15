// p_spec.mjs -- line/sector specials (p_spec.c), lights (p_lights.c),
// switches/buttons (p_switch.c), teleport (p_telept.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PT = null
let PM = null, PMap = null, PMov = null, RD = null, W = null
let L = null, S = null

const FRACUNIT = 65536
const MAXINT = 0x7fffffff
const GLOWSPEED = 8
const STROBEBRIGHT = 5
const FASTDARK = 15
const SLOWDARK = 35
const MAXBUTTONS = 16
const BUTTONTIME = 35
const MAXLINEANIMS = 64

function P_Random() { return R.P_Random() }

// ---- utilities ----

function getSide(currentSector, line, side) {
    const ln = L.sec_lines[currentSector][line]
    return side === 0 ? L.line_sidenum0[ln] : L.line_sidenum1[ln]
}

function getSector(currentSector, line, side) {
    return L.side_sector[getSide(currentSector, line, side)]
}

function twoSided(sector, line) {
    return L.line_flags[L.sec_lines[sector][line]] & DD.ML.TWOSIDED
}

// next sector index along a two-sided line, -1 if one-sided
function getNextSector(line, sec) {
    if (!(L.line_flags[line] & DD.ML.TWOSIDED)) return -1
    if (L.line_frontsector[line] === sec) return L.line_backsector[line]
    return L.line_frontsector[line]
}

function P_FindLowestFloorSurrounding(sec) {
    let floor = L.sec_floorheight[sec]
    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const other = getNextSector(lines[i], sec)
        if (other === -1) continue
        if (L.sec_floorheight[other] < floor)
            floor = L.sec_floorheight[other]
    }
    return floor
}

function P_FindHighestFloorSurrounding(sec) {
    let floor = -500 * FRACUNIT
    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const other = getNextSector(lines[i], sec)
        if (other === -1) continue
        if (L.sec_floorheight[other] > floor)
            floor = L.sec_floorheight[other]
    }
    return floor
}

function P_FindNextHighestFloor(sec, currentheight) {
    const heightlist = []
    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const other = getNextSector(lines[i], sec)
        if (other === -1) continue
        if (L.sec_floorheight[other] > currentheight)
            heightlist.push(L.sec_floorheight[other])
        if (heightlist.length >= 20) break     // vanilla overflow guard
    }
    if (heightlist.length === 0) return currentheight
    let min = heightlist[0]
    for (let i = 1; i < heightlist.length; i++)
        if (heightlist[i] < min) min = heightlist[i]
    return min
}

function P_FindLowestCeilingSurrounding(sec) {
    let height = MAXINT
    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const other = getNextSector(lines[i], sec)
        if (other === -1) continue
        if (L.sec_ceilingheight[other] < height)
            height = L.sec_ceilingheight[other]
    }
    return height
}

function P_FindHighestCeilingSurrounding(sec) {
    let height = 0
    const lines = L.sec_lines[sec]
    for (let i = 0; i < lines.length; i++) {
        const other = getNextSector(lines[i], sec)
        if (other === -1) continue
        if (L.sec_ceilingheight[other] > height)
            height = L.sec_ceilingheight[other]
    }
    return height
}

function P_FindSectorFromLineTag(line, start) {
    const tag = L.line_tag[line]
    for (let i = start + 1; i < L.numsectors; i++)
        if (L.sec_tag[i] === tag) return i
    return -1
}

function P_FindMinSurroundingLight(sector, max) {
    let min = max
    const lines = L.sec_lines[sector]
    for (let i = 0; i < lines.length; i++) {
        const check = getNextSector(lines[i], sector)
        if (check === -1) continue
        if (L.sec_lightlevel[check] < min) min = L.sec_lightlevel[check]
    }
    return min
}

// ---- animations (vanilla animdefs) ----

const animdefs = [
    [false, "NUKAGE3", "NUKAGE1", 8],
    [false, "FWATER4", "FWATER1", 8],
    [false, "SWATER4", "SWATER1", 8],
    [false, "LAVA4", "LAVA1", 8],
    [false, "BLOOD3", "BLOOD1", 8],
    [false, "RROCK08", "RROCK05", 8],
    [false, "SLIME04", "SLIME01", 8],
    [false, "SLIME08", "SLIME05", 8],
    [false, "SLIME12", "SLIME09", 8],
    [true, "BLODGR4", "BLODGR1", 8],
    [true, "SLADRIP3", "SLADRIP1", 8],
    [true, "BLODRIP4", "BLODRIP1", 8],
    [true, "FIREWALL", "FIREWALA", 8],
    [true, "GSTFONT3", "GSTFONT1", 8],
    [true, "FIRELAVA", "FIRELAV3", 8],
    [true, "FIREMAG3", "FIREMAG1", 8],
    [true, "FIREBLU2", "FIREBLU1", 8],
    [true, "ROCKRED3", "ROCKRED1", 8],
    [true, "BFALL4", "BFALL1", 8],
    [true, "SFALL4", "SFALL1", 8],
    [true, "WFALL4", "WFALL1", 8],
    [true, "DBRAIN4", "DBRAIN1", 8],
]

const anims = []        // { istexture, picnum, basepic, numpics, speed }

function P_InitPicAnims() {
    anims.length = 0
    for (const [istexture, endname, startname, speed] of animdefs) {
        let picnum, basepic
        if (istexture) {
            if (RD.R_CheckTextureNumForName(startname) === -1) continue
            picnum = RD.R_TextureNumForName(endname)
            basepic = RD.R_TextureNumForName(startname)
        } else {
            if (W.W_CheckNumForName(startname) === -1) continue
            picnum = RD.R_FlatNumForName(endname)
            basepic = RD.R_FlatNumForName(startname)
        }
        const numpics = picnum - basepic + 1
        if (numpics < 2)
            throw Error("P_InitPicAnims: bad cycle " + startname + ".." + endname)
        anims.push({ istexture, picnum, basepic, numpics, speed })
    }
}

// ---- switches & buttons (p_switch.c) ----

// [name1, name2, episode]
const alphSwitchList = [
    ["SW1BRCOM", "SW2BRCOM", 1], ["SW1BRN1", "SW2BRN1", 1],
    ["SW1BRN2", "SW2BRN2", 1], ["SW1BRNGN", "SW2BRNGN", 1],
    ["SW1BROWN", "SW2BROWN", 1], ["SW1COMM", "SW2COMM", 1],
    ["SW1COMP", "SW2COMP", 1], ["SW1DIRT", "SW2DIRT", 1],
    ["SW1EXIT", "SW2EXIT", 1], ["SW1GRAY", "SW2GRAY", 1],
    ["SW1GRAY1", "SW2GRAY1", 1], ["SW1METAL", "SW2METAL", 1],
    ["SW1PIPE", "SW2PIPE", 1], ["SW1SLAD", "SW2SLAD", 1],
    ["SW1STARG", "SW2STARG", 1], ["SW1STON1", "SW2STON1", 1],
    ["SW1STON2", "SW2STON2", 1], ["SW1STONE", "SW2STONE", 1],
    ["SW1STRTN", "SW2STRTN", 1],
    ["SW1BLUE", "SW2BLUE", 2], ["SW1CMT", "SW2CMT", 2],
    ["SW1GARG", "SW2GARG", 2], ["SW1GSTON", "SW2GSTON", 2],
    ["SW1HOT", "SW2HOT", 2], ["SW1LION", "SW2LION", 2],
    ["SW1SATYR", "SW2SATYR", 2], ["SW1SKIN", "SW2SKIN", 2],
    ["SW1VINE", "SW2VINE", 2], ["SW1WOOD", "SW2WOOD", 2],
    ["SW1PANEL", "SW2PANEL", 3], ["SW1ROCK", "SW2ROCK", 3],
    ["SW1MET2", "SW2MET2", 3], ["SW1WDMET", "SW2WDMET", 3],
    ["SW1BRIK", "SW2BRIK", 3], ["SW1MOD1", "SW2MOD1", 3],
    ["SW1ZIM", "SW2ZIM", 3], ["SW1STON6", "SW2STON6", 3],
    ["SW1TEK", "SW2TEK", 3], ["SW1MARB", "SW2MARB", 3],
    ["SW1SKULL", "SW2SKULL", 3],
]

let switchlist = []
let numswitches = 0

function P_InitSwitchList() {
    // vanilla p_switch.c: shareware sees only episode-1 switches; registered
    // and retail see episode-2; commercial (Doom 2) sees episode-3. Picking
    // the wrong tier makes R_TextureNumForName throw on a missing switch
    // texture (e.g. SW1BLUE is registered-only, absent from the shareware WAD).
    let episode = 1
    if (G.state.gamemode === DD.GameMode.registered ||
        G.state.gamemode === DD.GameMode.retail) episode = 2
    else if (G.state.gamemode === DD.GameMode.commercial) episode = 3

    switchlist = []
    for (const [name1, name2, ep] of alphSwitchList) {
        if (ep <= episode) {
            switchlist.push(RD.R_TextureNumForName(name1))
            switchlist.push(RD.R_TextureNumForName(name2))
        }
    }
    numswitches = switchlist.length / 2
}

// bwhere_e
const BW_TOP = 0, BW_MIDDLE = 1, BW_BOTTOM = 2

function makeButton() {
    return { line: -1, where: 0, btexture: 0, btimer: 0, soundorg: null }
}
const buttonlist = []
for (let i = 0; i < MAXBUTTONS; i++) buttonlist.push(makeButton())

function lineSoundOrg(line) {
    const sec = L.line_frontsector[line]
    return { x: L.sec_soundorgx[sec], y: L.sec_soundorgy[sec], z: 0 }
}

function P_StartButton(line, w, texture, time) {
    // already pressed?
    for (let i = 0; i < MAXBUTTONS; i++)
        if (buttonlist[i].btimer && buttonlist[i].line === line) return

    for (let i = 0; i < MAXBUTTONS; i++) {
        if (!buttonlist[i].btimer) {
            buttonlist[i].line = line
            buttonlist[i].where = w
            buttonlist[i].btexture = texture
            buttonlist[i].btimer = time
            buttonlist[i].soundorg = lineSoundOrg(line)
            return
        }
    }
    throw Error("P_StartButton: no button slots left!")
}

function P_ChangeSwitchTexture(line, useAgain) {
    if (!useAgain) L.line_special[line] = 0

    const side0 = L.line_sidenum0[line]
    const texTop = L.side_toptexture[side0]
    const texMid = L.side_midtexture[side0]
    const texBot = L.side_bottomtexture[side0]

    let sound = SFX.sfx_swtchn
    if (L.line_special[line] === 11) sound = SFX.sfx_swtchx  // exit switch

    for (let i = 0; i < numswitches * 2; i++) {
        if (switchlist[i] === texTop) {
            S.StartSound(buttonlist[0].soundorg, sound)
            L.side_toptexture[side0] = switchlist[i ^ 1]
            if (useAgain) P_StartButton(line, BW_TOP, switchlist[i], BUTTONTIME)
            return
        }
        if (switchlist[i] === texMid) {
            S.StartSound(buttonlist[0].soundorg, sound)
            L.side_midtexture[side0] = switchlist[i ^ 1]
            if (useAgain) P_StartButton(line, BW_MIDDLE, switchlist[i], BUTTONTIME)
            return
        }
        if (switchlist[i] === texBot) {
            S.StartSound(buttonlist[0].soundorg, sound)
            L.side_bottomtexture[side0] = switchlist[i ^ 1]
            if (useAgain) P_StartButton(line, BW_BOTTOM, switchlist[i], BUTTONTIME)
            return
        }
    }
}

// ---- lights (p_lights.c) ----

function T_FireFlicker(flick) {
    if (--flick.count) return
    const amount = (P_Random() & 3) * 16
    if (L.sec_lightlevel[flick.sector] - amount < flick.minlight)
        L.sec_lightlevel[flick.sector] = flick.minlight
    else
        L.sec_lightlevel[flick.sector] = flick.maxlight - amount
    flick.count = 4
}

function P_SpawnFireFlicker(sector) {
    L.sec_special[sector] = 0
    const flick = {
        prev: null, next: null, tfunc: T_FireFlicker,
        sector: sector,
        maxlight: L.sec_lightlevel[sector],
        minlight: P_FindMinSurroundingLight(sector, L.sec_lightlevel[sector]) + 16,
        count: 4,
    }
    PT.P_AddThinker(flick)
}

function T_LightFlash(flash) {
    if (--flash.count) return
    if (L.sec_lightlevel[flash.sector] === flash.maxlight) {
        L.sec_lightlevel[flash.sector] = flash.minlight
        flash.count = (P_Random() & flash.mintime) + 1
    } else {
        L.sec_lightlevel[flash.sector] = flash.maxlight
        flash.count = (P_Random() & flash.maxtime) + 1
    }
}

function P_SpawnLightFlash(sector) {
    L.sec_special[sector] = 0
    const flash = {
        prev: null, next: null, tfunc: T_LightFlash,
        sector: sector,
        maxlight: L.sec_lightlevel[sector],
        minlight: P_FindMinSurroundingLight(sector, L.sec_lightlevel[sector]),
        maxtime: 64, mintime: 7, count: 0,
    }
    flash.count = (P_Random() & flash.maxtime) + 1
    PT.P_AddThinker(flash)
}

function T_StrobeFlash(flash) {
    if (--flash.count) return
    if (L.sec_lightlevel[flash.sector] === flash.minlight) {
        L.sec_lightlevel[flash.sector] = flash.maxlight
        flash.count = flash.brighttime
    } else {
        L.sec_lightlevel[flash.sector] = flash.minlight
        flash.count = flash.darktime
    }
}

function P_SpawnStrobeFlash(sector, fastOrSlow, inSync) {
    const flash = {
        prev: null, next: null, tfunc: T_StrobeFlash,
        sector: sector,
        darktime: fastOrSlow, brighttime: STROBEBRIGHT,
        maxlight: L.sec_lightlevel[sector],
        minlight: P_FindMinSurroundingLight(sector, L.sec_lightlevel[sector]),
        count: 0,
    }
    if (flash.minlight === flash.maxlight) flash.minlight = 0
    L.sec_special[sector] = 0
    flash.count = inSync ? 1 : (P_Random() & 7) + 1
    PT.P_AddThinker(flash)
}

function EV_StartLightStrobing(line) {
    let secnum = -1
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
        if (L.sec_specialdata[secnum]) continue
        P_SpawnStrobeFlash(secnum, SLOWDARK, 0)
    }
}

function EV_TurnTagLightsOff(line) {
    const tag = L.line_tag[line]
    for (let j = 0; j < L.numsectors; j++) {
        if (L.sec_tag[j] !== tag) continue
        let min = L.sec_lightlevel[j]
        const lines = L.sec_lines[j]
        for (let i = 0; i < lines.length; i++) {
            const tsec = getNextSector(lines[i], j)
            if (tsec === -1) continue
            if (L.sec_lightlevel[tsec] < min) min = L.sec_lightlevel[tsec]
        }
        L.sec_lightlevel[j] = min
    }
}

function EV_LightTurnOn(line, bright) {
    const tag = L.line_tag[line]
    for (let i = 0; i < L.numsectors; i++) {
        if (L.sec_tag[i] !== tag) continue
        let b = bright
        // bright = 0: search for highest surrounding light level
        if (!b) {
            const lines = L.sec_lines[i]
            for (let j = 0; j < lines.length; j++) {
                const temp = getNextSector(lines[j], i)
                if (temp === -1) continue
                if (L.sec_lightlevel[temp] > b) b = L.sec_lightlevel[temp]
            }
        }
        L.sec_lightlevel[i] = b
    }
}

function T_Glow(g) {
    switch (g.direction) {
        case -1:
            L.sec_lightlevel[g.sector] -= GLOWSPEED
            if (L.sec_lightlevel[g.sector] <= g.minlight) {
                L.sec_lightlevel[g.sector] += GLOWSPEED
                g.direction = 1
            }
            break
        case 1:
            L.sec_lightlevel[g.sector] += GLOWSPEED
            if (L.sec_lightlevel[g.sector] >= g.maxlight) {
                L.sec_lightlevel[g.sector] -= GLOWSPEED
                g.direction = -1
            }
            break
    }
}

function P_SpawnGlowingLight(sector) {
    const g = {
        prev: null, next: null, tfunc: T_Glow,
        sector: sector,
        minlight: P_FindMinSurroundingLight(sector, L.sec_lightlevel[sector]),
        maxlight: L.sec_lightlevel[sector],
        direction: -1,
    }
    PT.P_AddThinker(g)
    L.sec_special[sector] = 0
}

// ---- teleport (p_telept.c) ----

function EV_Teleport(line, side, thing) {
    if (thing.flags & I.MF.MF_MISSILE) return 0
    if (side === 1) return 0       // hit back of line: can exit teleporter

    const tag = L.line_tag[line]
    for (let i = 0; i < L.numsectors; i++) {
        if (L.sec_tag[i] !== tag) continue
        for (let thinker = PT.thinkercap.next; thinker !== PT.thinkercap;
            thinker = thinker.next) {
            if (thinker.tfunc !== PM.P_MobjThinker) continue
            const m = thinker
            if (m.type !== I.MT.MT_TELEPORTMAN) continue
            if (L.ssec_sector[m.subsector] !== i) continue

            const oldx = thing.x, oldy = thing.y, oldz = thing.z

            if (!PMap.P_TeleportMove(thing, m.x, m.y)) return 0

            thing.z = thing.floorz
            if (thing.player)
                thing.player.viewz = (thing.z + thing.player.viewheight) | 0

            // teleport fog at source and destination
            let fog = PM.P_SpawnMobj(oldx, oldy, oldz, I.MT.MT_TFOG)
            S.StartSound(fog, SFX.sfx_telept)
            const an = (m.angle >>> 19) & 8191
            fog = PM.P_SpawnMobj((m.x + 20 * T.finecosine[an]) | 0,
                (m.y + 20 * T.finesine[an]) | 0, thing.z, I.MT.MT_TFOG)
            S.StartSound(fog, SFX.sfx_telept)

            if (thing.player) thing.reactiontime = 18  // don't move for a bit
            thing.angle = m.angle
            thing.momx = thing.momy = thing.momz = 0
            return 1
        }
    }
    return 0
}

// ---- event dispatch ----

function P_CrossSpecialLine(linenum, side, thing) {
    const line = linenum
    const MT = I.MT
    const DOOR = PMov.DOOR, F = PMov.F, PLAT = PMov.PLAT
    const CEIL = PMov.CEIL, STAIR = PMov.STAIR

    // triggers that other things can activate
    if (!thing.player) {
        switch (thing.type) {
            case MT.MT_ROCKET:
            case MT.MT_PLASMA:
            case MT.MT_BFG:
            case MT.MT_TROOPSHOT:
            case MT.MT_HEADSHOT:
            case MT.MT_BRUISERSHOT:
                return
        }
        let ok = 0
        switch (L.line_special[line]) {
            case 39: case 97: case 125: case 126:
            case 4: case 10: case 88:
                ok = 1
                break
        }
        if (!ok) return
    }

    switch (L.line_special[line]) {
        // TRIGGERS (one-shot)
        case 2: PMov.EV_DoDoor(line, DOOR.open); L.line_special[line] = 0; break
        case 3: PMov.EV_DoDoor(line, DOOR.close); L.line_special[line] = 0; break
        case 4: PMov.EV_DoDoor(line, DOOR.normal); L.line_special[line] = 0; break
        case 5: PMov.EV_DoFloor(line, F.raiseFloor); L.line_special[line] = 0; break
        case 6: PMov.EV_DoCeiling(line, CEIL.fastCrushAndRaise); L.line_special[line] = 0; break
        case 8: PMov.EV_BuildStairs(line, STAIR.build8); L.line_special[line] = 0; break
        case 10: PMov.EV_DoPlat(line, PLAT.downWaitUpStay, 0); L.line_special[line] = 0; break
        case 12: EV_LightTurnOn(line, 0); L.line_special[line] = 0; break
        case 13: EV_LightTurnOn(line, 255); L.line_special[line] = 0; break
        case 16: PMov.EV_DoDoor(line, DOOR.close30ThenOpen); L.line_special[line] = 0; break
        case 17: EV_StartLightStrobing(line); L.line_special[line] = 0; break
        case 19: PMov.EV_DoFloor(line, F.lowerFloor); L.line_special[line] = 0; break
        case 22: PMov.EV_DoPlat(line, PLAT.raiseToNearestAndChange, 0); L.line_special[line] = 0; break
        case 25: PMov.EV_DoCeiling(line, CEIL.crushAndRaise); L.line_special[line] = 0; break
        case 30: PMov.EV_DoFloor(line, F.raiseToTexture); L.line_special[line] = 0; break
        case 35: EV_LightTurnOn(line, 35); L.line_special[line] = 0; break
        case 36: PMov.EV_DoFloor(line, F.turboLower); L.line_special[line] = 0; break
        case 37: PMov.EV_DoFloor(line, F.lowerAndChange); L.line_special[line] = 0; break
        case 38: PMov.EV_DoFloor(line, F.lowerFloorToLowest); L.line_special[line] = 0; break
        case 39: EV_Teleport(line, side, thing); L.line_special[line] = 0; break
        case 40:
            PMov.EV_DoCeiling(line, CEIL.raiseToHighest)
            PMov.EV_DoFloor(line, F.lowerFloorToLowest)
            L.line_special[line] = 0
            break
        case 44: PMov.EV_DoCeiling(line, CEIL.lowerAndCrush); L.line_special[line] = 0; break
        case 52: G.G_ExitLevel(); break
        case 53: PMov.EV_DoPlat(line, PLAT.perpetualRaise, 0); L.line_special[line] = 0; break
        case 54: PMov.EV_StopPlat(line); L.line_special[line] = 0; break
        case 56: PMov.EV_DoFloor(line, F.raiseFloorCrush); L.line_special[line] = 0; break
        case 57: PMov.EV_CeilingCrushStop(line); L.line_special[line] = 0; break
        case 58: PMov.EV_DoFloor(line, F.raiseFloor24); L.line_special[line] = 0; break
        case 59: PMov.EV_DoFloor(line, F.raiseFloor24AndChange); L.line_special[line] = 0; break
        case 104: EV_TurnTagLightsOff(line); L.line_special[line] = 0; break
        case 108: PMov.EV_DoDoor(line, DOOR.blazeRaise); L.line_special[line] = 0; break
        case 109: PMov.EV_DoDoor(line, DOOR.blazeOpen); L.line_special[line] = 0; break
        case 100: PMov.EV_BuildStairs(line, STAIR.turbo16); L.line_special[line] = 0; break
        case 110: PMov.EV_DoDoor(line, DOOR.blazeClose); L.line_special[line] = 0; break
        case 119: PMov.EV_DoFloor(line, F.raiseFloorToNearest); L.line_special[line] = 0; break
        case 121: PMov.EV_DoPlat(line, PLAT.blazeDWUS, 0); L.line_special[line] = 0; break
        case 124: G.G_SecretExitLevel(); break
        case 125:
            if (!thing.player) {
                EV_Teleport(line, side, thing)
                L.line_special[line] = 0
            }
            break
        case 130: PMov.EV_DoFloor(line, F.raiseFloorTurbo); L.line_special[line] = 0; break
        case 141: PMov.EV_DoCeiling(line, CEIL.silentCrushAndRaise); L.line_special[line] = 0; break

        // RETRIGGERS
        case 72: PMov.EV_DoCeiling(line, CEIL.lowerAndCrush); break
        case 73: PMov.EV_DoCeiling(line, CEIL.crushAndRaise); break
        case 74: PMov.EV_CeilingCrushStop(line); break
        case 75: PMov.EV_DoDoor(line, DOOR.close); break
        case 76: PMov.EV_DoDoor(line, DOOR.close30ThenOpen); break
        case 77: PMov.EV_DoCeiling(line, CEIL.fastCrushAndRaise); break
        case 79: EV_LightTurnOn(line, 35); break
        case 80: EV_LightTurnOn(line, 0); break
        case 81: EV_LightTurnOn(line, 255); break
        case 82: PMov.EV_DoFloor(line, F.lowerFloorToLowest); break
        case 83: PMov.EV_DoFloor(line, F.lowerFloor); break
        case 84: PMov.EV_DoFloor(line, F.lowerAndChange); break
        case 86: PMov.EV_DoDoor(line, DOOR.open); break
        case 87: PMov.EV_DoPlat(line, PLAT.perpetualRaise, 0); break
        case 88: PMov.EV_DoPlat(line, PLAT.downWaitUpStay, 0); break
        case 89: PMov.EV_StopPlat(line); break
        case 90: PMov.EV_DoDoor(line, DOOR.normal); break
        case 91: PMov.EV_DoFloor(line, F.raiseFloor); break
        case 92: PMov.EV_DoFloor(line, F.raiseFloor24); break
        case 93: PMov.EV_DoFloor(line, F.raiseFloor24AndChange); break
        case 94: PMov.EV_DoFloor(line, F.raiseFloorCrush); break
        case 95: PMov.EV_DoPlat(line, PLAT.raiseToNearestAndChange, 0); break
        case 96: PMov.EV_DoFloor(line, F.raiseToTexture); break
        case 97: EV_Teleport(line, side, thing); break
        case 98: PMov.EV_DoFloor(line, F.turboLower); break
        case 105: PMov.EV_DoDoor(line, DOOR.blazeRaise); break
        case 106: PMov.EV_DoDoor(line, DOOR.blazeOpen); break
        case 107: PMov.EV_DoDoor(line, DOOR.blazeClose); break
        case 120: PMov.EV_DoPlat(line, PLAT.blazeDWUS, 0); break
        case 126:
            if (!thing.player) EV_Teleport(line, side, thing)
            break
        case 128: PMov.EV_DoFloor(line, F.raiseFloorToNearest); break
        case 129: PMov.EV_DoFloor(line, F.raiseFloorTurbo); break
    }
}

function P_ShootSpecialLine(thing, line) {
    const DOOR = PMov.DOOR, F = PMov.F, PLAT = PMov.PLAT

    // impacts that other things can activate
    if (!thing.player) {
        let ok = 0
        if (L.line_special[line] === 46) ok = 1
        if (!ok) return
    }

    switch (L.line_special[line]) {
        case 24:
            PMov.EV_DoFloor(line, F.raiseFloor)
            P_ChangeSwitchTexture(line, 0)
            break
        case 46:
            PMov.EV_DoDoor(line, DOOR.open)
            P_ChangeSwitchTexture(line, 1)
            break
        case 47:
            PMov.EV_DoPlat(line, PLAT.raiseToNearestAndChange, 0)
            P_ChangeSwitchTexture(line, 0)
            break
    }
}

function P_UseSpecialLine(thing, line, side) {
    const DOOR = PMov.DOOR, F = PMov.F, PLAT = PMov.PLAT
    const CEIL = PMov.CEIL, STAIR = PMov.STAIR

    // back sides only work for very special lines
    if (side) {
        switch (L.line_special[line]) {
            case 124: break             // sliding door (unused)
            default: return false
        }
    }

    // switches that other things can activate
    if (!thing.player) {
        if (L.line_flags[line] & DD.ML.SECRET) return false  // never secret doors
        switch (L.line_special[line]) {
            case 1: case 32: case 33: case 34:
                break
            default: return false
        }
    }

    switch (L.line_special[line]) {
        // MANUALS
        case 1: case 26: case 27: case 28:
        case 31: case 32: case 33: case 34:
        case 117: case 118:
            PMov.EV_VerticalDoor(line, thing)
            break

        // SWITCHES (one-shot)
        case 7:
            if (PMov.EV_BuildStairs(line, STAIR.build8)) P_ChangeSwitchTexture(line, 0)
            break
        case 9:
            if (EV_DoDonut(line)) P_ChangeSwitchTexture(line, 0)
            break
        case 11:
            P_ChangeSwitchTexture(line, 0)
            G.G_ExitLevel()
            break
        case 14:
            if (PMov.EV_DoPlat(line, PLAT.raiseAndChange, 32)) P_ChangeSwitchTexture(line, 0)
            break
        case 15:
            if (PMov.EV_DoPlat(line, PLAT.raiseAndChange, 24)) P_ChangeSwitchTexture(line, 0)
            break
        case 18:
            if (PMov.EV_DoFloor(line, F.raiseFloorToNearest)) P_ChangeSwitchTexture(line, 0)
            break
        case 20:
            if (PMov.EV_DoPlat(line, PLAT.raiseToNearestAndChange, 0)) P_ChangeSwitchTexture(line, 0)
            break
        case 21:
            if (PMov.EV_DoPlat(line, PLAT.downWaitUpStay, 0)) P_ChangeSwitchTexture(line, 0)
            break
        case 23:
            if (PMov.EV_DoFloor(line, F.lowerFloorToLowest)) P_ChangeSwitchTexture(line, 0)
            break
        case 29:
            if (PMov.EV_DoDoor(line, DOOR.normal)) P_ChangeSwitchTexture(line, 0)
            break
        case 41:
            if (PMov.EV_DoCeiling(line, CEIL.lowerToFloor)) P_ChangeSwitchTexture(line, 0)
            break
        case 71:
            if (PMov.EV_DoFloor(line, F.turboLower)) P_ChangeSwitchTexture(line, 0)
            break
        case 49:
            if (PMov.EV_DoCeiling(line, CEIL.crushAndRaise)) P_ChangeSwitchTexture(line, 0)
            break
        case 50:
            if (PMov.EV_DoDoor(line, DOOR.close)) P_ChangeSwitchTexture(line, 0)
            break
        case 51:
            P_ChangeSwitchTexture(line, 0)
            G.G_SecretExitLevel()
            break
        case 55:
            if (PMov.EV_DoFloor(line, F.raiseFloorCrush)) P_ChangeSwitchTexture(line, 0)
            break
        case 101:
            if (PMov.EV_DoFloor(line, F.raiseFloor)) P_ChangeSwitchTexture(line, 0)
            break
        case 102:
            if (PMov.EV_DoFloor(line, F.lowerFloor)) P_ChangeSwitchTexture(line, 0)
            break
        case 103:
            if (PMov.EV_DoDoor(line, DOOR.open)) P_ChangeSwitchTexture(line, 0)
            break
        case 111:
            if (PMov.EV_DoDoor(line, DOOR.blazeRaise)) P_ChangeSwitchTexture(line, 0)
            break
        case 112:
            if (PMov.EV_DoDoor(line, DOOR.blazeOpen)) P_ChangeSwitchTexture(line, 0)
            break
        case 113:
            if (PMov.EV_DoDoor(line, DOOR.blazeClose)) P_ChangeSwitchTexture(line, 0)
            break
        case 122:
            if (PMov.EV_DoPlat(line, PLAT.blazeDWUS, 0)) P_ChangeSwitchTexture(line, 0)
            break
        case 127:
            if (PMov.EV_BuildStairs(line, STAIR.turbo16)) P_ChangeSwitchTexture(line, 0)
            break
        case 131:
            if (PMov.EV_DoFloor(line, F.raiseFloorTurbo)) P_ChangeSwitchTexture(line, 0)
            break
        case 133: case 135: case 137:
            if (PMov.EV_DoLockedDoor(line, DOOR.blazeOpen, thing))
                P_ChangeSwitchTexture(line, 0)
            break
        case 140:
            if (PMov.EV_DoFloor(line, F.raiseFloor512)) P_ChangeSwitchTexture(line, 0)
            break

        // BUTTONS (reusable)
        case 42:
            if (PMov.EV_DoDoor(line, DOOR.close)) P_ChangeSwitchTexture(line, 1)
            break
        case 43:
            if (PMov.EV_DoCeiling(line, CEIL.lowerToFloor)) P_ChangeSwitchTexture(line, 1)
            break
        case 45:
            if (PMov.EV_DoFloor(line, F.lowerFloor)) P_ChangeSwitchTexture(line, 1)
            break
        case 60:
            if (PMov.EV_DoFloor(line, F.lowerFloorToLowest)) P_ChangeSwitchTexture(line, 1)
            break
        case 61:
            if (PMov.EV_DoDoor(line, DOOR.open)) P_ChangeSwitchTexture(line, 1)
            break
        case 62:
            if (PMov.EV_DoPlat(line, PLAT.downWaitUpStay, 1)) P_ChangeSwitchTexture(line, 1)
            break
        case 63:
            if (PMov.EV_DoDoor(line, DOOR.normal)) P_ChangeSwitchTexture(line, 1)
            break
        case 64:
            if (PMov.EV_DoFloor(line, F.raiseFloor)) P_ChangeSwitchTexture(line, 1)
            break
        case 66:
            if (PMov.EV_DoPlat(line, PLAT.raiseAndChange, 24)) P_ChangeSwitchTexture(line, 1)
            break
        case 67:
            if (PMov.EV_DoPlat(line, PLAT.raiseAndChange, 32)) P_ChangeSwitchTexture(line, 1)
            break
        case 65:
            if (PMov.EV_DoFloor(line, F.raiseFloorCrush)) P_ChangeSwitchTexture(line, 1)
            break
        case 68:
            if (PMov.EV_DoPlat(line, PLAT.raiseToNearestAndChange, 0)) P_ChangeSwitchTexture(line, 1)
            break
        case 69:
            if (PMov.EV_DoFloor(line, F.raiseFloorToNearest)) P_ChangeSwitchTexture(line, 1)
            break
        case 70:
            if (PMov.EV_DoFloor(line, F.turboLower)) P_ChangeSwitchTexture(line, 1)
            break
        case 114:
            if (PMov.EV_DoDoor(line, DOOR.blazeRaise)) P_ChangeSwitchTexture(line, 1)
            break
        case 115:
            if (PMov.EV_DoDoor(line, DOOR.blazeOpen)) P_ChangeSwitchTexture(line, 1)
            break
        case 116:
            if (PMov.EV_DoDoor(line, DOOR.blazeClose)) P_ChangeSwitchTexture(line, 1)
            break
        case 123:
            if (PMov.EV_DoPlat(line, PLAT.blazeDWUS, 0)) P_ChangeSwitchTexture(line, 1)
            break
        case 132:
            if (PMov.EV_DoFloor(line, F.raiseFloorTurbo)) P_ChangeSwitchTexture(line, 1)
            break
        case 99: case 134: case 136:
            if (PMov.EV_DoLockedDoor(line, DOOR.blazeOpen, thing))
                P_ChangeSwitchTexture(line, 1)
            break
        case 138:
            EV_LightTurnOn(line, 255)
            P_ChangeSwitchTexture(line, 1)
            break
        case 139:
            EV_LightTurnOn(line, 35)
            P_ChangeSwitchTexture(line, 1)
            break
    }
    return true
}

// ---- sector specials per tic ----

function P_PlayerInSpecialSector(player) {
    const sector = L.ssec_sector[player.mo.subsector]

    // falling, not all the way down yet?
    if (player.mo.z !== L.sec_floorheight[sector]) return

    const pw = DD.Power
    switch (L.sec_special[sector]) {
        case 5:
            // hellslime damage
            if (!player.powers[pw.ironfeet])
                if (!(G.state.leveltime & 0x1f))
                    PInter.P_DamageMobj(player.mo, null, null, 10)
            break
        case 7:
            // nukage damage
            if (!player.powers[pw.ironfeet])
                if (!(G.state.leveltime & 0x1f))
                    PInter.P_DamageMobj(player.mo, null, null, 5)
            break
        case 16:    // super hellslime
        case 4:     // strobe hurt
            if (!player.powers[pw.ironfeet] || P_Random() < 5) {
                if (!(G.state.leveltime & 0x1f))
                    PInter.P_DamageMobj(player.mo, null, null, 20)
            }
            break
        case 9:
            // secret sector
            player.secretcount++
            L.sec_special[sector] = 0
            break
        case 11:
            // exit super damage (E1M8 finale)
            player.cheats &= ~DD.CF.GODMODE
            if (!(G.state.leveltime & 0x1f))
                PInter.P_DamageMobj(player.mo, null, null, 20)
            if (player.health <= 10) G.G_ExitLevel()
            break
        default:
            throw Error("P_PlayerInSpecialSector: unknown special " +
                L.sec_special[sector])
    }
}

// ---- per-tic updates ----

let levelTimer = false
let levelTimeCount = 0

let numlinespecials = 0
const linespeciallist = new Int32Array(MAXLINEANIMS)

function P_UpdateSpecials() {
    // level timer
    if (levelTimer) {
        levelTimeCount--
        if (!levelTimeCount) G.G_ExitLevel()
    }

    // animate flats and textures globally
    const texturetranslation = RD.getTexturetranslation()
    const flattranslation = RD.getFlattranslation()
    for (const anim of anims) {
        for (let i = anim.basepic; i < anim.basepic + anim.numpics; i++) {
            const pic = anim.basepic +
                ((((G.state.leveltime / anim.speed) | 0) + i) % anim.numpics)
            if (anim.istexture) texturetranslation[i] = pic
            else flattranslation[i] = pic
        }
    }

    // animate line specials
    for (let i = 0; i < numlinespecials; i++) {
        const line = linespeciallist[i]
        if (L.line_special[line] === 48) {
            // effect firstcol scroll
            const s = L.line_sidenum0[line]
            L.side_textureoffset[s] = (L.side_textureoffset[s] + FRACUNIT) | 0
        }
    }

    // buttons
    for (let i = 0; i < MAXBUTTONS; i++) {
        const b = buttonlist[i]
        if (b.btimer) {
            b.btimer--
            if (!b.btimer) {
                const side0 = L.line_sidenum0[b.line]
                switch (b.where) {
                    case BW_TOP: L.side_toptexture[side0] = b.btexture; break
                    case BW_MIDDLE: L.side_midtexture[side0] = b.btexture; break
                    case BW_BOTTOM: L.side_bottomtexture[side0] = b.btexture; break
                }
                S.StartSound(b.soundorg, SFX.sfx_swtchn)
                b.line = -1; b.where = 0; b.btexture = 0
                b.btimer = 0; b.soundorg = null
            }
        }
    }
}

// ---- donut ----

function EV_DoDonut(line) {
    let secnum = -1
    let rtn = 0
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
        const s1 = secnum
        if (L.sec_specialdata[s1]) continue

        rtn = 1
        const s2 = getNextSector(L.sec_lines[s1][0], s1)
        const s2lines = L.sec_lines[s2]
        for (let i = 0; i < s2lines.length; i++) {
            // vanilla precedence bug: (!flags & ML_TWOSIDED) is always 0,
            // so only the backsector test guards this loop
            if (L.line_backsector[s2lines[i]] === s1) continue
            const s3 = L.line_backsector[s2lines[i]]

            // rising slime
            const floor1 = {
                prev: null, next: null, tfunc: PMov.T_MoveFloor,
                type: PMov.F.donutRaise, crush: false, sector: s2,
                direction: 1, newspecial: 0,
                texture: L.sec_floorpic[s3],
                floordestheight: L.sec_floorheight[s3],
                speed: FRACUNIT / 2,
            }
            PT.P_AddThinker(floor1)
            L.sec_specialdata[s2] = floor1

            // lowering donut hole
            const floor2 = {
                prev: null, next: null, tfunc: PMov.T_MoveFloor,
                type: PMov.F.lowerFloor, crush: false, sector: s1,
                direction: -1, newspecial: 0, texture: 0,
                floordestheight: L.sec_floorheight[s3],
                speed: FRACUNIT / 2,
            }
            PT.P_AddThinker(floor2)
            L.sec_specialdata[s1] = floor2
            break
        }
    }
    return rtn
}

// ---- special spawning ----

function P_SpawnSpecials() {
    levelTimer = false
    // (vanilla -avg/-timer deathmatch timers omitted: no netgame)

    // special sectors
    for (let i = 0; i < L.numsectors; i++) {
        if (!L.sec_special[i]) continue
        switch (L.sec_special[i]) {
            case 1: P_SpawnLightFlash(i); break
            case 2: P_SpawnStrobeFlash(i, FASTDARK, 0); break
            case 3: P_SpawnStrobeFlash(i, SLOWDARK, 0); break
            case 4:
                P_SpawnStrobeFlash(i, FASTDARK, 0)
                L.sec_special[i] = 4
                break
            case 8: P_SpawnGlowingLight(i); break
            case 9: G.state.totalsecret++; break
            case 10: PMov.P_SpawnDoorCloseIn30(i); break
            case 12: P_SpawnStrobeFlash(i, SLOWDARK, 1); break
            case 13: P_SpawnStrobeFlash(i, FASTDARK, 1); break
            case 14: PMov.P_SpawnDoorRaiseIn5Mins(i); break
            case 17: P_SpawnFireFlicker(i); break
        }
    }

    // line effects
    numlinespecials = 0
    for (let i = 0; i < L.numlines; i++) {
        if (L.line_special[i] === 48) {
            linespeciallist[numlinespecials] = i
            numlinespecials++
        }
    }

    // misc
    PMov.P_ClearCeilings()
    PMov.P_ClearPlats()
    for (let i = 0; i < MAXBUTTONS; i++) {
        buttonlist[i].line = -1; buttonlist[i].where = 0
        buttonlist[i].btexture = 0; buttonlist[i].btimer = 0
        buttonlist[i].soundorg = null
    }
}

let PInter = null
let SFX = null

exports = {
    getSide, getSector, twoSided, getNextSector,
    P_FindLowestFloorSurrounding, P_FindHighestFloorSurrounding,
    P_FindNextHighestFloor, P_FindLowestCeilingSurrounding,
    P_FindHighestCeilingSurrounding, P_FindSectorFromLineTag,
    P_FindMinSurroundingLight,
    P_InitPicAnims, P_InitSwitchList, P_ChangeSwitchTexture,
    P_CrossSpecialLine, P_ShootSpecialLine, P_UseSpecialLine,
    P_PlayerInSpecialSector, P_UpdateSpecials, P_SpawnSpecials,
    EV_DoDonut, EV_Teleport,
    EV_StartLightStrobing, EV_TurnTagLightsOff, EV_LightTurnOn,
    P_SpawnFireFlicker, P_SpawnLightFlash, P_SpawnStrobeFlash,
    P_SpawnGlowingLight,
    // light thinker tfuncs for savegame reconstruction
    getTLightFlash: () => T_LightFlash,
    getTStrobeFlash: () => T_StrobeFlash,
    getTGlow: () => T_Glow,
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PT = D.p_tick; PM = D.p_mobj; PMap = D.p_map
        PMov = D.p_movers; RD = D.r_data; W = D.w_wad
        L = D.p_setup.level; PInter = D.p_inter
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
    },
}
