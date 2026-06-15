// p_setup.mjs -- level loading (p_setup.c)
//
// Part of tsvm-doom, a derivative of linuxdoom-1.10 (C) id Software.
// Licensed under GPL-2.0-only; see COPYING.
//
// Structure-of-arrays layout: numeric struct fields become one typed array
// per field, indexed by entity number; cross-references are indices (-1 for
// NULL). Object-valued fields (thinglist, specialdata, ...) live in plain
// JS arrays alongside. This matches the demo-deterministic index discipline
// and keeps the render-hot data flat.

// injectIntChk sink -- keep first of each loop kind throwaway
while (false) {} for (;false;) {} do {} while (false);

let DD = null, T = null, W = null, R = null     // defs, tables, w_wad, r_data

// map lump order after the marker (doomdata.h ML_*)
const ML_THINGS = 1, ML_LINEDEFS = 2, ML_SIDEDEFS = 3, ML_VERTEXES = 4,
    ML_SEGS = 5, ML_SSECTORS = 6, ML_NODES = 7, ML_SECTORS = 8,
    ML_REJECT = 9, ML_BLOCKMAP = 10

// ---- level data (exported via getters; rebuilt per level) ----
let numvertexes = 0
let vertex_x = null, vertex_y = null

let numsegs = 0
let seg_v1 = null, seg_v2 = null, seg_angle = null, seg_offset = null
let seg_linedef = null, seg_sidedef = null
let seg_frontsector = null, seg_backsector = null

let numsectors = 0
let sec_floorheight = null, sec_ceilingheight = null
let sec_floorpic = null, sec_ceilingpic = null
let sec_lightlevel = null, sec_special = null, sec_tag = null
let sec_soundtraversed = null, sec_validcount = null, sec_linecount = null
let sec_rvalidcount = null      // renderer-only marks (sprite dedup): the
                                // playsim's sec_validcount must never be
                                // touched by rendering or demos desync
let sec_blockbox = null                  // 4*numsectors
let sec_soundorgx = null, sec_soundorgy = null
let sec_thinglist = null                 // JS: mobj | null
let sec_specialdata = null               // JS: thinker | null
let sec_soundtarget = null               // JS: mobj | null
let sec_lines = null                     // JS: Int32Array of line indices

let numsides = 0
let side_textureoffset = null, side_rowoffset = null
let side_toptexture = null, side_bottomtexture = null, side_midtexture = null
let side_sector = null

let numlines = 0
let line_v1 = null, line_v2 = null, line_dx = null, line_dy = null
let line_flags = null, line_special = null, line_tag = null
let line_sidenum0 = null, line_sidenum1 = null
let line_frontsector = null, line_backsector = null
let line_slopetype = null, line_validcount = null
let line_bbox = null                     // 4*numlines
let line_specialdata = null              // JS: thinker | null

let numsubsectors = 0
let ssec_numlines = null, ssec_firstline = null, ssec_sector = null

let numnodes = 0
let node_x = null, node_y = null, node_dx = null, node_dy = null
let node_bbox = null                     // 2*4*numnodes
let node_children = null                 // 2*numnodes, NF_SUBSECTOR flagged

let blockmaplump = null                  // Int16Array (signed-converted)
let bmaporgx = 0, bmaporgy = 0, bmapwidth = 0, bmapheight = 0
let blocklinks = null                    // JS: mobj | null per block

let rejectmatrix = null                  // Uint8Array view

let things = []                          // raw mapthing records
let playerstarts = []                    // mapthing per player (0-based)
let deathmatchstarts = []

// hook installed by p_mobj (M5): function(mapthing). Until then, the
// default records starts only.
let spawnMapThing = null

