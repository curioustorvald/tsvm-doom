// wadplayer.js -- tsvm-doom entry point
//
// A TSVM/TVDOS port of DOOM; derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// The IWAD filename is the FIRST argument; the `doom` / `doom1` aliases supply
// it (DOOM-SHAREWARE.WAD / DOOM.WAD). Usage (shown via the `doom` alias):
//   doom                       title/demo attract loop; play from the menu
//   doom play [E M [skill]]    start a level directly
//   doom -warp E M             start E M at skill 2
//   doom -file pwad.wad ...    load a vanilla PWAD over the IWAD
//   doom [-nomusic] [-nosound] disable music / all sound
//   doom demo DEMOn            play a recorded demo lump (paced)
//   doom timedemo DEMOn        render a demo flat out; report fps
//   doom bench                 platform benchmarks (blit / WAD load) timings
//   doom keys                  echo raw keyboard codes (for doomrc keymap)
// Directly:  wadplayer <IWAD> [command ...]
//
// Config: A:\home\config\doomrc (INI-style; rewritten on exit). See README.

// injectIntChk sink -- keep first of each loop kind throwaway, so the
// shell's SIGTERM rewrite never lands inside the game loop
while (false) {} for (;false;) {} do {} while (false);

con.clear()

const [FB_W, FB_H] = graphics.getPixelDimension()

_G.DOOM = {}
_G.DOOM.SCREENWIDTH = 320
_G.DOOM.SCREENHEIGHT = 200

// Mouse control tuning (TSVM extension -- tweak live via _G.DOOM.MOUSE).
// The screen splits into a centre dead-zone 'a' (free aim, no camera turn) and
// left/right wings 'b' (free aim + camera turn). The weapon and bullets always
// follow the cursor; only the wings steer the view.
//   ENABLE       master on/off switch
//   CENTREWIDTH  fraction of the screen width that is the no-turn zone 'a'
//   MAXTURNSPEED angleturn units at the very screen edge (kbd fast turn = 1280,
//                so >1280 makes the wing edge turn faster than the keyboard)
//   TURNGAMMA    wing ramp exponent: turn = MAXTURNSPEED * t^GAMMA, t in 0..1
//                from the inner edge of 'b' to the screen edge (1.0 = linear)
//   HANDFOLLOW   how far the weapon tracks the cursor (1.0 = exact follow)
_G.DOOM.MOUSE = {
    ENABLE: true,
    CENTREWIDTH: 0.45,
    MAXTURNSPEED: 1800,
    TURNGAMMA: 2.5,
    HANDFOLLOW: 0.707,
}

const DIR = _G.shell.getFileDir()

// ---------------------------------------------------------------------------
// Module loading. TVDOS require() has no cache and nested requires are
// forbidden (each eval re-declares `let exports`), so every module is loaded
// here, sequentially, then wired together through the shared registry D.
// Load order only matters in that it is the init() order.
// ---------------------------------------------------------------------------

const MODULE_NAMES = [
    "defs", "tables", "m_random", "info", "sounds",
    "w_wad", "v_video", "i_video",
    "r_data", "p_setup", "am_map",
    "r_draw", "r_main", "r_plane", "r_bsp", "r_segs", "r_things",
    "g_game", "p_tick", "p_mobj", "p_maputl", "p_map", "p_inter",
    "p_movers", "p_spec", "p_enemy", "p_pspr", "i_input",
    "st_stuff", "hu_stuff", "wi_stuff", "f_finale", "m_menu", "m_config",
    "p_saveg", "i_sound", "s_sound",
]

const D = {}    // shared registry: D.defs, D.tables, ...

for (let i = 0; i < MODULE_NAMES.length; i++) {
    D[MODULE_NAMES[i]] = require(DIR + "\\" + MODULE_NAMES[i] + ".mjs")
}
for (let i = 0; i < MODULE_NAMES.length; i++) {
    D[MODULE_NAMES[i]].init(D)
}

// ---------------------------------------------------------------------------
// Argument parsing (m_argv equivalent)
//
// wadplayer REQUIRES the IWAD filename as the first argument. The `doom` /
// `doom1` aliases supply it (DOOM-SHAREWARE.WAD / DOOM.WAD). Everything after
// the IWAD is the command grammar (play / demo / -warp / flags / ...).
// ---------------------------------------------------------------------------

const rawArgs = []
for (let i = 1; i < exec_args.length; i++) rawArgs.push(exec_args[i])

const IWAD_NAME = rawArgs[0]                 // required IWAD filename
const argv = rawArgs.slice(1)               // the command + its arguments

function checkParm(name) { return argv.indexOf(name) }

// ---------------------------------------------------------------------------
// Platform constants
// ---------------------------------------------------------------------------

const FB_ADDR = -1048577          // GPU framebuffer offset 0 (560x448, mode 0)
const PAL_ADDR = -1310209         // palette entry 0 (2 bytes per entry, RG/BA)
const KEY_ESC = 111

// ---------------------------------------------------------------------------
// bench: measure the platform costs the renderer budget depends on
// ---------------------------------------------------------------------------

