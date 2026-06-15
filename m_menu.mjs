// m_menu.mjs -- menu system (m_menu.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Table-driven like vanilla. Save/load slots draw but defer to M9 for
// actual disk I/O. Detail toggle is a no-op (single detail mode).

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, G = null, W = null, V = null, HU = null, S = null
let RM = null, IV = null

// vanilla doomdef.h key codes (events carry these)
const KEY_RIGHTARROW = 0xae
const KEY_LEFTARROW = 0xac
const KEY_UPARROW = 0xad
const KEY_DOWNARROW = 0xaf
const KEY_ESCAPE = 27
const KEY_ENTER = 13
const KEY_BACKSPACE = 127
const KEY_F1 = 0x80 + 0x3b

const SKULLXOFF = -32
const LINEHEIGHT = 16

let menuactive = false
let currentMenu = null
let itemOn = 0
let skullAnimCounter = 10
let whichSkull = 0

// message prompt state (M_StartMessage)
let messageToPrint = false
let messageString = ""
let messageRoutine = null
let messageNeedsInput = false

let screenSize = 10             // 3..11 (blocks)
let showMessages = true
let frameskip = 0               // doomrc [options] frameskip: 0 = draw every frame

// menu item: [name(patch lump or ""), routine(choice), status, alphaKey]
// status: 1 = ok, 2 = arrows ok (slider), -1 = inert
function makeMenu(x, y, items, drawer, prev) {
    return { x, y, items, drawer, prev, lastOn: 0 }
}

let MainDef, EpiDef, NewDef, OptionsDef, SoundDef, LoadDef, SaveDef, ReadDef1, ReadDef2

function buildMenus() {
    MainDef = makeMenu(97, 64, [
        ["M_NGAME", M_NewGame, 1, "n"],
        ["M_OPTION", M_Options, 1, "o"],
        ["M_LOADG", M_LoadGame, 1, "l"],
        ["M_SAVEG", M_SaveGame, 1, "s"],
        ["M_RDTHIS", M_ReadThis, 1, "r"],
        ["M_QUITG", M_QuitDOOM, 1, "q"],
    ], M_DrawMainMenu, null)

    EpiDef = makeMenu(48, 63, [
        ["M_EPI1", M_Episode, 1, "k"],
        ["M_EPI2", M_Episode, 1, "t"],
        ["M_EPI3", M_Episode, 1, "i"],
    ], M_DrawEpisode, () => MainDef)

    NewDef = makeMenu(48, 63, [
        ["M_JKILL", M_ChooseSkill, 1, "i"],
        ["M_ROUGH", M_ChooseSkill, 1, "h"],
        ["M_HURT", M_ChooseSkill, 1, "h"],
        ["M_ULTRA", M_ChooseSkill, 1, "u"],
        ["M_NMARE", M_ChooseSkill, 1, "n"],
    ], M_DrawNewGame, () => EpiDef)
    NewDef.lastOn = 2               // hurt me plenty default

    OptionsDef = makeMenu(60, 37, [
        ["M_ENDGAM", M_EndGame, 1, "e"],
        ["M_MESSG", M_ChangeMessages, 1, "m"],
        ["M_DETAIL", M_NoOp, 1, "g"],
        ["M_SCRNSZ", M_SizeDisplay, 2, "s"],
        ["", null, -1, ""],
        ["M_SVOL", M_Sound, 1, "s"],
    ], M_DrawOptions, () => MainDef)

    SoundDef = makeMenu(80, 64, [
        ["M_SFXVOL", M_SfxVol, 2, "s"],
        ["", null, -1, ""],
        ["M_MUSVOL", M_MusicVol, 2, "m"],
        ["", null, -1, ""],
    ], M_DrawSound, () => OptionsDef)

    const loadItems = []
    for (let i = 0; i < 6; i++)
        loadItems.push(["", M_LoadSelect, 1, String(i + 1)])
    LoadDef = makeMenu(80, 54, loadItems, M_DrawLoad, () => MainDef)
    const saveItems = []
    for (let i = 0; i < 6; i++)
        saveItems.push(["", M_SaveSelect, 1, String(i + 1)])
    SaveDef = makeMenu(80, 54, saveItems, M_DrawSave, () => MainDef)

    ReadDef1 = makeMenu(280, 185, [["", M_ReadThis2, 1, ""]],
        M_DrawReadThis1, () => MainDef)
    ReadDef2 = makeMenu(330, 175, [["", M_FinishReadThis, 1, ""]],
        M_DrawReadThis2, () => ReadDef1)
}