function P_LoadVertexes(lump) {
    const data = W.W_CacheLumpNum(lump)
    numvertexes = (W.W_LumpLength(lump) / 4) | 0
    vertex_x = new Int32Array(numvertexes)
    vertex_y = new Int32Array(numvertexes)
    for (let i = 0; i < numvertexes; i++) {
        vertex_x[i] = W.lumpI16(data, i * 4) << 16
        vertex_y[i] = W.lumpI16(data, i * 4 + 2) << 16
    }
}

function P_LoadSectors(lump) {
    const data = W.W_CacheLumpNum(lump)
    numsectors = (W.W_LumpLength(lump) / 26) | 0
    sec_floorheight = new Int32Array(numsectors)
    sec_ceilingheight = new Int32Array(numsectors)
    sec_floorpic = new Int32Array(numsectors)
    sec_ceilingpic = new Int32Array(numsectors)
    sec_lightlevel = new Int32Array(numsectors)
    sec_special = new Int32Array(numsectors)
    sec_tag = new Int32Array(numsectors)
    sec_soundtraversed = new Int32Array(numsectors)
    sec_validcount = new Int32Array(numsectors)
    sec_rvalidcount = new Int32Array(numsectors)
    sec_linecount = new Int32Array(numsectors)
    sec_blockbox = new Int32Array(4 * numsectors)
    sec_soundorgx = new Int32Array(numsectors)
    sec_soundorgy = new Int32Array(numsectors)
    sec_thinglist = new Array(numsectors).fill(null)
    sec_specialdata = new Array(numsectors).fill(null)
    sec_soundtarget = new Array(numsectors).fill(null)
    sec_lines = new Array(numsectors).fill(null)
    for (let i = 0; i < numsectors; i++) {
        const o = i * 26
        sec_floorheight[i] = W.lumpI16(data, o) << 16
        sec_ceilingheight[i] = W.lumpI16(data, o + 2) << 16
        sec_floorpic[i] = R.R_FlatNumForName(lumpStr8(data, o + 4))
        sec_ceilingpic[i] = R.R_FlatNumForName(lumpStr8(data, o + 12))
        sec_lightlevel[i] = W.lumpI16(data, o + 20)
        sec_special[i] = W.lumpI16(data, o + 22)
        sec_tag[i] = W.lumpI16(data, o + 24)
    }
}

function lumpStr8(data, ofs) {
    let s = ""
    for (let j = 0; j < 8; j++) {
        const c = data[ofs + j]
        if (c === 0) break
        s += String.fromCharCode(c)
    }
    return s
}

function P_LoadSideDefs(lump) {
    const data = W.W_CacheLumpNum(lump)
    numsides = (W.W_LumpLength(lump) / 30) | 0
    side_textureoffset = new Int32Array(numsides)
    side_rowoffset = new Int32Array(numsides)
    side_toptexture = new Int32Array(numsides)
    side_bottomtexture = new Int32Array(numsides)
    side_midtexture = new Int32Array(numsides)
    side_sector = new Int32Array(numsides)
    for (let i = 0; i < numsides; i++) {
        const o = i * 30
        side_textureoffset[i] = W.lumpI16(data, o) << 16
        side_rowoffset[i] = W.lumpI16(data, o + 2) << 16
        side_toptexture[i] = R.R_TextureNumForName(lumpStr8(data, o + 4))
        side_bottomtexture[i] = R.R_TextureNumForName(lumpStr8(data, o + 12))
        side_midtexture[i] = R.R_TextureNumForName(lumpStr8(data, o + 20))
        side_sector[i] = W.lumpI16(data, o + 28)
    }
}