function cmdBench() {
    println("tsvm-doom platform bench")

    // -- WAD load: sread -> Uint8Array conversion (chunked charCodeAt) --
    const wadPath = DIR + "\\" + (IWAD_NAME || "DOOM.WAD")
    const fd = files.open(wadPath)
    if (!fd.exists) {
        println(wadPath + " not found; skipping WAD bench")
    } else {
        let t0 = sys.nanoTime()
        const str = fd.sread()
        let t1 = sys.nanoTime()
        const bytes = new Uint8Array(str.length)
        for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
        let t2 = sys.nanoTime()
        println("WAD sread: " + str.length + " bytes in " +
            ((t1 - t0) / 1e6).toFixed(1) + " ms; to Uint8Array in " +
            ((t2 - t1) / 1e6).toFixed(1) + " ms")
        println("  header: " + String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) +
            " lumps=" + (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)))
    }

    // -- blit strategies: 250880 bytes to the framebuffer --
    graphics.setGraphicsMode(0)
    graphics.clearText()
    con.curs_set(0)

    const fb = new Uint8Array(FB_W * FB_H)
    for (let i = 0; i < fb.length; i++) fb[i] = i & 0xFF   // visible test pattern

    const REPS = 100

    let t0 = sys.nanoTime()
    for (let r = 0; r < REPS; r++) {
        sys.pokeBytes(FB_ADDR, fb, fb.length)
    }
    let singleMs = (sys.nanoTime() - t0) / 1e6 / REPS

    t0 = sys.nanoTime()
    for (let r = 0; r < REPS; r++) {
        for (let y = 0; y < FB_H; y++) {
            sys.pokeBytes(FB_ADDR - y * FB_W, fb.subarray(y * FB_W, (y + 1) * FB_W), FB_W)
        }
    }
    let perRowMs = (sys.nanoTime() - t0) / 1e6 / REPS

    // -- upscale LUT cost: 320x200 -> 560x448 nearest-neighbour --
    const src = new Uint8Array(_G.DOOM.SCREENWIDTH * _G.DOOM.SCREENHEIGHT)
    for (let i = 0; i < src.length; i++) src[i] = i & 0xFF
    const xmap = new Uint16Array(FB_W)
    for (let x = 0; x < FB_W; x++) xmap[x] = (x * _G.DOOM.SCREENWIDTH / FB_W) | 0
    const ymap = new Uint16Array(FB_H)
    for (let y = 0; y < FB_H; y++) ymap[y] = (y * _G.DOOM.SCREENHEIGHT / FB_H) | 0
    t0 = sys.nanoTime()
    for (let r = 0; r < REPS; r++) {
        let o = 0
        let prevSy = -1
        for (let y = 0; y < FB_H; y++) {
            const sy = ymap[y]
            if (sy === prevSy) {
                fb.copyWithin(o, o - FB_W, o)
                o += FB_W
            } else {
                const rowBase = sy * _G.DOOM.SCREENWIDTH
                for (let x = 0; x < FB_W; x++) fb[o++] = src[rowBase + xmap[x]]
                prevSy = sy
            }
        }
    }
    let upscaleMs = (sys.nanoTime() - t0) / 1e6 / REPS

    // restore the text screen
    fb.fill(255)
    sys.pokeBytes(FB_ADDR, fb, fb.length)
    con.curs_set(1)

    println("blit single pokeBytes (250880 B): " + singleMs.toFixed(2) + " ms/frame")
    println("blit per-row pokeBytes (448 calls): " + perRowMs.toFixed(2) + " ms/frame")
    println(`upscale ${_G.DOOM.SCREENWIDTH}x${_G.DOOM.SCREENHEIGHT} -> 560x448 (LUT):  ` + upscaleMs.toFixed(2) + " ms/frame")
    println("35 fps budget is 28.6 ms; upscale+best blit must fit alongside the renderer")
    return 0
}

// ---------------------------------------------------------------------------
// keys: echo raw libGDX keycodes for keymap configuration
// ---------------------------------------------------------------------------

function cmdKeys() {
    println("press keys to see their raw codes (up to 8 at once); ESC quits")
    let prev = ""
    let run = true
    while (run) {
        sys.poke(-40, 1)
        const held = []
        for (let a = -41; a >= -48; a--) {
            const k = sys.peek(a)
            if (k === 0) continue
            if (k === KEY_ESC) { run = false }
            held.push(k)
        }
        const cur = held.join(",")
        if (cur !== prev && cur !== "") println("keys: " + cur)
        prev = cur
        sys.sleep(20)
    }
    return 0
}

// ---------------------------------------------------------------------------
// WAD loading (platform side: read files, hand bytes to w_wad)
// ---------------------------------------------------------------------------

function loadWadFile(path) {
    const fd = files.open(path)
    if (!fd.exists) return null
    const str = fd.sread()                       // binary-safe ISO-8859-1
    const bytes = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
    return bytes
}

// ---------------------------------------------------------------------------
// doomrc config file (USERCONFIGPATH\doomrc). Parsing/serialising lives in the
// platform-free m_config; here we just do the disk I/O around it.
// ---------------------------------------------------------------------------

function doomrcPath() {
    let base = "\\home\\config"
    try {
        if (_TVDOS && _TVDOS.variables && _TVDOS.variables.USERCONFIGPATH)
            base = _TVDOS.variables.USERCONFIGPATH
    } catch (e) { /* _TVDOS unavailable: fall back to the default path */ }
    const drive = /^[A-Za-z]:/.test(DIR) ? DIR.slice(0, 2) : "A:"
    return drive + base + "\\doomrc"
}

