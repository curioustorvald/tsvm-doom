// p_movers.mjs -- moving sector machinery: T_MovePlane + floors/stairs
// (p_floor.c), doors (p_doors.c), platforms (p_plats.c), ceilings (p_ceilng.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Mover thinkers are JS objects with embedded prev/next/tfunc; stasis sets
// tfunc = null (thinker stays linked, does nothing) exactly like vanilla
// nulling function.acv. sector.specialdata holds the mover object.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, R = null, I = null, G = null, PT = null
let PMap = null, PS = null, L = null, S = null, RD = null

const FRACUNIT = 65536
const FLOORSPEED = FRACUNIT
const VDOORSPEED = FRACUNIT * 2
const VDOORWAIT = 150
const PLATSPEED = FRACUNIT
const PLATWAIT = 3
const CEILSPEED = FRACUNIT
const MAXPLATS = 30
const MAXCEILINGS = 30
const MAXINT = 0x7fffffff

// result_e
const RES_OK = 0, RES_CRUSHED = 1, RES_PASTDEST = 2

// floor_e
const F = {
    lowerFloor: 0, lowerFloorToLowest: 1, turboLower: 2, raiseFloor: 3,
    raiseFloorToNearest: 4, raiseToTexture: 5, lowerAndChange: 6,
    raiseFloor24: 7, raiseFloor24AndChange: 8, raiseFloorCrush: 9,
    raiseFloorTurbo: 10, donutRaise: 11, raiseFloor512: 12,
}
// stair_e
const STAIR = { build8: 0, turbo16: 1 }
// vldoor_e
const DOOR = {
    normal: 0, close30ThenOpen: 1, close: 2, open: 3,
    raiseIn5Mins: 4, blazeRaise: 5, blazeOpen: 6, blazeClose: 7,
}
// plattype_e / plat_e status
const PLAT = {
    perpetualRaise: 0, downWaitUpStay: 1, raiseAndChange: 2,
    raiseToNearestAndChange: 3, blazeDWUS: 4,
}
const PSTAT = { up: 0, down: 1, waiting: 2, in_stasis: 3 }
// ceiling_e
const CEIL = {
    lowerToFloor: 0, raiseToHighest: 1, lowerAndCrush: 2,
    crushAndRaise: 3, fastCrushAndRaise: 4, silentCrushAndRaise: 5,
}

function soundOrg(sector) {
    // a pseudo-mobj for positional sound at the sector's centre
    return { x: L.sec_soundorgx[sector], y: L.sec_soundorgy[sector], z: 0,
        __sector: sector }
}

// ---- T_MovePlane (p_floor.c) ----

function T_MovePlane(sector, speed, dest, crush, floorOrCeiling, direction) {
    let flag, lastpos
    if (floorOrCeiling === 0) {
        // FLOOR
        if (direction === -1) {
            if (L.sec_floorheight[sector] - speed < dest) {
                lastpos = L.sec_floorheight[sector]
                L.sec_floorheight[sector] = dest
                flag = PMap.P_ChangeSector(sector, crush)
                if (flag) {
                    L.sec_floorheight[sector] = lastpos
                    PMap.P_ChangeSector(sector, crush)
                }
                return RES_PASTDEST
            }
            lastpos = L.sec_floorheight[sector]
            L.sec_floorheight[sector] = (L.sec_floorheight[sector] - speed) | 0
            flag = PMap.P_ChangeSector(sector, crush)
            if (flag) {
                L.sec_floorheight[sector] = lastpos
                PMap.P_ChangeSector(sector, crush)
                return RES_CRUSHED
            }
        } else if (direction === 1) {
            if (L.sec_floorheight[sector] + speed > dest) {
                lastpos = L.sec_floorheight[sector]
                L.sec_floorheight[sector] = dest
                flag = PMap.P_ChangeSector(sector, crush)
                if (flag) {
                    L.sec_floorheight[sector] = lastpos
                    PMap.P_ChangeSector(sector, crush)
                }
                return RES_PASTDEST
            }
            // could get crushed
            lastpos = L.sec_floorheight[sector]
            L.sec_floorheight[sector] = (L.sec_floorheight[sector] + speed) | 0
            flag = PMap.P_ChangeSector(sector, crush)
            if (flag) {
                if (crush) return RES_CRUSHED
                L.sec_floorheight[sector] = lastpos
                PMap.P_ChangeSector(sector, crush)
                return RES_CRUSHED
            }
        }
    } else {
        // CEILING
        if (direction === -1) {
            if (L.sec_ceilingheight[sector] - speed < dest) {
                lastpos = L.sec_ceilingheight[sector]
                L.sec_ceilingheight[sector] = dest
                flag = PMap.P_ChangeSector(sector, crush)
                if (flag) {
                    L.sec_ceilingheight[sector] = lastpos
                    PMap.P_ChangeSector(sector, crush)
                }
                return RES_PASTDEST
            }
            // could get crushed
            lastpos = L.sec_ceilingheight[sector]
            L.sec_ceilingheight[sector] = (L.sec_ceilingheight[sector] - speed) | 0
            flag = PMap.P_ChangeSector(sector, crush)
            if (flag) {
                if (crush) return RES_CRUSHED
                L.sec_ceilingheight[sector] = lastpos
                PMap.P_ChangeSector(sector, crush)
                return RES_CRUSHED
            }
        } else if (direction === 1) {
            if (L.sec_ceilingheight[sector] + speed > dest) {
                lastpos = L.sec_ceilingheight[sector]
                L.sec_ceilingheight[sector] = dest
                flag = PMap.P_ChangeSector(sector, crush)
                if (flag) {
                    L.sec_ceilingheight[sector] = lastpos
                    PMap.P_ChangeSector(sector, crush)
                }
                return RES_PASTDEST
            }
            L.sec_ceilingheight[sector] = (L.sec_ceilingheight[sector] + speed) | 0
            PMap.P_ChangeSector(sector, crush)
        }
    }
    return RES_OK
}