function P_LoadLineDefs(lump) {
    const data = W.W_CacheLumpNum(lump)
    numlines = (W.W_LumpLength(lump) / 14) | 0
    line_v1 = new Int32Array(numlines)
    line_v2 = new Int32Array(numlines)
    line_dx = new Int32Array(numlines)
    line_dy = new Int32Array(numlines)
    line_flags = new Int32Array(numlines)
    line_special = new Int32Array(numlines)
    line_tag = new Int32Array(numlines)
    line_sidenum0 = new Int32Array(numlines)
    line_sidenum1 = new Int32Array(numlines)
    line_frontsector = new Int32Array(numlines)
    line_backsector = new Int32Array(numlines)
    line_slopetype = new Int32Array(numlines)
    line_validcount = new Int32Array(numlines)
    line_bbox = new Int32Array(4 * numlines)
    line_specialdata = new Array(numlines).fill(null)
    const ST = DD.SlopeType
    const BOXTOP = DD.BOXTOP, BOXBOTTOM = DD.BOXBOTTOM
    const BOXLEFT = DD.BOXLEFT, BOXRIGHT = DD.BOXRIGHT
    for (let i = 0; i < numlines; i++) {
        const o = i * 14
        line_flags[i] = W.lumpI16(data, o + 4)
        line_special[i] = W.lumpI16(data, o + 6)
        line_tag[i] = W.lumpI16(data, o + 8)
        const v1 = W.lumpU16(data, o)
        const v2 = W.lumpU16(data, o + 2)
        line_v1[i] = v1
        line_v2[i] = v2
        const dx = (vertex_x[v2] - vertex_x[v1]) | 0
        const dy = (vertex_y[v2] - vertex_y[v1]) | 0
        line_dx[i] = dx
        line_dy[i] = dy
        if (dx === 0) line_slopetype[i] = ST.vertical
        else if (dy === 0) line_slopetype[i] = ST.horizontal
        else line_slopetype[i] =
            T.FixedDiv(dy, dx) > 0 ? ST.positive : ST.negative
        const b = i * 4
        if (vertex_x[v1] < vertex_x[v2]) {
            line_bbox[b + BOXLEFT] = vertex_x[v1]
            line_bbox[b + BOXRIGHT] = vertex_x[v2]
        } else {
            line_bbox[b + BOXLEFT] = vertex_x[v2]
            line_bbox[b + BOXRIGHT] = vertex_x[v1]
        }
        if (vertex_y[v1] < vertex_y[v2]) {
            line_bbox[b + BOXBOTTOM] = vertex_y[v1]
            line_bbox[b + BOXTOP] = vertex_y[v2]
        } else {
            line_bbox[b + BOXBOTTOM] = vertex_y[v2]
            line_bbox[b + BOXTOP] = vertex_y[v1]
        }
        const s0 = W.lumpI16(data, o + 10)
        const s1 = W.lumpI16(data, o + 12)
        line_sidenum0[i] = s0
        line_sidenum1[i] = s1
        line_frontsector[i] = s0 !== -1 ? side_sector[s0] : -1
        line_backsector[i] = s1 !== -1 ? side_sector[s1] : -1
    }
}

function P_LoadSubsectors(lump) {
    const data = W.W_CacheLumpNum(lump)
    numsubsectors = (W.W_LumpLength(lump) / 4) | 0
    ssec_numlines = new Int32Array(numsubsectors)
    ssec_firstline = new Int32Array(numsubsectors)
    ssec_sector = new Int32Array(numsubsectors)
    for (let i = 0; i < numsubsectors; i++) {
        ssec_numlines[i] = W.lumpI16(data, i * 4)
        ssec_firstline[i] = W.lumpI16(data, i * 4 + 2)
    }
}

function P_LoadNodes(lump) {
    const data = W.W_CacheLumpNum(lump)
    numnodes = (W.W_LumpLength(lump) / 28) | 0
    node_x = new Int32Array(numnodes)
    node_y = new Int32Array(numnodes)
    node_dx = new Int32Array(numnodes)
    node_dy = new Int32Array(numnodes)
    node_bbox = new Int32Array(8 * numnodes)
    node_children = new Int32Array(2 * numnodes)
    for (let i = 0; i < numnodes; i++) {
        const o = i * 28
        node_x[i] = W.lumpI16(data, o) << 16
        node_y[i] = W.lumpI16(data, o + 2) << 16
        node_dx[i] = W.lumpI16(data, o + 4) << 16
        node_dy[i] = W.lumpI16(data, o + 6) << 16
        for (let j = 0; j < 2; j++) {
            node_children[i * 2 + j] = W.lumpU16(data, o + 24 + 2 * j)
            for (let k = 0; k < 4; k++)
                node_bbox[i * 8 + j * 4 + k] =
                    W.lumpI16(data, o + 8 + 8 * j + 2 * k) << 16
        }
    }
}