function loadDoomrc(MC) {
    try {
        const fd = files.open(doomrcPath())
        if (!fd.exists) return            // no config yet: keep defaults
        const cfg = MC.parseConfig(fd.sread())
        MC.applyConfig(cfg)
        for (let i = 0; i < cfg.warnings.length; i++)
            printerr("doomrc: " + cfg.warnings[i])
    } catch (e) {
        printerr("doom: could not read doomrc (" + e.message + ")")
    }
}

function saveDoomrc(MC) {
    try {
        files.open(doomrcPath()).swrite(MC.serializeConfig())
    } catch (e) {
        printerr("doom: could not write doomrc (" + e.message + ")")
    }
}

// ---------------------------------------------------------------------------
// ENDOOM: the 80x25 text screen stored in the WAD, shown after the game quits
// (shareware and registered ship different ones). Each cell is 2 bytes: a
// CP437 character and a DOS attribute (low nibble = fg, bits 4-6 = bg, bit 7 =
// blink). TVDOS's font is CP437-compatible (cf. zfm.js's box-drawing), so the
// characters render directly; the 16 DOS colours map to the nearest entries of
// the default palette (precomputed offline).
// ---------------------------------------------------------------------------

const ENDOOM_PAL = [
    240,  3, 25, 28,160,163,175,250,
    245, 99,116,119,217,219,236,239,
]

// Print the WAD's ENDOOM screen and return immediately (no key wait): the
// shell prompt then appears just below it, DOS-style. The palette is already
// the default by the time we get here (I_ShutdownGraphics restored it), so the
// ENDOOM_PAL default-palette indices render with the right colours.
function showEndoom() {
    try {
        const W = D.w_wad
        const n = W.W_CheckNumForName("ENDOOM")
        if (n < 0) return                        // WAD has no exit screen
        const lump = W.W_CacheLumpNum(n)
        if (lump === undefined || lump.length < 4000) return

        graphics.setGraphicsMode(0)
        graphics.clearPixels(ENDOOM_PAL[0])      // black behind the text plane
        graphics.clearText()
        con.curs_set(0)

        const dim = graphics.getTermDimension()  // [rows, cols]
        const R = Math.min(25, dim[0]), C = Math.min(80, dim[1])
        let lastFg = -1, lastBg = -1
        for (let y = 0; y < R; y++) {
            for (let x = 0; x < C; x++) {
                const off = (y * 80 + x) * 2
                const attr = lump[off + 1]
                const fg = ENDOOM_PAL[attr & 0x0F]
                const bg = ENDOOM_PAL[(attr >> 4) & 0x07]   // blink bit ignored
                if (fg !== lastFg || bg !== lastBg) {
                    con.color_pair(fg, bg)
                    lastFg = fg; lastBg = bg
                }
                con.move(y + 1, x + 1)           // 1-based; addch does not advance
                con.addch(lump[off])
            }
        }
        con.reset_graphics()
        // park the cursor just below the screen so the shell prompt lands there
        if (R < dim[0]) con.move(R + 1, 1)
        con.curs_set(1)
    } catch (e) {
        // ENDOOM is cosmetic: never let it block a clean exit
    }
}

function identifyAndLoadWads() {
    if (IWAD_NAME === undefined) {
        printerr("wadplayer: no IWAD given")
        return false
    }
    // resolve relative to the program first, then as an absolute/cwd path
    const iwadBytes = loadWadFile(DIR + "\\" + IWAD_NAME)
        || loadWadFile(IWAD_NAME)
    if (iwadBytes === null) {
        printerr("wadplayer: IWAD not found: " + IWAD_NAME)
        return false
    }
    D.w_wad.W_AddFile(iwadBytes)
    const fi = checkParm("-file")
    if (fi >= 0 && argv[fi + 1] !== undefined) {
        const pwadBytes = loadWadFile(DIR + "\\" + argv[fi + 1])
            || loadWadFile(argv[fi + 1])
        if (pwadBytes === null) {
            printerr("wadplayer: -file " + argv[fi + 1] + " not found")
            return false
        }
        D.w_wad.W_AddFile(pwadBytes)
    }
    return true
}

// base name of the IWAD without extension (e.g. "DOOM-SHAREWARE"), used for
// music-pack lookups
function iwadBaseName() {
    if (IWAD_NAME.startsWith("DOOM-SHAREWARE")) return "DOOM"
    return (IWAD_NAME || "DOOM").replace(/\.[^.]*$/, "")
}

// identify the IWAD by which maps it ships (vanilla D_IdentifyVersion). Must be
// called AFTER the IWAD is loaded. Getting this right matters: e.g. shareware
// lacks the registered-only switch textures (SW1BLUE), so P_InitSwitchList
// would throw if we assumed `registered`.
function detectGameMode() {
    const W = D.w_wad, GM = D.defs.GameMode
    if (W.W_CheckNumForName("MAP01") >= 0) return GM.commercial
    if (W.W_CheckNumForName("E4M1") >= 0) return GM.retail
    if (W.W_CheckNumForName("E2M1") >= 0) return GM.registered
    if (W.W_CheckNumForName("E1M1") >= 0) return GM.shareware
    return GM.registered                 // unknown IWAD: assume full Doom 1
}