// ---- floors (p_floor.c) ----

function T_MoveFloor(floor) {
    const res = T_MovePlane(floor.sector, floor.speed,
        floor.floordestheight, floor.crush, 0, floor.direction)

    if (!(G.state.leveltime & 7))
        S.StartSound(soundOrg(floor.sector), SFX.sfx_stnmov)

    if (res === RES_PASTDEST) {
        L.sec_specialdata[floor.sector] = null
        if (floor.direction === 1) {
            if (floor.type === F.donutRaise) {
                L.sec_special[floor.sector] = floor.newspecial
                L.sec_floorpic[floor.sector] = floor.texture
            }
        } else if (floor.direction === -1) {
            if (floor.type === F.lowerAndChange) {
                L.sec_special[floor.sector] = floor.newspecial
                L.sec_floorpic[floor.sector] = floor.texture
            }
        }
        PT.P_RemoveThinker(floor)
        S.StartSound(soundOrg(floor.sector), SFX.sfx_pstop)
    }
}

function makeFloor(sec) {
    const floor = {
        prev: null, next: null, tfunc: T_MoveFloor,
        type: 0, crush: false, sector: sec, direction: 0,
        newspecial: 0, texture: 0, floordestheight: 0, speed: FLOORSPEED,
    }
    PT.P_AddThinker(floor)
    L.sec_specialdata[sec] = floor
    return floor
}

