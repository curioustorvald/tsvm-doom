// defs.mjs -- core constants and enums (doomdef.h, d_event.h, d_ticcmd.h)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

const VERSION = 109               // demo/savegame compatibility: DOOM 1.9

const SCREENWIDTH = _G.DOOM.SCREENWIDTH
const SCREENHEIGHT = _G.DOOM.SCREENHEIGHT
const TICRATE = 35

const MAXPLAYERS = 4              // arrays sized like vanilla; only player 0 used

// gamemode_t -- detected from IWAD lump census
const GameMode = {
    shareware: 0,                 // DOOM 1 shareware, E1M1-E1M9
    registered: 1,                // DOOM 1 registered, E3M27
    commercial: 2,                // DOOM 2, MAP01-MAP32
    retail: 3,                    // DOOM 1 retail (Ultimate), E4M9
    indetermined: 4,
}

// gamestate_t
const GS = { LEVEL: 0, INTERMISSION: 1, FINALE: 2, DEMOSCREEN: 3, WIPE: -1 }

// skill_t
const Skill = { baby: 0, easy: 1, medium: 2, hard: 3, nightmare: 4 }

// card_t
const Card = {
    bluecard: 0, yellowcard: 1, redcard: 2,
    blueskull: 3, yellowskull: 4, redskull: 5,
    NUMCARDS: 6,
}

// weapontype_t
const Weapon = {
    fist: 0, pistol: 1, shotgun: 2, chaingun: 3, missile: 4,
    plasma: 5, bfg: 6, chainsaw: 7, supershotgun: 8,
    NUMWEAPONS: 9, nochange: 10,
}

// ammotype_t
const Ammo = { clip: 0, shell: 1, cell: 2, misl: 3, NUMAMMO: 4, noammo: 5 }

// powertype_t
const Power = {
    invulnerability: 0, strength: 1, invisibility: 2,
    ironfeet: 3, allmap: 4, infrared: 5, NUMPOWERS: 6,
}

// power durations, in tics
const PowerDuration = {
    INVULNTICS: 30 * TICRATE,
    INVISTICS: 60 * TICRATE,
    INFRATICS: 120 * TICRATE,
    IRONTICS: 60 * TICRATE,
}

// d_event.h: evtype_t -- ev_mouse/ev_joystick are never generated on TSVM
const Ev = { keydown: 0, keyup: 1 }

// d_ticcmd.h: ticcmd_t factory (per-tic player command; demo unit)
function makeTiccmd() {
    return { forwardmove: 0, sidemove: 0, angleturn: 0, consistancy: 0,
             chatchar: 0, buttons: 0 }
}

function copyTiccmd(dst, src) {
    dst.forwardmove = src.forwardmove
    dst.sidemove = src.sidemove
    dst.angleturn = src.angleturn
    dst.consistancy = src.consistancy
    dst.chatchar = src.chatchar
    dst.buttons = src.buttons
}

// d_event.h: buttoncode_t
const BT = {
    ATTACK: 1, USE: 2, SPECIAL: 128, SPECIALMASK: 3,
    CHANGE: 4, WEAPONMASK: 8 + 16 + 32, WEAPONSHIFT: 3,
    PAUSE: 1, SPECIAL_PAUSE: 129,
}

// doomdef.h key codes are replaced by libGDX raw codes (see i_input.mjs);
// engine code stores keybindings as raw codes from the config.

// m_bbox.h: bounding boxes are Int32Array(4) indexed by BOX*
const BOXTOP = 0, BOXBOTTOM = 1, BOXLEFT = 2, BOXRIGHT = 3
const MAXINT = 0x7fffffff, MININT = -0x80000000

function M_ClearBox(box) {
    box[BOXTOP] = box[BOXRIGHT] = MININT
    box[BOXBOTTOM] = box[BOXLEFT] = MAXINT
}

function M_AddToBox(box, x, y) {
    if (x < box[BOXLEFT]) box[BOXLEFT] = x
    else if (x > box[BOXRIGHT]) box[BOXRIGHT] = x
    if (y < box[BOXBOTTOM]) box[BOXBOTTOM] = y
    else if (y > box[BOXTOP]) box[BOXTOP] = y
}