let epi = 0
let quitRequested = false

// ---- menu routines ----

function M_NewGame(ch) { M_SetupNextMenu(EpiDef) }
function M_Options(ch) { M_SetupNextMenu(OptionsDef) }
function M_LoadGame(ch) { M_SetupNextMenu(LoadDef) }
function M_SaveGame(ch) {
    if (!G.state.usergame) {
        M_StartMessage("you can't save if you aren't playing!\n\npress a key.", null, false)
        return
    }
    M_SetupNextMenu(SaveDef)
}
function M_ReadThis(ch) { M_SetupNextMenu(ReadDef1) }
function M_ReadThis2(ch) { M_SetupNextMenu(ReadDef2) }
function M_FinishReadThis(ch) { M_SetupNextMenu(MainDef) }

function M_QuitDOOM(ch) {
    M_StartMessage("are you sure you want to\nquit this great game?\n\npress y or n.",
        (key) => {
            if (key === 121) quitRequested = true       // 'y'
        }, true)
}

function M_Episode(ch) {
    if (G.state.gamemode === DD.GameMode.shareware && ch !== 0) {
        M_StartMessage("this is the shareware version of doom.\n\n" +
            "you need to order the entire trilogy.\n\npress a key.", null, false)
        M_SetupNextMenu(ReadDef1)
        return
    }
    epi = ch
    M_SetupNextMenu(NewDef)
}

function M_ChooseSkill(ch) {
    if (ch === 4) {
        M_StartMessage("are you sure? this skill level\nisn't even remotely fair.\n\npress y or n.",
            (key) => {
                if (key !== 121) return
                G.G_DeferedInitNew(4, epi + 1, 1)
                M_ClearMenus()
            }, true)
        return
    }
    G.G_DeferedInitNew(ch, epi + 1, 1)
    M_ClearMenus()
}

function M_EndGame(ch) {
    if (!G.state.usergame) return
    M_StartMessage("are you sure you want to\nend the game?\n\npress y or n.",
        (key) => {
            if (key !== 121) return
            currentMenu.lastOn = itemOn
            M_ClearMenus()
            G.state.usergame = false
            if (startTitle !== null) startTitle()
        }, true)
}

function M_ChangeMessages(ch) {
    showMessages = !showMessages
    const player = G.state.players[G.state.consoleplayer]
    player.message = showMessages ? "Messages ON" : "Messages OFF"
}

function M_NoOp(ch) {}

function M_SizeDisplay(ch) {
    if (ch === 0) { if (screenSize > 3) screenSize-- }
    else if (ch === 1) { if (screenSize < 11) screenSize++ }
    RM.R_ExecuteSetViewSize(screenSize)
    if (viewSizeChanged !== null) viewSizeChanged(screenSize)
}

let sfxVolume = 8, musicVolume = 8

function M_SfxVol(ch) {
    if (ch === 0) { if (sfxVolume > 0) sfxVolume-- }
    else if (ch === 1) { if (sfxVolume < 15) sfxVolume++ }
    if (S.SetSfxVolume) S.SetSfxVolume(sfxVolume)
}

function M_MusicVol(ch) {
    if (ch === 0) { if (musicVolume > 0) musicVolume-- }
    else if (ch === 1) { if (musicVolume < 15) musicVolume++ }
    if (S.SetMusicVolume) S.SetMusicVolume(musicVolume)
}

function M_Sound(ch) { M_SetupNextMenu(SoundDef) }

// save/load slot handling; the shell wires the disk I/O hooks
let loadSelectHook = null, saveSelectHook = null
let saveSlotNames = ["", "", "", "", "", ""]
let saveStringEnter = false
let saveSlot = 0
let saveOldString = ""

function M_LoadSelect(ch) {
    if (loadSelectHook !== null) {
        loadSelectHook(ch)
        M_ClearMenus()
    } else {
        M_StartMessage("load / save is not wired up.\n\npress a key.", null, false)
    }
}