function EV_DoFloor(line, floortype) {
    let secnum = -1
    let rtn = 0
    while ((secnum = PS.P_FindSectorFromLineTag(line, secnum)) >= 0) {
        const sec = secnum
        if (L.sec_specialdata[sec]) continue

        rtn = 1
        const floor = makeFloor(sec)
        floor.type = floortype
        floor.crush = false

        switch (floortype) {
            case F.lowerFloor:
                floor.direction = -1
                floor.speed = FLOORSPEED
                floor.floordestheight = PS.P_FindHighestFloorSurrounding(sec)
                break
            case F.lowerFloorToLowest:
                floor.direction = -1
                floor.speed = FLOORSPEED
                floor.floordestheight = PS.P_FindLowestFloorSurrounding(sec)
                break
            case F.turboLower:
                floor.direction = -1
                floor.speed = FLOORSPEED * 4
                floor.floordestheight = PS.P_FindHighestFloorSurrounding(sec)
                if (floor.floordestheight !== L.sec_floorheight[sec])
                    floor.floordestheight = (floor.floordestheight + 8 * FRACUNIT) | 0
                break
            case F.raiseFloorCrush:
                floor.crush = true
                // fall through
            case F.raiseFloor:
                floor.direction = 1
                floor.speed = FLOORSPEED
                floor.floordestheight = PS.P_FindLowestCeilingSurrounding(sec)
                if (floor.floordestheight > L.sec_ceilingheight[sec])
                    floor.floordestheight = L.sec_ceilingheight[sec]
                floor.floordestheight = (floor.floordestheight -
                    8 * FRACUNIT * (floortype === F.raiseFloorCrush ? 1 : 0)) | 0
                break
            case F.raiseFloorTurbo:
                floor.direction = 1
                floor.speed = FLOORSPEED * 4
                floor.floordestheight =
                    PS.P_FindNextHighestFloor(sec, L.sec_floorheight[sec])
                break
            case F.raiseFloorToNearest:
                floor.direction = 1
                floor.speed = FLOORSPEED
                floor.floordestheight =
                    PS.P_FindNextHighestFloor(sec, L.sec_floorheight[sec])
                break
            case F.raiseFloor24:
                floor.direction = 1
                floor.speed = FLOORSPEED
                floor.floordestheight = (L.sec_floorheight[sec] + 24 * FRACUNIT) | 0
                break
            case F.raiseFloor512:
                floor.direction = 1
                floor.speed = FLOORSPEED
                floor.floordestheight = (L.sec_floorheight[sec] + 512 * FRACUNIT) | 0
                break
            case F.raiseFloor24AndChange:
                floor.direction = 1
                floor.speed = FLOORSPEED
                floor.floordestheight = (L.sec_floorheight[sec] + 24 * FRACUNIT) | 0
                L.sec_floorpic[sec] = L.sec_floorpic[L.line_frontsector[line]]
                L.sec_special[sec] = L.sec_special[L.line_frontsector[line]]
                break
            case F.raiseToTexture: {
                let minsize = MAXINT
                floor.direction = 1
                floor.speed = FLOORSPEED
                const textureheight = RD.getTextureheight()
                const lines = L.sec_lines[sec]
                for (let i = 0; i < lines.length; i++) {
                    if (PS.twoSided(sec, i)) {
                        let side = PS.getSide(sec, i, 0)
                        if (L.side_bottomtexture[side] >= 0 &&
                            textureheight[L.side_bottomtexture[side]] < minsize)
                            minsize = textureheight[L.side_bottomtexture[side]]
                        side = PS.getSide(sec, i, 1)
                        if (L.side_bottomtexture[side] >= 0 &&
                            textureheight[L.side_bottomtexture[side]] < minsize)
                            minsize = textureheight[L.side_bottomtexture[side]]
                    }
                }
                floor.floordestheight = (L.sec_floorheight[sec] + minsize) | 0
                break
            }
            case F.lowerAndChange: {
                floor.direction = -1
                floor.speed = FLOORSPEED
                floor.floordestheight = PS.P_FindLowestFloorSurrounding(sec)
                floor.texture = L.sec_floorpic[sec]
                let cur = sec
                const lines = L.sec_lines[cur]
                for (let i = 0; i < lines.length; i++) {
                    if (PS.twoSided(cur, i)) {
                        let osec
                        if (L.side_sector[PS.getSide(cur, i, 0)] === cur)
                            osec = PS.getSector(cur, i, 1)
                        else
                            osec = PS.getSector(cur, i, 0)
                        if (L.sec_floorheight[osec] === floor.floordestheight) {
                            floor.texture = L.sec_floorpic[osec]
                            floor.newspecial = L.sec_special[osec]
                            break
                        }
                    }
                }
                break
            }
        }
    }
    return rtn
}

function EV_BuildStairs(line, type) {
    let secnum = -1
    let rtn = 0
    while ((secnum = PS.P_FindSectorFromLineTag(line, secnum)) >= 0) {
        let sec = secnum
        if (L.sec_specialdata[sec]) continue

        rtn = 1
        let floor = makeFloor(sec)
        floor.direction = 1

        let speed, stairsize
        if (type === STAIR.build8) {
            speed = FLOORSPEED / 4
            stairsize = 8 * FRACUNIT
        } else {
            speed = FLOORSPEED * 4
            stairsize = 16 * FRACUNIT
        }
        floor.speed = speed
        let height = (L.sec_floorheight[sec] + stairsize) | 0
        floor.floordestheight = height

        const texture = L.sec_floorpic[sec]

        // raise successive sectors along two-sided lines with same texture
        let ok
        do {
            ok = 0
            const lines = L.sec_lines[sec]
            for (let i = 0; i < lines.length; i++) {
                const ln = lines[i]
                if (!(L.line_flags[ln] & DD.ML.TWOSIDED)) continue
                if (L.line_frontsector[ln] !== sec) continue
                const tsec = L.line_backsector[ln]
                if (L.sec_floorpic[tsec] !== texture) continue
                height = (height + stairsize) | 0
                if (L.sec_specialdata[tsec]) continue

                sec = tsec
                secnum = tsec
                floor = makeFloor(sec)
                floor.direction = 1
                floor.speed = speed
                floor.floordestheight = height
                ok = 1
                break
            }
        } while (ok)
    }
    return rtn
}