function P_LoadSegs(lump) {
    const data = W.W_CacheLumpNum(lump)
    numsegs = (W.W_LumpLength(lump) / 12) | 0
    seg_v1 = new Int32Array(numsegs)
    seg_v2 = new Int32Array(numsegs)
    seg_angle = new Int32Array(numsegs)
    seg_offset = new Int32Array(numsegs)
    seg_linedef = new Int32Array(numsegs)
    seg_sidedef = new Int32Array(numsegs)
    seg_frontsector = new Int32Array(numsegs)
    seg_backsector = new Int32Array(numsegs)
    const ML_TWOSIDED = DD.ML.TWOSIDED
    for (let i = 0; i < numsegs; i++) {
        const o = i * 12
        seg_v1[i] = W.lumpU16(data, o)
        seg_v2[i] = W.lumpU16(data, o + 2)
        seg_angle[i] = W.lumpI16(data, o + 4) << 16
        const ldef = W.lumpU16(data, o + 6)
        seg_offset[i] = W.lumpI16(data, o + 10) << 16
        seg_linedef[i] = ldef
        const side = W.lumpI16(data, o + 8)
        const sidenum = side === 0 ? line_sidenum0[ldef] : line_sidenum1[ldef]
        seg_sidedef[i] = sidenum
        seg_frontsector[i] = side_sector[sidenum]
        if (line_flags[ldef] & ML_TWOSIDED) {
            const back = side === 0 ? line_sidenum1[ldef] : line_sidenum0[ldef]
            seg_backsector[i] = back !== -1 ? side_sector[back] : -1
        } else {
            seg_backsector[i] = -1
        }
    }
}

function P_LoadBlockMap(lump) {
    const data = W.W_CacheLumpNum(lump)
    const count = (W.W_LumpLength(lump) / 2) | 0
    blockmaplump = new Int16Array(count)
    for (let i = 0; i < count; i++)
        blockmaplump[i] = W.lumpI16(data, i * 2)
    bmaporgx = blockmaplump[0] << 16
    bmaporgy = blockmaplump[1] << 16
    bmapwidth = blockmaplump[2]
    bmapheight = blockmaplump[3]
    blocklinks = new Array(bmapwidth * bmapheight).fill(null)
}

function P_LoadThings(lump) {
    const data = W.W_CacheLumpNum(lump)
    const numthings = (W.W_LumpLength(lump) / 10) | 0
    things = []
    for (let i = 0; i < numthings; i++) {
        const o = i * 10
        const mt = {
            x: W.lumpI16(data, o),
            y: W.lumpI16(data, o + 2),
            angle: W.lumpI16(data, o + 4),
            type: W.lumpI16(data, o + 6),
            options: W.lumpI16(data, o + 8),
        }
        things.push(mt)
        // vanilla: non-commercial IWADs BREAK the whole loop on the first
        // DOOM2-only thing (not skip) -- preserved bug-for-bug
        if (gamemode !== DD.GameMode.commercial) {
            const t = mt.type
            if (t === 68 || t === 64 || t === 88 || t === 89 || t === 69 ||
                t === 67 || t === 71 || t === 65 || t === 66 || t === 84)
                break
        }
        if (spawnMapThing !== null) spawnMapThing(mt)
        else if (mt.type >= 1 && mt.type <= 4)
            playerstarts[mt.type - 1] = mt
    }
}