function M_SaveSelect(ch) {
    // begin typing the slot description (vanilla behaviour)
    saveStringEnter = true
    saveSlot = ch
    saveOldString = saveSlotNames[ch]
    if (saveSlotNames[ch] === "" || saveSlotNames[ch] === "empty slot")
        saveSlotNames[ch] = ""
}

function M_DoSave() {
    saveStringEnter = false
    if (saveSelectHook !== null) {
        saveSelectHook(saveSlot, saveSlotNames[saveSlot])
        M_ClearMenus()
    } else {
        M_StartMessage("load / save is not wired up.\n\npress a key.", null, false)
    }
}

// ---- machinery ----

function M_StartMessage(string, routine, input) {
    messageToPrint = true
    messageString = string
    messageRoutine = routine
    messageNeedsInput = input
}

function M_SetupNextMenu(menudef) {
    currentMenu = menudef
    itemOn = currentMenu.lastOn
}

function M_StartControlPanel() {
    if (menuactive) return
    menuactive = true
    currentMenu = MainDef
    itemOn = currentMenu.lastOn
    G.state.menuactive = true
}

function M_ClearMenus() {
    menuactive = false
    G.state.menuactive = false
}

function M_Ticker() {
    if (--skullAnimCounter <= 0) {
        whichSkull ^= 1
        skullAnimCounter = 8
    }
}

function M_Responder(ev) {
    if (ev.type !== DD.Ev.keydown) return false
    const ch = ev.data1

    // typing a savegame description
    if (saveStringEnter) {
        if (ch === KEY_BACKSPACE) {
            if (saveSlotNames[saveSlot].length > 0)
                saveSlotNames[saveSlot] =
                    saveSlotNames[saveSlot].slice(0, -1)
        } else if (ch === KEY_ESCAPE) {
            saveStringEnter = false
            saveSlotNames[saveSlot] = saveOldString
        } else if (ch === KEY_ENTER) {
            if (saveSlotNames[saveSlot].length > 0) M_DoSave()
        } else if (ch >= 32 && ch <= 122 &&
            saveSlotNames[saveSlot].length < 23) {
            saveSlotNames[saveSlot] += String.fromCharCode(ch)
        }
        return true
    }

    // message prompt eats everything
    if (messageToPrint) {
        if (messageNeedsInput &&
            !(ch === 32 || ch === 110 || ch === 121 || ch === KEY_ESCAPE))
            return false
        messageToPrint = false
        if (messageRoutine !== null) messageRoutine(ch)
        S.StartSound(null, SFX.sfx_swtchx)
        return true
    }

    // pop up the menu
    if (!menuactive) {
        if (ch === KEY_ESCAPE) {
            M_StartControlPanel()
            S.StartSound(null, SFX.sfx_swtchn)
            return true
        }
        return false
    }

    switch (ch) {
        case KEY_DOWNARROW:
            do {
                itemOn = (itemOn + 1) % currentMenu.items.length
            } while (currentMenu.items[itemOn][2] === -1)
            S.StartSound(null, SFX.sfx_pstop)
            return true
        case KEY_UPARROW:
            do {
                itemOn = itemOn === 0 ? currentMenu.items.length - 1 : itemOn - 1
            } while (currentMenu.items[itemOn][2] === -1)
            S.StartSound(null, SFX.sfx_pstop)
            return true
        case KEY_LEFTARROW:
            if (currentMenu.items[itemOn][1] !== null &&
                currentMenu.items[itemOn][2] === 2) {
                S.StartSound(null, SFX.sfx_stnmov)
                currentMenu.items[itemOn][1](0)
            }
            return true
        case KEY_RIGHTARROW:
            if (currentMenu.items[itemOn][1] !== null &&
                currentMenu.items[itemOn][2] === 2) {
                S.StartSound(null, SFX.sfx_stnmov)
                currentMenu.items[itemOn][1](1)
            }
            return true
        case KEY_ENTER:
            if (currentMenu.items[itemOn][1] !== null &&
                currentMenu.items[itemOn][2]) {
                currentMenu.lastOn = itemOn
                if (currentMenu.items[itemOn][2] === 2) {
                    currentMenu.items[itemOn][1](1)
                    S.StartSound(null, SFX.sfx_stnmov)
                } else {
                    currentMenu.items[itemOn][1](itemOn)
                    S.StartSound(null, SFX.sfx_pistol)
                }
            }
            return true
        case KEY_ESCAPE:
            currentMenu.lastOn = itemOn
            M_ClearMenus()
            S.StartSound(null, SFX.sfx_swtchx)
            return true
        case KEY_BACKSPACE:
            currentMenu.lastOn = itemOn
            if (currentMenu.prev !== null) {
                currentMenu = currentMenu.prev()
                itemOn = currentMenu.lastOn
                S.StartSound(null, SFX.sfx_swtchn)
            }
            return true
        default:
            // alpha key shortcuts
            for (let i = itemOn + 1; i < currentMenu.items.length; i++) {
                if (currentMenu.items[i][3].charCodeAt(0) === ch) {
                    itemOn = i
                    S.StartSound(null, SFX.sfx_pstop)
                    return true
                }
            }
            for (let i = 0; i <= itemOn; i++) {
                if (currentMenu.items[i][3].charCodeAt(0) === ch) {
                    itemOn = i
                    S.StartSound(null, SFX.sfx_pstop)
                    return true
                }
            }
            break
    }
    return false
}