// ---- doors (p_doors.c) ----

function T_VerticalDoor(door) {
    let res
    switch (door.direction) {
        case 0:
            // waiting
            if (!--door.topcountdown) {
                switch (door.type) {
                    case DOOR.blazeRaise:
                        door.direction = -1
                        S.StartSound(soundOrg(door.sector), SFX.sfx_bdcls)
                        break
                    case DOOR.normal:
                        door.direction = -1
                        S.StartSound(soundOrg(door.sector), SFX.sfx_dorcls)
                        break
                    case DOOR.close30ThenOpen:
                        door.direction = 1
                        S.StartSound(soundOrg(door.sector), SFX.sfx_doropn)
                        break
                }
            }
            break
        case 2:
            // initial wait
            if (!--door.topcountdown) {
                if (door.type === DOOR.raiseIn5Mins) {
                    door.direction = 1
                    door.type = DOOR.normal
                    S.StartSound(soundOrg(door.sector), SFX.sfx_doropn)
                }
            }
            break
        case -1:
            // down
            res = T_MovePlane(door.sector, door.speed,
                L.sec_floorheight[door.sector], false, 1, door.direction)
            if (res === RES_PASTDEST) {
                switch (door.type) {
                    case DOOR.blazeRaise:
                    case DOOR.blazeClose:
                        L.sec_specialdata[door.sector] = null
                        PT.P_RemoveThinker(door)
                        S.StartSound(soundOrg(door.sector), SFX.sfx_bdcls)
                        break
                    case DOOR.normal:
                    case DOOR.close:
                        L.sec_specialdata[door.sector] = null
                        PT.P_RemoveThinker(door)
                        break
                    case DOOR.close30ThenOpen:
                        door.direction = 0
                        door.topcountdown = 35 * 30
                        break
                }
            } else if (res === RES_CRUSHED) {
                switch (door.type) {
                    case DOOR.blazeClose:
                    case DOOR.close:       // do not go back up!
                        break
                    default:
                        door.direction = 1
                        S.StartSound(soundOrg(door.sector), SFX.sfx_doropn)
                        break
                }
            }
            break
        case 1:
            // up
            res = T_MovePlane(door.sector, door.speed,
                door.topheight, false, 1, door.direction)
            if (res === RES_PASTDEST) {
                switch (door.type) {
                    case DOOR.blazeRaise:
                    case DOOR.normal:
                        door.direction = 0  // wait at top
                        door.topcountdown = door.topwait
                        break
                    case DOOR.close30ThenOpen:
                    case DOOR.blazeOpen:
                    case DOOR.open:
                        L.sec_specialdata[door.sector] = null
                        PT.P_RemoveThinker(door)
                        break
                }
            }
            break
    }
}

function makeDoor(sec) {
    const door = {
        prev: null, next: null, tfunc: T_VerticalDoor,
        type: DOOR.normal, sector: sec, topheight: 0,
        speed: VDOORSPEED, direction: 1,
        topwait: VDOORWAIT, topcountdown: 0,
    }
    PT.P_AddThinker(door)
    L.sec_specialdata[sec] = door
    return door
}

function EV_DoLockedDoor(line, type, thing) {
    const p = thing.player
    if (!p) return 0
    const C = DD.Card

    switch (L.line_special[line]) {
        case 99:    // blue lock
        case 133:
            if (!p.cards[C.bluecard] && !p.cards[C.blueskull]) {
                p.message = "You need a blue key to activate this object"
                S.StartSound(null, SFX.sfx_oof)
                return 0
            }
            break
        case 134:   // red lock
        case 135:
            if (!p.cards[C.redcard] && !p.cards[C.redskull]) {
                p.message = "You need a red key to activate this object"
                S.StartSound(null, SFX.sfx_oof)
                return 0
            }
            break
        case 136:   // yellow lock
        case 137:
            if (!p.cards[C.yellowcard] && !p.cards[C.yellowskull]) {
                p.message = "You need a yellow key to activate this object"
                S.StartSound(null, SFX.sfx_oof)
                return 0
            }
            break
    }
    return EV_DoDoor(line, type)
}