function applyGameMode() {
    const gm = detectGameMode()
    D.g_game.state.gamemode = gm
    D.p_setup.P_SetGameMode(gm)
    return gm
}

// ---------------------------------------------------------------------------
// title: M1 check -- draw TITLEPIC until a key is pressed
// ---------------------------------------------------------------------------

function cmdTitle() {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)
    V.screens[0].fill(0)
    V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName("TITLEPIC"))
    IV.I_FinishUpdate()
    // wait for any key (fresh snapshot each poll)
    let waiting = true
    while (waiting) {
        sys.poke(-40, 1)
        for (let a = -41; a >= -48; a--) if (sys.peek(a) !== 0) waiting = false
        sys.sleep(50)
    }
    IV.I_ShutdownGraphics()
    return 0
}

// ---------------------------------------------------------------------------
// map [E M]: M2 check -- automap free-cam viewer
//   arrows pan, A/Z zoom in/out, T toggles things, ESC quits
// ---------------------------------------------------------------------------

function cmdMap(episode, map) {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    const AM = D.am_map, PS = D.p_setup

    D.r_data.R_InitData()
    applyGameMode()
    try {
        PS.P_SetupLevel(episode, map)
    } catch (e) {
        printerr("doom: " + e.message)
        return 1
    }

    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)

    // camera starts at the player 1 start
    const p1 = PS.level.playerstarts[0]
    let camX = (p1 !== undefined ? p1.x : 0) << 16
    let camY = (p1 !== undefined ? p1.y : 0) << 16
    let camAngle = p1 !== undefined
        ? (0x20000000 * Math.floor(p1.angle / 45)) | 0 : 0

    AM.AM_SetWindow(0, 0, _G.DOOM.SCREENWIDTH, _G.DOOM.SCREENHEIGHT)
    AM.AM_LevelInit(camX, camY)

    const KEY_UP = 19, KEY_DOWN = 20, KEY_LEFT = 21, KEY_RIGHT = 22
    const KEY_A = 29, KEY_Z = 54, KEY_T = 48
    let tPrev = false
    let showThings = true
    let run = true
    while (run) {
        const t0 = sys.nanoTime()
        sys.poke(-40, 1)
        let pdx = 0, pdy = 0, zin = false, zout = false, tNow = false
        for (let a = -41; a >= -48; a--) {
            const k = sys.peek(a)
            if (k === 0) continue
            else if (k === KEY_ESC) run = false
            else if (k === KEY_UP) pdy += 4
            else if (k === KEY_DOWN) pdy -= 4
            else if (k === KEY_LEFT) pdx -= 4
            else if (k === KEY_RIGHT) pdx += 4
            else if (k === KEY_A) zin = true
            else if (k === KEY_Z) zout = true
            else if (k === KEY_T) tNow = true
        }
        if (tNow && !tPrev) { showThings = !showThings; AM.setShowThings(showThings) }
        tPrev = tNow
        if (pdx !== 0 || pdy !== 0) AM.AM_pan(pdx, pdy)
        if (zin) AM.AM_changeWindowScale(true)
        if (zout) AM.AM_changeWindowScale(false)

        AM.AM_DrawFreecam(camX, camY, camAngle)
        IV.I_FinishUpdate()

        // ~35 fps pacing
        const elapsedMs = (sys.nanoTime() - t0) / 1e6
        if (elapsedMs < 24) sys.sleep((28 - elapsedMs) | 0)
    }
    IV.I_ShutdownGraphics()
    return 0
}

// ---------------------------------------------------------------------------
// view [E M]: M3 check -- noclip fly through the level (walls only)
//   up/down move, left/right turn, A/Z fly up/down, ESC quits
// ---------------------------------------------------------------------------

