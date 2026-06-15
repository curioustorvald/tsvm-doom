# DOOM for TSVM

A faithful port of id Software's **linuxdoom-1.10** to the TSVM virtual machine,
running as a TVDOS application written entirely in JavaScript. The playsim is
tick-exact with vanilla DOOM, so the original DEMO1/2/3 attract demos play back
in sync.

> DOOM source © id Software, released under the GNU GPL v2. This port is a
> derivative work, also GPL-2.0-only. See `COPYING` and `GPL2`.

## Requirements

- TVDOS with `libtaud` (for music playback).
- An IWAD next to `wadplayer.js`:
  - `DOOM.WAD` — the registered game (episodes 1–3), **or**
  - `DOOM-SHAREWARE.WAD` — the shareware game (episode 1).

The full retail `DOOM.WAD` is not distributed; supply your own legally-owned copy.
The shareware IWAD ships with the package.

## Running

The program is `wadplayer.js`; its **first argument is the IWAD filename**. Two
aliases supply it for you:

| Command | Runs |
|---------|------|
| `doom`  | `wadplayer DOOM-SHAREWARE.WAD` (shareware) |
| `doom1` | `wadplayer DOOM.WAD` (registered) |

Everything after that is the same command grammar (shown below via `doom`):

```
doom                       title/demo attract loop; start a game from the menu
doom play [E M [skill]]    start a level directly (skill 1..5, default 3)
doom -warp E M             start episode E, map M at skill 2
doom -file PWAD ...        load a vanilla PWAD over the IWAD
doom -nosound              run with no sound at all
doom -nomusic              run with sound effects but no music
doom demo DEMOn            play a recorded demo lump (DEMO1/DEMO2/DEMO3)
doom timedemo DEMOn        render a demo flat-out and report the frame rate
```

Or invoke any IWAD directly: `wadplayer MYGAME.WAD play 1 1`.

Global flags (`-file`, `-nosound`, `-nomusic`) can be combined with any mode.

### Diagnostic / developer commands

```
doom bench                 WAD-load, blit and upscale timings
doom keys                  print raw keyboard codes (use these in doomrc)
doom title                 draw TITLEPIC until a key is pressed
doom map  [E M]            automap free-camera viewer
doom view [E M]            noclip fly-through (renderer smoke test)
```

## Controls (defaults)

| Action            | Key            |
|-------------------|----------------|
| Move forward/back | ↑ / ↓ (or W/S) |
| Turn left/right   | ← / →          |
| Strafe left/right | A / D          |
| Strafe modifier   | Alt            |
| Run               | Shift          |
| Fire              | Ctrl           |
| Use / open        | Space          |
| Weapons           | 1 … 7          |
| Menu              | Esc            |
| Automap           | Tab            |
| Save / Load       | F2 / F3        |
| Quicksave / load  | F6 / F9        |

All keys are remappable in `doomrc` (see below).

## Configuration — `doomrc`

On start-up the game reads `A:\home\config\doomrc` (the TVDOS
`USERCONFIGPATH`); on a clean exit it is rewritten with the current settings, so
volume and screen-size changes made in the menu persist. It is an INI-style text
file — `#` or `;` start a comment (whole-line or inline).

Key names come from the TVDOS keysym table (run `doom keys` to discover the code
for any physical key); friendly aliases like `CTRL`, `ALT`, `SHIFT`, `ESC` and
bare numeric codes are also accepted.

```ini
[keys]
forward    = UP        ; also bindable: altforward = W
back       = DOWN      ;                altback    = S
turnleft   = LEFT
turnright  = RIGHT
strafeleft = A
straferight= D
fire       = CTRL
use        = SPACE
strafe     = ALT
run        = SHIFT
weapon1    = NUM_1     ; weapon1 .. weapon7

[options]
sfxvolume   = 8        ; 0..15
musicvolume = 8        ; 0..15
screensize  = 10       ; 3..11 (view size; 11 = full screen, no status bar)
frameskip   = 0        ; 0..4  (draw 1 of every N+1 frames on slow hardware)
messages    = on       ; on/off HUD messages
autorun     = off      ; on = always run (invert the Run key)

[game]
skill       = 3        ; 1..5, the default skill on the New Game menu
```

Unknown keys, actions or options are skipped with a warning rather than aborting.

## Sound & music

The port uses two audio playheads: one for music, one for an 8-channel software
SFX mixer. Music ships as a single `{WADNAME}-MUSPACK.lfs` pack next to
`wadplayer.js` (for the shareware IWAD `DOOM-SHAREWARE.WAD`, the pack name is
shortened to `DOOM-MUSPACK.lfs`). The pack is unpacked at startup: a shared
`SOUNDFONT.tsii` sample+instrument bank is loaded once, then each track is
pulled out on demand as an `M_<SONG>.tpif` pattern file using the original MUS
lump names (`M_INTRO`, `M_E1M1`, `M_INTER`, `M_VICTOR`, `M_BUNNY`, …). A missing
pack — or a missing track within it — is skipped silently.

## Save games

Six slots, saved as `doomsav<N>.dsg` next to `wadplayer.js`, in the vanilla savegame
byte layout. Use the in-game **Save**/**Load** menus, or the F2/F3/F6/F9 keys.

## Exit screen (ENDOOM)

When the game quits it shows the WAD's **ENDOOM** lump — the classic 80×25
text-mode sign-off — read from whichever IWAD is loaded (shareware and
registered ship different ones). Press any key to return to the shell. The
CP437 characters render directly against TVDOS's font and the 16 DOS colours
map to the nearest default-palette entries.

## PWADs and map formats

`-file` loads one or more vanilla (Doom-format) PWADs; later lumps override
earlier ones, exactly like vanilla. **UDMF-format maps are not supported** — a
UDMF map (its first lump is `TEXTMAP`, e.g. `myhouse.wad`) is rejected with
`UDMF map format not supported` rather than crashing; the rest of the IWAD still
plays.

## Development

The engine is split into ~37 ES-module-style files loaded by `wadplayer.js` at
runtime through TVDOS `require()`. Engine modules are platform-free (they never
touch `sys`/`graphics`/`files`/`audio`/`con`); only the `i_*.mjs` platform layer
and `wadplayer.js` do. This keeps the engine testable headlessly under Node:

```
node test/run_all.mjs            # run every t_*.mjs suite
REGEN_GOLDENS=1 node test/run_all.mjs   # regenerate render/demo goldens
```

The suites cover fixed-point/RNG/table fidelity, WAD parsing, level loading,
rendering goldens, the playsim, **per-tic demo-sync checksums against vanilla**,
the game shell, sound mixing, save/load round-trips and the `doomrc` config.

Reference C source is vendored in the main TSVM tree under
`reference_materials/doom/linuxdoom-1.10/`.