// ---- drawing ----

function M_DrawThermo(x, y, thermWidth, thermDot) {
    let xx = x
    V.V_DrawPatch(xx, y, 0, W.W_CacheLumpName("M_THERML"))
    xx += 8
    for (let i = 0; i < thermWidth; i++) {
        V.V_DrawPatch(xx, y, 0, W.W_CacheLumpName("M_THERMM"))
        xx += 8
    }
    V.V_DrawPatch(xx, y, 0, W.W_CacheLumpName("M_THERMR"))
    V.V_DrawPatch(x + 8 + thermDot * 8, y, 0, W.W_CacheLumpName("M_THERMO"))
}

function M_DrawMainMenu() {
    V.V_DrawPatch(94, 2, 0, W.W_CacheLumpName("M_DOOM"))
}

function M_DrawEpisode() {
    V.V_DrawPatch(54, 38, 0, W.W_CacheLumpName("M_EPISOD"))
}

function M_DrawNewGame() {
    V.V_DrawPatch(96, 14, 0, W.W_CacheLumpName("M_NEWG"))
    V.V_DrawPatch(54, 38, 0, W.W_CacheLumpName("M_SKILL"))
}

function M_DrawOptions() {
    V.V_DrawPatch(108, 15, 0, W.W_CacheLumpName("M_OPTTTL"))
    V.V_DrawPatch(OptionsDef.x + 120, OptionsDef.y + LINEHEIGHT * 1, 0,
        W.W_CacheLumpName(showMessages ? "M_MSGON" : "M_MSGOFF"))
    M_DrawThermo(OptionsDef.x, OptionsDef.y + LINEHEIGHT * (3 + 1), 9,
        screenSize - 3)
}

function M_DrawSound() {
    V.V_DrawPatch(60, 38, 0, W.W_CacheLumpName("M_SVOL"))
    M_DrawThermo(SoundDef.x, SoundDef.y + LINEHEIGHT * 1, 16, sfxVolume)
    M_DrawThermo(SoundDef.x, SoundDef.y + LINEHEIGHT * 3, 16, musicVolume)
}

function M_DrawSaveLoadBorder(x, y) {
    V.V_DrawPatch(x - 8, y + 7, 0, W.W_CacheLumpName("M_LSLEFT"))
    let xx = x
    for (let i = 0; i < 24; i++) {
        V.V_DrawPatch(xx, y + 7, 0, W.W_CacheLumpName("M_LSCNTR"))
        xx += 8
    }
    V.V_DrawPatch(xx, y + 7, 0, W.W_CacheLumpName("M_LSRGHT"))
}

function M_DrawLoad() {
    V.V_DrawPatch(72, 28, 0, W.W_CacheLumpName("M_LOADG"))
    for (let i = 0; i < 6; i++) {
        M_DrawSaveLoadBorder(LoadDef.x, LoadDef.y + LINEHEIGHT * i)
        HU.HU_DrawText(LoadDef.x, LoadDef.y + LINEHEIGHT * i,
            saveSlotNames[i] || "empty slot")
    }
}