function cmdView(episode, map) {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    const PS = D.p_setup, RM = D.r_main

    D.r_data.R_InitData()
    D.r_draw.bindColormaps()
    D.r_things.R_InitSpriteDefs()
    applyGameMode()
    try {
        PS.P_SetupLevel(episode, map)
    } catch (e) {
        printerr("doom: " + e.message)
        return 1
    }
    RM.R_ExecuteSetViewSize(11)        // full-screen view
    RM.R_InitLightTables()
    RM.R_InitSkyMap()
    RM.setSkytexture(D.r_data.R_TextureNumForName("SKY" + episode))
    D.r_things.debugSpawnStatics()     // show things until the playsim spawns them

    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)

    const p1 = PS.level.playerstarts[0]
    const ss = RM.R_PointInSubsector(p1.x << 16, p1.y << 16)
    const sector = PS.level.ssec_sector[ss]
    const player = {
        mo: {
            x: p1.x << 16,
            y: p1.y << 16,
            angle: (0x20000000 * Math.floor(p1.angle / 45)) | 0,
        },
        viewz: (PS.level.sec_floorheight[sector] + (41 << 16)) | 0,
        extralight: 0,
        fixedcolormap: 0,
    }

    const KEY_UP = 19, KEY_DOWN = 20, KEY_LEFT = 21, KEY_RIGHT = 22
    const KEY_A = 29, KEY_Z = 54
    const MOVE = 8 << 16              // map units per frame
    const TURN = 0x02000000           // ~2.8 degrees per frame
    const fine = D.tables
    let frames = 0
    let t0 = sys.nanoTime()
    let run = true
    while (run) {
        const tf = sys.nanoTime()
        sys.poke(-40, 1)
        for (let a = -41; a >= -48; a--) {
            const k = sys.peek(a)
            if (k === 0) continue
            else if (k === KEY_ESC) run = false
            else if (k === KEY_LEFT) player.mo.angle = (player.mo.angle + TURN) | 0
            else if (k === KEY_RIGHT) player.mo.angle = (player.mo.angle - TURN) | 0
            else if (k === KEY_UP || k === KEY_DOWN) {
                const dir = k === KEY_UP ? 1 : -1
                const af = (player.mo.angle >>> 19) & 8191
                player.mo.x = (player.mo.x + dir * fine.FixedMul(MOVE, fine.finecosine[af])) | 0
                player.mo.y = (player.mo.y + dir * fine.FixedMul(MOVE, fine.finesine[af])) | 0
            }
            else if (k === KEY_A) player.viewz = (player.viewz + (4 << 16)) | 0
            else if (k === KEY_Z) player.viewz = (player.viewz - (4 << 16)) | 0
        }

        V.screens[0].fill(0)           // planes are not drawn until M4
        RM.R_RenderPlayerView(player)
        IV.I_FinishUpdate()
        frames++

        const elapsedMs = (sys.nanoTime() - tf) / 1e6
        if (elapsedMs < 24) sys.sleep((28 - elapsedMs) | 0)
    }
    const totalS = (sys.nanoTime() - t0) / 1e9
    IV.I_ShutdownGraphics()
    println("rendered " + frames + " frames in " + totalS.toFixed(1) +
        " s (" + (frames / totalS).toFixed(1) + " fps incl. input/pacing)")
    return 0
}

// ---------------------------------------------------------------------------
// the game shell (D_DoomMain / D_DoomLoop): attract loop, menus, the works.
//   `doom`                  -> title/demo attract loop, play via the menu
//   `doom play [E M [sk]]`  -> jump straight into a level
// ---------------------------------------------------------------------------