function EV_DoDoor(line, type) {
    let secnum = -1
    let rtn = 0
    while ((secnum = PS.P_FindSectorFromLineTag(line, secnum)) >= 0) {
        const sec = secnum
        if (L.sec_specialdata[sec]) continue

        rtn = 1
        const door = makeDoor(sec)
        door.type = type

        switch (type) {
            case DOOR.blazeClose:
                door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
                door.direction = -1
                door.speed = VDOORSPEED * 4
                S.StartSound(soundOrg(sec), SFX.sfx_bdcls)
                break
            case DOOR.close:
                door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
                door.direction = -1
                S.StartSound(soundOrg(sec), SFX.sfx_dorcls)
                break
            case DOOR.close30ThenOpen:
                door.topheight = L.sec_ceilingheight[sec]
                door.direction = -1
                S.StartSound(soundOrg(sec), SFX.sfx_dorcls)
                break
            case DOOR.blazeRaise:
            case DOOR.blazeOpen:
                door.direction = 1
                door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
                door.speed = VDOORSPEED * 4
                if (door.topheight !== L.sec_ceilingheight[sec])
                    S.StartSound(soundOrg(sec), SFX.sfx_bdopn)
                break
            case DOOR.normal:
            case DOOR.open:
                door.direction = 1
                door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
                if (door.topheight !== L.sec_ceilingheight[sec])
                    S.StartSound(soundOrg(sec), SFX.sfx_doropn)
                break
        }
    }
    return rtn
}

// manual door (no tag)
function EV_VerticalDoor(line, thing) {
    const player = thing.player
    const C = DD.Card

    switch (L.line_special[line]) {
        case 26:    // blue lock
        case 32:
            if (!player) return
            if (!player.cards[C.bluecard] && !player.cards[C.blueskull]) {
                player.message = "You need a blue key to open this door"
                S.StartSound(null, SFX.sfx_oof)
                return
            }
            break
        case 27:    // yellow lock
        case 34:
            if (!player) return
            if (!player.cards[C.yellowcard] && !player.cards[C.yellowskull]) {
                player.message = "You need a yellow key to open this door"
                S.StartSound(null, SFX.sfx_oof)
                return
            }
            break
        case 28:    // red lock
        case 33:
            if (!player) return
            if (!player.cards[C.redcard] && !player.cards[C.redskull]) {
                player.message = "You need a red key to open this door"
                S.StartSound(null, SFX.sfx_oof)
                return
            }
            break
    }

    // the back side's sector is the door
    const sec = L.side_sector[L.line_sidenum1[line]]

    // if the sector has an active thinker, use it
    if (L.sec_specialdata[sec]) {
        const door = L.sec_specialdata[sec]
        switch (L.line_special[line]) {
            case 1:     // only for "raise" doors, not "open"s
            case 26:
            case 27:
            case 28:
            case 117:
                if (door.direction === -1) {
                    door.direction = 1      // go back up
                } else {
                    if (!thing.player) return   // bad guys never close doors
                    door.direction = -1     // start going down immediately
                }
                return
        }
    }

    // for proper sound
    switch (L.line_special[line]) {
        case 117:   // blazing door raise
        case 118:   // blazing door open
            S.StartSound(soundOrg(sec), SFX.sfx_bdopn)
            break
        default:
            S.StartSound(soundOrg(sec), SFX.sfx_doropn)
            break
    }

    const door = makeDoor(sec)
    door.direction = 1

    switch (L.line_special[line]) {
        case 1:
        case 26:
        case 27:
        case 28:
            door.type = DOOR.normal
            break
        case 31:
        case 32:
        case 33:
        case 34:
            door.type = DOOR.open
            L.line_special[line] = 0
            break
        case 117:
            door.type = DOOR.blazeRaise
            door.speed = VDOORSPEED * 4
            break
        case 118:
            door.type = DOOR.blazeOpen
            L.line_special[line] = 0
            door.speed = VDOORSPEED * 4
            break
    }

    door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
}

function P_SpawnDoorCloseIn30(sec) {
    const door = makeDoor(sec)
    L.sec_special[sec] = 0
    door.direction = 0
    door.type = DOOR.normal
    door.topcountdown = 30 * 35
}