function M_DrawSave() {
    V.V_DrawPatch(72, 28, 0, W.W_CacheLumpName("M_SAVEG"))
    for (let i = 0; i < 6; i++) {
        M_DrawSaveLoadBorder(SaveDef.x, SaveDef.y + LINEHEIGHT * i)
        HU.HU_DrawText(SaveDef.x, SaveDef.y + LINEHEIGHT * i,
            saveSlotNames[i] || "empty slot")
    }
    if (saveStringEnter) {
        // typing cursor
        const tw = HU.HU_TextWidth(saveSlotNames[saveSlot])
        HU.HU_DrawText(SaveDef.x + tw, SaveDef.y + LINEHEIGHT * saveSlot, "_")
    }
}

function M_DrawReadThis1() {
    V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName("HELP1"))
}

function M_DrawReadThis2() {
    V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName("HELP2"))
}

function M_Drawer() {
    if (messageToPrint) {
        // centred multi-line message
        const lines = messageString.split("\n")
        let y = 100 - ((lines.length * 8) >> 1)
        for (const line of lines) {
            const x = (_G.DOOM.SCREENWIDTH - HU.HU_TextWidth(line)) >> 1
            HU.HU_DrawText(x, y, line)
            y += 8
        }
        return
    }
    if (!menuactive) return

    if (currentMenu.drawer !== null) currentMenu.drawer()

    // menu items
    const x = currentMenu.x
    let y = currentMenu.y
    for (const item of currentMenu.items) {
        if (item[0] !== "")
            V.V_DrawPatch(x, y, 0, W.W_CacheLumpName(item[0]))
        y += LINEHEIGHT
    }
    // skull cursor
    V.V_DrawPatch(x + SKULLXOFF, currentMenu.y - 5 + itemOn * LINEHEIGHT,
        0, W.W_CacheLumpName(whichSkull ? "M_SKULL2" : "M_SKULL1"))
}

let startTitle = null
let viewSizeChanged = null
let SFX = null

// direct menu openers for the F-key shortcuts
function M_OpenLoad() {
    M_StartControlPanel()
    currentMenu = LoadDef
    itemOn = LoadDef.lastOn
}

function M_OpenSave() {
    if (!G.state.usergame) {
        M_StartMessage("you can't save if you aren't playing!\n\npress a key.", null, false)
        return
    }
    M_StartControlPanel()
    currentMenu = SaveDef
    itemOn = SaveDef.lastOn
}

exports = {
    M_Responder, M_Ticker, M_Drawer, M_StartControlPanel, M_ClearMenus,
    M_StartMessage, M_OpenLoad, M_OpenSave,
    isMenuActive: () => menuactive || messageToPrint,
    getSaveSlotNames: () => saveSlotNames,
    isQuitRequested: () => quitRequested,
    getScreenSize: () => screenSize,
    setScreenSize: (s) => { screenSize = s },
    getFrameskip: () => frameskip,
    setFrameskip: (n) => { frameskip = n | 0 },
    getShowMessages: () => showMessages,
    setShowMessages: (b) => { showMessages = b },
    getSfxVolume: () => sfxVolume,
    getMusicVolume: () => musicVolume,
    setVolumes: (s, m) => { sfxVolume = s; musicVolume = m },
    getDefaultSkill: () => NewDef.lastOn,
    setDefaultSkill: (n) => { NewDef.lastOn = (n < 0 ? 0 : (n > 4 ? 4 : n)) },
    setSaveLoadHooks: (load, save, names) => {
        loadSelectHook = load
        saveSelectHook = save
        if (names !== undefined) saveSlotNames = names
    },
    setStartTitle: (fn) => { startTitle = fn },
    setViewSizeChanged: (fn) => { viewSizeChanged = fn },
    KEY_RIGHTARROW, KEY_LEFTARROW, KEY_UPARROW, KEY_DOWNARROW,
    KEY_ESCAPE, KEY_ENTER, KEY_BACKSPACE, KEY_F1,
    init: function (D) {
        DD = D.defs; G = D.g_game; W = D.w_wad; V = D.v_video
        HU = D.hu_stuff; RM = D.r_main; IV = D.i_video
        S = D.s_sound !== undefined ? D.s_sound
            : { StartSound: () => {}, StopSound: () => {} }
        SFX = D.sounds.sfx
        buildMenus()
    },
}