function cmdGame(autostart, episode, map, skill) {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    const G = D.g_game, RM = D.r_main, GS = D.defs.GS
    const ST = D.st_stuff, HU = D.hu_stuff, WI = D.wi_stuff
    const F = D.f_finale, M = D.m_menu, AM = D.am_map, II = D.i_input

    D.r_data.R_InitData()
    D.r_draw.bindColormaps()
    D.r_things.R_InitSpriteDefs()
    applyGameMode()
    RM.R_InitLightTables()
    RM.R_InitSkyMap()
    D.p_spec.P_InitPicAnims()
    D.p_spec.P_InitSwitchList()
    HU.HU_LoadFont()           // load the HU font now: menus can show messages
                               // (Quit prompt, save/load slots) before any level

    // view size: default 10 (view + status bar); menu slider changes it
    RM.R_ExecuteSetViewSize(M.getScreenSize())
    M.setViewSizeChanged(() => { borderNeedsRefresh = true })

    // wire the shell hooks
    const player0 = () => G.state.players[G.state.consoleplayer]
    G.setShellHooks({
        amStop: AM.AM_Stop,
        wiStart: WI.WI_Start,
        wiTicker: WI.WI_Ticker,
        fStartFinale: F.F_StartFinale,
        fTicker: F.F_Ticker,
        stTicker: ST.ST_Ticker,
        huTicker: HU.HU_Ticker,
    })
    D.p_mobj.setStStart(() => ST.ST_Start(player0()))
    D.p_mobj.setHuStart(() => HU.HU_Start(player0()))
    M.setStartTitle(D_StartTitle)

    // ---- savegame disk I/O (i_system side of p_saveg) ----
    let quickSaveSlot = -1

    function savePath(slot) { return DIR + "\\doomsav" + slot + ".dsg" }

    function bytesToLatin1(bytes) {
        let s = ""
        const CH = 8192
        for (let i = 0; i < bytes.length; i += CH) {
            s += String.fromCharCode.apply(null,
                bytes.subarray(i, Math.min(i + CH, bytes.length)))
        }
        return s
    }

    function doSaveGame(slot, desc) {
        try {
            const bytes = D.p_saveg.P_SaveGameToBuffer(desc)
            files.open(savePath(slot)).swrite(bytesToLatin1(bytes))
            player0().message = "game saved."
            quickSaveSlot = slot
        } catch (e) {
            player0().message = "save failed: " + e.message
            printerr("doom: save to " + savePath(slot) + " failed: " + e.message)
        }
    }

    function doLoadGame(slot) {
        const fd = files.open(savePath(slot))
        if (!fd.exists) {
            player0().message = "no such savegame"
            return
        }
        const bytes = loadWadFile(savePath(slot))
        try {
            D.p_saveg.P_LoadGameFromBuffer(bytes)
            quickSaveSlot = slot
        } catch (e) {
            player0().message = "load failed: " + e.message
        }
    }

    // populate menu slot names from existing save files
    const slotNames = ["", "", "", "", "", ""]
    for (let i = 0; i < 6; i++) {
        const fd = files.open(savePath(i))
        if (fd.exists) {
            const head = loadWadFile(savePath(i))
            const desc = D.p_saveg.P_ReadSaveDescription(head)
            if (desc !== null) slotNames[i] = desc
        }
    }
    M.setSaveLoadHooks(
        (slot) => G.G_LoadGame(slot),
        (slot, name) => G.G_SaveGame(slot, name),
        slotNames)
    G.setShellHooks({ doSaveGame, doLoadGame })

    // ---- doomrc config (keymap + options), loaded before audio so the
    // saved volumes take effect; rewritten on a clean exit ----
    const MC = D.m_config
    loadDoomrc(MC)

    // ---- audio (skippable with -nosound / -nomusic) ----
    const S = D.s_sound, IS = D.i_sound
    const wantSound = checkParm("-nosound") < 0
    const wantMusic = checkParm("-nomusic") < 0
    if (wantSound) {
        IS.I_InitSound()
        S.S_SetSfxVolume(M.getSfxVolume())
        if (wantMusic) {
            try {
                const taudMod = require("taud")
                const lfsMod = require("lfs")
                IS.I_InitMusic(taudMod, lfsMod, DIR, iwadBaseName())
                S.S_SetMusicVolume(M.getMusicVolume())
            } catch (e) {
                printerr("doom: music disabled (" + e.message + ")")
            }
        }
        G.setShellHooks({ sStart: S.S_Start })
    }

    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)

    // ---- attract sequence (d_main.c D_AdvanceDemo) ----
    let demosequence = -1
    let pagetic = 0
    let pagename = "TITLEPIC"
    let advancedemo = false

    function D_StartTitle() {
        G.state.usergame = false
        demosequence = -1
        advancedemo = true
    }

    function D_AdvanceDemo() {
        advancedemo = false
        demosequence = (demosequence + 1) % 6
        switch (demosequence) {
            case 0:
                pagetic = 170
                G.state.gamestate = GS.DEMOSCREEN
                pagename = "TITLEPIC"
                if (wantSound)
                    S.ChangeMusic(D.sounds.mus.mus_intro, false)
                break
            case 1: startDemo("DEMO1"); break
            case 2:
                pagetic = 200
                G.state.gamestate = GS.DEMOSCREEN
                pagename = "CREDIT"
                break
            case 3: startDemo("DEMO2"); break
            case 4:
                pagetic = 170
                G.state.gamestate = GS.DEMOSCREEN
                pagename = "TITLEPIC"
                break
            case 5: startDemo("DEMO3"); break
        }
    }

    function startDemo(name) {
        try {
            G.G_DoPlayDemo(name)
            G.state.gamestate = GS.LEVEL
        } catch (e) {
            // unplayable demo: fall back to the title page
            pagetic = 170
            G.state.gamestate = GS.DEMOSCREEN
            pagename = "TITLEPIC"
        }
    }

    function D_PageTicker() {
        if (--pagetic < 0) advancedemo = true
    }

    // ---- responder chain ----
    const KEY_F2 = 0x80 + 0x3c, KEY_F3 = 0x80 + 0x3d
    const KEY_F6 = 0x80 + 0x40, KEY_F9 = 0x80 + 0x43

    function G_Responder(ev) {
        const st = G.state
        if (ev.type === D.defs.Ev.keydown) {
            switch (ev.data1) {
                case KEY_F2:        // save menu
                    M.M_OpenSave()
                    return true
                case KEY_F3:        // load menu
                    M.M_OpenLoad()
                    return true
                case KEY_F6:        // quicksave
                    if (st.usergame && quickSaveSlot >= 0) {
                        G.G_SaveGame(quickSaveSlot,
                            M.getSaveSlotNames()[quickSaveSlot] || "quicksave")
                        return true
                    }
                    M.M_OpenSave()
                    return true
                case KEY_F9:        // quickload
                    if (quickSaveSlot >= 0) {
                        G.G_LoadGame(quickSaveSlot)
                        return true
                    }
                    M.M_OpenLoad()
                    return true
            }
        }
        if (st.gamestate === GS.LEVEL && st.usergame) {
            if (ST.ST_Responder(ev)) return true
            if (AM.AM_Responder(ev)) return true
        }
        if (st.gamestate === GS.DEMOSCREEN || st.demoplayback) {
            // any key on title/demo pulls up the menu
            if (ev.type === D.defs.Ev.keydown) {
                M.M_StartControlPanel()
                return true
            }
        }
        return false
    }

    // ---- drawing (D_Display) ----
    let borderNeedsRefresh = true
    let borderFlat = null

    function drawViewBorder() {
        // simple flat-tiled border around a shrunken view
        if (borderFlat === null)
            borderFlat = W.W_CacheLumpName("FLOOR7_2")
        const screen = V.screens[0]
        const vw = RM.getViewwidth(), vh = RM.getViewheight()
        const wx = D.r_draw.getViewwindowx(), wy = D.r_draw.getViewwindowy()
        for (let y = 0; y < _G.DOOM.SCREENHEIGHT - 32; y++) {
            const inViewY = y >= wy && y < wy + vh
            const fy = (y & 63) << 6
            for (let x = 0; x < _G.DOOM.SCREENWIDTH; x++) {
                if (inViewY && x >= wx && x < wx + vw) { x = wx + vw - 1; continue }
                screen[y * _G.DOOM.SCREENWIDTH + x] = borderFlat[fy + (x & 63)]
            }
        }
    }

    let wipegamestate = GS.DEMOSCREEN

    function D_Drawer() {
        const st = G.state
        switch (st.gamestate) {
            case GS.LEVEL:
                if (st.automapactive) {
                    AM.AM_Drawer()
                } else {
                    if (RM.getViewheight() !== 200 && borderNeedsRefresh) {
                        drawViewBorder()
                        borderNeedsRefresh = false
                    } else if (RM.getViewheight() !== 200) {
                        drawViewBorder()
                    }
                    RM.R_RenderPlayerView(player0())
                }
                if (RM.getViewheight() !== 200 || st.automapactive)
                    ST.ST_Drawer()
                HU.HU_Drawer()
                break
            case GS.INTERMISSION: WI.WI_Drawer(); break
            case GS.FINALE: F.F_Drawer(); break
            case GS.DEMOSCREEN:
                V.screens[0].fill(0)
                V.V_DrawPatch(0, 0, 0, W.W_CacheLumpName(pagename))
                break
        }
        M.M_Drawer()
    }

    // ---- boot into title or a direct level ----
    if (autostart) {
        G.G_InitNew(skill, episode, map)
    } else {
        D_StartTitle()
        D_AdvanceDemo()
    }

    // ---- main loop ----
    const TICNS = 1e9 / 35
    let nextTic = sys.nanoTime() + TICNS
    let running = true
    let wiping = false
    let frameCounter = 0

    try {
    while (running) {
        let tics = 0
        while (sys.nanoTime() >= nextTic && tics < 4) {
            II.I_PollKeys()

            // events through the responder chain
            let ev
            while ((ev = II.I_NextEvent()) !== null) {
                if (M.M_Responder(ev)) continue
                G_Responder(ev)
            }
            if (M.isQuitRequested()) { running = false; break }

            M.M_Ticker()

            if (!wiping) {
                const prevGamestate = G.state.gamestate
                if (G.state.gamestate === GS.DEMOSCREEN) {
                    D_PageTicker()
                } else {
                    G.G_Ticker(() => {
                        if (!G.state.demoplayback && G.state.usergame)
                            G.G_BuildTiccmd(player0().cmd)
                    })
                    // demo over: advance the attract sequence
                    if (G.state.demoplayback && G.G_DemoEnded()) {
                        G.state.demoplayback = false
                        advancedemo = true
                    }
                }
                if (advancedemo) D_AdvanceDemo()

                // gamestate change triggers the melt wipe
                if (G.state.gamestate !== wipegamestate) {
                    V.WipeStart()               // previous frame is "from"
                    D_Drawer()                  // fresh frame is "to"
                    V.WipeEndCapture()
                    V.WipeInitMelt()
                    wiping = true
                    wipegamestate = G.state.gamestate
                }
            } else {
                if (V.WipeDoMelt(1)) wiping = false
            }

            nextTic += TICNS
            tics++
        }

        // frameskip: skip the draw + blit on N of every (N+1) frames, but
        // never during the melt wipe (it must animate every frame)
        const fskip = M.getFrameskip()
        const drawThisFrame = wiping || fskip === 0 ||
            (frameCounter % (fskip + 1)) === 0
        frameCounter++
        if (drawThisFrame) {
            if (!wiping) {
                D_Drawer()
                if (G.state.gamestate === GS.LEVEL && G.state.usergame)
                    ST.ST_doPaletteStuff()
                else
                    IV.I_SetPalette(0)
            }
            IV.I_FinishUpdate()
        }

        // audio pump: positional updates + keep the PCM queue fed
        if (wantSound) {
            S.S_UpdateSounds()
            IS.I_UpdateSound()
        }

        const slackMs = (nextTic - sys.nanoTime()) / 1e6
        if (slackMs > 6) sys.sleep((slackMs - 4) | 0)
    }
    } finally {
        // guarantee teardown even if the loop throws, so the shell is handed
        // back a usable text console (and option changes are still saved)
        if (wantSound) IS.I_ShutdownSound()
        IV.I_ShutdownGraphics()
        saveDoomrc(MC)              // persist volume/keymap/option changes
    }
    showEndoom()                   // the WAD's exit screen, dismissed by a key
    graphics.resetPalette()
    return 0
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// demo [DEMOn]: M6 check -- play a recorded demo lump with the full playsim
// ---------------------------------------------------------------------------