// p_local.h
const MAXRADIUS = 32 * 65536
const MAPBLOCKSHIFT = 16 + 7

// doomdata.h: linedef flags
const ML = {
    BLOCKING: 1, BLOCKMONSTERS: 2, TWOSIDED: 4,
    DONTPEGTOP: 8, DONTPEGBOTTOM: 16, SECRET: 32,
    SOUNDBLOCK: 64, DONTDRAW: 128, MAPPED: 256,
}

// doomdata.h: BSP child flag; r_defs.h slope types
const NF_SUBSECTOR = 0x8000
const SlopeType = { vertical: 0, horizontal: 1, positive: 2, negative: 3 }

// playsim constants (p_local.h, doomdef.h)
const FRACUNIT = 65536
const VIEWHEIGHT = 41 * FRACUNIT
const ONFLOORZ = -0x80000000        // MININT
const ONCEILINGZ = 0x7fffffff       // MAXINT
const MAXMOVE = 30 * FRACUNIT
const GRAVITY = FRACUNIT
const FLOATSPEED = FRACUNIT * 4
const MELEERANGE = 64 * FRACUNIT
const MISSILERANGE = 32 * 64 * FRACUNIT
const USERANGE = 64 * FRACUNIT
const ITEMQUESIZE = 128
const MAPBLOCKSIZE = 128 * FRACUNIT
const MAPBTOFRAC = MAPBLOCKSHIFT - 16
const PT_ADDLINES = 1, PT_ADDTHINGS = 2, PT_EARLYOUT = 4
const MTF_AMBUSH = 8

// playerstate_t
const PST = { LIVE: 0, DEAD: 1, REBORN: 2 }

// cheat flags (d_player.h)
const CF = { NOCLIP: 1, GODMODE: 2, NOMOMENTUM: 4 }

// player_t factory (d_player.h); psprites filled by p_pspr
function makePlayer() {
    return {
        mo: null, playerstate: PST.LIVE, cmd: makeTiccmd(),
        viewz: 0, viewheight: VIEWHEIGHT, deltaviewheight: 0, bob: 0,
        health: 100, armorpoints: 0, armortype: 0,
        powers: new Int32Array(Power.NUMPOWERS),
        cards: new Uint8Array(Card.NUMCARDS),
        backpack: false,
        frags: new Int32Array(MAXPLAYERS),
        readyweapon: Weapon.pistol, pendingweapon: Weapon.nochange,
        weaponowned: new Uint8Array(Weapon.NUMWEAPONS),
        ammo: new Int32Array(Ammo.NUMAMMO),
        maxammo: new Int32Array(Ammo.NUMAMMO),
        attackdown: false, usedown: false,
        cheats: 0, refire: 0,
        killcount: 0, itemcount: 0, secretcount: 0,
        message: null, damagecount: 0, bonuscount: 0,
        attacker: null, extralight: 0, fixedcolormap: 0, colormap: 0,
        psprites: [
            { state: -1, tics: 0, sx: 0, sy: 0 },   // ps_weapon
            { state: -1, tics: 0, sx: 0, sy: 0 },   // ps_flash
        ],
        didsecret: false,
    }
}

exports = {
    VERSION, SCREENWIDTH, SCREENHEIGHT, TICRATE, MAXPLAYERS,
    GameMode, GS, Skill, Card, Weapon, Ammo, Power, PowerDuration,
    Ev, BT, makeTiccmd, copyTiccmd,
    BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT, M_ClearBox, M_AddToBox,
    MAXRADIUS, MAPBLOCKSHIFT, ML, NF_SUBSECTOR, SlopeType,
    VIEWHEIGHT, ONFLOORZ, ONCEILINGZ, MAXMOVE, GRAVITY, FLOATSPEED,
    MELEERANGE, MISSILERANGE, USERANGE, ITEMQUESIZE,
    MAPBLOCKSIZE, MAPBTOFRAC, PT_ADDLINES, PT_ADDTHINGS, PT_EARLYOUT,
    MTF_AMBUSH, PST, CF, makePlayer,
    init: function (D) {},
}