function P_SpawnDoorRaiseIn5Mins(sec) {
    const door = makeDoor(sec)
    L.sec_special[sec] = 0
    door.direction = 2
    door.type = DOOR.raiseIn5Mins
    door.topheight = (PS.P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0
    door.topcountdown = 5 * 60 * 35
}

// ---- platforms (p_plats.c) ----

const activeplats = new Array(MAXPLATS).fill(null)

function T_PlatRaise(plat) {
    let res
    switch (plat.status) {
        case PSTAT.up:
            res = T_MovePlane(plat.sector, plat.speed, plat.high,
                plat.crush, 0, 1)
            if (plat.type === PLAT.raiseAndChange ||
                plat.type === PLAT.raiseToNearestAndChange) {
                if (!(G.state.leveltime & 7))
                    S.StartSound(soundOrg(plat.sector), SFX.sfx_stnmov)
            }
            if (res === RES_CRUSHED && !plat.crush) {
                plat.count = plat.wait
                plat.status = PSTAT.down
                S.StartSound(soundOrg(plat.sector), SFX.sfx_pstart)
            } else if (res === RES_PASTDEST) {
                plat.count = plat.wait
                plat.status = PSTAT.waiting
                S.StartSound(soundOrg(plat.sector), SFX.sfx_pstop)
                switch (plat.type) {
                    case PLAT.blazeDWUS:
                    case PLAT.downWaitUpStay:
                    case PLAT.raiseAndChange:
                    case PLAT.raiseToNearestAndChange:
                        P_RemoveActivePlat(plat)
                        break
                }
            }
            break
        case PSTAT.down:
            res = T_MovePlane(plat.sector, plat.speed, plat.low, false, 0, -1)
            if (res === RES_PASTDEST) {
                plat.count = plat.wait
                plat.status = PSTAT.waiting
                S.StartSound(soundOrg(plat.sector), SFX.sfx_pstop)
            }
            break
        case PSTAT.waiting:
            if (!--plat.count) {
                if (L.sec_floorheight[plat.sector] === plat.low)
                    plat.status = PSTAT.up
                else plat.status = PSTAT.down
                S.StartSound(soundOrg(plat.sector), SFX.sfx_pstart)
            }
            break
        case PSTAT.in_stasis:
            break
    }
}

function EV_DoPlat(line, type, amount) {
    let secnum = -1
    let rtn = 0

    if (type === PLAT.perpetualRaise)
        P_ActivateInStasis(L.line_tag[line])

    while ((secnum = PS.P_FindSectorFromLineTag(line, secnum)) >= 0) {
        const sec = secnum
        if (L.sec_specialdata[sec]) continue

        rtn = 1
        const plat = {
            prev: null, next: null, tfunc: T_PlatRaise,
            sector: sec, speed: 0, low: 0, high: 0,
            wait: 0, count: 0, status: 0, oldstatus: 0,
            crush: false, tag: L.line_tag[line], type: type,
        }
        PT.P_AddThinker(plat)
        L.sec_specialdata[sec] = plat

        switch (type) {
            case PLAT.raiseToNearestAndChange:
                plat.speed = PLATSPEED / 2
                L.sec_floorpic[sec] =
                    L.sec_floorpic[L.side_sector[L.line_sidenum0[line]]]
                plat.high = PS.P_FindNextHighestFloor(sec, L.sec_floorheight[sec])
                plat.wait = 0
                plat.status = PSTAT.up
                L.sec_special[sec] = 0      // no more damage
                S.StartSound(soundOrg(sec), SFX.sfx_stnmov)
                break
            case PLAT.raiseAndChange:
                plat.speed = PLATSPEED / 2
                L.sec_floorpic[sec] =
                    L.sec_floorpic[L.side_sector[L.line_sidenum0[line]]]
                plat.high = (L.sec_floorheight[sec] + amount * FRACUNIT) | 0
                plat.wait = 0
                plat.status = PSTAT.up
                S.StartSound(soundOrg(sec), SFX.sfx_stnmov)
                break
            case PLAT.downWaitUpStay:
                plat.speed = PLATSPEED * 4
                plat.low = PS.P_FindLowestFloorSurrounding(sec)
                if (plat.low > L.sec_floorheight[sec])
                    plat.low = L.sec_floorheight[sec]
                plat.high = L.sec_floorheight[sec]
                plat.wait = 35 * PLATWAIT
                plat.status = PSTAT.down
                S.StartSound(soundOrg(sec), SFX.sfx_pstart)
                break
            case PLAT.blazeDWUS:
                plat.speed = PLATSPEED * 8
                plat.low = PS.P_FindLowestFloorSurrounding(sec)
                if (plat.low > L.sec_floorheight[sec])
                    plat.low = L.sec_floorheight[sec]
                plat.high = L.sec_floorheight[sec]
                plat.wait = 35 * PLATWAIT
                plat.status = PSTAT.down
                S.StartSound(soundOrg(sec), SFX.sfx_pstart)
                break
            case PLAT.perpetualRaise:
                plat.speed = PLATSPEED
                plat.low = PS.P_FindLowestFloorSurrounding(sec)
                if (plat.low > L.sec_floorheight[sec])
                    plat.low = L.sec_floorheight[sec]
                plat.high = PS.P_FindHighestFloorSurrounding(sec)
                if (plat.high < L.sec_floorheight[sec])
                    plat.high = L.sec_floorheight[sec]
                plat.wait = 35 * PLATWAIT
                plat.status = R.P_Random() & 1
                S.StartSound(soundOrg(sec), SFX.sfx_pstart)
                break
        }
        P_AddActivePlat(plat)
    }
    return rtn
}

function P_ActivateInStasis(tag) {
    for (let i = 0; i < MAXPLATS; i++) {
        const p = activeplats[i]
        if (p && p.tag === tag && p.status === PSTAT.in_stasis) {
            p.status = p.oldstatus
            p.tfunc = T_PlatRaise
        }
    }
}

function EV_StopPlat(line) {
    for (let j = 0; j < MAXPLATS; j++) {
        const p = activeplats[j]
        if (p && p.status !== PSTAT.in_stasis &&
            p.tag === L.line_tag[line]) {
            p.oldstatus = p.status
            p.status = PSTAT.in_stasis
            p.tfunc = null
        }
    }
}

function P_AddActivePlat(plat) {
    for (let i = 0; i < MAXPLATS; i++) {
        if (activeplats[i] === null) {
            activeplats[i] = plat
            return
        }
    }
    throw Error("P_AddActivePlat: no more plats!")
}

function P_RemoveActivePlat(plat) {
    for (let i = 0; i < MAXPLATS; i++) {
        if (activeplats[i] === plat) {
            L.sec_specialdata[plat.sector] = null
            PT.P_RemoveThinker(plat)
            activeplats[i] = null
            return
        }
    }
    throw Error("P_RemoveActivePlat: can't find plat!")
}

function P_ClearPlats() { activeplats.fill(null) }

// ---- ceilings (p_ceilng.c) ----

const activeceilings = new Array(MAXCEILINGS).fill(null)

function T_MoveCeiling(ceiling) {
    let res
    switch (ceiling.direction) {
        case 0:
            break               // in stasis
        case 1:
            // up
            res = T_MovePlane(ceiling.sector, ceiling.speed,
                ceiling.topheight, false, 1, ceiling.direction)
            if (!(G.state.leveltime & 7)) {
                if (ceiling.type !== CEIL.silentCrushAndRaise)
                    S.StartSound(soundOrg(ceiling.sector), SFX.sfx_stnmov)
            }
            if (res === RES_PASTDEST) {
                switch (ceiling.type) {
                    case CEIL.raiseToHighest:
                        P_RemoveActiveCeiling(ceiling)
                        break
                    case CEIL.silentCrushAndRaise:
                        S.StartSound(soundOrg(ceiling.sector), SFX.sfx_pstop)
                        // fall through
                    case CEIL.fastCrushAndRaise:
                    case CEIL.crushAndRaise:
                        ceiling.direction = -1
                        break
                }
            }
            break
        case -1:
            // down
            res = T_MovePlane(ceiling.sector, ceiling.speed,
                ceiling.bottomheight, ceiling.crush, 1, ceiling.direction)
            if (!(G.state.leveltime & 7)) {
                if (ceiling.type !== CEIL.silentCrushAndRaise)
                    S.StartSound(soundOrg(ceiling.sector), SFX.sfx_stnmov)
            }
            if (res === RES_PASTDEST) {
                switch (ceiling.type) {
                    case CEIL.silentCrushAndRaise:
                        S.StartSound(soundOrg(ceiling.sector), SFX.sfx_pstop)
                        // fall through
                    case CEIL.crushAndRaise:
                        ceiling.speed = CEILSPEED
                        // fall through
                    case CEIL.fastCrushAndRaise:
                        ceiling.direction = 1
                        break
                    case CEIL.lowerAndCrush:
                    case CEIL.lowerToFloor:
                        P_RemoveActiveCeiling(ceiling)
                        break
                }
            } else if (res === RES_CRUSHED) {
                switch (ceiling.type) {
                    case CEIL.silentCrushAndRaise:
                    case CEIL.crushAndRaise:
                    case CEIL.lowerAndCrush:
                        ceiling.speed = CEILSPEED / 8
                        break
                }
            }
            break
    }
}

function EV_DoCeiling(line, type) {
    let secnum = -1
    let rtn = 0

    // reactivate in-stasis ceilings for crusher types
    if (type === CEIL.fastCrushAndRaise ||
        type === CEIL.silentCrushAndRaise ||
        type === CEIL.crushAndRaise)
        P_ActivateInStasisCeiling(line)

    while ((secnum = PS.P_FindSectorFromLineTag(line, secnum)) >= 0) {
        const sec = secnum
        if (L.sec_specialdata[sec]) continue

        rtn = 1
        const ceiling = {
            prev: null, next: null, tfunc: T_MoveCeiling,
            type: type, sector: sec, bottomheight: 0, topheight: 0,
            speed: CEILSPEED, crush: false, direction: 0,
            tag: L.sec_tag[sec], olddirection: 0,
        }
        PT.P_AddThinker(ceiling)
        L.sec_specialdata[sec] = ceiling

        switch (type) {
            case CEIL.fastCrushAndRaise:
                ceiling.crush = true
                ceiling.topheight = L.sec_ceilingheight[sec]
                ceiling.bottomheight = (L.sec_floorheight[sec] + 8 * FRACUNIT) | 0
                ceiling.direction = -1
                ceiling.speed = CEILSPEED * 2
                break
            case CEIL.silentCrushAndRaise:
            case CEIL.crushAndRaise:
                ceiling.crush = true
                ceiling.topheight = L.sec_ceilingheight[sec]
                // fall through
            case CEIL.lowerAndCrush:
            case CEIL.lowerToFloor:
                ceiling.bottomheight = L.sec_floorheight[sec]
                if (type !== CEIL.lowerToFloor)
                    ceiling.bottomheight = (ceiling.bottomheight + 8 * FRACUNIT) | 0
                ceiling.direction = -1
                ceiling.speed = CEILSPEED
                break
            case CEIL.raiseToHighest:
                ceiling.topheight = PS.P_FindHighestCeilingSurrounding(sec)
                ceiling.direction = 1
                ceiling.speed = CEILSPEED
                break
        }
        P_AddActiveCeiling(ceiling)
    }
    return rtn
}

function P_AddActiveCeiling(c) {
    for (let i = 0; i < MAXCEILINGS; i++) {
        if (activeceilings[i] === null) {
            activeceilings[i] = c
            return
        }
    }
}

function P_RemoveActiveCeiling(c) {
    for (let i = 0; i < MAXCEILINGS; i++) {
        if (activeceilings[i] === c) {
            L.sec_specialdata[c.sector] = null
            PT.P_RemoveThinker(c)
            activeceilings[i] = null
            break
        }
    }
}

function P_ActivateInStasisCeiling(line) {
    for (let i = 0; i < MAXCEILINGS; i++) {
        const c = activeceilings[i]
        if (c && c.tag === L.line_tag[line] && c.direction === 0) {
            c.direction = c.olddirection
            c.tfunc = T_MoveCeiling
        }
    }
}

function EV_CeilingCrushStop(line) {
    let rtn = 0
    for (let i = 0; i < MAXCEILINGS; i++) {
        const c = activeceilings[i]
        if (c && c.tag === L.line_tag[line] && c.direction !== 0) {
            c.olddirection = c.direction
            c.tfunc = null
            c.direction = 0         // in stasis
            rtn = 1
        }
    }
    return rtn
}

function P_ClearCeilings() { activeceilings.fill(null) }

let SFX = null

exports = {
    T_MovePlane, T_MoveFloor, EV_DoFloor, EV_BuildStairs,
    F, STAIR, DOOR, PLAT, CEIL,
    T_VerticalDoor, EV_DoLockedDoor, EV_DoDoor, EV_VerticalDoor,
    P_SpawnDoorCloseIn30, P_SpawnDoorRaiseIn5Mins,
    T_PlatRaise, EV_DoPlat, P_ActivateInStasis, EV_StopPlat,
    P_AddActivePlat, P_RemoveActivePlat, P_ClearPlats,
    T_MoveCeiling, EV_DoCeiling, P_AddActiveCeiling,
    P_RemoveActiveCeiling, P_ActivateInStasisCeiling,
    EV_CeilingCrushStop, P_ClearCeilings,
    init: function (D) {
        DD = D.defs; T = D.tables; R = D.m_random; I = D.info
        G = D.g_game; PT = D.p_tick; PMap = D.p_map; PS = D.p_spec
        L = D.p_setup.level; RD = D.r_data
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
    },
}