function cmdDemo(lumpname) {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    const G = D.g_game, RM = D.r_main

    D.r_data.R_InitData()
    D.r_draw.bindColormaps()
    D.r_things.R_InitSpriteDefs()
    applyGameMode()
    RM.R_ExecuteSetViewSize(11)
    RM.R_InitLightTables()
    RM.R_InitSkyMap()
    D.p_spec.P_InitPicAnims()
    D.p_spec.P_InitSwitchList()

    try {
        G.G_DoPlayDemo(lumpname)
    } catch (e) {
        printerr("doom: " + e.message)
        return 1
    }

    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)

    const player = G.state.players[G.state.consoleplayer]
    const TICNS = 1e9 / 35
    let nextTic = sys.nanoTime() + TICNS
    let running = true
    while (running) {
        let tics = 0
        while (sys.nanoTime() >= nextTic && tics < 4) {
            sys.poke(-40, 1)
            for (let a = -41; a >= -48; a--)
                if (sys.peek(a) === KEY_ESC) running = false
            if (!G.G_DemoTic()) running = false
            nextTic += TICNS
            tics++
            if (!running) break
        }
        RM.R_RenderPlayerView(player)
        IV.I_FinishUpdate()
        const slackMs = (nextTic - sys.nanoTime()) / 1e6
        if (slackMs > 6) sys.sleep((slackMs - 4) | 0)
    }
    IV.I_ShutdownGraphics()
    println("demo ended at tic " + G.state.leveltime +
        ", kills " + player.killcount + "/" + G.state.totalkills +
        ", health " + player.health)
    return 0
}