function P_GroupLines() {
    // subsector sector numbers
    for (let i = 0; i < numsubsectors; i++)
        ssec_sector[i] = seg_frontsector[ssec_firstline[i]]

    // per-sector line counts
    for (let i = 0; i < numlines; i++) {
        sec_linecount[line_frontsector[i]]++
        if (line_backsector[i] !== -1 &&
            line_backsector[i] !== line_frontsector[i])
            sec_linecount[line_backsector[i]]++
    }

    const bbox = new Int32Array(4)
    const BOXTOP = DD.BOXTOP, BOXBOTTOM = DD.BOXBOTTOM
    const BOXLEFT = DD.BOXLEFT, BOXRIGHT = DD.BOXRIGHT
    for (let i = 0; i < numsectors; i++) {
        DD.M_ClearBox(bbox)
        const list = new Int32Array(sec_linecount[i])
        let n = 0
        for (let j = 0; j < numlines; j++) {
            if (line_frontsector[j] === i || line_backsector[j] === i) {
                list[n++] = j
                DD.M_AddToBox(bbox, vertex_x[line_v1[j]], vertex_y[line_v1[j]])
                DD.M_AddToBox(bbox, vertex_x[line_v2[j]], vertex_y[line_v2[j]])
            }
        }
        if (n !== sec_linecount[i]) throw Error("P_GroupLines: miscounted")
        sec_lines[i] = list

        sec_soundorgx[i] = ((bbox[BOXRIGHT] + bbox[BOXLEFT]) / 2) | 0
        sec_soundorgy[i] = ((bbox[BOXTOP] + bbox[BOXBOTTOM]) / 2) | 0

        let block = (bbox[BOXTOP] - bmaporgy + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
        sec_blockbox[i * 4 + BOXTOP] = block >= bmapheight ? bmapheight - 1 : block
        block = (bbox[BOXBOTTOM] - bmaporgy - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
        sec_blockbox[i * 4 + BOXBOTTOM] = block < 0 ? 0 : block
        block = (bbox[BOXRIGHT] - bmaporgx + DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
        sec_blockbox[i * 4 + BOXRIGHT] = block >= bmapwidth ? bmapwidth - 1 : block
        block = (bbox[BOXLEFT] - bmaporgx - DD.MAXRADIUS) >> DD.MAPBLOCKSHIFT
        sec_blockbox[i * 4 + BOXLEFT] = block < 0 ? 0 : block
    }
}

let gamemode = 4    // GameMode.indetermined until told otherwise

function P_SetGameMode(mode) { gamemode = mode }

// episode/map -> "ExMy" or "MAPxx" like vanilla P_SetupLevel
function levelLumpName(episode, map) {
    if (gamemode === DD.GameMode.commercial)
        return map < 10 ? "MAP0" + map : "MAP" + map
    return "E" + episode + "M" + map
}

function P_SetupLevel(episode, map) {
    playerstarts = []
    deathmatchstarts = []

    const lumpname = levelLumpName(episode, map)
    const lumpnum = W.W_GetNumForName(lumpname)

    // UDMF rejection: a UDMF map's first lump is TEXTMAP
    if (W.W_LumpName(lumpnum + 1) === "TEXTMAP")
        throw Error("UDMF map format not supported (" + lumpname + ")")

    // note: this ordering is important (vanilla)
    P_LoadBlockMap(lumpnum + ML_BLOCKMAP)
    P_LoadVertexes(lumpnum + ML_VERTEXES)
    P_LoadSectors(lumpnum + ML_SECTORS)
    P_LoadSideDefs(lumpnum + ML_SIDEDEFS)
    P_LoadLineDefs(lumpnum + ML_LINEDEFS)
    P_LoadSubsectors(lumpnum + ML_SSECTORS)
    P_LoadNodes(lumpnum + ML_NODES)
    P_LoadSegs(lumpnum + ML_SEGS)
    rejectmatrix = W.W_CacheLumpNum(lumpnum + ML_REJECT)
    P_GroupLines()
    // publish geometry before things: the spawnMapThing hook (p_mobj)
    // reads `level` during P_LoadThings
    publish()
    P_LoadThings(lumpnum + ML_THINGS)
}

// level accessor object: modules grab this once in init and read the
// freshly assigned arrays after each P_SetupLevel
const level = {}
function publish() {
    level.numvertexes = numvertexes
    level.vertex_x = vertex_x; level.vertex_y = vertex_y
    level.numsegs = numsegs
    level.seg_v1 = seg_v1; level.seg_v2 = seg_v2
    level.seg_angle = seg_angle; level.seg_offset = seg_offset
    level.seg_linedef = seg_linedef; level.seg_sidedef = seg_sidedef
    level.seg_frontsector = seg_frontsector; level.seg_backsector = seg_backsector
    level.numsectors = numsectors
    level.sec_floorheight = sec_floorheight; level.sec_ceilingheight = sec_ceilingheight
    level.sec_floorpic = sec_floorpic; level.sec_ceilingpic = sec_ceilingpic
    level.sec_lightlevel = sec_lightlevel; level.sec_special = sec_special
    level.sec_tag = sec_tag
    level.sec_soundtraversed = sec_soundtraversed; level.sec_validcount = sec_validcount
    level.sec_rvalidcount = sec_rvalidcount
    level.sec_linecount = sec_linecount; level.sec_blockbox = sec_blockbox
    level.sec_soundorgx = sec_soundorgx; level.sec_soundorgy = sec_soundorgy
    level.sec_thinglist = sec_thinglist; level.sec_specialdata = sec_specialdata
    level.sec_soundtarget = sec_soundtarget; level.sec_lines = sec_lines
    level.numsides = numsides
    level.side_textureoffset = side_textureoffset; level.side_rowoffset = side_rowoffset
    level.side_toptexture = side_toptexture; level.side_bottomtexture = side_bottomtexture
    level.side_midtexture = side_midtexture; level.side_sector = side_sector
    level.numlines = numlines
    level.line_v1 = line_v1; level.line_v2 = line_v2
    level.line_dx = line_dx; level.line_dy = line_dy
    level.line_flags = line_flags; level.line_special = line_special
    level.line_tag = line_tag
    level.line_sidenum0 = line_sidenum0; level.line_sidenum1 = line_sidenum1
    level.line_frontsector = line_frontsector; level.line_backsector = line_backsector
    level.line_slopetype = line_slopetype; level.line_validcount = line_validcount
    level.line_bbox = line_bbox; level.line_specialdata = line_specialdata
    level.numsubsectors = numsubsectors
    level.ssec_numlines = ssec_numlines; level.ssec_firstline = ssec_firstline
    level.ssec_sector = ssec_sector
    level.numnodes = numnodes
    level.node_x = node_x; level.node_y = node_y
    level.node_dx = node_dx; level.node_dy = node_dy
    level.node_bbox = node_bbox; level.node_children = node_children
    level.blockmaplump = blockmaplump
    level.bmaporgx = bmaporgx; level.bmaporgy = bmaporgy
    level.bmapwidth = bmapwidth; level.bmapheight = bmapheight
    level.blocklinks = blocklinks
    level.rejectmatrix = rejectmatrix
    level.things = things
    level.playerstarts = playerstarts
}

// wrap P_SetupLevel so `level` is always current
function setup(episode, map) {
    P_SetupLevel(episode, map)
    publish()
}

exports = {
    P_SetupLevel: setup,
    P_SetGameMode,
    levelLumpName,
    level,
    setSpawnMapThing: (fn) => { spawnMapThing = fn },
    init: function (D) {
        DD = D.defs; T = D.tables; W = D.w_wad; R = D.r_data
    },
}