// ---------------------------------------------------------------------------
// timedemo [DEMOn]: render a demo as fast as possible (no 35 Hz pacing) and
// report the achieved frame rate -- the vanilla -timedemo benchmark.
// ---------------------------------------------------------------------------

function cmdTimedemo(lumpname) {
    if (!identifyAndLoadWads()) return 1
    const IV = D.i_video, V = D.v_video, W = D.w_wad
    const G = D.g_game, RM = D.r_main

    D.r_data.R_InitData()
    D.r_draw.bindColormaps()
    D.r_things.R_InitSpriteDefs()
    applyGameMode()
    RM.R_ExecuteSetViewSize(11)
    RM.R_InitLightTables()
    RM.R_InitSkyMap()
    D.p_spec.P_InitPicAnims()
    D.p_spec.P_InitSwitchList()

    try {
        G.G_DoPlayDemo(lumpname)
    } catch (e) {
        printerr("doom: " + e.message)
        return 1
    }

    IV.I_InitGraphics()
    IV.I_RegisterPlaypal(W.W_CacheLumpName("PLAYPAL"))
    IV.I_SetPalette(0)

    const player = G.state.players[G.state.consoleplayer]
    let frames = 0
    let running = true
    const t0 = sys.nanoTime()
    while (running) {
        sys.poke(-40, 1)
        for (let a = -41; a >= -48; a--)
            if (sys.peek(a) === KEY_ESC) running = false
        if (!G.G_DemoTic()) running = false
        RM.R_RenderPlayerView(player)
        IV.I_FinishUpdate()
        frames++
    }
    const totalS = (sys.nanoTime() - t0) / 1e9
    IV.I_ShutdownGraphics()
    // vanilla phrasing: "timed N gametics in M realtics"; M is in 35 Hz units
    const realtics = Math.round(totalS * 35)
    println("timed " + frames + " gametics in " + realtics + " realtics")
    println((frames / totalS).toFixed(1) + " fps (" +
        (totalS * 1000 / Math.max(frames, 1)).toFixed(2) + " ms/frame)")
    return 0
}

if (IWAD_NAME === undefined) {
    println("wadplayer -- run a DOOM IWAD on TSVM")
    println("usage: wadplayer <IWAD> [play E M [skill]] [-warp E M] [demo DEMOn]")
    println("                        [-file PWAD] [-nosound] [-nomusic]")
    println("                        [timedemo DEMOn] [bench] [keys] [title]")
    println("                        [map E M] [view E M]")
    println("  e.g.  wadplayer DOOM.WAD            (or use the `doom` / `doom1` aliases)")
    return 1
}

if (argv[0] === undefined || argv[0] === "-warp") {
    if (argv[0] === "-warp") {
        const ep = argv[1] !== undefined ? parseInt(argv[1], 10) : 1
        const mp = argv[2] !== undefined ? parseInt(argv[2], 10) : 1
        return cmdGame(true, ep, mp, 2)
    }
    return cmdGame(false, 1, 1, 2)
}
if (argv[0] === "play") {
    const ep = argv[1] !== undefined ? parseInt(argv[1], 10) : 1
    const mp = argv[2] !== undefined ? parseInt(argv[2], 10) : 1
    const sk = argv[3] !== undefined ? parseInt(argv[3], 10) : 2
    return cmdGame(true, ep, mp, sk)
}
if (argv[0] === "demo") {
    return cmdDemo(argv[1] !== undefined ? argv[1] : "DEMO1")
}
if (argv[0] === "timedemo" || argv[0] === "-timedemo") {
    return cmdTimedemo(argv[1] !== undefined ? argv[1] : "DEMO1")
}
if (argv[0] === "bench") return cmdBench()
if (argv[0] === "keys") return cmdKeys()
if (argv[0] === "title") return cmdTitle()
if (argv[0] === "view") {
    const ep = argv[1] !== undefined ? parseInt(argv[1], 10) : 1
    const mp = argv[2] !== undefined ? parseInt(argv[2], 10) : 1
    return cmdView(ep, mp)
}
if (argv[0] === "map") {
    const ep = argv[1] !== undefined ? parseInt(argv[1], 10) : 1
    const mp = argv[2] !== undefined ? parseInt(argv[2], 10) : 1
    return cmdMap(ep, mp)
}

println("usage: wadplayer <IWAD> [play E M [skill]] [-warp E M] [demo DEMOn]")
println("                        [-file PWAD] [-nosound] [-nomusic] [timedemo DEMOn]")
println("       debug: bench, keys, title, map [E M], view [E M]")
con.reset_graphics()
graphics.resetPalette()
return 0
