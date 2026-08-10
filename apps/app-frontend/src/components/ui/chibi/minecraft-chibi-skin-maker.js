/*!
 * Minecraft Chibi Skin Maker - nogard.dev
 * Copyright (c) 2026 Nogard. All rights reserved.
 *
 * Served to your browser so the tool can run. That is not a licence to copy, host,
 * rebrand, resell or redistribute this code, in whole or in part.
 * Licensing enquiries: https://nogard.dev/contact
 */
// Phase 0: the three.js engine has been removed. This is the 2D-canvas Minecraft Chibi Skin
// Maker shell; the three.js renderer is replaced by a 2D pixel-art engine in a later phase.
// All three.js imports (THREE, OrbitControls, GLTFExporter, OBJExporter, RoomEnvironment,
// TransformControls) are gone. Any method below that still references THREE is UNCALLED dead
// code kept for the later port; nothing reachable on page load touches three.js.

// --- DOM helpers ---
// Every show/hide in this file goes through setVisible. It writes the `hidden` ATTRIBUTE rather
// than inline `style.display`, because an inline display beats any stylesheet rule: once JS has
// written display:none on a panel, a class-driven show can never win it back. The viewport CSS
// pairs this with `#viewer-section [hidden] { display: none !important }`.
function setVisible(el, on) {
  if (!el) return;
  el.hidden = !on;
}

// A dependent row (shadow intensity, outline width) is DIMMED AND DISABLED, never hidden. Hiding it
// makes the panel jump under the user's cursor the moment they tick the parent checkbox.
function setRowEnabled(row, on) {
  if (!row) return;
  row.classList.toggle('is-disabled', !on);
  for (const input of row.querySelectorAll('input, select, button')) input.disabled = !on;
}

// Swap a button into a busy state and back WITHOUT hardcoding its markup: the old code pasted two
// literal SVG strings back into the button, which would silently revert to the pre-redesign icon
// the first time you loaded a skin.
function setBusy(btn, label) {
  if (!btn || btn._busy) return;
  btn._busy = btn.innerHTML;
  btn.disabled = true;
  btn.textContent = label;
}
function clearBusy(btn) {
  if (!btn || !btn._busy) return;
  btn.innerHTML = btn._busy;
  btn._busy = null;
  btn.disabled = false;
}

// ===== 2D chibi engine =====
// THE deterministic chibi layout, decoded pixel-for-pixel from the reference tool by pushing a
// face-coloured probe skin through it and reading back where every face landed. It is a plain 2D
// blit table on a 24x33 sprite: copy a skin rect, paste it at a sprite rect. The "3/4" look is not a
// 3D projection at all - it is just the head's -X side face squished from 8 texels into 6 px beside a
// double-scaled front face. dest = [x, y, w, h] in sprite pixels; src rects are base-64 skin texels
// (HD skins multiply src by width/64). Arm src width becomes 3 for slim (Alex).
const CHIBI_SPRITE = { w: 24, h: 33 };
// How dark the squished SIDE faces are drawn relative to the front faces. This brightness gap is the
// entire depth cue: lower = stronger 3D read. Match the reference's measured ~0.84 - going darker (we
// used 0.72) dims the 1px bodySide seam beside the near arm BELOW the skin's own colour, which reads as
// a hard dark line down the arm's inner edge (sss's seam sits ~0.77, brighter than our old 0.72).
const CHIBI_SIDE_SHADE = 0.84;
// Every rect below was decoded from the reference tool by pushing face-coloured probe skins through it
// and reading back where each face landed. src = base-64 skin texels (HD skins multiply by width/64);
// dest = pixels on the 24x33 sprite. Note the SIDE faces: they are the whole "3/4" trick - a face is
// squished horizontally (head 8->6, arm 4->3, body 4->1) and drawn beside its front face, then dimmed.
// Overlays (hat/jacket/sleeves/pants) sit ON TOP of their base part in the same region, not offset.
// BODY / ARMS / LEGS use {base, over}: the 2nd-layer clothing (pant/jacket/sleeve) is composited onto the
// base IN SKIN SPACE - one merged texture, sampled ONCE - so it can't misalign into shading noise the way
// two separate scaled blits did. `bodyOverlay==='off'` renders the base only (no clothing). The HEAD stays
// SEPARATE base + hat blits (headFront/hatFront): merging the head surfaced the face's own pink/eye detail
// (this skin draws glasses on both layers), so it is deliberately left alone.
const CHIBI_PARTS = {
  // --- occluded depth faces: drawn FIRST and fully covered by the parts in front of them, so they
  // only appear when the Parts tab hides the occluder - hide the Body and the far arm's inner side
  // strip shows, hide the near arm and the body's side face shows at its full 4px depth, hide the
  // near leg and the far leg's side shows. Think of it as the 3D model: removing a box reveals the
  // faces it was hiding. ---
  lArmSideHid: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [16, 17, 3, 10], side: true },
  bodySideHid: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [5, 17, 4, 10], side: true },
  lLegSideHid: { base: [16, 52, 4, 12], over: [0, 52, 4, 12], dest: [10, 27, 4, 6], side: true },
  // --- legs (base + pant overlay) ---
  rLegSide:  { base: [0, 20, 4, 12],  over: [0, 36, 4, 12],  dest: [5, 27, 4, 6], side: true },
  rLegFront: { base: [4, 20, 4, 12],  over: [4, 36, 4, 12],  dest: [9, 27, 5, 6] },
  lLegFront: { base: [20, 52, 4, 12], over: [4, 52, 4, 12],  dest: [14, 27, 5, 6] },
  // --- body (base + jacket overlay) ---
  bodySide:  { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 1, 10], side: true },
  bodyFront: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [9, 17, 10, 10] },
  // --- arms (base + sleeve overlay): near (right) arm shows side + front; far (left) arm is front-only.
  // `wideDest` is the CLASSIC (4px-arm) layout, decoded from the reference's forced-Wide exports of the
  // same skin (concepts/chibi-steve-2d): arm fronts widen 3 -> 4, the body compresses 10 -> 9 and its
  // seam shifts 1 right, all inside the same 22px silhouette. Slim keeps `dest`. Legs never change. ---
  rArmSide:  { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [2, 17, 3, 10], side: true },
  rArmFront: { base: [44, 20, 4, 12], over: [44, 36, 4, 12], dest: [5, 17, 3, 10], wideDest: [5, 17, 4, 10], arm: true },
  lArmFront: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], dest: [19, 17, 3, 10], wideDest: [19, 17, 4, 10], arm: true },
  // --- head last (SEPARATE base + hat blits, left as-is) ---
  headSide:  { src: [0, 8, 8, 8],  dest: [1, 1, 6, 16], side: true },
  headFront: { src: [8, 8, 8, 8],  dest: [7, 1, 16, 16] },
  hatSide:   { src: [32, 8, 8, 8], dest: [0, 0, 6, 18], hat: true, side: true },
  hatFront:  { src: [40, 8, 8, 8], dest: [6, 0, 18, 18], hat: true },
};
const CHIBI_ORDER = ['lArmSideHid','bodySideHid','lLegSideHid','rLegSide','rLegFront','lLegFront','bodySide','bodyFront','rArmSide','rArmFront','lArmFront','headSide','headFront','hatSide','hatFront'];

// FACING LEFT: the same 3/4 pose turned the other way. Decoded from the reference with a probe skin whose
// face front was split red|blue and every box face uniquely coloured: the reference's "Facing left" is NOT
// a mirror of the sprite - front faces keep their as-authored orientation (red stayed left of blue), the
// LAYOUT mirrors (side strips move to the image-right end), each strip samples the box's LEFT face instead
// of its right, and the near/far roles swap to the LEFT limbs while the anatomical order stays put (the
// right arm remains on the image-left, now front-only). dest = the right table's dests mirrored with
// x' = 24 - x - w, then re-assigned anatomically. `slimShiftX`: a LEFT face sits at boxX + depth + frontW,
// so on a slim skin (front 4 -> 3) its src x moves 1 texel left; right faces sit at the box origin and
// never move, which is why the right-facing table needs no such flag.
const CHIBI_PARTS_LEFT = {
  // --- occluded depth faces (see CHIBI_PARTS): far arm / body / far leg reveals, mirror faces ---
  rArmSideHid: { base: [48, 20, 4, 12], over: [48, 36, 4, 12], dest: [5, 17, 3, 10], side: true, slimShiftX: true, mirrorMap: true },
  bodySideHid: { base: [28, 20, 4, 12], over: [28, 36, 4, 12], dest: [15, 17, 4, 10], side: true },
  rLegSideHid: { base: [8, 20, 4, 12], over: [8, 36, 4, 12], dest: [10, 27, 4, 6], side: true },
  // --- legs: near leg is now the LEFT leg (strip on the image-right end) ---
  rLegFront: { base: [4, 20, 4, 12],  over: [4, 36, 4, 12],  dest: [5, 27, 5, 6] },
  lLegFront: { base: [20, 52, 4, 12], over: [4, 52, 4, 12],  dest: [10, 27, 5, 6] },
  lLegSide:  { base: [24, 52, 4, 12], over: [8, 52, 4, 12],  dest: [15, 27, 4, 6], side: true },
  // --- body: seam shows the body's LEFT side, to the RIGHT of the front ---
  bodyFront: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [5, 17, 10, 10] },
  bodySide:  { base: [28, 20, 4, 12], over: [28, 36, 4, 12], dest: [15, 17, 1, 10], side: true, mirrorMap: true },
  // --- arms: near (left) arm shows front + its LEFT face; far (right) arm is front-only ---
  rArmFront: { base: [44, 20, 4, 12], over: [44, 36, 4, 12], dest: [2, 17, 3, 10], wideDest: [1, 17, 4, 10], arm: true },
  lArmFront: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], dest: [16, 17, 3, 10], wideDest: [15, 17, 4, 10], arm: true },
  lArmSide:  { base: [40, 52, 4, 12], over: [56, 52, 4, 12], dest: [19, 17, 3, 10], side: true, slimShiftX: true, mirrorMap: true },
  // --- head last: side strip = the head's LEFT face, on the image-right ---
  headFront: { src: [8, 8, 8, 8],   dest: [1, 1, 16, 16] },
  headSide:  { src: [16, 8, 8, 8],  dest: [17, 1, 6, 16], side: true },
  hatFront:  { src: [40, 8, 8, 8],  dest: [0, 0, 18, 18], hat: true },
  hatSide:   { src: [48, 8, 8, 8],  dest: [18, 0, 6, 18], hat: true, side: true },
};
const CHIBI_ORDER_LEFT = ['rArmSideHid','bodySideHid','rLegSideHid','rLegFront','lLegFront','lLegSide','bodySide','bodyFront','rArmFront','lArmFront','lArmSide','headSide','headFront','hatSide','hatFront'];

// FLAT (straight-on) layout: front faces ONLY, no 3/4 side faces. This is NOT the 3/4 table with sides
// removed - that leaves transparent gaps where the side columns bridged the arms to the torso. Every part
// is centred on x=9.5 so the sprite is symmetric, and the limbs/body are drawn 1:1 in x (arm 4->4, body
// 8->8, leg 4->4) - NO horizontal squish. A 4->3 squish would drop the SAME local texel on both arms, so
// even a perfectly mirror-authored skin could never come out symmetric; 1:1 uses every texel straight
// from the skin (no mirroring, no dropping), so a symmetric skin renders symmetric on its own.
// Shoulder row = arm(4)+body(8)+arm(4)=16 under a 16-wide head (18-wide hat for the hair overhang).
const CHIBI_PARTS_FLAT = {
  // The 2nd layer here is SEPARATE parts drawn 1:1 over their base (no squish, so no misalignment - the
  // reason the 3/4 table merges in skin space doesn't apply). `clothing: true` ties them to the same
  // bodyOverlay toggle that gates the 3/4 table's {base,over} merge, so the toggle means one thing.
  rLegFront:  { src: [4, 20, 4, 12],  dest: [6, 27, 4, 6] },
  lLegFront:  { src: [20, 52, 4, 12], dest: [10, 27, 4, 6] },
  rPantFront: { src: [4, 36, 4, 12],  dest: [6, 27, 4, 6], clothing: true },
  lPantFront: { src: [4, 52, 4, 12],  dest: [10, 27, 4, 6], clothing: true },
  bodyFront:  { src: [20, 20, 8, 12], dest: [6, 17, 8, 10] },
  jacketFront:{ src: [20, 36, 8, 12], dest: [6, 17, 8, 10], clothing: true },
  rArmFront:  { src: [44, 20, 4, 12], dest: [2, 17, 4, 10], arm: true },
  lArmFront:  { src: [36, 52, 4, 12], dest: [14, 17, 4, 10], arm: true },
  rSlvFront:  { src: [44, 36, 4, 12], dest: [2, 17, 4, 10], arm: true, clothing: true },
  lSlvFront:  { src: [52, 52, 4, 12], dest: [14, 17, 4, 10], arm: true, clothing: true },
  headFront:  { src: [8, 8, 8, 8],  dest: [2, 1, 16, 16] },
  hatFront:   { src: [40, 8, 8, 8], dest: [1, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_FLAT = ['rLegFront','lLegFront','rPantFront','lPantFront','bodyFront','jacketFront','rArmFront','lArmFront','rSlvFront','lSlvFront','headFront','hatFront'];

// BACK (straight-on from behind): the flat layout's mirror with BACK-face sources. Ground truth measured
// on the real 3D model (Mojavatar with a colour-probe skin, camera behind): back faces render AS-AUTHORED
// (texture-left lands on viewer-left, no mirroring), and the limbs swap image sides vs the front view -
// seen from behind, the character's RIGHT arm is on the viewer's RIGHT. So dests mirror the flat table
// (x' = 20 - x - w around the same x=9.5 centre) while the art stays unflipped. BACK faces sit at
// boxX + depth + frontW + depth, so on slim arms (front 4 -> 3) they shift 1 texel left AND narrow to 3:
// both `arm` (width) and `slimShiftX` (position) apply - the only parts in any table that need both.
const CHIBI_PARTS_BACK = {
  rLegBack:  { src: [12, 20, 4, 12], dest: [10, 27, 4, 6] },
  lLegBack:  { src: [28, 52, 4, 12], dest: [6, 27, 4, 6] },
  rPantBack: { src: [12, 36, 4, 12], dest: [10, 27, 4, 6], clothing: true },
  lPantBack: { src: [12, 52, 4, 12], dest: [6, 27, 4, 6], clothing: true },
  bodyBack:  { src: [32, 20, 8, 12], dest: [6, 17, 8, 10] },
  jacketBack:{ src: [32, 36, 8, 12], dest: [6, 17, 8, 10], clothing: true },
  rArmBack:  { src: [52, 20, 4, 12], dest: [14, 17, 4, 10], arm: true, slimShiftX: true },
  lArmBack:  { src: [44, 52, 4, 12], dest: [2, 17, 4, 10], arm: true, slimShiftX: true },
  rSlvBack:  { src: [52, 36, 4, 12], dest: [14, 17, 4, 10], arm: true, slimShiftX: true, clothing: true },
  lSlvBack:  { src: [60, 52, 4, 12], dest: [2, 17, 4, 10], arm: true, slimShiftX: true, clothing: true },
  headBack:  { src: [24, 8, 8, 8],  dest: [2, 1, 16, 16] },
  hatBack:   { src: [56, 8, 8, 8],  dest: [1, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_BACK = ['rLegBack','lLegBack','rPantBack','lPantBack','bodyBack','jacketBack','rArmBack','lArmBack','rSlvBack','lSlvBack','headBack','hatBack'];

// 3/4 BACK, both turns - the back view given the same 3/4 treatment as the front. Ground truth from the
// 3D model at back-quarter camera angles (side faces banded, back faces split red|blue): EVERYTHING still
// samples as-authored - the side-strip band order and the back split keep their texture order in both
// turns. That is not luck: a side face's strip always adjoins the blit it belongs to along the cube edge
// they share, and the adjacency flip from viewing behind cancels the physical mirror exactly. Structure:
// facing right = the RIGHT side faces visible, and from behind the right side sits on the image-RIGHT
// (limbs swap image sides vs front view), so the strips move to the right end; facing left mirrors that.
// dests are the front tables' dests mirrored (x' = 24 - x - w), limbs re-assigned anatomically. BACK
// faces sit at boxX + depth + frontW + depth: slim arms take BOTH `arm` (width 3) and `slimShiftX` (x-1).
const CHIBI_PARTS_BACK_RIGHT = {
  // --- occluded depth faces (see CHIBI_PARTS): revealed when their occluder is hidden ---
  lArmSideHid: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [5, 17, 3, 10], side: true },
  bodySideHid: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [15, 17, 4, 10], side: true },
  lLegSideHid: { base: [16, 52, 4, 12], over: [0, 52, 4, 12], dest: [10, 27, 4, 6], side: true },
  // near = RIGHT limbs, strips on the image-right end
  lLegBack:  { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [5, 27, 5, 6] },
  rLegBack:  { base: [12, 20, 4, 12], over: [12, 36, 4, 12], dest: [10, 27, 5, 6] },
  rLegSide:  { base: [0, 20, 4, 12],  over: [0, 36, 4, 12],  dest: [15, 27, 4, 6], side: true },
  bodyBack:  { base: [32, 20, 8, 12], over: [32, 36, 8, 12], dest: [5, 17, 10, 10] },
  bodySide:  { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [15, 17, 1, 10], side: true },
  lArmBack:  { base: [44, 52, 4, 12], over: [60, 52, 4, 12], dest: [2, 17, 3, 10], wideDest: [1, 17, 4, 10], arm: true, slimShiftX: true },
  rArmBack:  { base: [52, 20, 4, 12], over: [52, 36, 4, 12], dest: [16, 17, 3, 10], wideDest: [15, 17, 4, 10], arm: true, slimShiftX: true },
  rArmSide:  { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [19, 17, 3, 10], side: true },
  headBack:  { src: [24, 8, 8, 8],  dest: [1, 1, 16, 16] },
  headSide:  { src: [0, 8, 8, 8],   dest: [17, 1, 6, 16], side: true },
  hatBack:   { src: [56, 8, 8, 8],  dest: [0, 0, 18, 18], hat: true },
  hatSide:   { src: [32, 8, 8, 8],  dest: [18, 0, 6, 18], hat: true, side: true },
};
const CHIBI_ORDER_BACK_RIGHT = ['lArmSideHid','bodySideHid','lLegSideHid','lLegBack','rLegBack','rLegSide','bodySide','bodyBack','lArmBack','rArmBack','rArmSide','headSide','headBack','hatSide','hatBack'];

const CHIBI_PARTS_BACK_LEFT = {
  // --- occluded depth faces (see CHIBI_PARTS): revealed when their occluder is hidden ---
  rArmSideHid: { base: [48, 20, 4, 12], over: [48, 36, 4, 12], dest: [16, 17, 3, 10], side: true, slimShiftX: true, mirrorMap: true },
  bodySideHid: { base: [28, 20, 4, 12], over: [28, 36, 4, 12], dest: [5, 17, 4, 10], side: true },
  rLegSideHid: { base: [8, 20, 4, 12], over: [8, 36, 4, 12], dest: [10, 27, 4, 6], side: true },
  // near = LEFT limbs, strips on the image-left end (mirror of BACK_RIGHT; same dests as the front-right
  // table). mirrorMap on the odd-width strips keeps back-left === mirror(back-right) on a symmetric skin,
  // exactly like the front pair.
  lLegSide:  { base: [24, 52, 4, 12], over: [8, 52, 4, 12],  dest: [5, 27, 4, 6], side: true },
  lLegBack:  { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [9, 27, 5, 6] },
  rLegBack:  { base: [12, 20, 4, 12], over: [12, 36, 4, 12], dest: [14, 27, 5, 6] },
  bodySide:  { base: [28, 20, 4, 12], over: [28, 36, 4, 12], dest: [8, 17, 1, 10], side: true, mirrorMap: true },
  bodyBack:  { base: [32, 20, 8, 12], over: [32, 36, 8, 12], dest: [9, 17, 10, 10] },
  lArmSide:  { base: [40, 52, 4, 12], over: [56, 52, 4, 12], dest: [2, 17, 3, 10], side: true, slimShiftX: true, mirrorMap: true },
  lArmBack:  { base: [44, 52, 4, 12], over: [60, 52, 4, 12], dest: [5, 17, 3, 10], wideDest: [5, 17, 4, 10], arm: true, slimShiftX: true },
  rArmBack:  { base: [52, 20, 4, 12], over: [52, 36, 4, 12], dest: [19, 17, 3, 10], wideDest: [19, 17, 4, 10], arm: true, slimShiftX: true },
  headSide:  { src: [16, 8, 8, 8],  dest: [1, 1, 6, 16], side: true },
  headBack:  { src: [24, 8, 8, 8],  dest: [7, 1, 16, 16] },
  hatSide:   { src: [48, 8, 8, 8],  dest: [0, 0, 6, 18], hat: true, side: true },
  hatBack:   { src: [56, 8, 8, 8],  dest: [6, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_BACK_LEFT = ['rArmSideHid','bodySideHid','rLegSideHid','lLegSide','lLegBack','rLegBack','bodySide','bodyBack','lArmSide','lArmBack','rArmBack','headSide','headBack','hatSide','hatBack'];

// PURE SIDE PROFILES (90 degrees). Ground truth from the 3D model at azimuth 90/270 with banded side
// faces: the profile shows ONLY that side's faces, all as-authored - right profile reads texture-left ->
// image-left, which puts the face's front edge at image-RIGHT (the character looks image-right); the left
// profile looks image-left. The head side face is 8x8, drawn at the same 2x as the flat front (16px);
// body, arms and legs are their 4-texel DEPTH, drawn 1:1 (4px) - the true skinny silhouette. The near
// arm hangs outside the body and the far arm is behind it, all on the same 4px column, so the parts
// stack far-to-near at ONE dest and the topmost opaque pixel wins, exactly like the 3D occlusion.
// No side-dim and no AO here: a straight-on profile has no front/side contrast to fake depth with.
// Right faces sit at the box origin (never move); LEFT faces sit after the front, so slim arms shift
// their LEFT-face x by 1 (slimShiftX) - width stays 4, it is the box DEPTH.
const CHIBI_PARTS_SIDE_RIGHT = {
  lLegProf: { base: [16, 52, 4, 12], over: [0, 52, 4, 12],  dest: [8, 27, 4, 6] },
  rLegProf: { base: [0, 20, 4, 12],  over: [0, 36, 4, 12],  dest: [8, 27, 4, 6] },
  lArmProf: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [8, 17, 4, 10] },
  bodyProf: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 4, 10] },
  rArmProf: { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [8, 17, 4, 10] },
  headProf: { src: [0, 8, 8, 8],  dest: [2, 1, 16, 16] },
  hatProf:  { src: [32, 8, 8, 8], dest: [1, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_SIDE_RIGHT = ['lLegProf','rLegProf','lArmProf','bodyProf','rArmProf','headProf','hatProf'];

const CHIBI_PARTS_SIDE_LEFT = {
  rLegProf: { base: [8, 20, 4, 12],  over: [8, 36, 4, 12],  dest: [8, 27, 4, 6] },
  lLegProf: { base: [24, 52, 4, 12], over: [8, 52, 4, 12],  dest: [8, 27, 4, 6] },
  rArmProf: { base: [48, 20, 4, 12], over: [48, 36, 4, 12], dest: [8, 17, 4, 10], slimShiftX: true },
  bodyProf: { base: [28, 20, 4, 12], over: [28, 36, 4, 12], dest: [8, 17, 4, 10] },
  lArmProf: { base: [40, 52, 4, 12], over: [56, 52, 4, 12], dest: [8, 17, 4, 10], slimShiftX: true },
  headProf: { src: [16, 8, 8, 8],  dest: [2, 1, 16, 16] },
  hatProf:  { src: [48, 8, 8, 8], dest: [1, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_SIDE_LEFT = ['rLegProf','lLegProf','rArmProf','bodyProf','lArmProf','headProf','hatProf'];

// The VERTICAL row choice for the 12-texel-tall body/arm band squeezed into its 10 sprite rows.
// Brute-forced against the reference's forced-Wide AND forced-Slim exports of the same skin
// (concepts/chibi-steve-2d, RGB-scored over the whole band): the reference keeps the top five and
// bottom three rows one-to-one and drops two mid-torso rows - which is why its shirt sleeve runs one
// row longer than plain nearest sampling gives (nearest dropped rows 3 and 9, cutting the sleeve
// short and shifting the collar). Score 39.7 vs 54.4 for nearestMap. Applies to every 12-tall part
// with a 10-tall dest: fronts, backs AND side strips, so their rows always line up.
const CHIBI_BAND_YMAP = [0, 1, 2, 3, 4, 6, 8, 9, 10, 11];

// TOP and BOTTOM (straight down / straight up). Ground truth from the 3D model with quadrant-coloured
// top/bottom faces: from ABOVE everything renders as-authored and only the head shows (the chibi's
// 16px head + 18px hat exactly cover the 16px shoulder span, so no chips peek out); the face points
// toward the image-BOTTOM. From BELOW the X axis MIRRORS (texture top-left lands image top-RIGHT, like
// flipping a sheet of paper over; vertical stays), left limbs land image-LEFT, and the feet/arm bottom
// chips strip across the middle of the head square, nearest drawn last. `mirrorX` flips a part's
// horizontal sampling. Bottom faces sit at boxX + depth + frontW on the TOP row of the box, so slim
// arm/sleeve bottoms shift 1 texel left AND narrow: arm + slimShiftX again.
const CHIBI_PARTS_TOP = {
  // The head covers the whole figure from above - but hide it in the Parts tab and the body, arm
  // and leg TOP faces are what the 3D model shows (the bottom view's chip layout, unmirrored;
  // legs under the body, arms beside it).
  lLegTopHid: { base: [20, 48, 4, 4], over: [4, 48, 4, 4], dest: [10, 7, 4, 4] },
  rLegTopHid: { base: [4, 16, 4, 4], over: [4, 32, 4, 4], dest: [6, 7, 4, 4] },
  bodyTopHid: { base: [20, 16, 8, 4], over: [20, 32, 8, 4], dest: [6, 7, 8, 4] },
  lArmTopHid: { base: [36, 48, 4, 4], over: [52, 48, 4, 4], arm: true, dest: [14, 7, 4, 4] },
  rArmTopHid: { base: [44, 16, 4, 4], over: [44, 32, 4, 4], arm: true, dest: [2, 7, 4, 4] },
  headTop: { src: [8, 0, 8, 8],  dest: [2, 1, 16, 16] },
  hatTop:  { src: [40, 0, 8, 8], dest: [1, 0, 18, 18], hat: true },
};
const CHIBI_ORDER_TOP = ['lLegTopHid', 'rLegTopHid', 'bodyTopHid', 'lArmTopHid', 'rArmTopHid', 'headTop', 'hatTop'];

const CHIBI_PARTS_BOTTOM = {
  headBot: { src: [16, 0, 8, 8],  dest: [2, 1, 16, 16], mirrorX: true },
  hatBot:  { src: [48, 0, 8, 8],  dest: [1, 0, 18, 18], hat: true, mirrorX: true },
  bodyBot: { base: [28, 16, 8, 4], over: [28, 32, 8, 4], dest: [6, 7, 8, 4], mirrorX: true },
  lArmBot: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], dest: [2, 7, 4, 4], arm: true, slimShiftX: true, mirrorX: true },
  rArmBot: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], dest: [14, 7, 4, 4], arm: true, slimShiftX: true, mirrorX: true },
  lLegBot: { base: [24, 48, 4, 4], over: [8, 48, 4, 4],  dest: [6, 7, 4, 4], mirrorX: true },
  rLegBot: { base: [8, 16, 4, 4],  over: [8, 32, 4, 4],  dest: [10, 7, 4, 4], mirrorX: true },
};
const CHIBI_ORDER_BOTTOM = ['headBot', 'hatBot', 'bodyBot', 'lArmBot', 'rArmBot', 'lLegBot', 'rLegBot'];

// The ten view keys and the state fields each one sets. ONE table shared by the Camera panel
// (setView), the 1-0 keys, and the settings-config import - so a view named in a saved config can
// never drift from what the buttons produce. Views that omit a field deliberately keep the current
// value (picking Front keeps your facing, so returning to a 3/4 remembers the side you were on).
// ANIMATIONS (the Animation tab). The model is the reference chibi-GIF tool's, read from its
// bundle: an animation is a list of frames, each frame the standing layout with small per-part
// pixel offsets (their legRDy/armLDy deltas), optionally a pose-table swap (wave), a view
// override (turn/spin), a whole-sprite nudge, and its own delay in ms. Frames compose UNCROPPED
// and assemble into one shared box - aligned by each table's shift, or centered for view-cycling
// anims - so the motion survives and every frame has identical dimensions (what a GIF needs).
// Offsets key part GROUPS by table-key prefix so sleeves, pants and the hat ride their limb.
const CHIBI_ANIM_GROUPS = {
  head: ['head', 'hat'], body: ['body', 'jacket'],
  rArm: ['rArm', 'rSlv'], lArm: ['lArm', 'lSlv'],
  rLeg: ['rLeg', 'rPant'], lLeg: ['lLeg', 'lPant'],
  // ONLY the raised waving arm, whichever side it lands on: the wave pose names its raised-arm blits
  // lArmWave* (front views) or rArmWave* (profiles + every mirrored/left-facing view), never the
  // hanging arm (rArmSide/lArmFront/etc.). So the Wave anim can nudge just that arm in every view.
  waveArm: ['lArmWave', 'rArmWave'],
};
// The tilted head (nod dip, bow). A block head tipping forward REVEALS ITS TOP FACE, so each
// tilt stacks a squashed top face above a squashed front face - the reference builds its
// head-down part exactly this way, and without the top face the head just read as a flattened
// portrait. The revealed top is SHADED, not bright: two faces at the same brightness read as one
// flat shape, and the dim is what sells the fold. It takes the same values as every other
// secondary face - the side-face dim at a half tilt, the deeper end-cap value once the deep bow
// swings that face right away from the light - while the front dims only slightly. Half keeps the
// standing head's 16-row box; the deep hold shows more top, less face, and sits lower so the chin
// meets the chest. Keys start with head/hat so visibility and part-group offsets keep working
// through _partNames.
const CHIBI_BOW_HALF = { order: ['headTiltTop', 'headTiltFront', 'hatTiltTop', 'hatTiltFront'], parts: {
  headTiltTop:   { src: [8, 0, 8, 8],  dest: [2, 1, 16, 6], shade: CHIBI_SIDE_SHADE },
  headTiltFront: { src: [8, 8, 8, 8],  dest: [2, 7, 16, 10], shade: 0.93 },
  hatTiltTop:    { src: [40, 0, 8, 8], dest: [1, 0, 18, 7], hat: true, shade: CHIBI_SIDE_SHADE },
  hatTiltFront:  { src: [40, 8, 8, 8], dest: [1, 7, 18, 11], hat: true, shade: 0.93 },
} };
// CHIBI_BOW_HALF above is head-only, used by NOD (a nod is just a head dip). The BOW folds at the
// WAIST, so its tables swap the BODY too: the torso squashes from the TOP DOWN with its bottom edge
// pinned to the hip line (row 26, where the legs meet), so the legs stay full-height and planted
// while the shoulders sink - a human folding forward, not a shrinking figure. The head then rides
// down onto the lowered shoulders. The front of the torso dims as it tilts away, like the head's
// front face. drop lists head+hat+body+jacket so those base blits give way to the bent set.
const CHIBI_BOW_MID = { drop: ['head', 'hat', 'body', 'jacket'],
  order: ['bodyBent', 'jacketBent', 'headTiltTop', 'headTiltFront', 'hatTiltTop', 'hatTiltFront'], parts: {
  bodyBent:      { src: [20, 20, 8, 12], dest: [6, 18, 8, 9], shade: 0.92 },
  jacketBent:    { src: [20, 36, 8, 12], dest: [6, 18, 8, 9], clothing: true, shade: 0.92 },
  headTiltTop:   { src: [8, 0, 8, 8],  dest: [2, 3, 16, 5], shade: CHIBI_SIDE_SHADE },
  headTiltFront: { src: [8, 8, 8, 8],  dest: [2, 8, 16, 10], shade: 0.93 },
  hatTiltTop:    { src: [40, 0, 8, 8], dest: [1, 2, 18, 6], hat: true, shade: CHIBI_SIDE_SHADE },
  hatTiltFront:  { src: [40, 8, 8, 8], dest: [1, 8, 18, 11], hat: true, shade: 0.93 },
} };
const CHIBI_BOW_DEEP = { drop: ['head', 'hat', 'body', 'jacket'],
  order: ['bodyBent', 'jacketBent', 'headTiltTop', 'headTiltFront', 'hatTiltTop', 'hatTiltFront'], parts: {
  bodyBent:      { src: [20, 20, 8, 12], dest: [6, 19, 8, 8], shade: CHIBI_SIDE_SHADE },
  jacketBent:    { src: [20, 36, 8, 12], dest: [6, 19, 8, 8], clothing: true, shade: CHIBI_SIDE_SHADE },
  headTiltTop:   { src: [8, 0, 8, 8],  dest: [2, 5, 16, 6], shade: 0.72 },
  headTiltFront: { src: [8, 8, 8, 8],  dest: [2, 11, 16, 8], shade: 0.86 },
  hatTiltTop:    { src: [40, 0, 8, 8], dest: [1, 4, 18, 7], hat: true, shade: 0.72 },
  hatTiltFront:  { src: [40, 8, 8, 8],  dest: [1, 11, 18, 8], hat: true, shade: 0.86 },
} };
// The startled BENT arms (user call: straight raised sticks read stiff): each arm splits into
// an upper segment flared 1px out and a forearm offset 1px further - a small elbow kink. The
// settle variant sits 1px lower. Keys keep the rArm/lArm prefixes so visibility and group
// offsets resolve; `drop` tells the swap hook which family keys these replace.
const CHIBI_SURPRISE_ARMS_UP = { drop: ['rArm', 'rSlv', 'lArm', 'lSlv'], order: ['rArmBU', 'rArmBF', 'lArmBU', 'lArmBF'], parts: {
  rArmBU: { base: [44, 20, 4, 6], over: [44, 36, 4, 6], arm: true, dest: [1, 15, 4, 5] },
  rArmBF: { base: [44, 26, 4, 6], over: [44, 42, 4, 6], arm: true, dest: [0, 20, 4, 5] },
  lArmBU: { base: [36, 52, 4, 6], over: [52, 52, 4, 6], arm: true, dest: [15, 15, 4, 5] },
  lArmBF: { base: [36, 58, 4, 6], over: [52, 58, 4, 6], arm: true, dest: [16, 20, 4, 5] },
} };
const CHIBI_SURPRISE_ARMS_SETTLE = { drop: ['rArm', 'rSlv', 'lArm', 'lSlv'], order: ['rArmBU', 'rArmBF', 'lArmBU', 'lArmBF'], parts: {
  rArmBU: { base: [44, 20, 4, 6], over: [44, 36, 4, 6], arm: true, dest: [1, 16, 4, 5] },
  rArmBF: { base: [44, 26, 4, 6], over: [44, 42, 4, 6], arm: true, dest: [0, 21, 4, 5] },
  lArmBU: { base: [36, 52, 4, 6], over: [52, 52, 4, 6], arm: true, dest: [15, 16, 4, 5] },
  lArmBF: { base: [36, 58, 4, 6], over: [52, 58, 4, 6], arm: true, dest: [16, 21, 4, 5] },
} };
const CHIBI_TURN_VIEWS = ['front', '34-right', 'side-right', 'back34-right', 'back', 'back34-left', 'side-left', '34-left'];
// Turntable anchors: the x center of each family's LEG SPAN - the body's rotation axis. Feet
// stay planted and the head SILHOUETTE stays centered (block spans: flat 2..18, 3/4 1..23,
// both centered on the legs); the face then slides naturally WITHIN the stable head as it
// turns, which is how a real turnaround reads (the reference's diag frames do the same).
// History: canvas-center anchoring wobbled because every family composes on the shared 24-wide
// canvas while flat content only spans 0..19 (2px left of canvas center); face-center
// anchoring pinned the eyes but swung the body 3px side to side - worse.
const CHIBI_TURN_AX = {
  'front': 10, '34-right': 12, 'side-right': 10, 'back34-right': 12,
  'back': 10, 'back34-left': 12, 'side-left': 10, '34-left': 12,
};
const CHIBI_ANIMS = {
  cursor: { label: 'Follow Cursor', padX: 2, frames: [
    { parts: { head: [0, -1] }, d: 150 },
    { headSwap: '34-right', parts: { head: [1, -1] }, d: 150 },
    { headSwap: '34-right', parts: { head: [2, 0] }, d: 150 },
    { headSwap: '34-right', parts: { head: [1, 1] }, d: 150 },
    { parts: { head: [0, 1] }, d: 150 },
    { headSwap: '34-left', parts: { head: [-1, 1] }, d: 150 },
    { headSwap: '34-left', parts: { head: [-2, 0] }, d: 150 },
    { headSwap: '34-left', parts: { head: [-1, -1] }, d: 150 },
  ] },
  // The reference's core move (decoded from its bundle) is the upperDy SQUASH: head+body+arms
  // sink 1px onto the planted legs. Its inverse (torso lifts, legs stay) composes as a whole-
  // sprite rise plus legs pushed back down - the assembler's union box supplies the headroom.
  idle: { label: 'Idle', frames: [
    { d: 500 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 500 },
  ] },
  walk: { label: 'Walk', frames: [
    { parts: { rLeg: [0, -2, 0.72], lArm: [0, -1] }, d: 180 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 180 },
    { parts: { lLeg: [0, -2, 0.72], rArm: [0, -1] }, d: 180 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 180 },
  ] },
  // Run keeps OUR original cycle (user call: the reference's torso-lift version read worse
  // here): a hard 3px leg kick with the whole sprite bouncing, plain frames between strides.
  run: { label: 'Run', frames: [
    { parts: { rLeg: [0, -3, 0.7], lArm: [0, -2] }, dy: -1, d: 110 },
    { d: 110 },
    { parts: { lLeg: [0, -3, 0.7], rArm: [0, -2] }, dy: -1, d: 110 },
    { d: 110 },
  ] },
  skip: { label: 'Skip', frames: [
    { dy: -5, parts: { rLeg: [0, -2, 0.72], lArm: [0, -1], rArm: [0, -1] }, d: 280 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 80 },
    { dy: -3, parts: { lLeg: [0, -2, 0.72], lArm: [0, -1], rArm: [0, -1] }, d: 170 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 110 },
    { dy: -5, parts: { lLeg: [0, -2, 0.72], lArm: [0, -1], rArm: [0, -1] }, d: 280 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 80 },
    { dy: -3, parts: { rLeg: [0, -2, 0.72], lArm: [0, -1], rArm: [0, -1] }, d: 170 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 110 },
  ] },
  // A clean jump arc: CROUCH to load, STAND to push off the ground, CROUCH (tucked) at the apex,
  // then CROUCH again on landing. Only one crouch is airborne (the apex) - the old version tucked
  // the legs in the air AND landed in a crouch, so two crouch shapes stacked mid-air.
  jump: { label: 'Jump', frames: [
    { pose: 'crouch', d: 240 },
    { dy: -2, d: 150 },
    { pose: 'crouch', dy: -6, d: 300 },
    { pose: 'crouch', d: 160 },
  ] },
  // waveArm nudges ONLY the raised arm (lArmWave*/rArmWave*) so just the waving hand dips, in every
  // view - keying lArm alone left it frozen wherever the raised arm is the rArm side.
  wave: { label: 'Wave', frames: [
    { pose: 'waving', d: 240 },
    { pose: 'waving', parts: { waveArm: [0, 1] }, d: 240 },
  ] },
  nod: { label: 'Nod', shadeRow: true, frames: [
    { view: 'front', d: 260 },
    { view: 'front', headSwap: CHIBI_BOW_HALF, d: 300 },
    { view: 'front', d: 220 },
    { view: 'front', headSwap: CHIBI_BOW_HALF, d: 300 },
    { view: 'front', d: 420 },
  ] },
  // The head genuinely TURNS "no": the body stays the flat front view while the head blits are
  // swapped in from the 3/4-left family, back to the front head, then the 3/4-right family.
  // padX 2 gives the flat canvas the 3/4 head's extra width; the head dx recenters it (-2 undoes
  // the pad shift so the 24-wide turned head spans the padded canvas exactly).
  // shadeRow: the front view is normally lit head-on (no under-head shadow), but a TURNING head
  // reads as a little 3D scene - the shoulder row grounds it. All frames carry it (the body is
  // static across frames, so the row is identical everywhere and nothing flickers).
  // Timing is the reference's rhythm slowed a notch (user call): its 130ms snaps read too frantic
  // on our bigger head, which has further to travel between the two 3/4 extremes.
  shake: { label: 'Head shake', padX: 2, shadeRow: true, frames: [
    { view: 'front', headSwap: '34-left', parts: { head: [-2, 0] }, d: 175 },
    { view: 'front', headSwap: '34-right', parts: { head: [-2, 0] }, d: 175 },
    { view: 'front', headSwap: '34-left', parts: { head: [-2, 0] }, d: 175 },
    { view: 'front', headSwap: '34-right', parts: { head: [-2, 0] }, d: 175 },
    { view: 'front', parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 360 },
  ] },
  // The emote set, the reference's front-facing gestures. Clap and Surprised lean on the flat
  // order (arms draw AFTER the body, so inward-shifted hands stay visible over the chest); Bow
  // leans on the head drawing LAST (the dipped head overlays the body). Laugh throws the head
  // back without clipping the canvas top: the whole sprite rises 1px (assembler headroom) while
  // body and arms push back down - net effect head+legs up, a chuckling hop.
  // Clap: arms straight out (the T-pose table), then the standing arms swing in and up so the
  // two columns meet at the chest center - a big out-in swing. Arms draw after the body in the
  // flat order, so the met hands stay visible over the chest.
  clap: { label: 'Clap', frames: [
    { view: 'front', pose: 'tpose', d: 260 },
    { view: 'front', parts: { rArm: [4, -2], lArm: [-4, -2] }, d: 220 },
  ] },
  // Named for what it LOOKS like, not what the reference calls it: without tear/sparkle effect
  // pixels this is a rhythmic bob with the arms swinging up (a cheer), and the other is a
  // head-down shoulder hunch (a sulk). See CHIBI_ANIM_ALIASES for the old config keys.
  cheer: { label: 'Cheer', frames: [
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 200 },
    { pose: 'zombie', dy: -1, d: 220 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 180 },
    { pose: 'zombie', dy: -1, d: 220 },
    { parts: { head: [0, 1], body: [0, 1], lArm: [0, 1], rArm: [0, 1] }, d: 320 },
  ] },
  sulk: { label: 'Sulk', frames: [
    { parts: { head: [0, 1] }, d: 170 },
    { parts: { head: [0, 1], lArm: [0, -1], rArm: [0, -1] }, d: 170 },
  ] },
  joy: { label: 'Joy', frames: [
    { view: 'front', d: 280 },
    { view: 'front', pose: 'zombie', d: 140 },
    { view: 'front', pose: 'zombie', dy: -2, d: 240 },
    { view: 'front', pose: 'zombie', d: 140 },
  ] },
  surprise: { label: 'Surprised', frames: [
    { view: 'front', d: 650 },
    { view: 'front', dy: -2, headSwap: CHIBI_SURPRISE_ARMS_UP, d: 240 },
    { view: 'front', headSwap: CHIBI_SURPRISE_ARMS_SETTLE, d: 200 },
  ] },
  // A real bow folds at the waist: the arms swing down with the sinking shoulders (that is why the
  // deeper frame drops them further). No shadeRow here - the torso is bent away, so there is no flat
  // shoulder line for the head to shadow; the bent-front and top-face dims carry the depth instead.
  bow: { label: 'Bow', frames: [
    { view: 'front', d: 480 },
    { view: 'front', headSwap: CHIBI_BOW_MID, parts: { lArm: [0, 1], rArm: [0, 1] }, d: 170 },
    { view: 'front', headSwap: CHIBI_BOW_DEEP, parts: { lArm: [0, 2], rArm: [0, 2] }, d: 560 },
    { view: 'front', headSwap: CHIBI_BOW_MID, parts: { lArm: [0, 1], rArm: [0, 1] }, d: 170 },
  ] },
  bounce: { label: 'Bounce', frames: [
    { d: 260 },
    { pose: 'crouch', d: 260 },
  ] },
  dance: { label: 'Dance', frames: [
    { parts: { lArm: [0, -2, 0.86], rLeg: [0, -2, 0.72] }, d: 200 },
    { dy: -1, d: 200 },
    { parts: { rArm: [0, -2, 0.86], lLeg: [0, -2, 0.72] }, d: 200 },
    { dy: -1, d: 200 },
  ] },
  // Flying: DISABLED for now (user call). The dab's split arms + rWing/lWing groups stay in place so
  // it can be switched back on by restoring this entry and its HTML button.
  /* fly: { label: 'Flying', frames: [
    { pose: 'dab', parts: { rWing: [0, -1], lWing: [0, -1] }, dy: 1, d: 170 },
    { pose: 'dab', dy: 0, d: 120 },
    { pose: 'dab', parts: { rWing: [0, 1], lWing: [0, 1] }, dy: -1, d: 170 },
    { pose: 'dab', dy: 0, d: 120 },
  ] }, */
  shiver: { label: 'Shiver', frames: [
    { dx: -1, d: 80 },
    { dx: 1, d: 80 },
  ] },
  turn: { label: 'Turn around', frames: CHIBI_TURN_VIEWS.map((v) => ({ view: v, ax: CHIBI_TURN_AX[v], d: 220 })) },
  spin: { label: 'Spin', frames: CHIBI_TURN_VIEWS.map((v) => ({ view: v, ax: CHIBI_TURN_AX[v], d: 90 })) },
};

// Animations renamed after the fact: a config written before the rename still loads.
const CHIBI_ANIM_ALIASES = { laugh: 'cheer', cry: 'sulk' };

const CHIBI_VIEWS = {
  '34-right':     { side: false, flat: false, facing: 'right', vs: 'front' },
  '34-left':      { side: false, flat: false, facing: 'left',  vs: 'front' },
  'front':        { side: false, flat: true,  vs: 'front' },
  'back':         { side: false, flat: true,  vs: 'back' },
  'side-right':   { side: true,  facing: 'right' },
  'side-left':    { side: true,  facing: 'left' },
  'back34-right': { side: false, flat: false, facing: 'right', vs: 'back' },
  'back34-left':  { side: false, flat: false, facing: 'left',  vs: 'back' },
  'top':          { vert: 'top' },
  'bottom':       { vert: 'bottom' },
  // NOTE: the busts ('portrait' = cut at the shoulders, 'head' = head blits alone) used to live here
  // as views, which pinned them to the 3/4 projection. They are FRAMING now - see setBust - so they
  // ride on top of whichever camera and pose you have picked.
};

// 2D POSES. A pose is a REPLACEMENT part table for everything below the head; the head/hat blits
// stay from the facing's base table. The set: Zombie / Handshake / Crouching are the reference's
// poses (its "both arms up" / "one arm up" / "crouching"), decoded from its exports with a per-face
// colour probe skin (which face lands where) plus per-block pixel-matching of its steve exports
// against every steve face x rotation x mirror (which rows, which orientation, which shade).
// Waving / T-Pose / Sitting are our own, built from the same decoded vocabulary. That vocabulary:
//   - An arm reaching FORWARD (Zombie/Handshake) = the arm's OUTER side face laid horizontal at
//     shoulder height (rot, never resampled at an angle), capped with the bare hand (the arm's
//     BOTTOM face) at full brightness. The image-left arm gets its side's top 8 rows 1:1 (8px) +
//     4px hand; the image-right arm is the whole side squished to 6px + 4px hand, drawn past the
//     sprite's edge (the canvas widens and shifts per pose - see the shift/canvasW post-pass).
//   - Zombie shrinks the visible torso to a chest sliver between the raised arms plus a lower-body
//     band; the body's side face shows at its full 4px depth (no arm covers it).
//   - Waving = the far arm bent at the elbow: shoulder-to-elbow half of the side face horizontal at
//     the shoulder, elbow-to-wrist half vertical beside the head, hand on top at eye level.
//   - T-Pose = both arm FRONTS extended 1:1 sideways from the shoulder sockets (a roll keeps the
//     front face toward the viewer, so unlike a raised arm this one shows the sleeve pattern).
//   - Sitting = the standing figure with the legs swung forward: both leg FRONTS horizontal (rot,
//     boots toward the facing), the near leg lower and ahead of the far one.
//   - Crouching keeps the head put and rebuilds the lower body: the NEAR (right) arm stays the
//     standing hanging arm while the FAR (left) arm reaches FORWARD at shoulder height, the torso
//     drops to 8 rows, the FAR leg rides up beside the torso at 8 rows tall with its own side strip,
//     and the NEAR leg tucks in at half height. Total drops from 32 to 28 rows. (Near/far were
//     swapped in this note, and the leg shading had followed the note rather than the reference.)
// Poses replace everything below the head in EVERY projection family (3/4, flat, profiles, back,
// top and bottom); only the head bust skips pose parts (the headOnly guard in _composeChibi).
// `shade`/`aoTop` are per-part multipliers (through _shadeMul) replacing the standing AO rects
// where the layout no longer matches them (the per-pose AO gating in _composeChibi keeps the
// rects that still apply).
// NOTE: sub-rect sources (chest slivers, lower-body band, arm halves) assume full-height 64x64
// regions; the 8px-UV toggle keeps working for whole faces but those slivers sample the padded rows.
const CHIBI_POSE_RIGHT = {
  'zombie': {
    order: ['bodySideLow', 'bodyFrontLow', 'bodyChest', 'rArmUp', 'rArmHand', 'lArmUp', 'lArmHand', 'rLegSide', 'rLegFront', 'lLegFront'],
    parts: {
      // The forward arms are 4px tall now (were 6), so the lower body rises 2 rows to meet them and
      // fill the torso the arms used to cover - otherwise rows 20-21 read as a hole under the arms.
      bodySideLow:  { base: [16, 26, 4, 6], over: [16, 42, 4, 6], dest: [5, 21, 4, 6], shade: 0.84 },
      bodyFrontLow: { base: [20, 26, 8, 6], over: [20, 42, 8, 6], dest: [9, 21, 10, 6] },
      bodyChest:    { base: [24, 20, 4, 6], over: [24, 36, 4, 6], dest: [15, 17, 4, 6], aoTop: 0.78 },
      rArmUp:   { base: [40, 20, 4, 8], over: [40, 36, 4, 8], dest: [3, 17, 8, 4], rot: 270, mirrorX: true, shade: 0.77 },
      rArmHand: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [11, 17, 4, 4], hand: true },
      lArmUp:   { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true, dest: [19, 17, 6, 4], rot: 270, mirrorX: true, shade: 0.84 },
      lArmHand: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [25, 17, 4, 4], hand: true },
      rLegSide: CHIBI_PARTS.rLegSide, rLegFront: CHIBI_PARTS.rLegFront, lLegFront: CHIBI_PARTS.lLegFront,
    },
  },
  'handshake': {
    keepArms: true,
    order: ['rLegSide', 'rLegFront', 'lLegFront', 'bodySide', 'bodyFront', 'rArmSide', 'rArmFront', 'lArmUp', 'lArmHand'],
    parts: {
      rLegSide: CHIBI_PARTS.rLegSide, rLegFront: CHIBI_PARTS.rLegFront, lLegFront: CHIBI_PARTS.lLegFront,
      bodySide: CHIBI_PARTS.bodySide, bodyFront: CHIBI_PARTS.bodyFront,
      rArmSide: CHIBI_PARTS.rArmSide, rArmFront: CHIBI_PARTS.rArmFront,
      // Shorter than the reference's 10px reach (user call): 5px arm + 3px hand. The arm slab is
      // shaded; the PALM (the hand's bottom face at the tip) stays full-bright like the reference
      // and like the zombie palms - the light catches the face pointed at the camera. The arm's
      // first column picks up the standing crease (handshake is in aoCrease, trimmed to arm rows).
      lArmUp:   { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true, dest: [19, 17, 5, 4], rot: 270, mirrorX: true, shade: 0.84 },
      lArmHand: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [24, 17, 3, 4], wideDest: [24, 17, 4, 4], hand: true },
    },
  },
  // DAB: the near arm shoots up-right past the head on a steep diagonal (the waving strips,
  // higher and steeper); the far arm folds ACROSS the chest as a stepped band whose hand tucks
  // under the chin - the head draws last, so the face buries into the elbow for free.
  'dab': {
    order: ['rLegSide', 'rLegFront', 'lLegFront', 'bodySideT', 'bodySide', 'bodyFront', 'rArmUp', 'rArmHand', 'lArmT'],
    parts: {
      rLegSide: CHIBI_PARTS.rLegSide, rLegFront: CHIBI_PARTS.rLegFront, lLegFront: CHIBI_PARTS.lLegFront,
      bodySideT: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [5, 17, 4, 10], shade: 0.84 },
      bodySide: CHIBI_PARTS.bodySide, bodyFront: CHIBI_PARTS.bodyFront,
      // Two DIFFERENT hands, each lifted straight from another pose and dropped onto its own side.
      // image-LEFT is the ZOMBIE's LEFT-side arm+hand (its thick forward limb and full palm, verbatim
      // from the zombie table). image-RIGHT is the T-POSE's RIGHT-side arm+hand (its thin straight
      // arm, verbatim from the tpose table). Each keeps exactly the hand it had in its source pose.
      rArmUp:   { base: [40, 20, 4, 8], over: [40, 36, 4, 8], dest: [3, 17, 10, 4], rot: 270, mirrorX: true, shade: 0.77 },
      rArmHand: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [13, 17, 4, 4], hand: true },
      lArmT:    { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [19, 17, 8, 3], wideDest: [19, 17, 8, 4], rot: 270 },
    },
  },
  'waving': {
    // The occluded depth faces (drawn first, covered until you hide the occluder) come along so the
    // Parts-tab reveal works in this pose too: hide the near arm and the body's full side shows, hide
    // the near leg and the far leg's side shows - exactly like the standing view. lArmSideHid is left
    // out because the far arm is raised here, not hanging where that face assumes it is.
    order: ['bodySideHid', 'lLegSideHid', 'rLegSide', 'rLegFront', 'lLegFront', 'bodySide', 'bodyFront', 'rArmSide', 'rArmFront', 'lArmWaveSleeve', 'lArmWaveSleeveTip', 'lArmWaveArm', 'lArmWaveArmTip', 'lArmWavePalm'],
    parts: {
      bodySideHid: CHIBI_PARTS.bodySideHid, lLegSideHid: CHIBI_PARTS.lLegSideHid,
      rLegSide: CHIBI_PARTS.rLegSide, rLegFront: CHIBI_PARTS.rLegFront, lLegFront: CHIBI_PARTS.lLegFront,
      bodySide: CHIBI_PARTS.bodySide, bodyFront: CHIBI_PARTS.bodyFront,
      rArmSide: CHIBI_PARTS.rArmSide, rArmFront: CHIBI_PARTS.rArmFront,
      // Solved pixel-for-pixel against the user's reference (see wavefix.py): a DIAGONAL arm
      // entirely outside the head, teal shoulder into a bare-skin forearm into the hand.
      lArmWaveSleeve:    { base: [36, 52, 4, 3], over: [52, 52, 4, 3], dest: [19, 17, 6, 3], shade: 0.72 },
      lArmWaveSleeveTip: { base: [36, 54, 4, 1], over: [52, 54, 4, 1], dest: [19, 20, 5, 1], shade: 0.72 },
      lArmWaveArm:       { base: [36, 55, 4, 4], over: [52, 55, 4, 4], dest: [23, 15, 4, 3], wideDest: [23, 15, 4, 3], shade: 0.84 },
      lArmWaveArmTip:    { base: [36, 55, 4, 1], over: [52, 55, 4, 1], dest: [23, 18, 3, 1], wideDest: [23, 18, 3, 1], shade: 0.84 },
      lArmWavePalm:   { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [24, 13, 4, 4], wideDest: [24, 13, 4, 4], hand: true },
    },
  },
  'tpose': {
    order: ['rLegSide', 'rLegFront', 'lLegFront', 'bodySideT', 'bodySide', 'bodyFront', 'rArmTHand', 'rArmT', 'lArmT'],
    parts: {
      rLegSide: CHIBI_PARTS.rLegSide, rLegFront: CHIBI_PARTS.rLegFront, lLegFront: CHIBI_PARTS.lLegFront,
      // With the arm out of the way the torso's camera side shows at its full 4px depth (same
      // treatment the Zombie pose decoded from the reference); the arm draws over its top rows.
      bodySideT: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [5, 17, 4, 10], shade: 0.84 },
      bodySide: CHIBI_PARTS.bodySide, bodyFront: CHIBI_PARTS.bodyFront,
      // Arm FRONTS sideways, each flush against its shoulder socket (rot 90: sleeve lands at the
      // dest-right end, by the body; rot 270: sleeve at dest-left). Slim arms are 3 px thin. The
      // image-left arm is 1:1 but overlaps the torso, showing 8 px; the image-right arm hangs fully
      // clear, so it draws at 8 px outright - both visible lengths match. Its first column picks up
      // the standing far-arm crease (aoCrease includes tpose; the alpha check trims it to arm rows).
      // The image-left arm points toward the camera side, so its END CAP - the hand - is the exposed
      // 3/4 face: squished 4 -> 3 px at the tip, dimmed to the far-side composite level (0.72, deeper
      // than a plain side face - an end cap turns further from the light). Because the cap IS the
      // hand, the front slab samples only the arm's top 8 rows (sleeve + arm, no hand) 1:1 - keeping
      // the hand in both stacked them into a double-length hand. The far arm's tip points away, so it
      // stays capless and keeps its whole front (hand included) in the 8 px slab.
      rArmTHand: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [-3, 17, 3, 3], wideDest: [-2, 17, 3, 4], rot: 90, hand: true, shade: 0.72 },
      rArmT: { base: [44, 20, 4, 8], over: [44, 36, 4, 8], arm: true, dest: [0, 17, 8, 3], wideDest: [1, 17, 8, 4], rot: 90 },
      lArmT: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [19, 17, 8, 3], wideDest: [19, 17, 8, 4], rot: 270 },
    },
  },
  'sitting': {
    // Draw order carries the depth: the far arm goes under the leg band (its tip hides behind the
    // boots), but the NEAR arm draws after the legs so its hand rests ON the hip - above the legs,
    // the way a seated figure's near hand actually sits.
    order: ['bodySideSit', 'bodyFrontSit', 'lArmFront', 'lLegSit', 'lLegSitSole', 'rLegSitHip', 'rLegSit', 'rLegSitSole', 'rArmSide', 'rArmFront'],
    parts: {
      // The seated torso drops to 8 rows (the crouch treatment) - the butt sits low; the standing
      // arms keep their 10 rows and hang 2 rows past it, beside the hips.
      bodySideSit:  { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 1, 8], shade: 0.84 },
      bodyFrontSit: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [9, 17, 10, 8], aoTop: 0.88 },
      rArmSide: CHIBI_PARTS.rArmSide, rArmFront: CHIBI_PARTS.rArmFront, lArmFront: CHIBI_PARTS.lArmFront,
      // Legs swung forward along the ground, boots toward the facing. Each leg = its SIDE face as a
      // horizontal slab (hip to boot) at the standard squished 3px depth, PLUS its boot SOLE as the
      // end cap. The NEAR leg is the character's RIGHT leg (same as standing, where it carries the
      // side strip): its slab is the visible one, hip at the body's seam column. The LEFT leg is
      // the "3D part" peeking to the RIGHT of it, its own boot sole in front - the standing pair's
      // exact ordering; the two soles together span the body-front width (5 + 5 = 10px, matching
      // bodyFrontSit's 10 and the standing pair's rLegFront/lLegFront which are 5 each), legs at
      // the camera foreshortening into body-wide feet. The far sole was 4px for a long time, which
      // made it visibly one column narrower than the near one and left the pair a column short of
      // the torso above it. Every leg part carries aoTop: the torso casts a one-row shadow across
      // the top of the whole band.
      // The hip strip is the near leg's TOP face as its hip end cap on the image-left, under the
      // hanging arm. It was dropped once on the geometric argument that a seated leg's top face
      // swings rearward and cannot project from a front camera. True of a literal box, wrong for
      // this sprite: it is what draws the SEAT the figure rests on, so without it the pants stop
      // at the torso and the near hand rests on nothing. Keep it.
      rLegSitHip:  { base: [4, 16, 4, 4], over: [4, 32, 4, 4], dest: [5, 24, 4, 5], rot: 90, hand: true, shade: 0.72, aoTop: 0.88 },
      lLegSit:     { base: [16, 52, 4, 12], over: [0, 52, 4, 12], dest: [12, 24, 8, 5], rot: 270, shade: 0.72 },
      lLegSitSole: { base: [24, 48, 4, 4], over: [8, 48, 4, 4], dest: [20, 24, 5, 5], rot: 90, hand: true, shade: 0.62, aoTop: 0.88 },
      rLegSit:     { base: [0, 20, 4, 12], over: [0, 36, 4, 12], dest: [9, 24, 6, 5], rot: 270, shade: 0.84, aoTop: 0.88 },
      rLegSitSole: { base: [8, 16, 4, 4], over: [8, 32, 4, 4], dest: [15, 24, 5, 5], rot: 90, hand: true, shade: 0.72, aoTop: 0.88 },
    },
  },
  'crouch': {
    // Torso FIRST: crouch was the only pose drawing the near arm before the torso, so bodySideC's 1px
    // seam overpainted the classic arm's outer column (the reference has skin there).
    order: ['rLegSideSeamC', 'bodySideC', 'bodyFrontC', 'rArmSide', 'rArmFront', 'lArmUp', 'lArmHand', 'lLegSideC', 'lLegFrontC', 'rLegFrontC', 'rLegSideC'],
    parts: {
      rArmSide: CHIBI_PARTS.rArmSide, rArmFront: CHIBI_PARTS.rArmFront,   // the hanging arm stays the standing arm
      // A slim (Alex) arm is 3 texels wide, so rArmFront's slim dest stops a column short of the classic
      // one and left x8 bare for two rows - below where the torso seam ends (row 24) and above where the
      // folded shin starts (row 27). That is the near leg's own SIDE face, so sample it. Drawn FIRST:
      // the classic arm's 4-wide wideDest paints straight over it, so classic skins are unchanged, and
      // rLegSideC covers rows 27-28 for both - only the two bare slim rows actually show.
      rLegSideSeamC: { base: [0, 20, 4, 5], over: [0, 36, 4, 5], dest: [8, 25, 1, 4], shade: 0.72 },
      bodySideC:  { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 1, 8], shade: 0.84 },
      // No baked aoTop: crouch now takes the shared shoulder row like every other pose, and keeping
      // both stacked them (0.88 x 0.88) so the torso went darker than the arms beside it.
      bodyFrontC: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [9, 17, 10, 8] },
      lArmUp:   { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true, dest: [19, 17, 6, 5], rot: 270, mirrorX: true, shade: 0.84 },
      lArmHand: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [25, 17, 4, 5], hand: true },
      // Leg shading was INVERTED against the reference: lLeg is the FAR leg (it rides up beside the
      // torso) and takes the far-leg shadow - 0.72 = the 0.84 side dim x the 0.86 far-leg shadow on its
      // strip, 0.86 on its front - while rLeg is the NEAR leg and stays lit, carrying only the torso's
      // one-row contact shadow on top.
      lLegSideC:  { base: [16, 52, 4, 12], over: [0, 52, 4, 12], dest: [14, 21, 4, 8], shade: 0.72 },
      lLegFrontC: { base: [20, 52, 4, 12], over: [4, 52, 4, 12], dest: [18, 21, 5, 8], shade: 0.86 },
      // Sample only the leg's TOP 5 texel rows (the thigh). The full 12-row front squeezed into 4 dest
      // rows dragged the boot rows into the bottom row, so a leg that is folded away under the body
      // showed a sole edge-on at the front - the reference has thigh there.
      rLegFrontC: { base: [4, 20, 4, 5], over: [4, 36, 4, 5], dest: [9, 25, 5, 4], aoTop: 0.72 },
      rLegSideC:  { base: [0, 20, 4, 12], over: [0, 36, 4, 12], dest: [3, 27, 6, 2], rot: 90, shade: 0.72 },
    },
  },
};

// POSE TABLES FOR THE OTHER PROJECTIONS. Same replacement-table idea per view family; unchanged
// parts reference the family's base table entries. Flat/side/top families render UNSHADED like
// their standing views, so their pose parts carry no shade fields; the back-3/4 family shades like
// the front 3/4. Conventions per family:
//   - flat front: an arm reaching at the camera foreshortens into its bare fist at the shoulder;
//   - flat back / back 3/4: a forward arm points away, so only a short upper-arm stub shows; the
//     raised waving arm is fully visible from behind, diagonal on the character's left;
//   - side profiles: forward arms extend in full profile toward the facing; sitting is the ideal
//     profile (leg slab + sole); the wave emerges from behind the huge head;
//   - top: the face points image-BOTTOM (3D-verified), so forward limbs poke downward from under
//     the head, T-pose arms poke sideways, the wave hand shows beside the head. Crouch from above
//     is the standing head (the head really does cover the crouched body) and the BOTTOM view keeps
//     standing for every pose (soles-up shows nothing of a pose) - both by design.
const CHIBI_POSE_FLAT = {
  'zombie': {
    order: ['rLegFront', 'lLegFront', 'rPantFront', 'lPantFront', 'bodyFront', 'jacketFront', 'rArmFist', 'lArmFist'],
    parts: {
      rLegFront: CHIBI_PARTS_FLAT.rLegFront, lLegFront: CHIBI_PARTS_FLAT.lLegFront,
      rPantFront: CHIBI_PARTS_FLAT.rPantFront, lPantFront: CHIBI_PARTS_FLAT.lPantFront,
      bodyFront: CHIBI_PARTS_FLAT.bodyFront, jacketFront: CHIBI_PARTS_FLAT.jacketFront,
      rArmFist: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [2, 17, 4, 4], hand: true },
      lArmFist: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [14, 17, 4, 4], hand: true },
    },
  },
  'handshake': {
    order: ['rLegFront', 'lLegFront', 'rPantFront', 'lPantFront', 'bodyFront', 'jacketFront', 'rArmFront', 'rSlvFront', 'lArmFist'],
    parts: {
      rLegFront: CHIBI_PARTS_FLAT.rLegFront, lLegFront: CHIBI_PARTS_FLAT.lLegFront,
      rPantFront: CHIBI_PARTS_FLAT.rPantFront, lPantFront: CHIBI_PARTS_FLAT.lPantFront,
      bodyFront: CHIBI_PARTS_FLAT.bodyFront, jacketFront: CHIBI_PARTS_FLAT.jacketFront,
      rArmFront: CHIBI_PARTS_FLAT.rArmFront, rSlvFront: CHIBI_PARTS_FLAT.rSlvFront,
      lArmFist: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [14, 17, 4, 4], hand: true },
    },
  },
  // DAB, flat front. The pose is now built from two BORROWED limbs (see CHIBI_POSE_RIGHT.dab): the
  // character's RIGHT arm is the ZOMBIE's forward limb and the LEFT arm is the T-POSE's sideways arm.
  // Nothing is raised or diagonal any more, so nothing draws over the head. Straight-on, a forward arm
  // foreshortens to its bare fist at the shoulder (this family's stated convention), and the sideways
  // arm is simply the T-arm - both taken verbatim from this table's own zombie/tpose entries.
  'dab': {
    order: ['rLegFront', 'lLegFront', 'rPantFront', 'lPantFront', 'bodyFront', 'jacketFront', 'rArmFist', 'lArmT'],
    parts: {
      rLegFront: CHIBI_PARTS_FLAT.rLegFront, lLegFront: CHIBI_PARTS_FLAT.lLegFront,
      rPantFront: CHIBI_PARTS_FLAT.rPantFront, lPantFront: CHIBI_PARTS_FLAT.lPantFront,
      bodyFront: CHIBI_PARTS_FLAT.bodyFront, jacketFront: CHIBI_PARTS_FLAT.jacketFront,
      rArmFist: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [2, 17, 4, 4], hand: true },
      lArmT:    { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [14, 17, 8, 3], wideDest: [14, 17, 8, 4], rot: 270 },
    },
  },
  'waving': {
    order: ['rLegFront', 'lLegFront', 'rPantFront', 'lPantFront', 'bodyFront', 'jacketFront', 'rArmFront', 'rSlvFront', 'lArmWaveSleeve', 'lArmWaveSleeveTip', 'lArmWaveArm', 'lArmWaveArmTip', 'lArmWavePalm'],
    parts: {
      rLegFront: CHIBI_PARTS_FLAT.rLegFront, lLegFront: CHIBI_PARTS_FLAT.lLegFront,
      rPantFront: CHIBI_PARTS_FLAT.rPantFront, lPantFront: CHIBI_PARTS_FLAT.lPantFront,
      bodyFront: CHIBI_PARTS_FLAT.bodyFront, jacketFront: CHIBI_PARTS_FLAT.jacketFront,
      rArmFront: CHIBI_PARTS_FLAT.rArmFront, rSlvFront: CHIBI_PARTS_FLAT.rSlvFront,
      // Reference wave: a SHORT vertical arm right at the head's edge, reaching only to face height
      // (not high above), with a shaded hand. It is drawn UNDER the head, so the column that tucks
      // behind the hair is cleanly hidden (the user's "partially behind the head is fine") rather
      // than blending over the face. A shoulder stub bridges the body to the arm's base.
      // TEAL sleeve bridges the body out to the arm (broad shoulder); a SOLID SKIN forearm (base
      // only, NO sleeve overlay - the ref forearm is bare skin) rises to the shaded hand at chin
      // height. Only the shoulder is teal, matching the ref.
      // The whole diagonal sits ONE column further left than the 3/4 version's: this family's torso
      // ends at col 13 (bodyFront [6,17,8,10]) where the 3/4 torso ends at 18, so the sleeve has to
      // start at 14 to touch it. It was shifted 4 from the 3/4 dests when it needed 5, which left col
      // 14 empty and floated the entire arm off the shoulder.
      lArmWaveSleeve:    { base: [36, 52, 4, 3], over: [52, 52, 4, 3], dest: [14, 17, 6, 3], shade: 0.72 },
      lArmWaveSleeveTip: { base: [36, 54, 4, 1], over: [52, 54, 4, 1], dest: [14, 20, 5, 1], shade: 0.72 },
      lArmWaveArm:       { base: [36, 55, 4, 4], over: [52, 55, 4, 4], dest: [18, 15, 4, 3], wideDest: [18, 15, 4, 3], shade: 0.84 },
      lArmWaveArmTip:    { base: [36, 55, 4, 1], over: [52, 55, 4, 1], dest: [18, 18, 3, 1], wideDest: [18, 18, 3, 1], shade: 0.84 },
      lArmWavePalm:   { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [19, 13, 4, 4], wideDest: [19, 13, 4, 4], hand: true },
    },
  },
  'tpose': {
    order: ['rLegFront', 'lLegFront', 'rPantFront', 'lPantFront', 'bodyFront', 'jacketFront', 'rArmT', 'lArmT'],
    parts: {
      rLegFront: CHIBI_PARTS_FLAT.rLegFront, lLegFront: CHIBI_PARTS_FLAT.lLegFront,
      rPantFront: CHIBI_PARTS_FLAT.rPantFront, lPantFront: CHIBI_PARTS_FLAT.lPantFront,
      bodyFront: CHIBI_PARTS_FLAT.bodyFront, jacketFront: CHIBI_PARTS_FLAT.jacketFront,
      rArmT: { base: [44, 20, 4, 12], over: [44, 36, 4, 12], arm: true, dest: [-2, 17, 8, 3], wideDest: [-2, 17, 8, 4], rot: 90 },
      lArmT: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [14, 17, 8, 3], wideDest: [14, 17, 8, 4], rot: 270 },
    },
  },
  'sitting': {
    order: ['rLegSole', 'lLegSole', 'bodySit', 'rArmFront', 'rSlvFront', 'lArmFront', 'lSlvFront'],
    parts: {
      bodySit: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [6, 17, 8, 8] },
      rArmFront: CHIBI_PARTS_FLAT.rArmFront, rSlvFront: CHIBI_PARTS_FLAT.rSlvFront,
      lArmFront: CHIBI_PARTS_FLAT.lArmFront, lSlvFront: CHIBI_PARTS_FLAT.lSlvFront,
      rLegSole: { base: [8, 16, 4, 4], over: [8, 32, 4, 4], dest: [6, 25, 4, 4], hand: true },
      lLegSole: { base: [24, 48, 4, 4], over: [8, 48, 4, 4], dest: [10, 25, 4, 4], hand: true },
    },
  },
  'crouch': {
    // The far arm reaches FORWARD in this pose (see CHIBI_POSE_RIGHT.crouch), so straight-on it
    // foreshortens into its bare fist at the shoulder - this family's convention, verbatim from the
    // flat zombie. It used to hang as a full standing arm, which made the figure change pose on orbit.
    order: ['rLegCr', 'lLegCr', 'bodySit', 'rArmFront', 'rSlvFront', 'lArmFist'],
    parts: {
      bodySit: { base: [20, 20, 8, 12], over: [20, 36, 8, 12], dest: [6, 17, 8, 8] },
      rArmFront: CHIBI_PARTS_FLAT.rArmFront, rSlvFront: CHIBI_PARTS_FLAT.rSlvFront,
      lArmFist: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [14, 17, 4, 4], hand: true },
      rLegCr: { base: [4, 20, 4, 12], over: [4, 36, 4, 12], dest: [6, 25, 4, 4] },
      lLegCr: { base: [20, 52, 4, 12], over: [4, 52, 4, 12], dest: [10, 25, 4, 4] },
    },
  },
};

const CHIBI_POSE_FLATBACK = {
  'zombie': {
    order: ['rLegBack', 'lLegBack', 'rPantBack', 'lPantBack', 'bodyBack', 'jacketBack', 'rArmStub', 'lArmStub'],
    parts: {
      rLegBack: CHIBI_PARTS_BACK.rLegBack, lLegBack: CHIBI_PARTS_BACK.lLegBack,
      rPantBack: CHIBI_PARTS_BACK.rPantBack, lPantBack: CHIBI_PARTS_BACK.lPantBack,
      bodyBack: CHIBI_PARTS_BACK.bodyBack, jacketBack: CHIBI_PARTS_BACK.jacketBack,
      rArmStub: { base: [52, 20, 4, 4], over: [52, 36, 4, 4], arm: true, slimShiftX: true, dest: [14, 17, 4, 4], shade: 0.84 },
      lArmStub: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 4, 4], shade: 0.84 },
    },
  },
  'handshake': {
    order: ['rLegBack', 'lLegBack', 'rPantBack', 'lPantBack', 'bodyBack', 'jacketBack', 'rArmBack', 'rSlvBack', 'lArmStub'],
    parts: {
      rLegBack: CHIBI_PARTS_BACK.rLegBack, lLegBack: CHIBI_PARTS_BACK.lLegBack,
      rPantBack: CHIBI_PARTS_BACK.rPantBack, lPantBack: CHIBI_PARTS_BACK.lPantBack,
      bodyBack: CHIBI_PARTS_BACK.bodyBack, jacketBack: CHIBI_PARTS_BACK.jacketBack,
      rArmBack: CHIBI_PARTS_BACK.rArmBack, rSlvBack: CHIBI_PARTS_BACK.rSlvBack,
      lArmStub: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 4, 4], shade: 0.84 },
    },
  },
  // Back dab: same two borrowed limbs as every other family now (right arm = zombie forward, left arm
  // = tpose sideways). Straight from behind the forward arm points away, so it keeps this family's
  // 4px shoulder-stub convention; the sideways arm is the T-arm, taken verbatim from the entries below.
  'dab': {
    order: ['rLegBack', 'lLegBack', 'rPantBack', 'lPantBack', 'bodyBack', 'jacketBack', 'rArmStub', 'lArmT'],
    parts: {
      rLegBack: CHIBI_PARTS_BACK.rLegBack, lLegBack: CHIBI_PARTS_BACK.lLegBack,
      rPantBack: CHIBI_PARTS_BACK.rPantBack, lPantBack: CHIBI_PARTS_BACK.lPantBack,
      bodyBack: CHIBI_PARTS_BACK.bodyBack, jacketBack: CHIBI_PARTS_BACK.jacketBack,
      rArmStub: { base: [52, 20, 4, 4], over: [52, 36, 4, 4], arm: true, slimShiftX: true, dest: [14, 17, 4, 4], shade: 0.84 },
      lArmT:    { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [-2, 17, 8, 3], wideDest: [-2, 17, 8, 4], rot: 90 },
    },
  },
  'waving': {
    order: ['rLegBack', 'lLegBack', 'rPantBack', 'lPantBack', 'bodyBack', 'jacketBack', 'rArmBack', 'rSlvBack', 'lArmWaveSleeve', 'lArmWaveSleeveTip', 'lArmWaveArm', 'lArmWaveArmTip', 'lArmWavePalm'],
    parts: {
      rLegBack: CHIBI_PARTS_BACK.rLegBack, lLegBack: CHIBI_PARTS_BACK.lLegBack,
      rPantBack: CHIBI_PARTS_BACK.rPantBack, lPantBack: CHIBI_PARTS_BACK.lPantBack,
      bodyBack: CHIBI_PARTS_BACK.bodyBack, jacketBack: CHIBI_PARTS_BACK.jacketBack,
      rArmBack: CHIBI_PARTS_BACK.rArmBack, rSlvBack: CHIBI_PARTS_BACK.rSlvBack,
      // Short vertical wave at the head's LEFT edge (seen from behind), under the head; back faces.
      lArmWaveSleeve:    { base: [44, 52, 4, 3], over: [60, 52, 4, 3], arm: true, slimShiftX: true, dest: [0, 17, 6, 3], shade: 0.72 },
      lArmWaveSleeveTip: { base: [44, 54, 4, 1], over: [60, 54, 4, 1], arm: true, slimShiftX: true, dest: [1, 20, 5, 1], shade: 0.72 },
      lArmWaveArm:       { base: [44, 55, 4, 8], over: [60, 55, 4, 8], arm: true, slimShiftX: true, dest: [-2, 15, 4, 3], wideDest: [-2, 15, 4, 3], shade: 0.84 },
      lArmWaveArmTip:    { base: [44, 55, 4, 1], over: [60, 55, 4, 1], arm: true, slimShiftX: true, dest: [-1, 18, 3, 1], wideDest: [-1, 18, 3, 1], shade: 0.84 },
      lArmWavePalm:   { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [-3, 13, 4, 4], wideDest: [-3, 13, 4, 4], hand: true },
    },
  },
  'tpose': {
    order: ['rLegBack', 'lLegBack', 'rPantBack', 'lPantBack', 'bodyBack', 'jacketBack', 'rArmT', 'lArmT'],
    parts: {
      rLegBack: CHIBI_PARTS_BACK.rLegBack, lLegBack: CHIBI_PARTS_BACK.lLegBack,
      rPantBack: CHIBI_PARTS_BACK.rPantBack, lPantBack: CHIBI_PARTS_BACK.lPantBack,
      bodyBack: CHIBI_PARTS_BACK.bodyBack, jacketBack: CHIBI_PARTS_BACK.jacketBack,
      rArmT: { base: [52, 20, 4, 12], over: [52, 36, 4, 12], arm: true, slimShiftX: true, dest: [14, 17, 8, 3], wideDest: [14, 17, 8, 4], rot: 270 },
      lArmT: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [-2, 17, 8, 3], wideDest: [-2, 17, 8, 4], rot: 90 },
    },
  },
  'sitting': {
    // The legs point straight AWAY, so they foreshorten to their end caps - the exact mirror of the
    // flat FRONT view, which shows the two SOLES. Sitting rotates each leg until its sole faces
    // forward, which swings its TOP face to the rear: from behind those two top faces are what you
    // see, so they draw as the leg-width pair under the butt (without them the figure reads as
    // sitting ON its legs). Limbs swap sides from behind, so the RIGHT leg is on the image-right.
    order: ['rLegTopB', 'lLegTopB', 'bodySitB', 'rArmBack', 'rSlvBack', 'lArmBack', 'lSlvBack'],
    parts: {
      bodySitB: { base: [32, 20, 8, 12], over: [32, 36, 8, 12], dest: [6, 17, 8, 8] },
      rArmBack: CHIBI_PARTS_BACK.rArmBack, rSlvBack: CHIBI_PARTS_BACK.rSlvBack,
      lArmBack: CHIBI_PARTS_BACK.lArmBack, lSlvBack: CHIBI_PARTS_BACK.lSlvBack,
      rLegTopB: { base: [4, 16, 4, 4], over: [4, 32, 4, 4], dest: [10, 25, 4, 4], hand: true },
      lLegTopB: { base: [20, 48, 4, 4], over: [4, 48, 4, 4], dest: [6, 25, 4, 4], hand: true },
    },
  },
  'crouch': {
    // No lSlvBack: it is the FULL 10-row standing sleeve and was listed after the 4-row stub, so rows
    // 21-26 rendered a sleeve with no arm inside it. lArmStub already merges its own overlay via
    // base/over, exactly like the flat-back zombie and handshake stubs.
    order: ['rLegSitB', 'lLegSitB', 'bodySitB', 'rArmBack', 'rSlvBack', 'lArmStub'],
    parts: {
      // Sample 10 of the torso's 12 texel rows. Squeezing all 12 into 8 dest rows put the last one on
      // texel 11 - the WAISTBAND - so a crouched back view grew a band of trouser blue under a shirt
      // that had already ended. The reference stops at texel 9: shirt the whole way down to the legs.
      bodySitB: { base: [32, 20, 8, 10], over: [32, 36, 8, 10], dest: [6, 17, 8, 8] },
      rArmBack: CHIBI_PARTS_BACK.rArmBack, rSlvBack: CHIBI_PARTS_BACK.rSlvBack,
      lArmStub: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 4, 4], shade: 0.84 },
      // The kneeling leg's shin is folded flat, so from straight behind you see its SOLE, not its back -
      // the one thing that tells this pose apart from a plain squat in this camera. Full-bright like
      // every other sole/palm cap. (Verified against the reference edit: the 4x4 lands the leg's bottom
      // face texels exactly.) The other leg keeps its back face: its knee is up, shin dropping away.
      rLegSitB: { base: [8, 16, 4, 4], over: [8, 32, 4, 4], dest: [10, 25, 4, 4], hand: true, mirrorX: true },
      lLegSitB: { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [6, 25, 4, 4] },
    },
  },
};

const CHIBI_POSE_SIDE_RIGHT = {
  'zombie': {
    order: ['lLegProf', 'rLegProf', 'bodyProf', 'lArmZ', 'rArmZ'],
    parts: {
      lLegProf: CHIBI_PARTS_SIDE_RIGHT.lLegProf, rLegProf: CHIBI_PARTS_SIDE_RIGHT.rLegProf,
      bodyProf: CHIBI_PARTS_SIDE_RIGHT.bodyProf,
      // Both arms reach toward the facing. The near arm's slab starts AT THE SHOULDER, over the
      // body column's top rows; the far (left) arm emerges from behind the body one row higher
      // and peeks over the near arm along the top.
      // NO palm cap here: a forward arm in a pure profile lies IN the image plane, so its bottom
      // face points image-right and is seen edge-on - it cannot show. The side-face slab already
      // spans the WHOLE 12-texel arm (hand included) at the standing profile's 12 -> 10 length, so
      // the cap was also 3px of extra reach on top of a complete arm.
      lArmZ:    { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [12, 16, 6, 4], rot: 270, mirrorX: true, shade: 0.84 },
      rArmZ:    { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [8, 17, 10, 4], rot: 270, mirrorX: true },
    },
  },
  'handshake': {
    keepArms: true,
    order: ['lLegProf', 'rLegProf', 'lArmProf', 'bodyProf', 'rArmH'],
    parts: {
      lLegProf: CHIBI_PARTS_SIDE_RIGHT.lLegProf, rLegProf: CHIBI_PARTS_SIDE_RIGHT.rLegProf,
      lArmProf: CHIBI_PARTS_SIDE_RIGHT.lArmProf, bodyProf: CHIBI_PARTS_SIDE_RIGHT.bodyProf,
      // In profile the raised arm is the NEAR one (the arm this camera shows). Its slab starts AT
      // THE SHOULDER - drawn over the body column's top rows, since the arm is nearer the camera -
      // and runs out at the standing profile's 12 -> 10 length; the torso side shows below it and
      // the far arm hangs hidden behind the body.
      // NO palm cap (see the zombie profile): the reaching arm lies in the image plane here, so its
      // bottom face is edge-on to this camera, and the slab is already the whole 12-texel arm.
      rArmH:    { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [8, 17, 10, 4], rot: 270, mirrorX: true },
    },
  },
  // Profile dab: right arm = the zombie/handshake forward slab (no palm cap - it is edge-on here), and
  // the LEFT arm now points straight away from this camera, so like the profile T-pose it is fully
  // hidden behind the body and is not drawn at all.
  'dab': {
    order: ['lLegProf', 'rLegProf', 'bodyProf', 'rArmExt'],
    parts: {
      lLegProf: CHIBI_PARTS_SIDE_RIGHT.lLegProf, rLegProf: CHIBI_PARTS_SIDE_RIGHT.rLegProf,
      bodyProf: CHIBI_PARTS_SIDE_RIGHT.bodyProf,
      rArmExt: { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [8, 17, 10, 4], rot: 270, mirrorX: true },
    },
  },
  'waving': {
    order: ['lLegProf', 'rLegProf', 'lArmProf', 'bodyProf', 'rArmWaveSleeve', 'rArmWaveSleeveTip', 'rArmWaveArm', 'rArmWaveArmTip', 'rArmWavePalm'],
    parts: {
      lLegProf: CHIBI_PARTS_SIDE_RIGHT.lLegProf, rLegProf: CHIBI_PARTS_SIDE_RIGHT.rLegProf,
      lArmProf: CHIBI_PARTS_SIDE_RIGHT.lArmProf, bodyProf: CHIBI_PARTS_SIDE_RIGHT.bodyProf,
      // The NEAR arm waves: its SHOULDER block stays over the body column's top rows (the arm is
      // nearer the camera), the torso side shows below, the far arm hides behind the body, and the
      // arm passes behind the huge head with its diagonal emerging beside the hat.
      // Short vertical wave in profile: the near arm rises just in front of the head, under it.
      rArmWaveSleeve:    { base: [40, 20, 4, 3], over: [40, 36, 4, 3], dest: [12, 17, 5, 3], shade: 0.72 },
      rArmWaveSleeveTip: { base: [40, 22, 4, 1], over: [40, 38, 4, 1], dest: [12, 20, 4, 1], shade: 0.72 },
      rArmWaveArm:       { base: [40, 23, 4, 8], over: [40, 39, 4, 8], dest: [16, 15, 4, 3], shade: 0.84 },
      rArmWaveArmTip:    { base: [40, 23, 4, 1], over: [40, 39, 4, 1], dest: [16, 18, 3, 1], shade: 0.84 },
      rArmWavePalm:   { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [17, 13, 4, 4], wideDest: [17, 13, 4, 4], hand: true },
    },
  },
  'tpose': {
    order: ['lLegProf', 'rLegProf', 'bodyProf', 'rArmFistS'],
    parts: {
      lLegProf: CHIBI_PARTS_SIDE_RIGHT.lLegProf, rLegProf: CHIBI_PARTS_SIDE_RIGHT.rLegProf,
      bodyProf: CHIBI_PARTS_SIDE_RIGHT.bodyProf,
      // Arms point at and away from the camera; the near fist faces the viewer at the shoulder.
      rArmFistS: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [8, 17, 4, 4], hand: true },
    },
  },
  'sitting': {
    order: ['bodySitS', 'lArmProf', 'rArmProf', 'rLegSitS', 'rLegSitSole'],
    parts: {
      bodySitS: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 4, 8] },
      lArmProf: CHIBI_PARTS_SIDE_RIGHT.lArmProf, rArmProf: CHIBI_PARTS_SIDE_RIGHT.rArmProf,
      rLegSitS: { base: [0, 20, 4, 12], over: [0, 36, 4, 12], dest: [8, 25, 8, 4], rot: 270 },
      rLegSitSole: { base: [8, 16, 4, 4], over: [8, 32, 4, 4], dest: [16, 25, 3, 4], rot: 90, hand: true, shade: 0.72 },
    },
  },
  'crouch': {
    // The far arm reaches FORWARD here, so in profile it clears the body's front edge and must show -
    // the zombie profile's slab verbatim (no palm cap: it is edge-on in a pure profile). It sits a row
    // lower than the zombie's because there is no second reaching arm for it to peek over.
    // A KNEEL, not a squat: the far leg's shin folds back flat along the ground with the knee under
    // the hip, and the near leg's thigh swings FORWARD with its shin dropping to a planted foot. That
    // is the whole point of the pose in profile - it has fore/aft extent, where a squat would be the
    // torso's 4px depth column and nothing else. Far leg first (behind), then the torso, then the
    // near leg over it, so the near shin reads in front of the folded one.
    // Which leg does what matches the front 3/4, where the FAR (left) leg rides up beside the torso
    // with its knee raised and the NEAR (right) leg folds its shin back along the ground. Drawn far
    // leg last so the raised knee reads in front of the folded one, as it does in the 3/4.
    order: ['rLegLyingS', 'bodySitS', 'lArmProf', 'rArmProf', 'lLegUpThighS', 'lLegUpShinS', 'lArmZ'],
    parts: {
      bodySitS: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [8, 17, 4, 8] },
      // The arms stop at the hip, as the torso does. The standing profile arm is 10 rows and would
      // hang two rows PAST the crouched hip, straight over the kneeling thigh underneath it.
      lArmProf: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [8, 17, 4, 8] },
      rArmProf: { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [8, 17, 4, 8] },
      // BACK leg (the character's right) LIES FLAT: the whole leg, hip to boot, as ONE rectangle on
      // the ground with the boot at the rear. Not a thigh block plus a shin - splitting it built a
      // stepped corner where the pose wants a single laid-down limb.
      rLegLyingS: { base: [0, 20, 4, 12], over: [0, 36, 4, 12], dest: [5, 25, 7, 3], rot: 90 },
      // FAR leg (the character's left) has its KNEE UP: the thigh rides up BESIDE the torso as a plain
      // 4-wide column - not swung forward flat - with the shin dropping straight to a planted foot, so
      // the forward arm comes to rest on top of the raised knee. Far-leg dim, the 3/4's 0.72.
      lLegUpThighS: { base: [16, 52, 4, 6], over: [0, 52, 4, 6], dest: [12, 21, 4, 4], shade: 0.72 },
      lLegUpShinS:  { base: [16, 58, 4, 6], over: [0, 58, 4, 6], dest: [12, 25, 4, 3], shade: 0.72 },
      lArmZ: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [12, 17, 6, 4], rot: 270, mirrorX: true, shade: 0.84 },
    },
  },
};

const CHIBI_POSE_BACK_RIGHT = {
  'zombie': {
    // The standing bodySide is a 1px seam ONLY because the hanging near arm covers the torso's other
    // three depth columns. Both arms go forward here and leave 4-row stubs, so from row 21 down those
    // columns were drawn by nothing at all and the torso ended in a notch. Restore the side face at its
    // full 4px depth - the same "arm gone -> show the torso side at full depth" that tpose's bodySideT
    // already does in both families, and what the front table's bodySideLow does.
    // BOTH arms reach forward. Forward keeps projecting image-RIGHT in the back 3/4 (only the limb
    // sides flip when you go behind, not the facing), so the arms are not shoulder stubs - each is its
    // whole arm laid horizontal and receding to the right, ending in the bare-skin hand, which is the
    // last texels of the slab. No palm CAP: the fist's bottom face points away from a back camera. The
    // FAR (left) arm draws before the torso so the body occludes the part of it that passes behind;
    // the NEAR (right) arm draws last, clear of the body.
    order: ['lLegBack', 'rLegBack', 'rLegSide', 'lArmFwdZ', 'bodySideZ', 'bodySide', 'bodyBack', 'rArmFwdZ'],
    parts: {
      lLegBack: CHIBI_PARTS_BACK_RIGHT.lLegBack, rLegBack: CHIBI_PARTS_BACK_RIGHT.rLegBack,
      rLegSide: CHIBI_PARTS_BACK_RIGHT.rLegSide,
      bodySideZ: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [15, 17, 4, 10], side: true },
      bodySide: CHIBI_PARTS_BACK_RIGHT.bodySide, bodyBack: CHIBI_PARTS_BACK_RIGHT.bodyBack,
      lArmFwdZ: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [1, 17, 10, 4], rot: 270, mirrorX: true, shade: 0.72 },
      rArmFwdZ: { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [15, 17, 12, 4], rot: 270, mirrorX: true, shade: 0.84 },
    },
  },
  'handshake': {
    keepArms: true,
    order: ['lLegBack', 'rLegBack', 'rLegSide', 'bodySide', 'bodyBack', 'lArmStub', 'rArmBack', 'rArmSide'],
    parts: {
      lLegBack: CHIBI_PARTS_BACK_RIGHT.lLegBack, rLegBack: CHIBI_PARTS_BACK_RIGHT.rLegBack,
      rLegSide: CHIBI_PARTS_BACK_RIGHT.rLegSide,
      bodySide: CHIBI_PARTS_BACK_RIGHT.bodySide, bodyBack: CHIBI_PARTS_BACK_RIGHT.bodyBack,
      rArmBack: CHIBI_PARTS_BACK_RIGHT.rArmBack, rArmSide: CHIBI_PARTS_BACK_RIGHT.rArmSide,
      lArmStub: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 3, 4], wideDest: [1, 17, 4, 4], shade: 0.84 },
    },
  },
  // Back-3/4 dab: right arm = the zombie forward stub pair (it points away from this camera), left arm
  // = the tpose sideways arm, and bodySideT exposes the torso's full 4px depth now that the near
  // shoulder is empty - exactly what the front-3/4 dab does with its own bodySideT.
  'dab': {
    order: ['lLegBack', 'rLegBack', 'rLegSide', 'bodySideT', 'bodySide', 'bodyBack', 'lArmT', 'rArmStub', 'rArmSideStub'],
    parts: {
      lLegBack: CHIBI_PARTS_BACK_RIGHT.lLegBack, rLegBack: CHIBI_PARTS_BACK_RIGHT.rLegBack,
      rLegSide: CHIBI_PARTS_BACK_RIGHT.rLegSide,
      bodySideT: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [15, 17, 4, 10], shade: 0.84 },
      bodySide: CHIBI_PARTS_BACK_RIGHT.bodySide, bodyBack: CHIBI_PARTS_BACK_RIGHT.bodyBack,
      lArmT:        { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [-3, 17, 8, 3], wideDest: [-3, 17, 8, 4], rot: 90 },
      rArmStub:     { base: [52, 20, 4, 4], over: [52, 36, 4, 4], arm: true, slimShiftX: true, dest: [16, 17, 3, 4], wideDest: [15, 17, 4, 4], shade: 0.84 },
      rArmSideStub: { base: [40, 20, 4, 4], over: [40, 36, 4, 4], dest: [19, 17, 3, 4], side: true },
    },
  },
  'waving': {
    // Occluded reveal faces so the Parts-tab reveal works here too (see the 3/4-right wave note).
    order: ['bodySideHid', 'lLegSideHid', 'lLegBack', 'rLegBack', 'rLegSide', 'lArmWaveSleeve', 'lArmWaveSleeveTip', 'lArmWaveArm', 'lArmWaveArmTip', 'lArmWavePalm', 'bodySide', 'bodyBack', 'rArmBack', 'rArmSide'],
    parts: {
      bodySideHid: CHIBI_PARTS_BACK_RIGHT.bodySideHid, lLegSideHid: CHIBI_PARTS_BACK_RIGHT.lLegSideHid,
      lLegBack: CHIBI_PARTS_BACK_RIGHT.lLegBack, rLegBack: CHIBI_PARTS_BACK_RIGHT.rLegBack,
      rLegSide: CHIBI_PARTS_BACK_RIGHT.rLegSide,
      bodySide: CHIBI_PARTS_BACK_RIGHT.bodySide, bodyBack: CHIBI_PARTS_BACK_RIGHT.bodyBack,
      rArmBack: CHIBI_PARTS_BACK_RIGHT.rArmBack, rArmSide: CHIBI_PARTS_BACK_RIGHT.rArmSide,
      lArmStub4: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 3, 4], wideDest: [1, 17, 4, 4] },
      lArmWaveSleeve:    { base: [44, 52, 4, 3], over: [60, 52, 4, 3], arm: true, slimShiftX: true, dest: [1, 17, 6, 3], shade: 0.72 },
      lArmWaveSleeveTip: { base: [44, 54, 4, 1], over: [60, 54, 4, 1], arm: true, slimShiftX: true, dest: [2, 20, 5, 1], shade: 0.72 },
      lArmWaveArm:       { base: [44, 55, 4, 8], over: [60, 55, 4, 8], arm: true, slimShiftX: true, dest: [-1, 15, 4, 3], wideDest: [-1, 15, 4, 3], shade: 0.84 },
      lArmWaveArmTip:    { base: [44, 55, 4, 1], over: [60, 55, 4, 1], arm: true, slimShiftX: true, dest: [0, 18, 3, 1], wideDest: [0, 18, 3, 1], shade: 0.84 },
      lArmWavePalm:   { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [-2, 13, 4, 4], wideDest: [-2, 13, 4, 4], hand: true },
    },
  },
  'tpose': {
    order: ['lLegBack', 'rLegBack', 'rLegSide', 'bodySideT', 'bodySide', 'bodyBack', 'lArmT', 'rArmT', 'rArmTHand'],
    parts: {
      lLegBack: CHIBI_PARTS_BACK_RIGHT.lLegBack, rLegBack: CHIBI_PARTS_BACK_RIGHT.rLegBack,
      rLegSide: CHIBI_PARTS_BACK_RIGHT.rLegSide,
      bodySideT: { base: [16, 20, 4, 12], over: [16, 36, 4, 12], dest: [15, 17, 4, 10], shade: 0.84 },
      bodySide: CHIBI_PARTS_BACK_RIGHT.bodySide, bodyBack: CHIBI_PARTS_BACK_RIGHT.bodyBack,
      lArmT: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [-3, 17, 8, 3], wideDest: [-3, 17, 8, 4], rot: 90 },
      rArmT: { base: [52, 20, 4, 12], over: [52, 36, 4, 12], arm: true, slimShiftX: true, dest: [15, 17, 8, 3], wideDest: [15, 17, 8, 4], rot: 270 },
      rArmTHand: { base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4], dest: [23, 17, 3, 3], wideDest: [23, 17, 3, 4], rot: 90, hand: true, shade: 0.72 },
    },
  },
  'sitting': {
    // Seated seen from BEHIND. Sitting rotates each leg so the sole points forward, which re-aims its
    // faces: the leg's FRONT face turns UP (the top-of-thigh surface a back camera looks down on), its
    // TOP face turns BACKWARD - straight at this camera, the one face only the back views can see -
    // and the SOLE turns away and is hidden, so no sole is drawn here (that was the front view's cap).
    // Direction: CHIBI_VIEWS keeps facing 'right' for the back 3/4 too (only `vs` flips), so forward
    // still projects image-RIGHT exactly like the front 3/4 - the limbs swap sides, the facing does
    // not. Each leg is therefore its TOP face as the rear/hip cap then its FRONT face as the slab
    // running right, at the front view's leg width. The character's RIGHT leg is the near one (image-
    // right and lower, drawn last); the LEFT leg sits further back, image-left and a row higher.
    // Legs draw BEFORE the arms so the hands rest ABOVE them.
    order: ['bodySideSitB', 'bodyBackSit', 'lLegSitTopB', 'lLegSitB', 'rLegSitTopB', 'rLegSitB', 'lArmBack', 'rArmBack', 'rArmSide'],
    parts: {
      bodyBackSit: { base: [32, 20, 8, 12], over: [32, 36, 8, 12], dest: [5, 17, 10, 8] },
      bodySideSitB: { base: [16, 24, 4, 6], over: [16, 40, 4, 6], dest: [15, 21, 4, 4], side: true },
      lLegSitTopB: { base: [20, 48, 4, 4],  over: [4, 48, 4, 4],   dest: [5, 25, 5, 5], rot: 90, hand: true, shade: 0.62 },
      lLegSitB:    { base: [20, 52, 4, 12], over: [4, 52, 4, 12],  dest: [10, 25, 10, 5], rot: 270, shade: 0.72 },
      rLegSitTopB: { base: [4, 16, 4, 4],   over: [4, 32, 4, 4],   dest: [10, 25, 5, 5], rot: 90, hand: true, shade: 0.72 },
      rLegSitB:    { base: [4, 20, 4, 12],  over: [4, 36, 4, 12],  dest: [15, 25, 10, 5], rot: 270, shade: 0.84 },
      lArmBack: CHIBI_PARTS_BACK_RIGHT.lArmBack, rArmBack: CHIBI_PARTS_BACK_RIGHT.rArmBack,
      rArmSide: CHIBI_PARTS_BACK_RIGHT.rArmSide,
    },
  },
  'crouch': {
    // Seen from BEHIND the depth order inverts: the leg whose knee is up stands on the far side of the
    // torso, so it goes down FIRST and the body hides it, while the leg folded flat lies nearer the
    // camera than the hips and draws over the body. Front-first ordering put the raised knee in front
    // of the chest, which is what made this camera read as a different pose from the others.
    order: ['bodySideSitB', 'bodyBackSit', 'lArmStub', 'lArmFarBR', 'rArmSideBR', 'rArmBack', 'rArmReachBR', 'lLegKneeBR', 'lLegUpSideBR', 'lLegUpBR', 'rLegLyingBR', 'lLegSoleBR'],
    parts: {
      // Shirt rows only, exactly as in the flat back - see the note there.
      bodyBackSit: { base: [32, 20, 8, 10], over: [32, 36, 8, 10], dest: [5, 17, 10, 8] },
      bodySideSitB: { base: [16, 24, 4, 6], over: [16, 40, 4, 6], dest: [15, 21, 4, 4], side: true },
      // No shade, matching the arm below it: this whole limb hangs clear of the body with nothing
      // above to cast on it. Only the reaching arm's outboard strip is dimmed, for depth.
      lArmStub: { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true, dest: [2, 17, 3, 4], wideDest: [1, 17, 4, 4] },
      // SHOULDER ONLY. The standing arm hangs a second hand down the flank, and this pose already has
      // one - the raised arm reaching at shoulder height. Two hands on one side is the tell. Keep the
      // 4 rows that fill the shoulder line and let the raised limb be the only hand.
      rArmBack:    { base: [52, 20, 4, 4], over: [52, 36, 4, 4], dest: [15, 17, 4, 4], arm: true },
      rArmSideBR:  { base: [40, 20, 4, 4], over: [40, 36, 4, 4], dest: [18, 17, 4, 4], side: true },
            // The raised knee peeks up past the hip for three rows before the leg proper starts.
      lLegKneeBR: { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [19, 22, 2, 3], shade: 0.785 },
      // The same KNEEL the front 3/4 draws, seen from behind: the character's LEFT leg has its knee
      // up and rides beside the torso, the RIGHT leg folds its shin back along the ground. Only the
      // image SIDES swap when you go behind (the facing does not), so the raised leg moves to
      // image-left and the folded shin to image-right, and every face becomes the BACK face.
      // The legs live in the BOTTOM rows only. Running them from row 21 filled the whole flank with
      // thigh and buried the arm that hangs there - in the reference that space is arm, and the legs
      // are the last four rows. Crouching folds the legs up under the hips; it does not stretch them
      // alongside the torso.
      lLegUpBR:     { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [12, 25, 5, 4], shade: 0.90 },
      lLegUpSideBR: { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [17, 25, 4, 4], shade: 0.785 },
      rLegLyingBR:  { base: [12, 20, 4, 8], over: [12, 36, 4, 8], dest: [4, 25, 8, 4], rot: 270, shade: 0.75 },
      // ^ the folded leg lies ACROSS the body, nearer the camera than the hip it crosses, so it takes a
      // contact shadow from the torso above it - measured at 0.83 of the unshadowed leg on the reference.
      // Same sole the flat back shows, at the trailing end of the folded shin - image-LEFT here, per
      // the reference edit. Left leg's bottom face; its overlay sits 16 texels LEFT of the base.
      lLegSoleBR: { base: [24, 48, 4, 4], over: [8, 48, 4, 4], dest: [0, 25, 4, 4], hand: true },
      // The reaching arm at shoulder height, clear of the torso, and the far arm at the other flank.
      rArmReachBR: { base: [52, 28, 4, 4], over: [52, 44, 4, 4], dest: [22, 17, 4, 4] },
      // No shade: this arm hangs clear of the body, with nothing above to cast on it - unlike the folded
      // leg, which crosses the torso and does take a contact shadow.
      lArmFarBR:   { base: [44, 60, 4, 4], over: [60, 60, 4, 4], arm: true, slimShiftX: true, dest: [2, 21, 3, 4], wideDest: [1, 21, 4, 4] },
    },
  },
};

// BOTTOM: front = image-BOTTOM (3D-verified with the quadrant probe: camera basis at (0,-5,-0.001)
// puts world -Z at screen-up and the model faces +Z). A forward arm shows its underside - the
// original FRONT face - as a strip running from the shoulder chip toward the front; its standing
// hand chip leaves the hip. Sideways T-pose arms show their inner faces as strips with the hands at
// the far ends; sitting legs run forward ending in their soles. Crouch keeps the standing feet.
const CHIBI_POSE_BOTTOM = {
  'zombie': {
    order: ['bodyBot', 'lArmFwd', 'rArmFwd', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
      // Full 12px reach, same reasoning as the handshake below: perpendicular to this camera, so no
      // foreshortening, and this family draws limbs 1:1.
      lArmFwd: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [2, 7, 4, 12], mirrorX: true },
      rArmFwd: { base: [44, 20, 4, 12], over: [44, 36, 4, 12], arm: true, dest: [14, 7, 4, 12], mirrorX: true },
    },
  },
  'handshake': {
    // Straight down the arm is PERPENDICULAR to this camera, so it is not foreshortened at all: at
    // this family's 1:1 limb scale (bodyBot 8 texels -> 8px, the hand chip 4 -> 4px) the 12-texel arm
    // must read a full 12px. At 8 it stopped inside the head square and only its 3-row sleeve told it
    // apart from the skin-coloured head, which is what made the reach look stunted.
    order: ['bodyBot', 'lArmFwd', 'rArmBot', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, rArmBot: CHIBI_PARTS_BOTTOM.rArmBot,
      lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
      lArmFwd: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [2, 7, 4, 12], mirrorX: true },
    },
  },
  'waving': {
    // The raised arm is above the body - from straight below only its chip disappears from the hip.
    order: ['bodyBot', 'rArmBot', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, rArmBot: CHIBI_PARTS_BOTTOM.rArmBot,
      lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
    },
  },
  // Dab from below: both arms are horizontal at shoulder height now, so both show their undersides -
  // the right one reaching forward (zombie treatment), the left one straight out sideways (T-pose).
  'dab': {
    order: ['bodyBot', 'lArmSide', 'rArmFwd', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot,
      lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
      rArmFwd:  { base: [44, 20, 4, 12], over: [44, 36, 4, 12], arm: true, dest: [14, 7, 4, 12], mirrorX: true },
      lArmSide: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [-2, 7, 8, 4], rot: 90, mirrorX: true },
    },
  },
  'tpose': {
    order: ['bodyBot', 'lArmSide', 'rArmSide', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
      lArmSide: { base: [32, 52, 4, 12], over: [48, 52, 4, 12], dest: [-2, 7, 8, 4], rot: 90, mirrorX: true },
      rArmSide: { base: [48, 20, 4, 12], over: [48, 36, 4, 12], slimShiftX: true, dest: [14, 7, 8, 4], rot: 270, mirrorX: true },
    },
  },
  'sitting': {
    order: ['bodyBot', 'lArmBot', 'rArmBot', 'lLegFwd', 'rLegFwd', 'lLegSole', 'rLegSole'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, lArmBot: CHIBI_PARTS_BOTTOM.lArmBot, rArmBot: CHIBI_PARTS_BOTTOM.rArmBot,
      lLegFwd: { base: [28, 52, 4, 12], over: [12, 52, 4, 12], dest: [6, 7, 4, 6], mirrorX: true },
      rLegFwd: { base: [12, 20, 4, 12], over: [12, 36, 4, 12], dest: [10, 7, 4, 6], mirrorX: true },
      lLegSole: { base: [24, 48, 4, 4], over: [8, 48, 4, 4], dest: [6, 13, 4, 4], mirrorX: true },
      rLegSole: { base: [8, 16, 4, 4], over: [8, 32, 4, 4], dest: [10, 13, 4, 4], mirrorX: true },
    },
  },
  // Crouch keeps the standing soles (tucked legs show nothing new from below), but its far arm reaches
  // forward, so its underside strips across the head exactly like the handshake's.
  'crouch': {
    order: ['bodyBot', 'lArmFwd', 'rArmBot', 'lLegBot', 'rLegBot'],
    parts: {
      bodyBot: CHIBI_PARTS_BOTTOM.bodyBot, rArmBot: CHIBI_PARTS_BOTTOM.rArmBot,
      lLegBot: CHIBI_PARTS_BOTTOM.lLegBot, rLegBot: CHIBI_PARTS_BOTTOM.rLegBot,
      lArmFwd: { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true, dest: [2, 7, 4, 12], mirrorX: true },
    },
  },
};

const CHIBI_POSE_TOP = {
  // Forward arms run 12px here for the same reason as in the BOTTOM table: straight up/down the arm is
  // perpendicular to the camera, so it is not foreshortened, and this family draws limbs 1:1
  // (bodyTopHid is 8 texels -> 8px). They also have to agree with their BOTTOM counterparts, since top
  // and bottom are the same figure seen from opposite sides.
  'zombie': {
    order: ['rArmTopZ', 'lArmTopZ'],
    parts: {
      rArmTopZ: { base: [52, 20, 4, 12], over: [52, 36, 4, 12], arm: true, slimShiftX: true, dest: [2, 17, 4, 12] },
      lArmTopZ: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [14, 17, 4, 12] },
    },
  },
  'handshake': {
    order: ['lArmTopZ'],
    parts: {
      lArmTopZ: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [14, 17, 4, 12] },
    },
  },
  'waving': {
    order: ['lArmTopW'],
    parts: {
      lArmTopW: { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4], dest: [18, 6, 3, 3], hand: true },
    },
  },
  // From above, dab is the same two borrowed limbs as everywhere else: the right arm pokes forward
  // (toward image-BOTTOM, this family's facing) and the left arm runs straight out sideways, butted
  // against the head square at col 18 like the T-pose's.
  'dab': {
    order: ['rArmTopZ', 'lArmTopT'],
    parts: {
      rArmTopZ: { base: [52, 20, 4, 12], over: [52, 36, 4, 12], arm: true, slimShiftX: true, dest: [2, 17, 4, 12] },
      lArmTopT: { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true, dest: [18, 10, 8, 4], rot: 270 },
    },
  },
  'tpose': {
    // Both arms must butt straight against the head square, which spans cols 2..17 from above: the
    // image-right arm already starts at 18, so the image-left one has to END at 1 (x = -6, not -7,
    // which left a 1px hole at the head's edge and made the arm read as detached).
    order: ['rArmTopT', 'lArmTopT'],
    parts: {
      // y=7, not 10: a sideways arm has not moved in Z, so it sits in the figure's own 4-row depth
      // band (rows 7..10) that CHIBI_PARTS_TOP puts EVERY part in - bodyTopHid [6,7,8,4], both arm
      // tops and both leg tops [.,7,4,4] - and that the BOTTOM table's t-pose arms already use.
      rArmTopT: { base: [40, 20, 4, 12], over: [40, 36, 4, 12], dest: [-6, 7, 8, 4], rot: 90 },
      lArmTopT: { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true, dest: [18, 7, 8, 4], rot: 270 },
    },
  },
  'sitting': {
    order: ['rLegTopSit', 'lLegTopSit'],
    parts: {
      rLegTopSit: { base: [4, 20, 4, 12], over: [4, 36, 4, 12], dest: [6, 17, 4, 6] },
      lLegTopSit: { base: [20, 52, 4, 12], over: [4, 52, 4, 12], dest: [10, 17, 4, 6] },
    },
  },
  // The crouched BODY really is fully under the head from above, but the forward-reaching far arm
  // pokes out past the head silhouette, same as the handshake's.
  'crouch': {
    order: ['lArmTopZ'],
    parts: {
      lArmTopZ: { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true, dest: [14, 17, 4, 12] },
    },
  },
};

// Source-rect swap pairs for deriving the facing-left pose tables: turning the character around shows
// the OTHER limb's OPPOSITE face (the exact swap the hand-authored standing left table makes). Each
// entry is [right-facing src, left-facing src]; matching is by the base rect.
const CHIBI_POSE_SRC_MIRROR = [
  [{ base: [40, 20, 4, 8], over: [40, 36, 4, 8] }, { base: [40, 52, 4, 8], over: [56, 52, 4, 8], slimShiftX: true }],
  [{ base: [40, 20, 4, 6], over: [40, 36, 4, 6] }, { base: [40, 52, 4, 6], over: [56, 52, 4, 6], slimShiftX: true }],
  [{ base: [40, 26, 4, 6], over: [40, 42, 4, 6] }, { base: [40, 58, 4, 6], over: [56, 58, 4, 6], slimShiftX: true }],
  [{ base: [40, 20, 4, 12], over: [40, 36, 4, 12] }, { base: [40, 52, 4, 12], over: [56, 52, 4, 12], slimShiftX: true }],
  [{ base: [48, 16, 4, 4], over: [48, 32, 4, 4], slimBase: [47, 16, 3, 4], slimOver: [47, 32, 3, 4] },
   { base: [40, 48, 4, 4], over: [56, 48, 4, 4], slimBase: [39, 48, 3, 4], slimOver: [55, 48, 3, 4] }],
  [{ base: [44, 20, 4, 12], over: [44, 36, 4, 12], arm: true }, { base: [36, 52, 4, 12], over: [52, 52, 4, 12], arm: true }],
  [{ base: [44, 20, 4, 8], over: [44, 36, 4, 8], arm: true }, { base: [36, 52, 4, 8], over: [52, 52, 4, 8], arm: true }],
  [{ base: [8, 16, 4, 4], over: [8, 32, 4, 4] }, { base: [24, 48, 4, 4], over: [8, 48, 4, 4] }],
  [{ base: [4, 16, 4, 4], over: [4, 32, 4, 4] }, { base: [20, 48, 4, 4], over: [4, 48, 4, 4] }],
  // Wave-hand columns: lArm.bottom interior col i <-> rArm.bottom interior col (3-i) (bottom faces
  // mirror between limbs).
  [{ base: [41, 48, 1, 4], over: [57, 48, 1, 4], slimBase: [40, 48, 1, 4], slimOver: [56, 48, 1, 4] },
   { base: [50, 16, 1, 4], over: [50, 32, 1, 4], slimBase: [48, 16, 1, 4], slimOver: [48, 32, 1, 4] }],
  [{ base: [42, 48, 1, 4], over: [58, 48, 1, 4], slimBase: [41, 48, 1, 4], slimOver: [57, 48, 1, 4] },
   { base: [49, 16, 1, 4], over: [49, 32, 1, 4], slimBase: [47, 16, 1, 4], slimOver: [47, 32, 1, 4] }],
  // Wave-diagonal arm strips: lArm.left interior col, side rows 2k..2k+3 <-> rArm.right interior col.
  [{ base: [41, 52, 1, 4], over: [57, 52, 1, 4], slimShiftX: true }, { base: [42, 20, 1, 4], over: [42, 36, 1, 4] }],
  [{ base: [41, 54, 1, 4], over: [57, 54, 1, 4], slimShiftX: true }, { base: [42, 22, 1, 4], over: [42, 38, 1, 4] }],
  [{ base: [41, 56, 1, 4], over: [57, 56, 1, 4], slimShiftX: true }, { base: [42, 24, 1, 4], over: [42, 40, 1, 4] }],
  // Back faces (arm full / top-3 / top-4 stubs) and their interior wave strips.
  [{ base: [52, 20, 4, 12], over: [52, 36, 4, 12], arm: true, slimShiftX: true }, { base: [44, 52, 4, 12], over: [60, 52, 4, 12], arm: true, slimShiftX: true }],
  [{ base: [52, 20, 4, 4], over: [52, 36, 4, 4], arm: true, slimShiftX: true }, { base: [44, 52, 4, 4], over: [60, 52, 4, 4], arm: true, slimShiftX: true }],
  [{ base: [45, 52, 1, 4], over: [61, 52, 1, 4] }, { base: [54, 20, 1, 4], over: [54, 36, 1, 4] }],
  [{ base: [45, 54, 1, 4], over: [61, 54, 1, 4] }, { base: [54, 22, 1, 4], over: [54, 38, 1, 4] }],
  [{ base: [45, 56, 1, 4], over: [61, 56, 1, 4] }, { base: [54, 24, 1, 4], over: [54, 40, 1, 4] }],
  [{ base: [40, 20, 4, 4], over: [40, 36, 4, 4] }, { base: [40, 52, 4, 4], over: [56, 52, 4, 4], slimShiftX: true }],
  // The INNER depth faces the profiles show: lArm.right <-> rArm.left (full + wave strips).
  [{ base: [32, 52, 4, 12], over: [48, 52, 4, 12] }, { base: [48, 20, 4, 12], over: [48, 36, 4, 12], slimShiftX: true }],
  [{ base: [33, 52, 1, 4], over: [49, 52, 1, 4] }, { base: [49, 20, 1, 4], over: [49, 36, 1, 4], slimShiftX: true }],
  [{ base: [33, 54, 1, 4], over: [49, 54, 1, 4] }, { base: [49, 22, 1, 4], over: [49, 38, 1, 4], slimShiftX: true }],
  [{ base: [33, 56, 1, 4], over: [49, 56, 1, 4] }, { base: [49, 24, 1, 4], over: [49, 40, 1, 4], slimShiftX: true }],
  // Side-face top-3 (the near-arm stub the back-3/4 zombie keeps) and leg backs.
  [{ base: [12, 20, 4, 12], over: [12, 36, 4, 12] }, { base: [28, 52, 4, 12], over: [12, 52, 4, 12] }],
  [{ base: [24, 20, 4, 6], over: [24, 36, 4, 6] }, { base: [20, 20, 4, 6], over: [20, 36, 4, 6] }],
  [{ base: [16, 28, 4, 4], over: [16, 44, 4, 4] }, { base: [28, 28, 4, 4], over: [28, 44, 4, 4] }],
  [{ base: [16, 20, 4, 12], over: [16, 36, 4, 12] }, { base: [28, 20, 4, 12], over: [28, 36, 4, 12] }],
  [{ base: [0, 20, 4, 12], over: [0, 36, 4, 12] }, { base: [24, 52, 4, 12], over: [8, 52, 4, 12] }],
  [{ base: [16, 52, 4, 12], over: [0, 52, 4, 12] }, { base: [8, 20, 4, 12], over: [8, 36, 4, 12] }],
  [{ base: [20, 52, 4, 12], over: [4, 52, 4, 12] }, { base: [4, 20, 4, 12], over: [4, 36, 4, 12] }],
];

// Derive the facing-left variant of a pose table. Verified rule set - applying it to the standing
// parts reproduces CHIBI_PARTS_LEFT's entries exactly:
//   - dest/wideDest mirror on the x = 24 axis every left-facing table uses;
//   - the source swaps to the other limb's opposite face (map above); front faces keep their content
//     (turning someone around does not mirror their chest);
//   - rotated blits (a mirrored blit is the same blit with the 90/270 rotations swapped and the
//     sampling mirror toggled) and the hands (bottom faces mirror between limbs the way the vanilla
//     UV mirrors them) toggle mirrorX; unrotated front faces do not;
//   - vertical odd-width side strips take mirrorMap, the same half-texel fix the standing table needs.
// `keepArms` on a pose table: turning the character around must NOT change WHICH arm is raised. The
// limb swap below is right for a symmetric layout (the standing pair just trades image sides), but on
// a one-armed pose it hands the raise to the other arm, so an asymmetric pose changed hands the moment
// you orbited past the profile. Poses that raise a specific arm set keepArms and keep both the key and
// the limb's own faces; only the dest still mirrors. (The wave already behaved this way by accident -
// its sub-rect sources are not in the swap map - which is why it never flipped and handshake did.)
function chibiMirrorPose(table, axis) {
  const keepArms = !!table.keepArms;
  const isArm = (k) => k.startsWith('rArm') || k.startsWith('lArm');
  const swapKey = (k) => {
    if (keepArms && isArm(k)) return k;
    for (const [a, b] of [['rArm', 'lArm'], ['lArm', 'rArm'], ['rLeg', 'lLeg'], ['lLeg', 'rLeg']]) {
      if (k.startsWith(a)) return b + k.slice(4);
    }
    return k;
  };
  const parts = {};
  for (const [k, p] of Object.entries(table.parts)) {
    const q = { ...p };
    if (!(keepArms && isArm(k))) for (const [a, b] of CHIBI_POSE_SRC_MIRROR) {
      const other = String(p.base) === String(a.base) ? b : (String(p.base) === String(b.base) ? a : null);
      if (other) {
        delete q.slimBase; delete q.slimOver; delete q.slimShiftX; delete q.arm;
        Object.assign(q, other);
        if (!p.rot && !p.hand && (p.dest[2] & 1)) q.mirrorMap = true;
        break;
      }
    }
    const mv = (d) => [axis - d[0] - d[2], d[1], d[2], d[3]];
    q.dest = mv(p.dest);
    if (p.wideDest) q.wideDest = mv(p.wideDest);
    if (p.rot || p.hand) q.mirrorX = !p.mirrorX;
    if (p.rot === 90) q.rot = 270; else if (p.rot === 270) q.rot = 90;
    parts[swapKey(k)] = q;
  }
  const out = { order: table.order.map(swapKey), parts };
  if (table.over) out.over = table.over.map(swapKey);
  if (table.keepArms) out.keepArms = true;
  return out;
}

// Build both facings, then give every table its horizontal shift and canvas width: blits may sit at
// negative x (the T-pose's image-left arm, any mirrored right-overhang), so the whole render - pose
// parts AND the head - shifts right by `shift` at draw time and the canvas widens to fit. The crop
// at the end of _composeChibi re-tightens, so the shift is invisible in the output.
const CHIBI_POSES = {};
for (const [name, table] of Object.entries(CHIBI_POSE_RIGHT)) {
  // Facing-left, side-left and back-3/4-left derive from their right tables; each family mirrors on
  // its own layout axis (24 for the 3/4 and back-3/4 pairs, 20 for the centred profile pair).
  const sides = {
    right: table, left: chibiMirrorPose(table, 24),
    flat: CHIBI_POSE_FLAT[name], flatBack: CHIBI_POSE_FLATBACK[name],
    sideRight: CHIBI_POSE_SIDE_RIGHT[name], sideLeft: chibiMirrorPose(CHIBI_POSE_SIDE_RIGHT[name], 20),
    backRight: CHIBI_POSE_BACK_RIGHT[name], backLeft: chibiMirrorPose(CHIBI_POSE_BACK_RIGHT[name], 24),
    top: CHIBI_POSE_TOP[name] || null, bottom: CHIBI_POSE_BOTTOM[name] || null,
  };
  for (const t of Object.values(sides)) {
    if (!t) continue;
    let minX = 0, maxX = CHIBI_SPRITE.w;
    for (const p of Object.values(t.parts)) {
      for (const d of [p.dest, p.wideDest]) {
        if (!d) continue;
        if (d[0] < minX) minX = d[0];
        if (d[0] + d[2] > maxX) maxX = d[0] + d[2];
      }
    }
    t.shift = -minX;
    t.canvasW = maxX - minX;
  }
  CHIBI_POSES[name] = sides;
}

// Mirror-symmetric nearest-neighbour index map: for output width `dest` from source width `src`, returns
// xmap[i] with the guarantee xmap[dest-1-i] === src-1-xmap[i]. This does NOT mirror pixels - every column
// still samples a REAL skin texel; it only removes a sampling bias. Plain floor((i+0.5)*src/dest) rounds
// left at exact-integer boundaries, so an 8->10 body maps to 0,1,2,2,3,4,5,6,6,7 (doubles texel 2 on the
// left but texel 6 on the right) and a perfectly symmetric skin renders lopsided. Building one half and
// mirroring the MAP keeps the sampling unbiased: symmetric skin -> symmetric sprite, and a genuinely
// asymmetric skin (e.g. different left/right arm art) still renders faithfully asymmetric.
function symNearest(src, dest) {
  const m = new Array(dest);
  for (let i = 0; i < (dest >> 1); i++) {
    const tx = Math.min(src - 1, Math.floor((i + 0.5) * src / dest));
    m[i] = tx; m[dest - 1 - i] = src - 1 - tx;
  }
  if (dest & 1) { const mid = dest >> 1; m[mid] = Math.min(src - 1, Math.floor((mid + 0.5) * src / dest)); }
  return m;
}

// Plain nearest map, for the VERTICAL axis. symNearest's mirroring exists to keep LEFT/RIGHT sampling
// unbiased so a mirror-authored skin renders symmetric - a face has no such top/bottom symmetry, so
// mirroring the vertical map only relocates which source row gets doubled on a non-integer scale, and it
// relocated it onto the worst possible row: the proud hat's 16->18 upscale doubled source row 11, the
// eyelash/glasses rim, drawing it 2px tall and burying the eye that belongs on the row below (the
// long-running "2px eyelash"). Plain nearest doubles rows 4 and 12 instead - flat hair and the cheek -
// leaving the lash 1px. Measured against the reference this cut the head's mean per-pixel error from
// 7.11 to 5.20, and a brute force over every possible pair of doubled rows confirmed 4 & 12 is optimal.
function nearestMap(src, dest) {
  const m = new Array(dest);
  for (let i = 0; i < dest; i++) m[i] = Math.min(src - 1, Math.floor((i + 0.5) * src / dest));
  return m;
}

const DEFAULT_LOOK = 'soft';

class ChibiSkinMaker {
  constructor(options = {}) {
    this.headless = !!(options && options.headless);
    this.currentModelType = 'steve';
    // 'auto' reads the body type from the skin's UV layout. 'steve' / 'alex' are manual overrides that
    // STICK: once you have said what you want, loading another skin must not silently overrule you.
    this.bodyTypeMode = 'auto';
    this.currentMaterial = DEFAULT_LOOK;
    this.textureFilterPixelated = true;
    this.barebones = false;            // merge similar skin colours into flat ones
    this.barebonesThreshold = 30;      // hue-based merge threshold x100 (higher = flatter)
    // The four chibi renderer toggles, declared so the compose gates read a real state (not undefined)
    // and captureFullState snapshots concrete values that restore/undo can always write back.
    this.flatProfile = false;          // false = 3/4 profile, true = flat straight-on layout
    this.sideProfile = false;          // pure 90-degree profile (facing picks the side); overrides flatProfile
    this.vertView = 'none';            // 'top' | 'bottom' straight-down/up views; overrides everything
    this.portraitView = false;         // false | 'portrait' (head+shoulders) | 'head' (head only); overrides all views
    this.layerShadow = false;          // opt-in: the 2nd layer casts onto the skin below its edge
    this.upsideDown = false;           // Dinnerbone / Grumm render inverted, as they do in game
    this.facing = 'right';             // which way the 3/4 turns ('left' mirrors layout + swaps side faces)
    this.viewSide = 'front';           // 'front' or 'back' (seen from behind); combines with flatProfile and facing
    this.pose = 'none';                // 'none' or a CHIBI_POSES key; applies to the 3/4 views only
    this.headOverlay = 'on';           // hat/hair 2nd-layer blits ('off' hides them)
    this.bodyOverlay = 'on';           // jacket/sleeves/pants 2nd layer ('off' = base only)
    this.shading = 'on';               // side-face dim + AO pass ('off' = flat colours)
    // 0 = no shading, 100 = shaded areas black. 50 is the PIVOT of the curve in _shadeMul, where every
    // multiplier is exactly its reference-calibrated value; below it the shading lerps out toward flat
    // colour, above it toward black. The DEFAULT sits a little past the pivot at 53 (each shaded area
    // ~6% darker than the raw calibration), which reads better on the small sprite without tipping
    // into the crushed look the upper half of the slider gives.
    this.shadingStrength = 53;
    this.partVisibility = {};          // Parts tab eyes: name -> false when hidden (missing = visible)
    this.currentSkinImage = null;
    this._pristineSkinImage = null;    // the upload BEFORE legacy 2:1 conversion (body-type detect)
    this.skinName = null;
    this.bgColor = '#4a4a4a';         // the color a swatch click returns to; boot ships transparent
    this.bgTransparent = true;
    this.bgShape = 'none';             // 'none' | 'square' | 'circle' - the profile-picture badge, live in the preview
    this.bgAspect = '1:1';             // the Square frame's aspect (the 3D sibling's set); circle is always 1:1
    this.gifSpeedValue = 1;            // GIF playback speed, a divisor on every frame delay
    this.bgImage = null;               // decoded custom background image (an Image), or null
    this._bgImageURI = null;           // its data URI - what undo snapshots and configs carry
    this.viewZoom = 0;                 // 0 = auto-fit; else the zoom RATIO vs auto-fit (view-only) - a ratio, so the sprite rescales with the pane
    this.viewPanX = 0;                 // pan offsets while zoomed, in canvas px
    this.viewPanY = 0;
    this.charZoom = 1;                 // with a badge shape: character size vs auto-fit - COMPOSITION, baked into the export
    this.charX = 0;                    // character offset inside the badge, in NATIVE SPRITE PIXELS (integers -
    this.charY = 0;                    // the position snaps to the pixel grid, identically at every resolution)
    this.anim = 'none';                // Animation tab: key into CHIBI_ANIMS ('none' = static)
    this._animFrames = null;           // baked [{cv, delay}] at native sprite scale, all same size
    this._animIdx = 0;                 // current frame in the preview loop
    this._animPrev = 0;                // rAF timestamp the current frame started at
    this._animRAF = 0;                 // rAF handle (0 = loop not running)
    this._animParts = null;            // compose hook: per-group [dx,dy] offsets for the frame baking
    this._animPadX = 0;                // compose hook: symmetric x slack so head-shake offsets can't clip
    this._animNoCrop = false;          // compose hook: skip the tighten-crop so frames stay aligned
    this._animHeadSwap = null;         // compose hook: head/hat blits swapped in from another family (head turn)
    this._animShadeRow = false;        // compose hook: force the under-head shoulder row in the lit front view
    this.bgVignette = false;
    this.undoStack = [];
    this.redoStack = [];
    this.bgShape = 'none';
    this.bgAspect = '1:1';
    this.bgImage = null;
    this.charZoom = 1;
    this.charX = 0;
    this.charY = 0;
    this.viewZoom = null;
    this.viewPanX = 0;
    this.viewPanY = 0;
    this.exportSize = 1024;
    this.outlineWidth = 0;
    this.outlineEnabled = false;
    this.outlineSharp = false;
    this.outlineColor = '#000000';

    if (typeof document !== 'undefined') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    }
  }

  async init() {
    if (typeof window !== 'undefined') window.__csm = this;
    if (this.headless || typeof document === 'undefined' || !document.getElementById('viewerContainer')) return;
    this.getElements();
    this.setupScene();
    this.setupEventListeners();
    await this.loadModel('steve');
    this.updatePresetActive();
    this.updateBackground();
    if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, this._bgPaints());
  }

  // Outline thickness doubles as the on/off switch (0 = no outline), the tag generator's
  // outline UX: no checkbox, the options only exist while there is an outline to configure.
  // Does NOT write the number input itself, so it is safe to call from its input listener
  // mid-typing; restore paths write the input separately.
  _applyOutlineWidth(w) {
    this.outlineWidth = Math.max(0, Math.min(10, w || 0));
    this.outlineEnabled = this.outlineWidth > 0;
    setVisible(this.outlineSettingsRow, this.outlineEnabled);
    this._refreshSkinTexture();   // 2D: the outline is a dilation pass in the compose
  }

  async resetAll() {
    // 2D reset: the tool's defaults ARE the config defaults, and applyConfig is the proven
    // full-state path - an empty config merges to CONFIG_DEFAULTS. Drop the skin first so the
    // default Steve comes back, then clear history (the modal says a reset cannot be undone).
    this.removeSkin();
    await this.applyConfig({});
    this.undoStack = [];
    this.redoStack = [];
    this.updateUndoButtons();
  }

  // The part-visibility checkboxes are REBUILT from the scene graph whenever the model changes, so a
  // static NodeList captured at init would silently go on addressing detached nodes (and every eye
  // in the outliner would stop responding). Query them live.
  get visibilityCheckboxes() {
    return document.querySelectorAll('#visibility-section input[data-part]');
  }

  getElements() {
    this.viewerContainer = document.getElementById('viewerContainer');
    this.viewerLoading = document.getElementById('viewerLoading');
    this.modelToggle = document.getElementById('modelToggle');
    this.usernameInput = document.getElementById('usernameInput');
    this.loadSkinBtn = document.getElementById('loadSkinBtn');
    this.dropOverlay = document.getElementById('dropOverlay');
    this.skinFileInput = document.getElementById('skinFileInput');
    this.skinStatusText = document.getElementById('skinStatusText');
    this.filterToggleBtn = document.getElementById('filterToggleBtn');
    this.removeSkinBtn = document.getElementById('removeSkinBtn');
    this.downloadSkinBtn = document.getElementById('downloadSkinBtn');
    this.skinError = document.getElementById('skinError');
    this.halfHeightUVsToggle = document.getElementById('halfHeightUVs');
    this.bgColorPicker = document.getElementById('bgColorPicker');
    this.bgTransparentCheckbox = document.getElementById('bgTransparent');
    this.bgVignetteCheckbox = document.getElementById('bgVignette');
    this.bgVignetteRow = document.getElementById('bgVignetteRow');
    this.bgPresets = document.getElementById('bgPresets');
    this.materialSelect = document.getElementById('materialSelect');
    this.barebonesToggle = document.getElementById('barebonesToggle');
    this.barebonesStrength = document.getElementById('barebonesStrength');
    this.barebonesStrengthValue = document.getElementById('barebonesStrengthValue');
    this.shadingSlider = document.getElementById('shadingStrength');
    this.shadingSliderValue = document.getElementById('shadingStrengthValue');
    this.barebonesStrengthRow = document.getElementById('barebonesStrengthRow');
    // New viewport chrome (the stage, the chips, the modals)
    this.vpStage = document.getElementById('vpStage');
    this.historyChip = document.getElementById('historyChip');
    this.toolStatus = document.getElementById('toolStatus');
    this.exportBtn = document.getElementById('exportBtn');
    this.configBtn = document.getElementById('configBtn');
    this.undoBtn = document.getElementById('undoBtn');
    this.redoBtn = document.getElementById('redoBtn');
    this.exportSizeSelect = document.getElementById('exportSizeSelect');
    this.gifInfo = document.getElementById('gifInfo');
    this.bgShapeBtns = [...document.querySelectorAll('#bgShapeBtns [data-shape]')];
    this.bgImageInput = document.getElementById('bgImageInput');
    this.bgImageTile = document.getElementById('bgImageTile');
    this.bgAspectSelect = document.getElementById('bgAspect');
    this.bgAspectRow = document.getElementById('bgAspectRow');
    this.exportDims = document.getElementById('exportDims');
    this.copyPngBtn = document.getElementById('copyPngBtn');

    this.downloadPngBtn = document.getElementById('downloadPngBtn');
    this.downloadGifBtn = document.getElementById('downloadGifBtn');
    this.gifSpeed = document.getElementById('gifSpeed');
    this.outlineSettingsRow = document.getElementById('outlineSettingsRow');
    this.outlineWidthSlider = document.getElementById('outlineWidth');
    this.outlineSharpToggle = document.getElementById('outlineSharp');
    this.outlineColorPicker = document.getElementById('outlineColor');
    this.outlineColorHexInput = document.getElementById('outlineColorHex');
    this.resetAllBtn = document.getElementById('resetAllBtn');
    // NOTE: visibilityCheckboxes is a live getter, not a field. Assigning it here would shadow the
    // getter with a stale NodeList and break every eye in the outliner after a model reload.
  }

  setupScene() {
    // 2D canvas setup. There is no three.js here: the chibi is composed on a 2D context and
    // painted by _draw(). The only per-frame concern is keeping the backing store sized to the
    // container (see resizeCanvas below).
    const container = this.viewerContainer;

    // A blank 2D canvas placeholder. The CSS rule `#viewer-section .viewer-container canvas`
    // sizes it to fill the container; the container's own #4a4a4a background reads through.
    const canvas = document.createElement('canvas');
    canvas.className = 'view-canvas';
    // The backing store is sized to container x DPR for crisp pixels; CSS maps it back to the
    // container box (without this the 2x backing renders at double size and the chibi is clipped off).
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);
    this.viewCanvas = canvas;
    this.ctx = canvas.getContext('2d');

    // No model: the model-guarded helpers below check this.

    // ResizeObserver: resize only the 2D canvas backing store (no renderer, no three.js calls).
    const resizeCanvas = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (this._draw) this._draw();
    };
    resizeCanvas();
    this.resizeObserver = new ResizeObserver(resizeCanvas);
    this.resizeObserver.observe(container);

    // Nothing to load: retire the spinner.
    setVisible(this.viewerLoading, false);
  }

  setupEventListeners() {
    // Body type pills (the same control at every width).
    this.modelToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.toggle-btn');
      if (btn) this._setBodyType(btn.dataset.model);
    });

    // The twelve fixed views (2D engine: the view IS the render, there is no free camera): ten standing
    // views on the number row 1-9,0 plus the Portrait and Head busts, which have no key. One handler
    // maps the picked view onto the renderer's state fields; the active button stays lit.
    this.viewButtons = Array.from(document.querySelectorAll('#viewButtons [data-view]'));
    for (const btn of this.viewButtons) {
      btn.addEventListener('click', () => this.setView(btn.dataset.view));
    }
    // Reset, pose-tab style: back to the default 3/4 Right (setView pushes the undo entry).
    const resetViewBtn = document.getElementById('resetViewBtn');
    if (resetViewBtn) resetViewBtn.addEventListener('click', () => this.setView('34-right'));
    document.addEventListener('keydown', (e) => {
      // Undo/Redo — works everywhere
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault();
        this.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ((e.code === 'KeyZ' && e.shiftKey) || e.code === 'KeyY')) {
        e.preventDefault();
        this.redo();
        return;
      }
      // Only handle remaining keys when not typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      // The number row picks a view, mirroring the Camera panel's grid order (1-9 then 0).
      const viewMap = {
        'Numpad1': '34-right',     'Digit1': '34-right',
        'Numpad2': 'front',        'Digit2': 'front',
        'Numpad3': '34-left',      'Digit3': '34-left',
        'Numpad4': 'side-right',   'Digit4': 'side-right',
        'Numpad5': 'back',         'Digit5': 'back',
        'Numpad6': 'side-left',    'Digit6': 'side-left',
        'Numpad7': 'back34-right', 'Digit7': 'back34-right',
        'Numpad8': 'back34-left',  'Digit8': 'back34-left',
        'Numpad9': 'top',          'Digit9': 'top',
        'Numpad0': 'bottom',       'Digit0': 'bottom',
      };
      const view = viewMap[e.code];
      if (view) {
        e.preventDefault();
        this.setView(view);
      }
    });

    // Pose mode
    this.setupPanels();
    this.setupModals();
    this.setupConfigModal();
    this.setupPreviewPane();
    this.setupValueScrubbing();
    // (Reset pose now lives in the Pose panel header as #resetPoseBtn2, next to the presets, so it is
    // reachable WITHOUT first selecting a part. It used to sit in the Move tab, which was disabled
    // until you selected something: you could not reset a pose without first making one.)
    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());

    // Material: the look dropdown re-runs the 2D tone pass over the composed sprite.
    this.materialSelect.addEventListener('change', (e) => { this.pushUndo(); this.setMaterial(e.target.value); });

    // Outline: thickness IS the switch (0 = off), the tag generator's outline UX.
    this._trackContinuousInput(this.outlineWidthSlider);
    this.outlineWidthSlider.addEventListener('input', (e) => {
      this._applyOutlineWidth(parseInt(e.target.value, 10));
    });
    this.outlineSharpToggle.addEventListener('change', (e) => {
      this.pushUndo();
      this.outlineSharp = e.target.checked;
      this._refreshSkinTexture();
    });
    this._trackContinuousInput(this.outlineColorPicker);
    this.outlineColorPicker.addEventListener('input', (e) => {
      this.outlineColor = e.target.value;
      this.outlineColorHexInput.value = e.target.value.substring(1);
      this._refreshSkinTexture();
    });
    // The hex field, wired the way the tag generator wires its own: a full 6-digit value
    // applies, anything shorter just sits in the field until it becomes one.
    this._trackContinuousInput(this.outlineColorHexInput);
    this.outlineColorHexInput.addEventListener('input', (e) => {
      const hex = e.target.value.replace('#', '');
      if (/^[0-9A-Fa-f]{6}$/.test(hex)) {
        this.outlineColor = '#' + hex.toLowerCase();
        this.outlineColorPicker.value = this.outlineColor;
        this._refreshSkinTexture();
      }
    });

    // Part visibility (event delegation)
    document.getElementById('visibility-section').addEventListener('change', (e) => {
      const part = e.target.dataset.part;
      if (part) { this.pushUndo(); this.setPartVisibility(part, e.target.checked); }
    });

    // Username skin load
    this.loadSkinBtn.addEventListener('click', () => this.loadSkinFromUsername());
    this.usernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.loadSkinFromUsername();
    });

    // One picker, one file type: a skin PNG.
    this.skinFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        this.loadSkinFromFile(file);
      }
      e.target.value = '';               // so re-picking the SAME file fires change again
    });

    // Drop straight onto the model. The canvas already accepted dropped files, but it said nothing
    // about it, so the feature was undiscoverable. Now the whole stage lights up as a drop target.
    //
    // dragenter/dragleave fire for every child element the cursor crosses, which makes the overlay
    // flicker. Counting enters and leaves is the standard fix: only hide when the count hits zero.
    let dragDepth = 0;
    const stage = this.vpStage || this.viewerContainer;
    stage.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      setVisible(this.dropOverlay, true);
    });
    stage.addEventListener('dragover', (e) => { e.preventDefault(); });
    stage.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setVisible(this.dropOverlay, false);
    });
    stage.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0;
      setVisible(this.dropOverlay, false);
      this.handleDroppedFile(e);
    });

    // Filter toggle (a checkbox now: checked = pixelated, unchecked = smooth)
    this.filterToggleBtn.addEventListener('change', (e) => {
      this.pushUndo();
      this.textureFilterPixelated = e.target.checked;
      this._refreshSkinTexture();   // works for default + custom, composes with Barebones
    });

    // Barebones colour merge + its similarity slider.
    this.barebonesToggle.addEventListener('change', (e) => {
      this.pushUndo();
      this.barebones = e.target.checked;
      this._syncBarebonesRow(this.barebones);
      this._refreshSkinTexture();
    });
    this._trackContinuousInput(this.barebonesStrength);
    this.barebonesStrength.addEventListener('input', (e) => {
      this.barebonesThreshold = parseInt(e.target.value, 10);
      this.barebonesStrengthValue.textContent = e.target.value;
      if (this.barebones) this._refreshSkinTexture();
    });

    // Shadow strength: live while dragging, ONE undo entry per drag (_trackContinuousInput).
    if (this.shadingSlider) {
      this._trackContinuousInput(this.shadingSlider);
      this.shadingSlider.addEventListener('input', (e) => {
        this.shadingStrength = parseInt(e.target.value, 10);
        if (this.shadingSliderValue) this.shadingSliderValue.textContent = e.target.value;
        this._refreshSkinTexture();
      });
    }

    this.removeSkinBtn.addEventListener('click', () => {
      if (this.currentSkinImage) { this.pushUndo(); this.removeSkin(); }
    });
    this.downloadSkinBtn.addEventListener('click', () => this.downloadSkin());

    this.halfHeightUVsToggle.addEventListener('change', (e) => {
      this.pushUndo();
      this.halfHeightUVs = e.target.checked;
      this.applyHalfHeightUVs();
    });

    // Background color
    this._trackContinuousInput(this.bgColorPicker);
    this.bgColorPicker.addEventListener('input', (e) => {
      this.bgColor = e.target.value;
      if (this.bgImage) { this.bgImage = null; this._bgImageURI = null; this._syncBgImageTile(); }
      if (this.bgTransparent) {
        this.bgTransparent = false;
        this.bgTransparentCheckbox.checked = false;
        setRowEnabled(this.bgVignetteRow, true);
      }
      this.updatePresetActive(e.target.value);
      this.updateBackground();
    });

    this.bgTransparentCheckbox.addEventListener('change', (e) => {
      this.pushUndo();
      this.bgTransparent = e.target.checked;
      setRowEnabled(this.bgVignetteRow, this._bgPaints());   // a vignette needs something to darken
      this.updatePresetActive();
      this.updateBackground();
    });

    this.bgVignetteCheckbox.addEventListener('change', (e) => {
      this.pushUndo();
      this.bgVignette = e.target.checked;
      this.updateBackground();
    });

    this.bgPresets.addEventListener('click', (e) => {
      const preset = e.target.closest('.bg-preset');
      if (!preset) return;
      this.pushUndo();
      this.bgColor = preset.dataset.color;
      // Picking a colour replaces an image background, exactly as an image replaces the colour.
      if (this.bgImage) { this.bgImage = null; this._bgImageURI = null; this._syncBgImageTile(); }
      this.bgColorPicker.value = this.bgColor;
      this.bgTransparentCheckbox.checked = false;
      this.bgTransparent = false;
      setRowEnabled(this.bgVignetteRow, true);
      this.updatePresetActive(this.bgColor);
      this.updateBackground();
    });

    // Export
    // Each numeric choice is one select; Download PNG is the only thing that writes a file.
    if (this.exportSizeSelect) this.exportSizeSelect.addEventListener('change', (e) => {
      this.setExportSize(parseInt(e.target.value, 10));
    });
    if (this.bgAspectSelect) this.bgAspectSelect.addEventListener('change', (e) => this.setAspect(e.target.value));
    if (this.gifSpeed) this.gifSpeed.addEventListener('change', (e) => this.setGifSpeed(parseFloat(e.target.value)));
    for (const b of this.gifSpeedBtns || []) {
      b.addEventListener('click', () => this.setGifSpeed(parseFloat(b.dataset.speed)));
    }
    this.exportBtn.addEventListener('click', () => { this._populateExportSizes(); this._updateExportDims(); this._updateGifInfo(); });

    if (this.downloadPngBtn) this.downloadPngBtn.addEventListener('click', () => this.exportPNG());
    if (this.copyPngBtn) this.copyPngBtn.addEventListener('click', () => this.copyPNG());
    this._populateExportSizes();
    this._updateExportDims();
    // The format tiles. Each picks one output shape and leaves every other setting alone;
    // the aspect beside the sizes is the user's, not the preset's.
    for (const btn of this.bgShapeBtns) {
      btn.addEventListener('click', () => this.setFormat(btn.dataset.shape));
    }
    // Custom image background: takes the color's place everywhere the color would paint (badge
    // fill, circle disc, the sprite rect in the pixel-art layout) and bakes into PNG + GIF.
    if (this.bgImageInput) this.bgImageInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        this.pushUndo();
        await this._applyBgImageURI(reader.result);
        this.setStatus('Background image set - Transparent turned off so it shows.');
      };
      reader.readAsDataURL(file);
    });
    // (the aspect pills are bound above, next to the sizes they sit with)
    // Preview gestures, two regimes. With no shape the export is the tight sprite, so the wheel is
    // a pure view magnifier (integer scales, crisp) and drag pans the view while zoomed - view-only,
    // never part of undo or configs. With a badge shape the badge IS the fixed export frame, so the
    // wheel sizes the CHARACTER inside it and drag repositions it - composition, baked into the
    // export and saved in configs (charZoom/charX/charY). Double-click resets both regimes.
    this.viewerContainer.addEventListener('wheel', (e) => {
      if (!this._chibiCanvas) return;
      e.preventDefault();
      const step = e.deltaY < 0 ? 1 : -1;
      if ((this.bgShape || 'none') !== 'none') {
        const auto = this._fitScale();
        const cur = Math.max(1, Math.round(auto * (this.charZoom || 1)));
        const next = Math.max(1, Math.min(60, cur + step));
        this.charZoom = next === auto ? 1 : next / auto;
        this._draw();
        this.setStatus('Character ' + next + 'x' + (next === auto ? ' (fit)' : '') + ' - drag to move, double-click to reset.');
        return;
      }
      const fit = this._fitScale();
      const next = Math.max(1, Math.min(60, this._viewScale() + step));
      this.viewZoom = (next === fit && !this.viewPanX && !this.viewPanY) ? 0 : next / fit;
      if (!this.viewZoom) { this.viewPanX = 0; this.viewPanY = 0; }
      this._draw();
      this.setStatus('Zoom ' + next + 'x - double-click the preview to reset.');
    }, { passive: false });
    this.viewerContainer.addEventListener('dblclick', () => {
      const comp = this.charZoom !== 1 || this.charX !== 0 || this.charY !== 0;
      if (!this.viewZoom && !this.viewPanX && !this.viewPanY && !comp) return;
      this.viewZoom = 0; this.viewPanX = 0; this.viewPanY = 0;
      this.charZoom = 1; this.charX = 0; this.charY = 0;
      this._draw();
      this.setStatus('Zoom and position reset.');
    });
    let panFrom = null;
    // Pinch. The wheel is a mouse-only event, so without this the character size is unreachable on
    // touch - the one gesture a phone user has for "make it bigger" did nothing. Two live pointers
    // switch off the pan (a pinch is not a drag) and scale whichever zoom the current regime owns.
    const livePointers = new Map();
    let pinch = null;
    const pinchDist = () => {
      const [a, b] = [...livePointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const beginPinch = () => {
      if (livePointers.size !== 2) return;
      panFrom = null;                                   // a second finger ends the drag
      const badge = (this.bgShape || 'none') !== 'none';
      pinch = { d0: pinchDist(), badge, z0: badge ? (this.charZoom || 1) : (this.viewZoom || 1) };
    };
    const movePinch = () => {
      if (!pinch || livePointers.size !== 2 || !this._chibiCanvas) return;
      const d = pinchDist();
      if (!pinch.d0 || !d) return;
      const fit = this._fitScale();
      // Clamp on the EFFECTIVE integer scale, exactly like the wheel, so pinch and wheel cannot
      // reach different limits.
      const want = pinch.z0 * (d / pinch.d0);
      const eff = Math.max(1, Math.min(60, Math.round(fit * want)));
      if (pinch.badge) {
        this.charZoom = eff === fit ? 1 : eff / fit;
        this.setStatus('Character ' + eff + 'x' + (eff === fit ? ' (fit)' : '') + ' - drag to move, double-tap to reset.');
      } else {
        this.viewZoom = (eff === fit && !this.viewPanX && !this.viewPanY) ? 0 : eff / fit;
        if (!this.viewZoom) { this.viewPanX = 0; this.viewPanY = 0; }
        this.setStatus('Zoom ' + eff + 'x - double-tap the preview to reset.');
      }
      this._draw();
    };
    // Right-drag is a move gesture in the viewport, like the 3D sibling's pan - the browser
    // context menu would eat the drag half the time, which read as "moving randomly stops working".
    this.viewerContainer.addEventListener('contextmenu', (e) => e.preventDefault());
    let downPos = null;
    let downTime = 0;
    this.viewerContainer.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      downPos = { x: e.clientX, y: e.clientY };
      downTime = Date.now();
      livePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (livePointers.size >= 2) { beginPinch(); return; }
      const char = (this.bgShape || 'none') !== 'none';
      panFrom = {
        x: e.clientX, y: e.clientY,
        px: char ? this.charX : this.viewPanX,
        py: char ? this.charY : this.viewPanY,
        char,
      };
      try { this.viewerContainer.setPointerCapture(e.pointerId); } catch (_) {}
    });
    this.viewerContainer.addEventListener('pointermove', (e) => {
      if (livePointers.has(e.pointerId)) livePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (livePointers.size >= 2) { movePinch(); return; }
      if (!panFrom) return;
      if (panFrom.char) {
        const scale = Math.max(1, Math.round(this._fitScale() * (this.charZoom || 1)));
        const frame = this._frameSize(this.viewCanvas.width, this.viewCanvas.height);
        const cv = this._chibiCanvas;
        const lim = (span, sprite) => Math.max(1, Math.round((span / scale + sprite) / 2 - sprite * 0.25));
        const limX = lim(frame.w, cv ? cv.width : 0);
        const limY = lim(frame.h, cv ? cv.height : 0);
        this.charX = Math.max(-limX, Math.min(limX, Math.round(panFrom.px + (e.clientX - panFrom.x) / scale)));
        this.charY = Math.max(-limY, Math.min(limY, Math.round(panFrom.py + (e.clientY - panFrom.y) / scale)));
      } else {
        this.viewPanX = panFrom.px + (e.clientX - panFrom.x);
        this.viewPanY = panFrom.py + (e.clientY - panFrom.y);
      }
      this._draw();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
      this.viewerContainer.addEventListener(ev, (e) => {
        if (ev === 'pointerup' && downPos && Date.now() - downTime < 300) {
          const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
          if (dist < 6) {
            this.triggerHurt(e.clientX, e.clientY);
          }
        }
        downPos = null;
        panFrom = null;
        livePointers.delete(e.pointerId);
        if (livePointers.size < 2) pinch = null;
        if (e.pointerId !== undefined) { try { this.viewerContainer.releasePointerCapture(e.pointerId); } catch (_) {} }
      });
    }
    this.downloadGifBtn.addEventListener('click', () => this.exportGIF());
    // One upload door, both file types (the tag generator's drop-zone pattern): click opens
    // the combined picker, and the zone itself accepts drops with the same sniffing as the
    // canvas. It is a sibling of the stage's drop target, so their handlers never collide.
    const uploadZone = document.getElementById('uploadDropZone');
    if (uploadZone) {
      uploadZone.addEventListener('click', () => this.skinFileInput.click());
      uploadZone.addEventListener('dragover', (e) => {
        if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
        e.preventDefault();
        uploadZone.classList.add('drag-over');
      });
      uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        uploadZone.classList.remove('drag-over');
        this.handleDroppedFile(e);
      });
    }
    // Reset All wipes the pose, the skin AND the undo history, so it is the one action in the tool
    // that cannot be taken back. It asks first.
    this.resetAllBtn.addEventListener('click', () => {
      this.openDialog(document.getElementById('confirmOverlay'), this.resetAllBtn);
    });
    const confirmOk = document.getElementById('confirmOk');
    if (confirmOk) confirmOk.addEventListener('click', () => {
      this.closeDialog();
      this.resetAll();
      this.setStatus('Everything cleared.');
    });

    this.layerShadowInput = document.getElementById('layerShadow');
    if (this.layerShadowInput) this.layerShadowInput.addEventListener('change', () => this.setLayerShadow(this.layerShadowInput.checked));
    this.bustButtons = Array.from(document.querySelectorAll('[data-bust]'));
    for (const btn of this.bustButtons) btn.addEventListener('click', () => this.setBust(btn.dataset.bust));
    this.poseButtons = Array.from(document.querySelectorAll('[data-pose]'));
    for (const btn of this.poseButtons) {
      btn.addEventListener('click', () => this.setPose(btn.dataset.pose));
    }
    const resetPose2 = document.getElementById('resetPoseBtn2');
    if (resetPose2) resetPose2.addEventListener('click', () => this.setPose('none'));
    this.animButtons = Array.from(document.querySelectorAll('[data-anim]'));
    for (const btn of this.animButtons) {
      btn.addEventListener('click', () => this.setAnim(btn.dataset.anim));
    }
    const animPresets = document.getElementById('animPresets');
    if (animPresets) {
      animPresets.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-anim]');
        if (btn) this.setAnim(btn.dataset.anim);
      });
    }
    const resetAnim = document.getElementById('resetAnimBtn');
    if (resetAnim) resetAnim.addEventListener('click', () => this.setAnim('none'));
    const resetBg = document.getElementById('resetBgBtn');
    if (resetBg) resetBg.addEventListener('click', () => this.resetBackground());

    window.addEventListener('pointermove', (e) => {
      const container = this.viewerContainer || document.getElementById('viewerContainer') || document.querySelector('.preview-card');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height * 0.35;
      
      const maxDistX = Math.max(120, rect.width * 0.7);
      const maxDistY = Math.max(120, rect.height * 0.7);

      const normX = Math.max(-1, Math.min(1, (e.clientX - centerX) / maxDistX));
      const normY = Math.max(-1, Math.min(1, (e.clientY - centerY) / maxDistY));

      const dx = Math.round(normX * 4);
      const dy = Math.round(normY * 3);

      let headSwap = null;
      if (normX > 0.2) headSwap = '34-right';
      else if (normX < -0.2) headSwap = '34-left';

      if (this._cursorHeadDx !== dx || this._cursorHeadDy !== dy || this._cursorHeadSwap !== headSwap) {
        this._cursorHeadDx = dx;
        this._cursorHeadDy = dy;
        this._cursorHeadSwap = headSwap;
        if (this.anim === 'cursor') {
          this._refreshSkinTexture();
        }
      }
    });

    // "Show all" is the way back from having hidden six things one at a time and forgotten which.
    const showAllBtn = document.getElementById('showAllPartsBtn');
    if (showAllBtn) showAllBtn.addEventListener('click', () => {
      const hidden = [...this.visibilityCheckboxes].filter(cb => !cb.checked);
      if (!hidden.length) return;
      this.pushUndo();
      for (const cb of hidden) {
        cb.checked = true;
        this.setPartVisibility(cb.dataset.part, true);
      }
    });

    // Steppers on the transform rails. The old drag-to-scrub was bound to `mousedown` and drove
    // itself off `document.mousemove`, so on a phone it did nothing at all: the numbers could not be
    // nudged, only typed. A tap target either side of each field fixes that without a gesture.
    for (const step of document.querySelectorAll('.quantity-btn[data-for]')) {
      const nudge = () => {
        const input = document.getElementById(step.dataset.for);
        if (!input || input.disabled) return;
        const by = parseFloat(step.dataset.step) || 1;
        let next = Math.round(((parseFloat(input.value) || 0) + by) * 100) / 100;
        if (input.min !== '') next = Math.max(parseFloat(input.min), next);
        if (input.max !== '') next = Math.min(parseFloat(input.max), next);
        input.value = next;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      // The buttons never focus the input, so the focus/blur history tracking on the field
      // cannot see them: snapshot before the first nudge and push when the press ends, or
      // stepper edits would be invisible to undo.
      let timer = null, repeat = null, armed = false;
      step.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const input = document.getElementById(step.dataset.for);
        if (input && !input.disabled && !this._preActionState) {
          this._preActionState = this.captureFullState();
          armed = true;
        }
        nudge();
        timer = setTimeout(() => { repeat = setInterval(nudge, 120); }, 400);   // press and hold
      });
      const stop = () => {
        clearTimeout(timer); clearInterval(repeat); timer = repeat = null;
        if (armed && this._preActionState) {
          this.pushUndo(this._preActionState);
          this._preActionState = null;
        }
        armed = false;
      };
      step.addEventListener('pointerup', stop);
      step.addEventListener('pointerleave', stop);
      step.addEventListener('pointercancel', stop);
    }
  }

  // A swatch highlights only while its color is actually IN USE: any time Transparent is off,
  // or with the Circle shape (its disc always paints the color, transparent or not). While the
  // background is genuinely transparent no swatch lights up - the old color-only toggle left the
  // gray swatch looking selected at boot when the background was really the checkerboard.
  updatePresetActive(color = this.bgColor) {
    const painting = !this.bgTransparent || this.bgShape === 'circle';
    const inUse = painting && !this.bgImage;
    this.bgPresets.querySelectorAll('.bg-preset').forEach(p => {
      p.classList.toggle('active', inUse && p.dataset.color === String(color).toLowerCase());
    });
    if (this.bgImageTile) this.bgImageTile.classList.toggle('active', painting && !!this.bgImage);
  }

  updateBackground() {
    // 2D: the sprite canvas stays transparent; the background is the viewer element behind it.
    // Transparent = the classic checkerboard, vignette = the color easing into a darkened copy of
    // itself toward the corners. Exports compose their own background from the same state fields.
    const el = this.viewerContainer;
    if (!el) return;
    if (this.bgTransparent || (this.bgShape || 'none') !== 'none' || this.bgImage) {
      // With a badge shape the color lives ON the badge; the surroundings are what exports as
      // transparent, so they always show the checkerboard.
      el.style.background = 'repeating-conic-gradient(#808080 0% 25%, #a0a0a0 0% 50%) 0 0 / 20px 20px';
    } else if (this.bgVignette) {
      el.style.background = `radial-gradient(ellipse at center, ${this.bgColor} 40%, ${this._shadeHex(this.bgColor, 0.55)} 135%)`;
    } else {
      el.style.background = this.bgColor;
    }
    // The badge paints the background ON the canvas, so any background change must redraw it.
    this._draw();
  }

  // '#rrggbb' scaled by mul, clamped - the vignette's darkened rim color.
  _shadeHex(hex, mul) {
    const n = parseInt((hex || '#4a4a4a').slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * mul)));
    return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join('');
  }

  async loadModel(type, { clearUndo = true, preservePose = true } = {}) {
    // There is no geometry to build: "loading a model" is choosing the body type and recomposing
    // the sprite from the current skin. Kept async so init()'s await still works.
    this._loading = true;
    this.currentModelType = type;
    if (clearUndo) {
      this.undoStack = [];
      this.redoStack = [];
      this.updateUndoButtons();
    }
    await this._loadDefaultSkin(type);
    setVisible(this.viewerLoading, false);
    this._loading = false;
  }

  async loadSkinFromUsername() {
    const username = this.usernameInput.value.trim();
    if (!username) return;

    this.hideError();
    setBusy(this.loadSkinBtn, 'Loading...');
    const preState = this.captureFullState();

    try {
      // Fetch as blob and convert to data URI to avoid CORS canvas taint
      const resp = await fetch(`https://mc-heads.net/skin/${encodeURIComponent(username)}`);
      if (!resp.ok) throw new Error('Could not load skin. Check the username.');
      const blob = await resp.blob();
      const dataUri = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Could not load skin. Check the username.'));
        img.src = dataUri;
      });

      if (!this._validSkinSize(img)) throw new Error(`Skin service returned an unusable ${img.width}x${img.height} image.`);
      this.pushUndo(preState);
      this.applySkinTexture(img);
      this.skinName = username;
      const switched = await this._syncBodyType(img);
      this.showSkinStatus(`${username} (${img.width}x${img.height})`);
      this.setStatus(switched === 'alex'
        ? 'Slim arms detected, switched to Alex.'
        : 'Loaded ' + username + '.');
    } catch (err) {
      this.showError(err.message);
    } finally {
      clearBusy(this.loadSkinBtn);
    }
  }

  // A well-formed square skin leaves these boxes empty - they are the gaps between the UV islands.
  // Mirror the sheet and the islands land on them instead, which makes the test a simple ink count:
  // if flipping the sheet moves ink OUT of the gaps, the sheet was stored mirrored. Measured: Steve
  // 0 ink as-is vs 208 flipped, Dinnerbone 208 vs 1, Grumm 368 vs 0.
  static get MIRROR_PROBE_BOXES() {
    return [[0, 0, 8, 8], [24, 0, 16, 8], [56, 0, 8, 8], [0, 16, 4, 4], [12, 16, 4, 4],
            [0, 32, 4, 4], [12, 32, 4, 4], [0, 48, 4, 4], [12, 48, 4, 4], [28, 48, 4, 4]];
  }

  _detectMirroredSheet(image) {
    const w = image.width || image.naturalWidth, h = image.height || image.naturalHeight;
    if (!w || !h || w !== h || w % 64 !== 0) return false;   // 1:1 only - legacy 2:1 has no 2nd layer
    const hd = w / 64;
    const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
    const cx = cvs.getContext('2d', { willReadFrequently: true });
    cx.drawImage(image, 0, 0);
    const d = cx.getImageData(0, 0, w, h).data;
    const ink = (mirror) => {
      let n = 0;
      for (const [bx, by, bw, bh] of ChibiSkinMaker.MIRROR_PROBE_BOXES) {
        for (let y = by * hd; y < (by + bh) * hd; y++) {
          const sy = mirror ? (h - 1 - y) : y;
          for (let x = bx * hd; x < (bx + bw) * hd; x++) if (d[(sy * w + x) * 4 + 3] >= 128) n++;
        }
      }
      return n;
    };
    const asIs = ink(false);
    if (asIs === 0) return false;                 // nothing in the gaps: ordinary sheet, cheap exit
    return ink(true) * 4 < asIs;                  // flipping empties them => it was stored mirrored
  }

  _flipImageV(image) {
    const w = image.width || image.naturalWidth, h = image.height || image.naturalHeight;
    const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
    const cx = cvs.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.translate(0, h); cx.scale(1, -1);
    cx.drawImage(image, 0, 0);
    return cvs;
  }

  // SLIM SKIN DETECTION.
  //
  // This fixes a real broken-output bug. Nothing in the skin-loading path ever set currentModelType,
  // so it stayed 'steve' forever: every player with an Alex (slim) skin typed their username, pressed
  // Load Skin, and got 3px arm textures stretched across 4px arms with a visible empty stripe. The
  // only cure was two clicks deep inside a collapsed panel, and the tool's own copy admitted it
  // ("Body type lives in the Model tab"). A tool should not ask you to fix its own output.
  //
  // How: a slim skin leaves four 2px-wide gutters fully transparent, because the arm is 3px not 4px.
  // If all four are transparent, it is slim. Legacy 64x32 skins predate Alex entirely, so they are
  // always classic. (A fully-opaque sheet - some editors flatten onto a background - reads as classic
  // too: its opaque gutter pixels hit the ink check.)
  _detectSlim(image) {
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w) return null;
    // Legacy 2:1 sheets (64x32, 128x64 ...) predate Alex, so they are ALWAYS classic - say so (false)
    // instead of "cannot tell" (null). Returning null left the previous skin's body type in place, so
    // loading an Alex skin and then a legacy one rendered the legacy skin with 3px slim arms.
    if (h * 2 === w) return false;
    const s = w / 64;
    if (s < 1 || s % 1 !== 0) return null;              // not a standard skin size

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0);

    // The four strips that only a WIDE arm paints. On a slim skin they are empty.
    const gutters = [[50, 16, 2, 4], [54, 20, 2, 12], [42, 48, 2, 4], [46, 52, 2, 12]];
    for (const [x, y, gw, gh] of gutters) {
      if ((y + gh) * s > h) return null;                // skin too short to hold the second arm
      const d = g.getImageData(x * s, y * s, gw * s, gh * s).data;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] > 16) return false;                    // ink in a wide-only strip: classic
      }
    }
    // Every wide-only strip was empty: slim. (A fully-opaque classic skin never reaches here - its
    // opaque gutter pixels already returned false at the ink check above.)
    return true;
  }

  // The one code path behind BOTH body-type controls (the desktop pills and the phone dropdown).
  //
  // It COALESCES rather than rejects, and that is the whole design. A closed <select> fires `change`
  // on EVERY arrow key, and each change here reloads the model, which is async. The obvious guard
  // ("busy? drop it") is actively wrong: the browser has ALREADY committed the new option, so
  // dropping the change and re-syncing writes the old value back into the control, reverting the
  // user's choice under their hands. Arrow from Auto down to Alex and you would silently land on
  // Steve, with the dropdown reading "Steve". Measured: the first switch is an uncached fetch of the
  // default skin PNG, so the window to lose a keystroke in is ~1.2s, and Windows key-repeat is ~30ms.
  //
  // So a change that arrives mid-load is remembered as the LATEST intent and applied when the
  // in-flight load lands. The burst also shares ONE undo entry: arrowing Auto > Steve > Alex is one
  // decision, and Ctrl+Z should return to Auto, not to a Steve the user only passed through.
  async _setBodyType(mode) {
    if (!mode || !ChibiSkinMaker.BODY_TYPES.includes(mode)) return;

    if (this._busyBodyType) {
      this._pendingBodyType = mode;   // deliberately does NOT re-sync: that is what reverted the control
      return;
    }
    if (mode === this.bodyTypeMode) {
      this._syncBodyTypeButtons();
      return;
    }

    this._busyBodyType = true;
    this.pushUndo();                  // one entry for the whole burst
    try {
      let next = mode;
      while (next && next !== this.bodyTypeMode) {
        this._pendingBodyType = null;
        await this._applyBodyType(next);
        next = this._pendingBodyType;
      }
    } finally {
      this._busyBodyType = false;
      this._pendingBodyType = null;
      this._syncBodyTypeButtons();
    }
  }

  // Does the work for one body type. No undo push: _setBodyType owns the undo entry for the burst.
  async _applyBodyType(mode) {
    this.bodyTypeMode = mode;
    this._syncBodyTypeButtons();

    if (mode === 'auto') {
      // Going back to Auto re-reads the skin, so the switch takes effect at once instead of waiting for
      // the next skin load. Detect on the PRISTINE upload (before legacy conversion): the converted
      // square's empty gutters would wrongly read a legacy sheet as slim.
      const detectSrc = this._pristineSkinImage || this.currentSkinImage;
      const resolved = detectSrc ? await this._syncBodyType(detectSrc) : null;
      this._syncBodyTypeButtons();
      this.setStatus(resolved
        ? 'Auto: ' + (resolved === 'alex' ? 'slim arms detected, using Alex.' : 'wide arms detected, using Steve.')
        : (this.currentSkinImage ? 'Auto: keeping ' + this.currentModelType + '.' : 'Auto: body type will follow the skin.'));
      return;
    }

    await this.loadModel(mode, { clearUndo: false });
    // Recompose: the sprite's arm width comes from currentModelType, so a manual Steve/Alex lock must
    // re-render immediately (loadModel is a 2D stub - nothing else repaints).
    this._refreshSkinTexture();
    this.setStatus('Body type locked to ' + (mode === 'alex' ? 'Alex' : 'Steve') + '.');
  }

  // ONE place decides which pill is lit. Five different sites used to do this by hand
  // (resetAll, the click handler, restoreFullState, importBBModel, the detector), and with a third
  // button in the group every one of them would have quietly switched Auto off.
  //
  // In Auto mode the ACTIVE pill is "Auto", and the body type it resolved to is shown as a quieter
  // "resolved" state on Steve or Alex, so you can always see what the tool decided.
  _syncBodyTypeButtons() {
    for (const b of this.modelToggle.querySelectorAll('.toggle-btn')) {
      const m = b.dataset.model;
      b.classList.toggle('active', m === this.bodyTypeMode);
      b.classList.toggle('is-resolved', this.bodyTypeMode === 'auto' && m === this.currentModelType);
    }
  }

  // Switch the body type to match the skin. Only ever called in Auto mode: a manual choice must not be
  // overruled by the next skin the user loads.
  async _syncBodyType(image) {
    if (this.bodyTypeMode !== 'auto') return null;
    const slim = this._detectSlim(image);
    if (slim === null) return null;
    const type = slim ? 'alex' : 'steve';
    if (type === this.currentModelType) { this._syncBodyTypeButtons(); return null; }

    // clearUndo:false is MANDATORY. loadModel() wipes the undo and redo stacks by default, and both
    // skin loaders have just pushed an undo entry: a naive call would destroy the entry it pushed,
    // plus every earlier one.
    await this.loadModel(type, { clearUndo: false });
    this._syncBodyTypeButtons();
    if (this.currentSkinImage) this.applySkinTexture(this.currentSkinImage);
    return type;
  }

  // One drop target, both file types: the user should not have to know which of two doors a file
  // goes through. Sniff the file, not the door.
  handleDroppedFile(e) {
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
      this.loadSkinFromFile(file);
    } else {
      this.showError('Drop a skin PNG.');
    }
  }

  // The ONE size rule for every skin entry point (file drop, username fetch, config import): square or
  // legacy 2:1, width a power of two >= 64. Anything else makes _composeChibi's hd multiplier sample the
  // wrong rects and the sprite silently garbles - reject it up front instead.
  _validSkinSize(img) {
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
    const ratio = w / h;
    return (ratio === 1 || ratio === 2) && w >= 64 && (w & (w - 1)) === 0;
  }

  loadSkinFromFile(file) {
    this.hideError();
    const preState = this.captureFullState();
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Validate dimensions
        const ratio = img.width / img.height;
        if (ratio !== 1 && ratio !== 2) {
          this.showError('Skin must be square (64x64, 128x128, 256x256 ...) or a legacy 2:1 sheet (64x32, 128x64 ...).');
          return;
        }
        if (img.width < 64 || (img.width & (img.width - 1)) !== 0) {
          this.showError('Skin width must be a power of two: 64, 128, 256, 512 ...');
          return;
        }
        this.pushUndo(preState);
        this.applySkinTexture(img);
        this.skinName = file.name.replace(/\.png$/i, '');
        this._syncBodyType(img).then((switched) => {
          this.showSkinStatus(`${file.name} (${img.width}x${img.height})`);
          this.setStatus(switched === 'alex'
            ? 'Slim arms detected, switched to Alex.'
            : 'Loaded ' + file.name + '.');
        });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  downloadSkin() {
    if (!this.currentSkinImage) return;
    const canvas = document.createElement('canvas');
    canvas.width = this.currentSkinImage.width || this.currentSkinImage.naturalWidth;
    canvas.height = this.currentSkinImage.height || this.currentSkinImage.naturalHeight;
    canvas.getContext('2d').drawImage(this.currentSkinImage, 0, 0);
    const link = document.createElement('a');
    link.download = `${this.skinName || 'skin'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    this._flashBtn(this.downloadSkinBtn, 'Saved!', true);
  }

  removeSkin() {
    this.currentSkinImage = null;
    this._pristineSkinImage = null;
    this._skinDataUri = null;
    this.skinName = null;
    this.clearSkinStatus();
    setVisible(this.skinError, false);
    this._refreshSkinTexture();   // falls back to the model's embedded default skin
  }

  applySkinTexture(image) {
    // MIRRORED SHEETS (Dinnerbone, Grumm). Their skins are stored as the whole PNG flipped top to
    // bottom, so every UV island sits in the wrong place and the head box reads the leg rows - which
    // is why one loaded as a blank face with the artwork down in the torso. Un-mirror the sheet so
    // the regions line up again, then render the FIGURE inverted, which is how the game shows them.
    // Detected from the texture, not the name, so a file upload or a rehost gets it too.
    const flipped = this._detectMirroredSheet(image);
    this.upsideDown = flipped;
    if (flipped) image = this._flipImageV(image);
    // Keep the PRISTINE upload (before any legacy conversion): body-type re-detection must see the
    // original 2:1 sheet, or _detectSlim's legacy-always-classic rule never fires on the converted
    // square (whose empty gutters would read as slim).
    this._pristineSkinImage = image;

    let source = image;

    // Convert legacy 64x32 skins to 64x64
    if (image.width / image.height === 2) {
      source = this.convertLegacySkin(image);
    }

    // Store data URI and dimensions for the settings config (the PRISTINE skin, not barebones).
    const canvas = document.createElement('canvas');
    canvas.width = source.width || source.naturalWidth;
    canvas.height = source.height || source.naturalHeight;
    canvas.getContext('2d').drawImage(source, 0, 0);
    try {
      this._skinDataUri = canvas.toDataURL('image/png');
      this._skinWidth = canvas.width;
      this._skinHeight = canvas.height;
    } catch { this._skinDataUri = null; }

    // One chokepoint builds and applies the display texture (see _refreshSkinTexture).
    this.currentSkinImage = source;
    this._refreshSkinTexture();
  }

  // The Colour similarity slider only makes sense once Barebones is on, so it is HIDDEN (not just
  // dimmed) until then. It is the last row of the Material group, so nothing above it shifts when it
  // appears. Also toggles the input's disabled state so a hidden slider stays inert.
  _syncBarebonesRow(on) {
    setVisible(this.barebonesStrengthRow, on);
    setRowEnabled(this.barebonesStrengthRow, on);
  }

  // The empty tool renders the vanilla default skin (Steve or Alex) so it never boots blank. The two
  // PNGs are THIS tool's own assets (tools/assets/minecraft-chibi-skin-maker/), copied from vanilla
  // 1.21 (textures/entity/player/wide/steve.png and slim/alex.png) - deliberately NOT the Mojavatar
  // models, so the chibi tool has no asset dependency on its 3D sibling. Cached per body type, and
  // the default follows a manual Steve/Alex switch. A load failure quietly leaves the preview blank -
  // the default is a boot nicety, never a dependency the tool can error out on.
  async _loadDefaultSkin(type) {
    try {
      this._defaultSkinCache = this._defaultSkinCache || {};
      if (!this._defaultSkinCache[type]) {
        this._defaultSkinCache[type] = await this._loadImage(`/tools/assets/minecraft-chibi-skin-maker/${type}.png`);
      }
      this._defaultSkinImage = this._defaultSkinCache[type];
    } catch {
      this._defaultSkinImage = null;
    }
    this._refreshSkinTexture();
  }

  // The 2D reading of the Look panel's material presets: each is a deterministic tone curve over the
  // composed sprite (saturation around luma, contrast around mid-grey, brightness offset), plus two
  // structural touches - glossy brightens the pixels along the TOP silhouette edge (a specular kiss),
  // embossed darkens the 1px inner rim (a pressed-relief read). 'soft' is identity (the calibrated
  // default, byte-identical to before materials existed) and 'flat' is handled in the compose gates
  // (unlit: no side dim, no AO). The outline is drawn AFTER this pass, so it keeps its pure color.
  _applyMaterialTone(c, cv) {
    const M = {
      glossy:   { sat: 1.18, con: 1.06, bri: 3, top: 1.22 },
      clay:     { sat: 0.76, con: 0.93, bri: 6 },
      plastic:  { sat: 1.10, con: 1.14, bri: 0 },
      matte:    { sat: 0.88, con: 0.91, bri: 2 },
      metallic: { sat: 0.34, con: 1.22, bri: 0 },
      embossed: { sat: 0.96, con: 1.05, bri: 0, rim: 0.74 },
    }[this.currentMaterial];
    if (!M) return;
    const id = c.getImageData(0, 0, cv.width, cv.height), D = id.data, W = cv.width, H = cv.height;
    const alphaAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : D[(y * W + x) * 4 + 3];
    for (let i = 0; i < D.length; i += 4) {
      if (D[i + 3] === 0) continue;
      let r = D[i], g = D[i + 1], b = D[i + 2];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * M.sat; g = l + (g - l) * M.sat; b = l + (b - l) * M.sat;
      D[i] = (r - 128) * M.con + 128 + M.bri;
      D[i + 1] = (g - 128) * M.con + 128 + M.bri;
      D[i + 2] = (b - 128) * M.con + 128 + M.bri;
    }
    if (M.top || M.rim) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (D[i + 3] === 0) continue;
        if (M.top && !alphaAt(x, y - 1)) { D[i] *= M.top; D[i + 1] *= M.top; D[i + 2] *= M.top; }
        else if (M.rim && (!alphaAt(x - 1, y) || !alphaAt(x + 1, y) || !alphaAt(x, y - 1) || !alphaAt(x, y + 1))) {
          D[i] *= M.rim; D[i + 1] *= M.rim; D[i + 2] *= M.rim;
        }
      }
    }
    c.putImageData(id, 0, 0);
  }

  // Which Parts-tab names govern a blit-table key: [base part, 2nd-layer part]. The {base,over}
  // merged parts carry both (hiding the base leaves the clothing layer as its own silhouette, hiding
  // the layer strips the clothing - the same independence the 3D outliner gave its meshes); the flat
  // table's separate clothing parts and the hat blits govern themselves.
  _partNames(key) {
    if (key.startsWith('hat')) return ['Hat Layer', null];
    if (key.startsWith('head')) return ['Head', null];
    if (key.startsWith('jacket')) return ['Body Layer', null];
    if (key.startsWith('body')) return ['Body', 'Body Layer'];
    if (key.startsWith('rSlv')) return ['Right Arm Layer', null];
    if (key.startsWith('lSlv')) return ['Left Arm Layer', null];
    if (key.startsWith('rArm')) return ['Right Arm', 'Right Arm Layer'];
    if (key.startsWith('lArm')) return ['Left Arm', 'Left Arm Layer'];
    if (key.startsWith('rPant')) return ['Right Leg Layer', null];
    if (key.startsWith('lPant')) return ['Left Leg Layer', null];
    if (key.startsWith('rLeg')) return ['Right Leg', 'Right Leg Layer'];
    if (key.startsWith('lLeg')) return ['Left Leg', 'Left Leg Layer'];
    return [null, null];
  }

  // Scale a shading multiplier by the Shadow-strength slider. The calibrated multipliers (side dim
  // 0.84, shoulder 0.88, creases/leg 0.86 - all measured off the reference) are what strength 50
  // produces EXACTLY; 0 lifts every one of them to 1 (shading gone), 100 drives them all to 0 (shaded
  // areas black), linearly on each side of the midpoint. this.shading === 'off' still hard-disables.
  _shadeMul(base) {
    if (this.shading === 'off') return 1;
    const s = Number.isFinite(this.shadingStrength) ? this.shadingStrength : 50;
    if (s <= 0) return 1;
    if (s <= 50) return 1 - (1 - base) * (s / 50);
    if (s >= 100) return 0;
    return base * (1 - (s - 50) / 50);
  }

  // The single view key, DERIVED from the four renderer state fields rather than stored - so undo,
  // config import and the test handles can set the fields directly and the Camera panel can never
  // disagree with what is actually rendered.
  _viewKey() {
    if (this.vertView === 'top' || this.vertView === 'bottom') return this.vertView;
    if (this.sideProfile) return this.facing === 'left' ? 'side-left' : 'side-right';
    if (this.flatProfile) return this.viewSide === 'back' ? 'back' : 'front';
    const l = this.facing === 'left';
    return this.viewSide === 'back' ? (l ? 'back34-left' : 'back34-right') : (l ? '34-left' : '34-right');
  }

  // ONE code path behind the Camera panel's view grid and the 1-8 keys. Maps a view key onto the
  // state fields (only the fields that MATTER for that view - picking Front keeps your facing, so
  // returning to a 3/4 goes back to the side you were on), pushes one undo entry, re-renders, and
  // re-lights the grid.
  setView(key) {
    if (key === this._viewKey()) { this._syncViewButtons(); return; }
    const V = CHIBI_VIEWS[key];
    if (!V) return;
    this.pushUndo();
    this.vertView = V.vert || 'none';
    if (V.side !== undefined) this.sideProfile = !!V.side;
    if (V.flat !== undefined) this.flatProfile = V.flat;
    if (V.facing) this.facing = V.facing;
    if (V.vs) this.viewSide = V.vs;
    this._refreshSkinTexture();
    this._syncViewButtons();
    const btn = (this.viewButtons || []).find((b) => b.dataset.view === key);
    this.setStatus('View: ' + (btn ? btn.textContent : key) + '.');
  }

  _syncViewButtons() {
    const key = this._viewKey();
    for (const b of this.viewButtons || []) {
      const on = b.dataset.view === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // ONE code path behind the Pose panel's preset grid (mirrors setView): validate the key, push one
  // undo entry, re-render, re-light the grid. 'none' is Standing - also what the Reset button sets.
  setPose(key) {
    if (key !== 'none' && !CHIBI_POSES[key]) return;
    if (key === this.pose) { this._syncPoseButtons(); return; }
    this.pushUndo();
    this.pose = key;
    if (key !== 'none' && this.anim !== 'none') { this.anim = 'none'; this._syncAnimButtons(); }
    this._refreshSkinTexture();
    this._syncPoseButtons();
    const btn = (this.poseButtons || []).find((b) => b.dataset.pose === key);
    this.setStatus('Pose: ' + (btn ? btn.textContent : key) + '.');
  }

  // FRAMING, not a pose or a camera: the busts crop whatever the current camera and pose render, so
  // a waving portrait still works and a portrait can now be taken from any angle. Four mutually
  // exclusive choices (see BUST_CUT); Full Body is the absence of a crop.
  setBust(key) {
    const want = ChibiSkinMaker.BUST_CUT[key] !== undefined ? key : false;
    const next = want;   // four mutually exclusive framings; Full Body is its own button, so clicking
                         // the active crop is a no-op rather than a hidden toggle back to full body
    if (next === this.portraitView) { this._syncPoseButtons(); return; }
    this.pushUndo();
    this.portraitView = next;
    this._refreshSkinTexture();
    this._syncPoseButtons();
    this._syncViewButtons();
    this.setStatus('Framing: ' + (next ? (ChibiSkinMaker.BUST_LABEL[next] || next) : 'full body') + '.');
  }

  setLayerShadow(on) {
    const next = !!on;
    if (next === this.layerShadow) return;
    this.pushUndo();
    this.layerShadow = next;
    if (this.layerShadowInput) this.layerShadowInput.checked = next;
    this._refreshSkinTexture();
    this.setStatus('Layer shadow: ' + (next ? 'on' : 'off') + '.');
  }

  _syncPoseButtons() {
    for (const b of this.bustButtons || []) {
      const on = (b.dataset.bust === 'none') ? !this.portraitView : (b.dataset.bust === this.portraitView);
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
    for (const b of this.poseButtons || []) {
      const on = b.dataset.pose === this.pose;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // THE single chokepoint: (re)build the chibi from the current skin and paint the preview. Every
  // skin/filter/option change funnels through here so the compose path is identical for load, undo,
  // and config import. Re-derives from the pristine currentSkinImage every time, so toggling
  // Barebones off restores the untouched skin exactly. No skin -> blank preview.
  _refreshSkinTexture() {
    if (!this.ctx) return;
    const src = this.currentSkinImage || this._defaultSkinImage;
    if (!src) { this._chibiCanvas = null; this._draw(); return; }
    const skin = this._skinToCanvas(src);
    if (this._animRAF) {
      cancelAnimationFrame(this._animRAF);
      this._animRAF = 0;
    }
    if (CHIBI_ANIMS[this.anim]) {
      if (this.anim === 'cursor') {
        const frame = this._bakeCursorFrame(skin);
        this._chibiCanvas = frame.cv;
        this._animEnsureLoop();
      } else {
        this._animFrames = this._bakeAnim(skin);
        this._animIdx = 0; this._animPrev = 0;
        this._chibiCanvas = this._animFrames[0].cv;
        this._animEnsureLoop();
      }
    } else {
      this._animFrames = null;
      this._chibiCanvas = this._composeChibi(skin);
    }
    this._draw();
    this._syncBgShapeButtons();
    if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, this._bgPaints());
  }

  // Bake every frame of the current animation at native scale. Each frame composes UNCROPPED with
  // the frame's pose/view/offsets swapped in via instance state (saved and restored - compose is
  // synchronous), then all frames assemble into one shared box: aligned by each table's shift so
  // the body sits still while limbs move, or by center for the view-cycling turn/spin. One tight
  // crop over the UNION silhouette keeps the box minimal without re-centering any single frame.
  _bakeAnim(skin) {
    const A = CHIBI_ANIMS[this.anim];
    const saved = {
      pose: this.pose, portraitView: this.portraitView, vertView: this.vertView,
      sideProfile: this.sideProfile, flatProfile: this.flatProfile,
      facing: this.facing, viewSide: this.viewSide,
    };
    const raw = [];
    try {
      for (const f of A.frames) {
        this.pose = f.pose || 'none';
        if (f.view) {
          const V = CHIBI_VIEWS[f.view];
          this.portraitView = V.portrait || false;
          this.vertView = V.vert || 'none';
          this.sideProfile = !!V.side;
          this.flatProfile = !!V.flat;
          if (V.facing) this.facing = V.facing;
          this.viewSide = V.vs || 'front';
        }
        if (typeof f.headSwap === 'string') {
          const fam = f.headSwap === '34-left'
            ? { parts: CHIBI_PARTS_LEFT, order: CHIBI_ORDER_LEFT }
            : { parts: CHIBI_PARTS, order: CHIBI_ORDER };
          const hkeys = fam.order.filter((k) => k.startsWith('head') || k.startsWith('hat'));
          const hparts = {}; for (const k of hkeys) hparts[k] = fam.parts[k];
          this._animHeadSwap = { parts: hparts, order: hkeys };
        } else {
          this._animHeadSwap = f.headSwap || null;   // custom table (the bow's squashed heads) or off
        }
        this._animParts = f.parts || null;
        this._animPadX = A.padX || 0;
        this._animShadeRow = !!A.shadeRow;
        this._animNoCrop = true;
        const cvF = this._composeChibi(skin);
        raw.push({ cv: cvF, shift: this._lastComposeShift, dx: f.dx || 0, dy: f.dy || 0, ax: f.ax, delay: f.d });
      }
    } finally {
      this._animParts = null; this._animPadX = 0; this._animNoCrop = false; this._animHeadSwap = null; this._animShadeRow = false;
      Object.assign(this, saved);
    }
    // Union box in the aligned space, then place every frame identically.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const xOf = (r) => (r.ax !== undefined ? -r.ax
      : (A.anchor === 'center' ? -r.cv.width / 2 : -r.shift)) + r.dx;
    for (const r of raw) {
      minX = Math.min(minX, xOf(r)); maxX = Math.max(maxX, xOf(r) + r.cv.width);
      minY = Math.min(minY, r.dy); maxY = Math.max(maxY, r.dy + r.cv.height);
    }
    minX = Math.floor(minX); minY = Math.floor(minY);
    const W = Math.ceil(maxX) - minX, H = Math.ceil(maxY) - minY;
    const boxed = raw.map((r) => {
      const b = document.createElement('canvas'); b.width = W; b.height = H;
      const bc = b.getContext('2d'); bc.imageSmoothingEnabled = false;
      bc.drawImage(r.cv, Math.round(xOf(r) - minX), Math.round(r.dy - minY));
      return { cv: b, delay: r.delay };
    });
    // One shared tighten-crop: the union of every frame's silhouette.
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (const fr of boxed) {
      const d = fr.cv.getContext('2d').getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 0) {
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return boxed;
    return boxed.map((fr) => {
      const t = document.createElement('canvas'); t.width = x1 - x0 + 1; t.height = y1 - y0 + 1;
      const tc = t.getContext('2d'); tc.imageSmoothingEnabled = false;
      tc.drawImage(fr.cv, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
      return { cv: t, delay: fr.delay };
    });
  }

  _bakeCursorFrame(skin) {
    const saved = {
      pose: this.pose, portraitView: this.portraitView, vertView: this.vertView,
      sideProfile: this.sideProfile, flatProfile: this.flatProfile,
      facing: this.facing, viewSide: this.viewSide,
    };
    try {
      const dx = this._cursorHeadDx || 0;
      const dy = this._cursorHeadDy || 0;
      const swapKey = this._cursorHeadSwap;

      if (typeof swapKey === 'string') {
        const fam = swapKey === '34-left'
          ? { parts: CHIBI_PARTS_LEFT, order: CHIBI_ORDER_LEFT }
          : { parts: CHIBI_PARTS, order: CHIBI_ORDER };
        const hkeys = fam.order.filter((k) => k.startsWith('head') || k.startsWith('hat'));
        const hparts = {}; for (const k of hkeys) hparts[k] = fam.parts[k];
        this._animHeadSwap = { parts: hparts, order: hkeys };
      } else {
        this._animHeadSwap = null;
      }

      this._animParts = { head: [dx, dy] };
      this._animPadX = 2;
      this._animShadeRow = false;
      this._animNoCrop = true;
      const cvF = this._composeChibi(skin);
      return { cv: cvF, delay: 40 };
    } finally {
      this._animParts = null; this._animPadX = 0; this._animNoCrop = false; this._animHeadSwap = null; this._animShadeRow = false;
      Object.assign(this, saved);
    }
  }

  // The preview loop: swap the current baked frame in as _chibiCanvas on the frame's own delay
  // (divided by the export Speed select, so the preview shows the exact GIF timing). rAF stops
  // firing in background tabs, which pauses the loop for free; it exits when the anim turns off.
  _animEnsureLoop() {
    if (this._animRAF || this._animHold) return;
    const tick = (t) => {
      if (!CHIBI_ANIMS[this.anim] || this._animHold) { this._animRAF = 0; return; }
      this._animRAF = requestAnimationFrame(tick);
      if (this.anim === 'cursor') {
        const src = this.currentSkinImage || this._defaultSkinImage;
        if (src) {
          const skin = this._skinToCanvas(src);
          const frame = this._bakeCursorFrame(skin);
          this._chibiCanvas = frame.cv;
          this._draw();
        }
        return;
      }
      if (!this._animFrames) { this._animRAF = 0; return; }
      if (!this._animPrev) { this._animPrev = t; return; }
      const speed = this.gifSpeedValue || 1;
      const cur = this._animFrames[this._animIdx % this._animFrames.length];
      if (t - this._animPrev >= cur.delay / speed) {
        this._animPrev = t;
        this._animIdx = (this._animIdx + 1) % this._animFrames.length;
        this._chibiCanvas = this._animFrames[this._animIdx].cv;
        this._draw();
      }
    };
    this._animRAF = requestAnimationFrame(tick);
  }

  // ONE code path behind the Animation panel's grid (mirrors setPose). Animations play on the
  // standing figure, so picking one clears the pose - and vice versa - inside the same undo entry.
  setAnim(key) {
    if (key !== 'none' && !CHIBI_ANIMS[key]) return;
    if (key === this.anim) { this._syncAnimButtons(); return; }
    this.pushUndo();
    this.anim = key;
    if (key !== 'none' && this.pose !== 'none') { this.pose = 'none'; this._syncPoseButtons(); }
    try {
      this._refreshSkinTexture();
    } catch (e) {
      console.error('Error in _refreshSkinTexture:', e);
    }
    this._syncAnimButtons();
    this._updateGifInfo();
    this.setStatus(key === 'none' ? 'Animation off.' : 'Animation: ' + CHIBI_ANIMS[key].label + ' - export it from the GIF panel.');
  }

  _syncAnimButtons() {
    this.animButtons = Array.from(document.querySelectorAll('[data-anim]'));
    for (const b of this.animButtons) {
      const on = b.dataset.anim === this.anim;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }

  // The pristine skin at its NATIVE resolution. Do NOT normalise an HD skin down to 64 here: measuring
  // the reference showed it samples HD directly (only 13% of its head-front 2x2 blocks are uniform, i.e.
  // full HD detail), so the head front becomes a 1:1 copy of a 128px skin's 16x16 face. Normalising
  // first halves the face's resolution and visibly flattens it.
  _skinToCanvas(src) {
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    // willReadFrequently: _composeChibi getImageData's this canvas a dozen+ times per render.
    const c = cv.getContext('2d', { willReadFrequently: true }); c.imageSmoothingEnabled = false; c.drawImage(src, 0, 0);
    return this.barebones ? this._barebonesCanvas(cv) : cv;
  }

  // Assemble the chibi with the deterministic 2D blit table above: for each part, copy its skin rect
  // and paste it at its sprite rect. No 3D and no projection - the "3/4" look is only the head's side
  // face squished from 8 texels into 6 px beside the double-scaled front face. The output is a true
  // low-res 24x33 sprite, which is what makes it read as pixel art; _draw upscales it crisply.
  _composeChibi(skin) {
    if (this.headless) {
      this.outlineWidth = 0;
      this.outlineEnabled = false;
      this.bgShape = 'none';
      this.bgTransparent = true;
      this.bgImage = null;
    }
    const hd = Math.max(1, Math.round((skin.width || 64) / 64));   // HD skins sample at x2 / x4
    const slim = this.currentModelType === 'alex';
    const cv = document.createElement('canvas');
    cv.width = CHIBI_SPRITE.w; cv.height = CHIBI_SPRITE.h;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    // Per-face shading: front faces keep the skin's own colour (shade 1); only the squished SIDE faces
    // dim to CHIBI_SIDE_SHADE (0.84, measured off the reference - see the constant's doc). Each part is
    // shaded in its own buffer so a part can never re-darken one drawn underneath it.
    // Ten cameras from the state fields: vertView (top/bottom) beats sideProfile (facing picks the
    // side) beats flatProfile, then viewSide and facing. The BUSTS are not cameras - portraitView is
    // a crop applied on top, so a portrait renders at whatever camera and pose are selected.
    const bust = this.portraitView;
    const cut = ChibiSkinMaker.BUST_CUT[bust] || 0;      // 0 = full body
    const portrait = cut > 0;
    const headOnly = bust === 'head';
    const leftF = this.facing === 'left';
    const back = this.viewSide === 'back';
    const flat = this.flatProfile;
    const side = this.sideProfile;
    const vert = this.vertView === 'top' || this.vertView === 'bottom';
    let parts, order;
    if (vert) {
      parts = this.vertView === 'top' ? CHIBI_PARTS_TOP : CHIBI_PARTS_BOTTOM;
      order = this.vertView === 'top' ? CHIBI_ORDER_TOP : CHIBI_ORDER_BOTTOM;
    } else if (side) {
      parts = leftF ? CHIBI_PARTS_SIDE_LEFT : CHIBI_PARTS_SIDE_RIGHT;
      order = leftF ? CHIBI_ORDER_SIDE_LEFT : CHIBI_ORDER_SIDE_RIGHT;
    } else if (flat) {
      parts = back ? CHIBI_PARTS_BACK : CHIBI_PARTS_FLAT;
      order = back ? CHIBI_ORDER_BACK : CHIBI_ORDER_FLAT;
    } else if (back) {
      parts = leftF ? CHIBI_PARTS_BACK_LEFT : CHIBI_PARTS_BACK_RIGHT;
      order = leftF ? CHIBI_ORDER_BACK_LEFT : CHIBI_ORDER_BACK_RIGHT;
    } else {
      // The plain 3/4 - and the portrait, which is this render cut at the shoulders further below.
      parts = leftF ? CHIBI_PARTS_LEFT : CHIBI_PARTS;
      order = leftF ? CHIBI_ORDER_LEFT : CHIBI_ORDER;
    }
    // Where the side strips sit decides which AO regions apply: front-right and back-left carry them on
    // the image-LEFT; front-left and back-right on the image-RIGHT (limbs swap sides seen from behind).
    // Straight-on views (flat, back, pure profiles, top/bottom) have no strips and skip the AO pass.
    const stripsRight = !flat && !side && !vert && (leftF !== back);
    // Poses replace everything below the head in EVERY projection family: each family carries its
    // own replacement tables (the busts reuse the 3/4 ones - a waving hand sits above the portrait
    // cut), top and bottom included - every pose has a top and bottom table, so no view falls back to
    // standing. The head/hat blits carry over from the family's base table; the head bust is the one
    // exception, skipping pose parts entirely (the headOnly guard below).
    let poseTab = null;
    if (CHIBI_POSES[this.pose]) {
      const P = CHIBI_POSES[this.pose];
      if (vert) poseTab = this.vertView === 'top' ? P.top : P.bottom;
      else if (side) poseTab = leftF ? P.sideLeft : P.sideRight;
      else if (flat) poseTab = back ? P.flatBack : P.flat;
      else if (back) poseTab = leftF ? P.backLeft : P.backRight;
      else poseTab = leftF ? P.left : P.right;
    }
    if (poseTab) {
      const isHead = (k) => { const n = this._partNames(k)[0]; return n === 'Head' || n === 'Hat Layer'; };
      const headKeys = order.filter(isHead);
      const keep = {};
      for (const k of headKeys) keep[k] = parts[k];
      parts = { ...keep, ...poseTab.parts };
      // Keep the family's own head layering: the bottom view draws the head FIRST (feet and hands
      // are nearer the camera from below); every other family draws it last.
      order = isHead(order[0]) ? [...headKeys, ...poseTab.order] : [...poseTab.order, ...headKeys];
      // `over` parts draw ON TOP of the head - our head is so wide that a raised arm beside it (the
      // wave) would otherwise be hidden behind the head; drawing it last puts it in front, like a
      // hand raised beside the face. Their parts already merged in above; just append the keys.
      if (poseTab.over) order = [...order, ...poseTab.over];
      // Pose blits can overhang the standing sprite on either edge (raised arms, the T-pose's arms);
      // each table precomputes how far, so the canvas widens and every blit shifts right instead of
      // going negative. The crop below re-tightens either way.
      cv.width = poseTab.canvasW;
      c.imageSmoothingEnabled = false;   // resizing a canvas resets its context state
    }
    // Part-swap frames (head turns, bowed heads, bent arms): drop the family keys the swap
    // names - head/hat by default - and append the replacement blits, drawn last.
    if (this._animHeadSwap) {
      const dropPre = this._animHeadSwap.drop || ['head', 'hat'];
      order = order.filter((k) => !dropPre.some((pre) => k.startsWith(pre)));
      parts = { ...parts, ...this._animHeadSwap.parts };
      order = [...order, ...this._animHeadSwap.order];
    }
    const xShift = (poseTab ? poseTab.shift : 0) + (this._animPadX || 0);
    this._lastComposeShift = xShift;   // the bake assembler aligns frames by this
    // PER COLUMN, the lowest row any head/hat blit actually paints OPAQUE. The under-head shoulder
    // shadow hangs off this instead of a constant: a hat layer is drawn PROUD (a row lower than the
    // bare head), so on a skin whose overlay covers the whole head the fixed row landed on the hat's
    // own bottom row - the caster shading itself instead of the shoulders under it. Per COLUMN, not one
    // row for the whole head: a skin with a single dangling hat pixel (Grian has exactly one on each
    // side face) would otherwise drop the entire shoulder line a row for one outlier. Measured from the
    // painted pixels rather than the dest rect because an EMPTY hat region still runs its blit, and
    // trusting the rect would drop the shadow a row on every hatless skin.
    const headBottomCol = new Int16Array(cv.width + (this._animPadX || 0) * 2 + 8).fill(-1);
    // Sprite-space record of what each pixel came from: 0 nothing, 1 base skin, 2 the 2nd layer. Only
    // built when the layer shadow is on, since it costs a write per painted pixel.
    const maskW = cv.width + (this._animPadX || 0) * 2 + 8, maskH = cv.height + 8;
    const overMask = this.layerShadow ? new Uint8Array(maskW * maskH) : null;
    if (this._animPadX) cv.width += this._animPadX * 2;   // resizing clears; nothing is drawn yet
    const sctx = skin.getContext('2d');
    const isVis = (n) => n == null || this.partVisibility[n] !== false;
    const unlit = this.currentMaterial === 'flat';   // 'Flat (Unlit)' material: no side dim, no AO

    for (const key of order) {
      const p = parts[key];
      if (p.hat && this.headOverlay === 'off') continue;
      if (p.clothing && this.bodyOverlay === 'off') continue;   // flat table's separate 2nd-layer parts
      // Parts-tab eyes. A merged {base,over} part draws when EITHER half is visible: base hidden +
      // layer shown = the clothing as its own silhouette (base samples from an empty buffer below).
      const [baseName, overName] = this._partNames(key);
      if (headOnly && baseName !== 'Head' && baseName !== 'Hat Layer') continue;   // head bust: head blits only
      const baseVis = isVis(baseName);
      const overVis = !!(p.base && p.over) && isVis(overName) && this.bodyOverlay !== 'off';
      if (p.base && p.over ? (!baseVis && !overVis) : !baseVis) continue;
      // Pose hands live at a different UV entirely for slim skins (3-wide bottom face), so they carry
      // explicit slim rects instead of the arm/slimShiftX width fixups.
      const s = ((slim && p.slimBase) || p.base || p.src).slice();
      if (p.arm && slim) s[2] = 3;            // Alex arms are 3 texels wide
      if (p.slimShiftX && slim) s[0] -= 1;    // a LEFT face sits after the front, which shrank by 1
      // 8px-UV skins paint their limb/body faces into the TOP 8 rows of the nominal 12-tall regions
      // (3D-verified with a row-banded probe: rows 0-7 show, 8-11 are ignored). Every 12-tall rect in
      // every table shrinks to 8; the sampler then stretches those 8 rows over the same sprite height.
      // Heads (8-tall) and top/bottom faces (4-tall) are untouched.
      if (this.halfHeightUVs && s[3] === 12) s[3] = 8;
      // The side-face dim IS part of the shading (sss's shadow slider darkens the sides too: side/front
      // ratio 0.50 at shadow-100 vs 0.64 at shadow-0), so it rides the same strength slider as the AO
      // pass below (_shadeMul returns 1 when shading is off or strength is 0). Pose parts carry their
      // own explicit `shade` multiplier (their layouts don't match the standing AO rects).
      // Classic (wide) skins take the wideDest layout where a part has one (4px arm fronts, 9px body).
      const d = (!slim && p.wideDest) ? p.wideDest : p.dest;
      const rot = p.rot || 0;
      let shade = unlit ? 1 : (p.shade ? this._shadeMul(p.shade) : (p.side ? this._shadeMul(CHIBI_SIDE_SHADE) : 1));
      // Animation-frame group offsets and DEPTH SHADE ([dx, dy, shadeMul]): the reference dims
      // the limb that swings away from the camera mid-stride, and so do we - the multiplier
      // folds into this part's own shade and rides the Shadow-strength slider like the rest.
      let aox = 0, aoy = 0;
      if (this._animParts) {
        for (const g in this._animParts) {
          if (CHIBI_ANIM_GROUPS[g].some((pre) => key.startsWith(pre))) {
            aox = this._animParts[g][0]; aoy = this._animParts[g][1];
            if (this._animParts[g][2] && !unlit) shade *= this._shadeMul(this._animParts[g][2]);
            break;
          }
        }
      }
      const t = document.createElement('canvas'); t.width = d[2]; t.height = d[3];
      const tc = t.getContext('2d');
      // NEAREST sampling: each output pixel copies ONE real skin texel - crisp pixel-art blocks, small
      // palette, no gradient mush (area-averaging read as "not pixel art"). The HORIZONTAL map is
      // mirror-symmetric (symNearest) so a symmetric skin renders symmetric; the VERTICAL map is plain
      // nearest (nearestMap) - see the comment at the sampling call below.
      const srcW = s[2] * hd, srcH = s[3] * hd;
      // Base hidden (Parts tab) but layer shown: start from a fully transparent buffer instead.
      const sd = baseVis ? sctx.getImageData(s[0] * hd, s[1] * hd, srcW, srcH) : new ImageData(srcW, srcH);
      // Composite the 2nd-layer clothing onto the base IN SKIN SPACE (an OPAQUE overlay texel - alpha
      // >= 128 - replaces the base texel at the same coordinate), then sample the single merged texture
      // once. This is why the clothing reads clean instead of noisy - the old separate scaled blits
      // misaligned. The alpha never goes DOWN: a soft-brush overlay speck (alpha 1..127, common in
      // Photoshop/GIMP-edited skins) must not punch a translucent hole through the opaque body under it.
      // bodyOverlay off => base only. Only {base,over} parts (body/arms/legs) merge; the head keeps its
      // own blits.
      // srcIsOver marks the texels the 2nd layer actually covered, so the layer-shadow pass below can
      // tell clothing from bare skin AFTER the merge has hidden the difference.
      let srcIsOver = null;
      if (overVis) {
        const ov = ((slim && p.slimOver) || p.over).slice(); if (p.arm && slim) ov[2] = 3;
        if (p.slimShiftX && slim) ov[0] -= 1;
        if (this.halfHeightUVs && ov[3] === 12) ov[3] = 8;   // overlay regions shrink with the base
        const od = sctx.getImageData(ov[0] * hd, ov[1] * hd, srcW, srcH);
        if (this.layerShadow) srcIsOver = new Uint8Array(srcW * srcH);
        for (let i = 0; i < sd.data.length; i += 4) if (od.data[i + 3] >= 128) {
          sd.data[i] = od.data[i]; sd.data[i + 1] = od.data[i + 1]; sd.data[i + 2] = od.data[i + 2];
          sd.data[i + 3] = Math.max(sd.data[i + 3], od.data[i + 3]);
          if (srcIsOver) srcIsOver[i >> 2] = 1;
        }
      }
      const out = tc.createImageData(d[2], d[3]);
      // x mirrored (keeps a symmetric skin symmetric), y plain nearest (see nearestMap: mirroring the
      // vertical map is what doubled the eyelash row instead of a harmless one).
      // A rotated pose blit samples through its UNROTATED dims (uw x uh), then the dest loop below
      // spins the coordinates in crisp 90-degree steps.
      const uw = (rot === 90 || rot === 270) ? d[3] : d[2];
      const uh = (rot === 90 || rot === 270) ? d[2] : d[3];
      let xc = symNearest(srcW, uw);
      // The 12-tall -> 10-row body/arm band uses the reference-matched row choice (see CHIBI_BAND_YMAP);
      // for HD skins each chosen texel row samples its centre pixel row. Everything else plain nearest.
      const yc = (s[3] === 12 && uh === 10)
        ? CHIBI_BAND_YMAP.map(t => Math.min(srcH - 1, t * hd + (hd >> 1)))
        : nearestMap(srcH, uh);
      // mirrorMap (facing-left odd-width side strips): squeezing an EVEN-width face into an ODD width has
      // no symmetric center texel, and floor picks the same index for both facings - so a mirror-authored
      // skin would render its two facings half a texel apart. Re-index as the exact mirror of the right
      // table's choice: m'[i] = srcW-1 - m[destW-1-i]. Even-width strips are already mirror-consistent.
      if (p.mirrorMap) { const m = xc; xc = new Array(uw); for (let i = 0; i < uw; i++) xc[i] = srcW - 1 - m[uw - 1 - i]; }
      // mirrorX (bottom view): looking up at a face flips its horizontal axis, like turning a sheet of
      // paper over - sample the content mirrored (3D-verified: texture top-left lands image top-right).
      if (p.mirrorX) xc = xc.slice().reverse();
      for (let dy = 0; dy < d[3]; dy++) {
        for (let dx = 0; dx < d[2]; dx++) {
          let ux, uy;
          if (rot === 180) { ux = d[2] - 1 - dx; uy = d[3] - 1 - dy; }
          else if (rot === 90) { ux = dy; uy = uh - 1 - dx; }        // cw: unrotated top edge -> dest right
          else if (rot === 270) { ux = uw - 1 - dy; uy = dx; }       // ccw: unrotated bottom edge -> dest right
          else { ux = dx; uy = dy; }
          const si = (yc[uy] * srcW + xc[ux]) * 4, oi = (dy * d[2] + dx) * 4;
          out.data[oi] = sd.data[si]; out.data[oi + 1] = sd.data[si + 1];
          out.data[oi + 2] = sd.data[si + 2]; out.data[oi + 3] = sd.data[si + 3];
          // Same texel, same nearest map: the mask can never drift out of step with the pixels.
          if (overMask && sd.data[si + 3] >= 128) {
            const mx = d[0] + xShift + aox + dx, my = d[1] + aoy + dy;
            if (mx >= 0 && mx < maskW && my >= 0 && my < maskH) {
              // p.hat is the HEAD's 2nd layer. It never goes through the base/over merge above - the
              // head draws its face and its hat as separate blits - so without this the hat cast
              // nothing and hair never shadowed the face.
              overMask[my * maskW + mx] = (p.hat || (srcIsOver && srcIsOver[si >> 2])) ? 2 : 1;   // 2 = 2nd layer, 1 = base
            }
          }
        }
      }
      // Track the head silhouette's real bottom per column (see headBottomCol's declaration).
      if (key.startsWith('head') || key.startsWith('hat')) {
        const cx = d[0] + xShift + aox, cy = d[1] + aoy;
        for (let rx = 0; rx < d[2]; rx++) {
          const ax = cx + rx; if (ax < 0 || ax >= headBottomCol.length) continue;
          for (let ry = d[3] - 1; ry >= 0; ry--) {
            if (out.data[(ry * d[2] + rx) * 4 + 3] >= 128) {
              if (cy + ry > headBottomCol[ax]) headBottomCol[ax] = cy + ry;
              break;
            }
          }
        }
      }
      tc.putImageData(out, 0, 0);
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = 'rgba(0,0,0,' + (1 - shade).toFixed(3) + ')';
      tc.fillRect(0, 0, d[2], d[3]);
      // aoTop: pose parts' one-row under-the-head shadow (the chest slivers / crouch torso), standing
      // in for the shoulder-line AO rect that assumes the standing layout.
      if (p.aoTop && !unlit) {
        tc.fillStyle = 'rgba(0,0,0,' + (1 - this._shadeMul(p.aoTop)).toFixed(3) + ')';
        tc.fillRect(0, 0, d[2], 1);
      }
      c.drawImage(t, d[0] + xShift + aox, d[1] + aoy);
    }
    // 2ND-LAYER DROP SHADOW (opt-in, Shading pane). The overlay is a slightly larger shell in the 3D
    // model, so where it ends it casts onto the skin just past its edge. The merge upstream replaces
    // base texels with overlay ones, which is why this needs overMask rather than a colour test: after
    // compositing a jacket pixel and a body pixel are indistinguishable. Shape-driven by construction -
    // it reads the mask the skin's own alpha produced, so a hood, a fringe or a single tuft each cast
    // their own outline. Light comes from above, matching the baked shading, so the cast falls DOWN.
    if (overMask && !unlit) {
      const m = this._shadeMul(0.82);
      if (m < 1) {
        const IM = c.getImageData(0, 0, cv.width, cv.height), D = IM.data;
        for (let y = 0; y < cv.height; y++) {
          for (let x = 0; x < cv.width; x++) {
            if (overMask[y * maskW + x] !== 1) continue;             // only bare skin receives it
            if (y === 0 || overMask[(y - 1) * maskW + x] !== 2) continue;   // ...directly under cloth
            const i = (y * cv.width + x) * 4;
            if (D[i + 3] === 0) continue;
            D[i] *= m; D[i + 1] *= m; D[i + 2] *= m;
          }
        }
        c.putImageData(IM, 0, 0);
      }
    }
    // NOTE: no "de-double" head post-pass. An earlier version collapsed any 2px-tall same-colour band in
    // the head, on the theory that a thin feature drawn on BOTH the base face and the hat overlay stacks
    // into a doubled line. On the current compositing (separate base + proud-hat blits) that doubling no
    // longer happens: features already land as clean 1px/2px runs. The pass then had no real doubles to
    // fix and only did harm - it MANUFACTURED the "pixel above the eyebrow" (it read a legit 2px skin band
    // as a double and painted the dark brow up into it) and it DESTROYED Steve's 2px eyes (collapsed the
    // white block, dropping a row). Proven per-pixel: pre-pass brow was already clean 1px; the pass turned
    // skin at (10,8) dark, and Steve's WW/PP eye into a broken WW/P. So it is gone. If a future skin shows
    // a genuine doubled line, fix it at the SOURCE (blit rects), not with a fragile whole-head heuristic.
    // AMBIENT-OCCLUSION shading (matches sss's "Shadow" pass, measured off its shadow-100 vs shadow-0
    // output): on top of the already-dimmed side faces, darken the shoulder line under the head, the one
    // crease column where the right-in-image arm meets the body, and the right-in-image leg - the depth
    // cues sss bakes in. Only the 3/4 profile has these; flat is lit head-on. Off when shading is off.
    // Per-pose AO: poses that keep standing parts keep the matching rects (shifted right with the
    // sprite's own shift); fully rebuilt layouts (crouch) or replaced regions bake shading per part.
    // The back-3/4 zombie/handshake keep the STANDING torso (stubs instead of raised arms), so they
    // keep the full standing shoulder row. Handshake takes it in EVERY camera: its reaching arm sits at
    // shoulder height directly under the head, so the head shadows it just like a standing shoulder.
    // (It used to be special-cased to stop at the standing torso's edge, col 18, which left the arm at
    // cols 19-23 lit in the front 3/4 alone - the pose visibly changed shading as you orbited.)
    const aoShoulder = !poseTab || this.pose === 'waving' || this.pose === 'tpose' || this.pose === 'sitting' || this.pose === 'dab'
      || this.pose === 'handshake' || this.pose === 'crouch' || (back && this.pose === 'zombie');
    const aoCrease = !poseTab || this.pose === 'sitting'            // needs the hanging image-right far arm
      // extended-arm poses: the crease column = that arm's body-adjacent column (arm rows only)
      || this.pose === 'tpose' || this.pose === 'handshake' || this.pose === 'waving';
    const aoFarLeg = !poseTab || this.pose === 'zombie' || this.pose === 'handshake' || this.pose === 'waving' || this.pose === 'tpose' || this.pose === 'dab';
    // The under-head shoulder line appears in EVERY horizontal view except the front flat view,
    // which is lit head-on (the light sits at that camera, so the head casts no visible shadow).
    // The crease and far-leg rects exist only in the 3/4 families whose layouts they were measured
    // on. Straight-down/up views and the head bust have no shoulders at all.
    const litHeadOn = flat && !back && !this._animShadeRow;
    const shoulderRow = !vert && !headOnly && !litHeadOn
      && ((flat || side) ? true : aoShoulder);
    const aoRects = !flat && !side && !vert && !headOnly;
    if (this.shading !== 'off' && this.shadingStrength > 0 && !unlit
        && (shoulderRow || (aoRects && (aoCrease || aoFarLeg)))) {
      const AO = c.getImageData(0, 0, cv.width, cv.height), DA = AO.data, WA = cv.width;
      const HA = cv.height;
      const darken = (x0, y0, x1, y1, m) => {
        for (let y = Math.max(0, y0); y <= Math.min(HA - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(WA - 1, x1); x++) {
          const i = (y * WA + x) * 4; if (DA[i + 3] === 0) continue;
          DA[i] = DA[i] * m; DA[i + 1] = DA[i + 1] * m; DA[i + 2] = DA[i + 2] * m;
        }
      };
      // The regions are deterministic full spans, the same on every skin. The crease and leg shadow sit
      // on the FAR side, opposite the side strips (x' = 23 - x mirror); the shoulder line is symmetric.
      // Every multiplier rides the Shadow-strength slider through _shadeMul.
      const sx = xShift;
      // An animation frame offsets whole part GROUPS, and each rect below describes a specific part,
      // so it has to travel with that part. Without this the shading stayed at the standing
      // coordinates while the limb moved: Walk lifts a leg 2px and its shadow stayed on the ground,
      // and the head's shoulder line sat a row off the shoulders it belongs to on every squash frame.
      // Which group a rect follows: the shoulder line is the HEAD's shadow; the crease and leg shadow
      // belong to the FAR limb, which is the image-left one when the side strips are on the right.
      const animOff = (g) => {
        const a = this._animParts && this._animParts[g];
        return a ? [a[0] || 0, a[1] || 0] : [0, 0];
      };
      if (shoulderRow) {
        // The shoulder line is the HEAD's shadow, so it spans only the head's columns: limbs that
        // extend past the head (T-pose arms, the wave slab's outer end) stay lit beyond it. For
        // standing layouts everything sits under the head, so this changes nothing there.
        const hx0 = (flat || side) ? 1 : 0, hx1 = (flat || side) ? 18 : 23;
        const [ox, oy] = animOff('head');
        // One row under the head's real silhouette, column by column. A bare head bottoms out at 16 so
        // every column lands on the long-standing 17; a hat layer reaches 17 and pushes the shadow to
        // 18, onto the shoulders, instead of darkening the hat itself. Columns the head never painted
        // (limbs reaching past it) fall back to the constant, which keeps them lit as before.
        // BASELINE = the majority column's bottom. Not the lowest: a lone dangling hat pixel (Grian has
        // exactly one on each side face) must not drag the whole line down a row.
        const tally = new Map();
        for (let x = hx0 + sx + ox; x <= hx1 + sx + ox; x++) {
          const hb = (x >= 0 && x < headBottomCol.length) ? headBottomCol[x] : -1;
          if (hb >= 0) tally.set(hb, (tally.get(hb) || 0) + 1);
        }
        let best = -1, bestN = 0;
        for (const [row, n] of tally) if (n > bestN || (n === bestN && row > best)) { best = row; bestN = n; }
        const baseY = best >= 0 ? best + 1 : 17 + oy;
        // Then FOLLOW THE EDGE, per column, downward only. A hat that covers just part of the head
        // (GeckoTN's front face is opaque on its outer columns and bare in the middle) leaves a stepped
        // silhouette, and a straight line would darken the hat itself wherever it hangs lower. Clamped
        // to never rise ABOVE the baseline: the head's own faces meet the body at different rows in the
        // 3/4, and letting the line climb there moved it on skins that have no hat at all.
        const m = this._shadeMul(0.88);
        for (let x = hx0 + sx + ox; x <= hx1 + sx + ox; x++) {
          const hb = (x >= 0 && x < headBottomCol.length) ? headBottomCol[x] : -1;
          const y = hb >= 0 ? Math.max(baseY, hb + 1) : baseY;
          darken(x, y, x, y, m);
        }
      }
      if (aoRects && aoCrease) {   // the arm poses raise or extend the image-right far arm; no crease to draw there
        // Sitting: the leg band (drawn over the arm tips) reaches the crease column from row 25 on;
        // the crease must not mark the boot sole, so it stops at the seated torso's bottom row.
        const cy1 = (poseTab && this.pose === 'sitting') ? 24 : 26;
        const [ox, oy] = animOff(stripsRight ? 'rArm' : 'lArm');
        const cx = (stripsRight ? 4 : 19) + sx + ox;   // far arm's inner column: image-left / image-right
        // NEVER onto the head. The crease travels with the arm, and an anim that lifts the arm lifts it
        // too: Run and Dance offset the arm -2, putting 18 + oy at row 16, and Walk and Skip -1 at 17 -
        // all head rows. headBottomCol is the head's REAL bottom for this column and counts the hat, so
        // clamping to it keeps the crease off the face and off the hair above it whatever the frame.
        const hb = (cx >= 0 && cx < headBottomCol.length) ? headBottomCol[cx] : -1;
        darken(cx, Math.max(18 + oy, hb + 1), cx, cy1 + oy, this._shadeMul(0.86));
                                              //   (the near arm already has the dimmed 1px bodySide seam
                                              //   next to it; an extra crease there read near-black)
      }
      if (aoRects && aoFarLeg) {
        const [ox, oy] = animOff(stripsRight ? 'rLeg' : 'lLeg');
        if (stripsRight) darken(5 + sx + ox, 27 + oy, 9 + sx + ox, 32 + oy, this._shadeMul(0.86));   // the far leg, left-in-image, in shadow
        else darken(14 + sx + ox, 27 + oy, 18 + sx + ox, 32 + oy, this._shadeMul(0.86));             // the far right-in-image leg in shadow
      }
      if (aoRects && !back && this.pose === 'dab') {
        // The image-left arm/palm casts an L-shaped drop shadow on the chest: a column right of the
        // palm and a row under the arm. Darkening the EXISTING body (not a redrawn slice) keeps the
        // shirt pattern and leaves the side face darker than the front. Mirrored for the left facing
        // on the pose's own axis (24 - x - w). FRONT 3/4 only: seen from behind the reaching arm is a
        // shoulder stub pointing away, so there is nothing there to cast it.
        const m = this._shadeMul(0.78);
        if (leftF) { darken(6 + sx, 17, 6 + sx, 20, m); darken(7 + sx, 21, 16 + sx, 21, m); }
        else       { darken(17 + sx, 17, 17 + sx, 20, m); darken(7 + sx, 21, 16 + sx, 21, m); }
      }
      if (aoRects && this.pose === 'sitting') {
        // Seated, the hanging near arm's hand comes to rest ON the thigh, so it drops a one-row
        // contact shadow across the leg band right under it (the arm's own rows stop at 26). Darkening
        // the EXISTING legs keeps the trouser pattern instead of flattening it - the dab's trick. The
        // near arm follows the side strips, so `stripsRight` picks the side in all four 3/4 views, and
        // the two spans are mirrors of each other on the 24 axis.
        const m = this._shadeMul(0.82);
        if (stripsRight) darken(15 + sx, 27, 22 + sx, 27, m);
        else             darken(1 + sx, 27, 8 + sx, 27, m);
      }
      c.putImageData(AO, 0, 0);
    }
    // PORTRAIT: cut the render at the shoulders - the head rows plus the top of the torso band. The
    // sprite ends up roughly square, so the preview's integer-fit scale draws it much bigger, which
    // is the whole "zoom". Cut before the outline so the outline wraps the bust's bottom edge too.
    if (cut > 0 && cv.height > cut) c.clearRect(0, cut, cv.width, cv.height - cut);

    // MATERIAL tone pass (identity for 'soft'; 'flat' was handled by the unlit gates above).
    this._applyMaterialTone(c, cv);

    // OUTLINE, composed under the sprite on a padded canvas so it can't clip (the crop below
    // re-tightens to whatever was actually drawn). Drawn after the material pass so it keeps its
    // pure color.
    let fc = c, fcv = cv;
    const ow = Math.max(0, Math.min(10, this.outlineWidth | 0));
    if (ow > 0) {
      const pad = document.createElement('canvas');
      pad.width = cv.width + ow * 2; pad.height = cv.height + ow * 2;
      const pc = pad.getContext('2d', { willReadFrequently: true });
      const src = c.getImageData(0, 0, cv.width, cv.height).data;
      const buf = pc.createImageData(pad.width, pad.height);
      // Dilate the silhouette by outlineWidth sprite pixels - the tag generator's outline at chibi
      // scale. Sharp corners = square (Chebyshev); default = round (Euclidean disc).
      const oc = this.outlineColor || '#000000';
      const orr = parseInt(oc.slice(1, 3), 16), org = parseInt(oc.slice(3, 5), 16), orb = parseInt(oc.slice(5, 7), 16);
      const inside = (dx, dy) => this.outlineSharp
        ? Math.max(Math.abs(dx), Math.abs(dy)) <= ow
        : dx * dx + dy * dy <= ow * ow + 1;   // +1 rounds the disc the way the tag generator's does
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        if (src[(y * cv.width + x) * 4 + 3] < 128) continue;
        for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) {
          if (!inside(dx, dy)) continue;
          const i = ((y + ow + dy) * pad.width + (x + ow + dx)) * 4;
          buf.data[i] = orr; buf.data[i + 1] = org; buf.data[i + 2] = orb; buf.data[i + 3] = 255;
        }
      }
      pc.putImageData(buf, 0, 0);
      pc.drawImage(cv, ow, ow);
      fc = pc; fcv = pad;
    }

    // Animation frames skip the crop: motion IS position, and the tighten-crop would re-center
    // every frame and erase it. The bake assembler does one shared crop across all frames instead.
    if (this._animNoCrop) return this._flipIfUpsideDown(fcv);
    // Crop to the drawn silhouette so the sprite auto-centres (and its size tracks the content, the
    // way the reference does - 22x32 vs 24x33 depending on the hair). Keeps flat vs 3/4 both centred.
    const id = fc.getImageData(0, 0, fcv.width, fcv.height).data;
    let x0 = fcv.width, y0 = fcv.height, x1 = -1, y1 = -1;
    for (let y = 0; y < fcv.height; y++) for (let x = 0; x < fcv.width; x++) if (id[(y * fcv.width + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
    if (x1 < 0) return fcv;
    const cr = document.createElement('canvas'); cr.width = x1 - x0 + 1; cr.height = y1 - y0 + 1;
    cr.getContext('2d').drawImage(fcv, x0, y0, cr.width, cr.height, 0, 0, cr.width, cr.height);
    return this._flipIfUpsideDown(cr);
  }

  // DINNERBONE / GRUMM. Minecraft renders any entity with either name upside down, and both accounts
  // draw their skin upside down to suit it - which is why loading one here produced a scrambled
  // figure with its face in the torso. Turning the finished sprite over puts it right.
  // LAST step by design: the bust crop and the outline both run in normal orientation, so a portrait
  // still cuts at the shoulders rather than the knees, and only then does the whole thing turn over.
  _flipIfUpsideDown(cv) {
    if (!this.upsideDown || !cv) return cv;
    const f = document.createElement('canvas');
    f.width = cv.width; f.height = cv.height;
    const fx = f.getContext('2d');
    fx.imageSmoothingEnabled = false;
    fx.translate(0, f.height); fx.scale(1, -1);
    fx.drawImage(cv, 0, 0);
    return f;
  }

  // Paint the composed chibi onto the preview canvas: integer-scaled to fit, centred, crisp.
  // The preview's auto-fit integer scale. Bust views share one zoom basis (the portrait's 22-row
  // cut): without it the 17-tall head sprite integer-fits noticeably larger than the portrait and
  // reads as too zoomed in. With a badge shape active the sprite fits INSIDE the badge at the
  // export's own fill ratio, so the preview shows exactly the framing the PNG will have.
  _fitScale() {
    const cv = this.viewCanvas, chibi = this._chibiCanvas;
    if (!cv || !chibi) return 1;
    const fitH = this.portraitView ? Math.max(chibi.height, ChibiSkinMaker.BUST_CUT[this.portraitView] || 22) : chibi.height;
    if ((this.bgShape || 'none') !== 'none') {
      const fill = this.bgShape === 'circle' ? 0.68 : 0.9;
      const f = this._frameSize(cv.width, cv.height);   // the exact frame _draw paints
      return Math.max(1, Math.floor(Math.min(f.w / chibi.width, f.h / fitH) * fill));
    }
    return Math.max(1, Math.floor(Math.min(cv.width / chibi.width, cv.height / fitH) * 0.8));
  }

  // The no-shape preview scale: auto-fit, or the user's zoom RATIO snapped back to a crisp
  // integer. Storing a ratio instead of an absolute scale is what makes a set zoom TRACK the
  // pane: resize the preview window and the image rescales proportionally, exactly like the
  // badge modes (whose charZoom is already a ratio against the badge's auto-fit).
  _viewScale() {
    const fit = this._fitScale();
    return this.viewZoom ? Math.max(1, Math.round(fit * this.viewZoom)) : fit;
  }

  triggerHurt(clientX, clientY) {
    this._hurtUntil = Date.now() + 450;
    this._hurtDir = Math.random() < 0.5 ? -1 : 1;
    this._playHurtSound();

    const rect = this.viewCanvas ? this.viewCanvas.getBoundingClientRect() : null;
    const px = (clientX && rect) ? (clientX - rect.left) * (this.viewCanvas.width / rect.width) : (this.viewCanvas ? this.viewCanvas.width / 2 : 100);
    const py = (clientY && rect) ? (clientY - rect.top) * (this.viewCanvas.height / rect.height) : (this.viewCanvas ? this.viewCanvas.height / 2 : 100);

    const mcColors = ['#ffffff', '#f1f5f9', '#cbd5e1', '#94a3b8', '#64748b', '#d97706'];
    this._hurtParticles = this._hurtParticles || [];
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 6;
      this._hurtParticles.push({
        x: px,
        y: py,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.5,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.03,
        size: 3 + Math.random() * 4,
        isCrit: i % 2 === 0,
        color: mcColors[Math.floor(Math.random() * mcColors.length)],
      });
    }

    const phrases = ['Сука!', 'Ай!', 'За что?!', 'Бля!', 'Ой!', 'Больно!', 'Эй!'];
    const text = phrases[Math.floor(Math.random() * phrases.length)];
    this._speechBubble = {
      text,
      x: px,
      y: Math.max(30, py - 50),
      startTime: Date.now(),
      duration: 1000,
    };

    const animLoop = () => {
      this._draw();
      const hasParticles = this._hurtParticles && this._hurtParticles.length > 0;
      const hasBubble = this._speechBubble && (Date.now() - this._speechBubble.startTime < this._speechBubble.duration);
      const isHurt = this._hurtUntil && Date.now() < this._hurtUntil;
      if (isHurt || hasParticles || hasBubble) {
        requestAnimationFrame(animLoop);
      }
    };
    animLoop();
  }

  _playHurtSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const actx = new AudioCtx();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, actx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(45, actx.currentTime + 0.16);
      gain.gain.setValueAtTime(0.35, actx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.16);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start();
      osc.stop(actx.currentTime + 0.16);
    } catch (_) {}
  }

  _draw() {
    const ctx = this.ctx, cv = this.viewCanvas; if (!ctx || !cv) return;
    if (this.headless) {
      this.bgShape = 'none';
      this.bgTransparent = true;
      this.bgColor = 'transparent';
      this.bgImage = null;
      this.outlineWidth = 0;
      this.outlineEnabled = false;
    }
    ctx.clearRect(0, 0, cv.width, cv.height);
    const chibi = this._chibiCanvas; if (!chibi) return;
    const shape = this.bgShape || 'none';
    let frame = null;
    let scale, cx, cy;
    if (shape !== 'none') {
      const f = this._frameSize(cv.width, cv.height);
      const bx = Math.round((cv.width - f.w) / 2), by = Math.round((cv.height - f.h) / 2);
      ctx.imageSmoothingEnabled = true;
      this._paintBadge(ctx, bx, by, f.w, f.h, shape);
      frame = { x: bx, y: by, w: f.w, h: f.h };
      scale = Math.max(1, Math.round(this._fitScale() * (this.charZoom || 1)));
      cx = bx + f.w / 2 + (this.charX || 0) * scale;
      cy = by + f.h / 2 + (this.charY || 0) * scale;
    } else {
      scale = this._viewScale();
      const dwf = chibi.width * scale, dhf = chibi.height * scale;
      const maxX = Math.max(0, (cv.width + dwf) / 2 - 40), maxY = Math.max(0, (cv.height + dhf) / 2 - 40);
      this.viewPanX = Math.max(-maxX, Math.min(maxX, this.viewPanX));
      this.viewPanY = Math.max(-maxY, Math.min(maxY, this.viewPanY));
      cx = cv.width / 2 + this.viewPanX;
      cy = cv.height / 2 + this.viewPanY;
      if (this.bgImage && !this.bgTransparent) {
        const fx = Math.round(cx - dwf / 2), fy = Math.round(cy - dhf / 2);
        ctx.save();
        ctx.translate(fx, fy);
        ctx.imageSmoothingEnabled = true;
        this._paintExportBackground(ctx, Math.round(dwf), Math.round(dhf), false);
        ctx.restore();
      }
    }
    const dw = chibi.width * scale, dh = chibi.height * scale;
    if (this.headless) {
      cx = cv.width / 2;
      cy = cv.height - dh / 2;
    }
    ctx.imageSmoothingEnabled = !this.textureFilterPixelated;
    const sx0 = Math.round(cx - dw / 2), sy0 = Math.round(cy - dh / 2);

    const isHurt = this._hurtUntil && Date.now() < this._hurtUntil;
    if (isHurt) {
      const remaining = this._hurtUntil - Date.now();
      const progress = 1 - remaining / 450;
      const tilt = Math.sin(progress * Math.PI) * 0.18 * (this._hurtDir || 1);
      const knockX = Math.sin(progress * Math.PI) * 8 * (this._hurtDir || 1);
      const knockY = -Math.sin(progress * Math.PI) * 5;

      ctx.save();
      ctx.translate(cx + knockX, cy + knockY);
      ctx.rotate(tilt);
      ctx.translate(-cx, -cy);

      ctx.drawImage(chibi, sx0, sy0, dw, dh);

      const alpha = Math.sin(progress * Math.PI) * 0.75;
      const off = document.createElement('canvas');
      off.width = dw; off.height = dh;
      const octx = off.getContext('2d');
      octx.drawImage(chibi, 0, 0, dw, dh);
      octx.globalCompositeOperation = 'source-in';
      octx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
      octx.fillRect(0, 0, dw, dh);
      ctx.drawImage(off, sx0, sy0);

      ctx.restore();
    } else {
      ctx.drawImage(chibi, sx0, sy0, dw, dh);
    }

    // Render Authentic Minecraft Particles (White/Gray/Crit)
    if (this._hurtParticles && this._hurtParticles.length > 0) {
      this._hurtParticles = this._hurtParticles.filter((p) => p.life > 0);
      for (const p of this._hurtParticles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.35;
        p.life -= p.decay;
        if (p.life <= 0) continue;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.isCrit) {
          const s = Math.round(p.size);
          ctx.fillRect(Math.round(p.x - s), Math.round(p.y - 1), s * 2, 3);
          ctx.fillRect(Math.round(p.x - 1), Math.round(p.y - s), 3, s * 2);
        } else {
          ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), Math.round(p.size), Math.round(p.size));
        }
        ctx.restore();
      }
    }

    // Render Minecraft Pixelated Speech Bubble
    if (this._speechBubble) {
      const b = this._speechBubble;
      const elapsed = Date.now() - b.startTime;
      if (elapsed > b.duration) {
        this._speechBubble = null;
      } else {
        const progress = elapsed / b.duration;
        const alpha = Math.max(0, 1 - Math.max(0, (elapsed - 700) / 300));
        const floatY = b.y - progress * 16;
        const bx = Math.round(b.x);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '700 13px "Courier New", monospace';

        const textMetrics = ctx.measureText(b.text);
        const bw = Math.max(52, Math.ceil(textMetrics.width) + 16);
        const bh = 24;
        const rectX = Math.round(bx - bw / 2);
        const rectY = Math.round(floatY - bh);

        // Minecraft pixel border & card background
        ctx.fillStyle = '#000000';
        ctx.fillRect(rectX - 2, rectY - 2, bw + 4, bh + 4);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rectX, rectY, bw, bh);

        // Pixelated speech bubble tail
        ctx.fillStyle = '#000000';
        ctx.fillRect(bx - 3, rectY + bh, 6, 4);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(bx - 2, rectY + bh, 4, 3);

        // Pixel text inside bubble
        ctx.fillStyle = '#000000';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.text, bx, Math.round(rectY + bh / 2));

        ctx.restore();
      }
    }

    if (!this.headless && this.bgShape && this.bgShape !== 'none') {
      if (!frame) frame = { x: sx0, y: sy0, w: dw, h: dh };
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(0, 0, cv.width, frame.y);
      ctx.fillRect(0, frame.y + frame.h, cv.width, cv.height - frame.y - frame.h);
      ctx.fillRect(0, frame.y, frame.x, frame.h);
      ctx.fillRect(frame.x + frame.w, frame.y, cv.width - frame.x - frame.w, frame.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(frame.x - 0.5, frame.y - 0.5, frame.w + 1, frame.h + 1);
      ctx.restore();
    }
  }

  // The barebones colour merge: flatten the skin's shading onto the most common colour of
  // each region. Greedy by frequency, so the dominant colour wins; the distance is in HSV
  // and HUE-driven, which is what makes it read as "flatten the shading": two shades of the
  // same hue (a shirt's teal and its darker teal) merge no matter how their brightness or
  // saturation differ, while different hues stay apart AND a colourful pixel never collapses
  // onto a near-neutral grey (the artifact plain RGB distance produced).
  _barebonesCanvas(base) {
    const cv = document.createElement('canvas');
    cv.width = base.width;
    cv.height = base.height;
    // willReadFrequently: this canvas replaces the skin source, which _composeChibi reads repeatedly.
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(base, 0, 0);
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    const data = id.data;
    const T = this.barebonesThreshold / 100;   // slider is an integer; the metric is 0..~1.3
    const T2 = T * T;
    const SN = 0.12;   // saturation below this reads as neutral/grey (no meaningful hue)
    const hsv = (r, g, b) => {
      r /= 255; g /= 255; b /= 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h *= 60; if (h < 0) h += 360;
      }
      return { h, s: mx ? d / mx : 0, v: mx };
    };
    const dist2 = (A, B) => {
      const a = hsv(A.r, A.g, A.b), b = hsv(B.r, B.g, B.b);
      const an = a.s < SN, bn = b.s < SN;
      if (an !== bn) return 9;                  // one colourful, one grey: never merge
      const dv = a.v - b.v;
      if (an && bn) return (0.7 * dv) * (0.7 * dv);   // both grey: merge by brightness only
      let dh = Math.abs(a.h - b.h); if (dh > 180) dh = 360 - dh; dh /= 180;
      const ds = a.s - b.s;
      // The heuristic that flattens shading but keeps features: shading is a SMALL brightness
      // step at (nearly) the same hue, whereas a feature differs either in HUE (Alex's pink
      // mouth on cream skin) or in a LARGE brightness step (Steve's dark mouth on light skin).
      // So hue and brightness are both weighted hard; only a small-in-both step survives the
      // threshold and merges. Saturation stays cheap so a shirt's light/dark shades collapse.
      return 6.0 * dh * dh + 0.35 * ds * ds + 2.0 * dv * dv;
    };
    const freq = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 128) continue;
      const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
      freq.set(key, (freq.get(key) || 0) + 1);
    }
    const colors = [...freq.entries()]
      .map(([k, f]) => ({ r: (k >> 16) & 255, g: (k >> 8) & 255, b: k & 255, f }))
      .sort((a, b) => b.f - a.f);
    const keepers = [];
    const map = new Map();
    for (const c of colors) {
      let best = null, bd = Infinity;
      for (const k of keepers) { const d = dist2(c, k); if (d < bd) { bd = d; best = k; } }
      const key = (c.r << 16) | (c.g << 8) | c.b;
      if (best && bd <= T2) { map.set(key, best); }
      else { const nk = { r: c.r, g: c.g, b: c.b }; keepers.push(nk); map.set(key, nk); }
    }
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] <= 128) continue;
      const k = map.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      if (k) { data[i] = k.r; data[i + 1] = k.g; data[i + 2] = k.b; }
    }
    ctx.putImageData(id, 0, 0);
    return cv;
  }

  applyHalfHeightUVs() {
    // 2D: the remap lives inside _composeChibi (every 12-tall src rect samples its top 8 rows when
    // this.halfHeightUVs is set), so applying the toggle is just a re-render through the chokepoint.
    this._refreshSkinTexture();
  }

  setPartVisibility(partName, visible) {
    // 2D: the Parts-tab eyes drive a name -> hidden map the compose loop reads; every view honors it.
    if (visible) delete this.partVisibility[partName];
    else this.partVisibility[partName] = false;
    this._refreshSkinTexture();
  }

  syncVisibilityCheckboxes() {
    for (const cb of this.visibilityCheckboxes) {
      cb.checked = this.partVisibility[cb.dataset.part] !== false;
    }
  }

  // Turn a legacy 2:1 skin into the modern square layout by mirroring the right limbs onto the left.
  //
  // ⚠️ THIS USED TO BE HARDCODED TO 64x64. A legacy HD skin (128x64, 256x128) was drawn into a 64x64
  // canvas at its NATIVE size, so it was clipped to its own top-left quarter and then the limb
  // mirroring copied from entirely the wrong pixels. It did not merely lose detail, it rendered
  // corrupt. Everything below is now expressed in 64-space and multiplied by the scale factor, so a
  // 128x64 skin produces a 128x128 sheet with its detail intact.
  convertLegacySkin(image) {
    const srcW = image.width || image.naturalWidth;
    const s = srcW / 64;                       // 1 for 64x32, 2 for 128x64, 4 for 256x128 ...

    const canvas = document.createElement('canvas');
    canvas.width = srcW;
    canvas.height = srcW;                      // the modern layout is square
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // the original occupies the top half, at its own resolution
    ctx.drawImage(image, 0, 0);

    // Copy a rect with a horizontal flip, mirroring each face onto the left limb.
    // Coordinates are given in 64-space and scaled here, so the callers stay readable.
    const copyFlipped = (srcX, srcY, w, h, dstX, dstY) => {
      const x = srcX * s, y = srcY * s, W = w * s, H = h * s;
      const src = ctx.getImageData(x, y, W, H);
      const dst = ctx.createImageData(W, H);
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const si = (py * W + px) * 4;
          const di = (py * W + (W - 1 - px)) * 4;
          dst.data[di] = src.data[si];
          dst.data[di + 1] = src.data[si + 1];
          dst.data[di + 2] = src.data[si + 2];
          dst.data[di + 3] = src.data[si + 3];
        }
      }
      ctx.putImageData(dst, dstX * s, dstY * s);
    };

    // Right leg (0,16) → Left leg (16,48) — per-face mirrored copy
    copyFlipped(4, 16, 4, 4, 20, 48);   // top
    copyFlipped(8, 16, 4, 4, 24, 48);   // bottom
    copyFlipped(0, 20, 4, 12, 24, 52);  // outer → outer
    copyFlipped(4, 20, 4, 12, 20, 52);  // front → front
    copyFlipped(8, 20, 4, 12, 16, 52);  // inner → inner
    copyFlipped(12, 20, 4, 12, 28, 52); // back → back

    // Right arm (40,16) → Left arm (32,48) — per-face mirrored copy
    copyFlipped(44, 16, 4, 4, 36, 48);  // top
    copyFlipped(48, 16, 4, 4, 40, 48);  // bottom
    copyFlipped(40, 20, 4, 12, 40, 52); // outer → outer
    copyFlipped(44, 20, 4, 12, 36, 52); // front → front
    copyFlipped(48, 20, 4, 12, 32, 52); // inner → inner
    copyFlipped(52, 20, 4, 12, 44, 52); // back → back

    return canvas;
  }

  // The Skin block is always in the Style panel; a custom skin just names itself and un-dims Remove.
  // With no custom skin it names the built-in one and Remove is disabled (there is nothing to remove).
  showSkinStatus(text) {
    this.skinStatusText.textContent = text;
    if (this.removeSkinBtn) this.removeSkinBtn.disabled = false;
    setVisible(this.skinError, false);
  }

  // No custom skin loaded: name the built-in body type and disable Remove.
  clearSkinStatus() {
    this.skinStatusText.textContent = this.currentModelType === 'alex' ? 'Alex (default)' : 'Steve (default)';
    if (this.removeSkinBtn) this.removeSkinBtn.disabled = true;
  }

  showError(message) {
    setVisible(this.skinError, true);
    this.skinError.textContent = message;
  }

  hideError() {
    setVisible(this.skinError, false);
  }

  // Apply a complete look (surface + tone + lighting) from the Material dropdown.
  // Resets the key/fill/ambient sliders to this look's 100% defaults.
  setMaterial(type) {
    this.currentMaterial = type;
    this.materialSelect.value = type;
    // 2D: the material is a tone pass over the composed sprite (see _applyMaterialTone) plus the
    // 'flat' unlit special case; re-render through the chokepoint. The three.js styling below is dead.
    this._refreshSkinTexture();
  }

  // --- Pose mode ---

  // ---------- The docked panel and its rail ----------
  // The panel is a GRID COLUMN, not a floating box: opening it takes width away from the canvas
  // rather than covering it, so the model you are adjusting is never hidden behind the control you
  // are adjusting it with. The ResizeObserver already watching #viewerContainer reshapes the
  // renderer for free, which is why none of this needs to touch three.js.
  // THE SIDEBAR IS ALWAYS OPEN. There is no collapse arrow any more.
  //
  // Hiding the whole toolset behind a 22px chevron was the mistake: it made the tool look calm and
  // left a new user with nothing to click. A tool's controls should be visible. The panel docks (it
  // takes width from the canvas rather than covering it), so having it open costs the model nothing
  // it was not already paying.
  // The tab rail is gone: every control lives in an always-visible card now, so there is nothing to
  // switch between. These stay as no-ops so the selection code (which used to bring the Pose panel
  // forward) does not need to know.
  // ---------- Drag-to-scrub on stepper number fields ----------
  // Ported from the pixel-art tag generator (setupValueScrubbing): drag an unfocused
  // number field left/right to adjust it, Shift for coarse steps; a plain click still
  // focuses it for typing. The transform rails keep their own richer drag
  // (_startInputDrag), so only stepper fields outside a rail get this.
  setupValueScrubbing() {
    const SCRUB_THRESHOLD = 24; // px of horizontal movement before a press becomes a scrub
    const PX_PER_STEP = 24;     // mouse px of drag per single step (higher = less sensitive)
    const COARSE_MULT = 10;     // Shift drag = bigger jumps

    const inputs = Array.from(document.querySelectorAll('.quantity-control input[type="number"]'))
      .filter((inp) => !inp.readOnly);

    for (const input of inputs) {
      input.classList.add('scrubbable');
      input.title = 'Drag left/right to adjust';

      const stepAttr = parseFloat(input.step);
      const step = (isFinite(stepAttr) && stepAttr > 0) ? stepAttr : 1;
      const minAttr = parseFloat(input.min);
      const maxAttr = parseFloat(input.max);
      const min = isFinite(minAttr) ? minAttr : -Infinity;
      const max = isFinite(maxAttr) ? maxAttr : Infinity;

      let active = false;        // pointer is down on this field
      let scrubbing = false;     // movement passed the threshold: committed to a drag
      let suppressClick = false; // swallow the click synthesized right after a drag
      let startX = 0;
      let startVal = 0;
      let pointerId = null;

      input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;             // left button only
        if (e.pointerType === 'touch') return;  // leave touch for scrolling / the +/- buttons
        if (input.disabled) return;
        // A focused field stays editable: allow native caret placement / drag-select.
        if (document.activeElement === input) return;
        suppressClick = false;
        active = true;
        scrubbing = false;
        startX = e.clientX;
        startVal = parseFloat(input.value);
        if (!isFinite(startVal)) startVal = 0;
        pointerId = e.pointerId;
      });

      input.addEventListener('pointermove', (e) => {
        if (!active) return;
        const dx = e.clientX - startX;
        if (!scrubbing) {
          if (Math.abs(dx) < SCRUB_THRESHOLD) return;
          scrubbing = true;
          document.body.classList.add('scrubbing-value');
          if (document.activeElement === input) input.blur();
          try { input.setPointerCapture(pointerId); } catch (_) {}
        }
        e.preventDefault();
        const mult = e.shiftKey ? COARSE_MULT : 1;
        // Count travel PAST the threshold so crossing it changes nothing (no jump).
        const over = Math.max(0, Math.abs(dx) - SCRUB_THRESHOLD);
        const deltaSteps = Math.sign(dx) * Math.round(over / PX_PER_STEP) * mult;
        let next = startVal + deltaSteps * step;
        next = Math.max(min, Math.min(max, next));
        if (String(input.value) !== String(next)) {
          input.value = next;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      const endScrub = () => {
        if (!active) return;
        active = false;
        try { if (pointerId !== null) input.releasePointerCapture(pointerId); } catch (_) {}
        pointerId = null;
        if (scrubbing) {
          scrubbing = false;
          document.body.classList.remove('scrubbing-value');
          input.dispatchEvent(new Event('change', { bubbles: true }));
          suppressClick = true;   // swallow the click synthesized after the drag
        }
      };
      input.addEventListener('pointerup', endScrub);
      input.addEventListener('pointercancel', endScrub);
      input.addEventListener('lostpointercapture', () => {
        if (active) {
          active = false;
          scrubbing = false;
          pointerId = null;
          document.body.classList.remove('scrubbing-value');
        }
      });
      input.addEventListener('click', (ev) => {
        if (suppressClick) {
          ev.preventDefault();
          ev.stopPropagation();
          suppressClick = false;
        }
      }, true);
    }
  }

  // ---------- Layers island + contextual options island ----------
  // The minecraft-gui-generator's master-detail: the Layers list on the left picks WHAT you
  // are editing (a settings group, or a model part), and the single options island on the
  // right swaps its content to match. Part rows reuse the outliner contract untouched:
  // #visibility-section delegates eye changes (part visibility) straight to setPartVisibility().
  setupPanels() {
    this.optionsTitle = document.getElementById('optionsTitle');
    this.layerRows = [...document.querySelectorAll('.mv-layer-row[data-panel]')];
    this.optionPanels = [...document.querySelectorAll('.mv-panel')];
    const titles = {
      skin: 'Skin', look: 'Look', pose: 'Pose', anim: 'Animation',
      camera: 'Camera', parts: 'Parts',
    };
    this.showOptionsPanel = (key) => {

      for (const p of this.optionPanels) setVisible(p, p.dataset.options === key);
      const rowKey = key;
      for (const r of this.layerRows) r.classList.toggle('is-active', r.dataset.panel === rowKey);
      // On phones the rows are a horizontal chip strip: slide the lit chip into view.
      // Scroll the STRIP only, never the page (scrollIntoView could yank the page when the
      // selection comes from a tap on the canvas far above this list).
      const active = this.layerRows.find((r) => r.dataset.panel === rowKey);
      const strip = active && active.parentElement;
      if (strip && strip.scrollWidth > strip.clientWidth + 1) {
        const sRect = strip.getBoundingClientRect();
        const aRect = active.getBoundingClientRect();
        const target = strip.scrollLeft + (aRect.left - sRect.left) - (sRect.width - aRect.width) / 2;
        strip.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
      }
      if (this.optionsTitle) this.optionsTitle.textContent = titles[key] || key;
    };
    for (const r of this.layerRows) {
      r.addEventListener('click', () => this.showOptionsPanel(r.dataset.panel));
    }
    this.showOptionsPanel('skin');
  }

  // ---------- Modals ----------
  // Lifted from the glyph generator: focus trap, Escape, backdrop click, scroll lock, and `inert` on
  // the background so a screen reader cannot wander into the page behind the dialog. The modals are
  // reparented to <body> because `inert` on an ancestor would inert a dialog nested inside it.
  setupModals() {
    this.openDialogEl = null;
    for (const id of ['exportOverlay', 'confirmOverlay', 'configOverlay', 'supportOverlay']) {
      const el = document.getElementById(id);
      if (el) document.body.appendChild(el);
    }
    const bind = (overlay, opener, closers) => {
      if (!overlay) return;
      if (opener) opener.addEventListener('click', () => this.openDialog(overlay, opener));
      for (const c of closers) { const el = document.getElementById(c); if (el) el.addEventListener('click', () => this.closeDialog()); }
      overlay.addEventListener('click', (e) => { if (e.target === overlay) this.closeDialog(); });
    };
    bind(document.getElementById('exportOverlay'), this.exportBtn, ['exportClose']);
    bind(document.getElementById('confirmOverlay'), null, ['confirmClose', 'confirmCancel']);
    bind(document.getElementById('configOverlay'), this.configBtn, ['configClose']);
    bind(document.getElementById('supportOverlay'), null, ['supportClose', 'supportDismiss']);
    // Following a link out should not leave the dialog sitting there when they come back.
    for (const el of document.querySelectorAll('#supportOverlay .support-btn')) {
      el.addEventListener('click', () => setTimeout(() => this.closeDialog(), 120));
    }

    document.addEventListener('keydown', (e) => {
      if (!this.openDialogEl) return;
      if (e.key === 'Escape') { e.preventDefault(); this.closeDialog(); return; }
      if (e.key !== 'Tab') return;
      const f = this.openDialogEl.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const list = [...f].filter(el => !el.disabled && el.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, true);   // capture: must beat the numpad camera shortcuts, or typing behind a dialog flies the camera
  }

  // ---------- Preview pane: pin / drag / resize ----------
  // Ported from the pixel-art tag generator so both tools behave identically. Pinning arms a
  // scroll watcher: once the card would scroll out of view it detaches into a fixed floating
  // panel, leaving a visible "Drop here to dock" home zone in the grid. While floating it can
  // be dragged by the top-left grip and resized by the bottom-right corner; dropping it on the
  // home zone (or double-clicking a handle, or unpinning) docks it again. A moved/resized panel
  // stays floating on scroll-to-top so its custom place is not reset. The ResizeObserver on
  // #viewerContainer reshapes the renderer whenever the pane changes size, so there are no
  // explicit onResize calls here; the CSS lets the stage fill the floating pane's height.
  setupPreviewPane() {
    const card = document.getElementById('previewCard');
    const pinBtn = document.getElementById('pinPreviewBtn');
    if (!card || !pinBtn) return;

    let isPinEnabled = false;
    let placeholder = null;
    let pinDragged = false;      // the user moved/resized the pane; stop auto-realign and redock
    let gestureActive = false;   // a drag/resize is in progress (freeze the pin scroll logic)

    // Clear any inline positioning/size the pane picked up while pinned, returning it to the
    // default docked (grid) layout.
    const unfloat = () => {
      card.style.left = card.style.top = card.style.width = card.style.height = '';
      card.classList.remove('user-resized');
    };

    const updatePinPosition = () => {
      if (!isPinEnabled || gestureActive) return;
      const rect = placeholder ? placeholder.getBoundingClientRect() : card.getBoundingClientRect();
      if (rect.top <= 80) {
        // The docked spot is scrolling out of view: detach into a fixed floating panel.
        if (!card.classList.contains('pinned')) {
          const r = placeholder ? placeholder.getBoundingClientRect() : card.getBoundingClientRect();
          if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.className = 'preview-dock-zone';   // always-visible drop target
            placeholder.textContent = 'Drop here to dock';
            placeholder.style.width = '100%';
            placeholder.style.minWidth = '0';
            placeholder.style.height = r.height + 'px';
            placeholder.setAttribute('aria-hidden', 'true');
            card.parentNode.insertBefore(placeholder, card);
          }
          card.style.width = r.width + 'px';
          card.style.left = r.left + 'px';
          card.style.height = r.height + 'px';
          card.classList.add('pinned');
        }
      } else if (card.classList.contains('pinned') && !pinDragged) {
        // Back near the top: dock again, unless the user customised the panel.
        card.classList.remove('pinned');
        unfloat();
        if (placeholder) { placeholder.remove(); placeholder = null; }
      }
    };

    // Window resize with a CUSTOMISED floating panel: pull it back inside the viewport and the
    // content column so shrinking the window can't strand it (partly) off-screen. Ported from the
    // tag generator's reclampFloatingPreview (same fix as Mojavatar); the ResizeObserver on
    // #viewerContainer then repaints the preview whenever the clamp changes the pane's size.
    const reclampFloating = () => {
      if (!card.classList.contains('pinned') || !pinDragged || gestureActive) return;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const main = card.closest('.main-content') || document.querySelector('.main-content');
      let cL = 8, cR = vw - 8;
      if (main) {
        const mr = main.getBoundingClientRect();
        const ms = getComputedStyle(main);
        cL = mr.left + parseFloat(ms.paddingLeft);
        cR = mr.right - parseFloat(ms.paddingRight);
      }
      // Fixed (viewport) coords: clamp width to the content column, then keep left/top on
      // screen and height within the viewport below the navbar.
      const rect = card.getBoundingClientRect();
      const nav = document.querySelector('.navbar');
      const minTop = (nav ? nav.getBoundingClientRect().bottom : 70) + 8;
      const maxW = Math.max(64, cR - cL);
      const w = Math.min(rect.width, maxW);
      const maxH = Math.max(60, vh - minTop - 8);
      const h = Math.min(rect.height, maxH);
      card.style.width = w + 'px';
      if (rect.height > maxH) card.style.height = h + 'px';
      card.style.left = Math.max(cL, Math.min(Math.max(cL, cR - w), rect.left)) + 'px';
      card.style.top = Math.max(minTop, Math.min(Math.max(minTop, vh - h - 8), rect.top)) + 'px';
    };

    // Window resize: an untouched pinned panel stays aligned with its home slot; a customised
    // one gets clamped back on screen instead of keeping stale fixed coordinates.
    const handleResize = () => {
      if (!isPinEnabled || gestureActive) return;
      if (placeholder && !pinDragged) {
        const rect = placeholder.getBoundingClientRect();
        card.style.width = rect.width + 'px';
        card.style.left = rect.left + 'px';
        card.style.height = rect.height + 'px';
      } else {
        reclampFloating();
      }
    };

    pinBtn.addEventListener('click', () => {
      isPinEnabled = !isPinEnabled;
      if (isPinEnabled) {
        pinBtn.classList.add('active');
        pinBtn.setAttribute('title', 'Unpin preview');
        pinBtn.setAttribute('aria-label', 'Unpin preview');
        window.addEventListener('scroll', updatePinPosition);
        window.addEventListener('resize', handleResize);
        updatePinPosition();
      } else {
        pinBtn.classList.remove('active');
        pinBtn.setAttribute('title', 'Pin preview');
        pinBtn.setAttribute('aria-label', 'Pin preview');
        window.removeEventListener('scroll', updatePinPosition);
        window.removeEventListener('resize', handleResize);
        card.classList.remove('pinned');
        unfloat();
        pinDragged = false;
        if (placeholder) { placeholder.remove(); placeholder = null; }
      }
    });

    // Corner-handle resize, only while the pane is pinned (a floating panel); a docked preview
    // is not resizable. Both axes; double-click snaps back to the default size.
    const rHandle = document.getElementById('previewResizeHandle');
    if (rHandle) {
      let resizing = false, resized = false;
      let startX = 0, startY = 0, startW = 0, startH = 0, minW = 0, minH = 0, maxW = 0, maxH = 0;

      rHandle.addEventListener('pointerdown', (e) => {
        if (!card.classList.contains('pinned')) return;
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        resized = false;
        gestureActive = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = card.offsetWidth;
        startH = card.offsetHeight;
        const r = card.getBoundingClientRect();
        const main = card.closest('.main-content') || document.querySelector('.main-content');
        let contentRight = document.documentElement.clientWidth - 8;
        if (main) {
          const mr = main.getBoundingClientRect();
          contentRight = mr.right - parseFloat(getComputedStyle(main).paddingRight);
        }
        minW = Math.min(260, startW);
        minH = Math.min(200, startH);
        maxW = Math.max(startW, contentRight - r.left);
        maxH = Math.max(minH, document.documentElement.clientHeight - r.top - 8);
        try { rHandle.setPointerCapture(e.pointerId); } catch (_) {}
        document.body.classList.add('preview-resizing');
      });

      rHandle.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // Ignore sub-threshold jitter so a plain click on the handle never resizes.
        if (!resized && (Math.abs(dx) + Math.abs(dy)) < 3) return;
        resized = true;
        pinDragged = true;
        card.classList.add('user-resized');
        card.style.width = Math.max(minW, Math.min(maxW, startW + dx)) + 'px';
        card.style.height = Math.max(minH, Math.min(maxH, startH + dy)) + 'px';
      });

      const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        gestureActive = false;
        try { rHandle.releasePointerCapture(e.pointerId); } catch (_) {}
        document.body.classList.remove('preview-resizing');
        if (card.classList.contains('pinned')) window.dispatchEvent(new Event('scroll'));
      };
      rHandle.addEventListener('pointerup', endResize);
      rHandle.addEventListener('pointercancel', endResize);

      rHandle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!card.classList.contains('pinned')) return;
        card.classList.remove('user-resized');
        pinDragged = false;
        card.style.height = '';
        card.style.top = '';
        window.dispatchEvent(new Event('resize'));   // the pin re-applies width & left
      });
    }

    // Drag the pane by the top-left grip. Only while pinned; the drag moves the fixed panel
    // around the viewport, and dropping it on the lit home zone docks it.
    const dHandle = document.getElementById('previewDragHandle');
    if (dHandle) {
      let dragging = false, moved = false, overDock = false;
      let originX = 0, originY = 0, startLeft = 0, startTop = 0;
      let minTop = 8, boundLeft = 8, boundRight = 0;

      dHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (!card.classList.contains('pinned')) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        moved = false;
        gestureActive = true;
        originX = e.clientX;
        originY = e.clientY;
        const r = card.getBoundingClientRect();
        startLeft = r.left;
        startTop = r.top;
        // Not under the fixed navbar, and horizontally within the main content column.
        const nav = document.querySelector('.navbar');
        minTop = (nav ? nav.getBoundingClientRect().bottom : 70) + 8;
        const main = card.closest('.main-content') || document.querySelector('.main-content');
        if (main) {
          const mr = main.getBoundingClientRect();
          const ms = getComputedStyle(main);
          boundLeft = mr.left + parseFloat(ms.paddingLeft);
          boundRight = mr.right - parseFloat(ms.paddingRight);
        } else {
          boundLeft = 8;
          boundRight = document.documentElement.clientWidth - 8;
        }
        try { dHandle.setPointerCapture(e.pointerId); } catch (_) {}
      });

      dHandle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - originX;
        const dy = e.clientY - originY;
        if (!moved) {
          if (Math.abs(dx) + Math.abs(dy) < 4) return;   // click-vs-drag threshold
          moved = true;
          pinDragged = true;
          document.body.classList.add('preview-dragging');
        }
        const vh = document.documentElement.clientHeight;
        const w = card.offsetWidth, h = card.offsetHeight;
        const maxLeft = Math.max(boundLeft, boundRight - w);
        card.style.left = Math.max(boundLeft, Math.min(maxLeft, startLeft + dx)) + 'px';
        card.style.top = Math.max(minTop, Math.min(Math.max(minTop, vh - h - 8), startTop + dy)) + 'px';
        // Light up the home dock zone when the pointer is over it; fade the panel so the
        // highlighted zone shows through underneath.
        if (placeholder) {
          const z = placeholder.getBoundingClientRect();
          overDock = z.height > 0 && e.clientX >= z.left && e.clientX <= z.right
            && e.clientY >= z.top && e.clientY <= z.bottom;
          placeholder.classList.toggle('dock-active', overDock);
          card.classList.toggle('docking', overDock);
        }
      });

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        gestureActive = false;
        try { dHandle.releasePointerCapture(e.pointerId); } catch (_) {}
        document.body.classList.remove('preview-dragging');
        card.classList.remove('docking');
        if (placeholder) placeholder.classList.remove('dock-active');
        if (overDock) {
          // Dropped on the home slot: dock back to the default state (un-pins).
          overDock = false;
          if (card.classList.contains('pinned')) pinBtn.click();
          return;
        }
        if (card.classList.contains('pinned')) window.dispatchEvent(new Event('scroll'));
      };
      dHandle.addEventListener('pointerup', endDrag);
      dHandle.addEventListener('pointercancel', endDrag);

      dHandle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pinDragged = false;
        card.style.top = '';                          // back to the pinned CSS top
        window.dispatchEvent(new Event('resize'));    // the pin realigns left/width
      });
    }
  }

  // Every export and copy ends here. The export modal CLOSES first and the support modal opens in
  // its place - openDialog is single-dialog by design, and the scroll-lock save/restore is not
  // re-entrant, so stacking could strand the page scrolled-locked with nothing visible. Closing also
  // releases the animation hold the export modal takes, so a GIF export does not leave the preview
  // frozen behind the dialog. Deferred a tick so the browser's own download starts first.
  _afterExport() {
    const overlay = document.getElementById('supportOverlay');
    if (!overlay) return;
    setTimeout(() => {
      if (this.openDialogEl && this.openDialogEl.id === 'exportOverlay') this.closeDialog();
      if (!this.openDialogEl) this.openDialog(overlay, this.exportBtn);
    }, 260);
  }

  openDialog(overlay, opener) {
    if (!overlay || this.openDialogEl) return;
    // Hold the animation while Export is open. Without this the still export took whatever frame
    // the loop was on at the instant of the click - three different pictures out of five presses -
    // and the modal covers the preview, so you could not even see which one you got.
    if (overlay.id === 'exportOverlay') this._animHold = true;
    overlay._opener = opener || document.activeElement;
    const root = document.documentElement;
    const sbw = window.innerWidth - root.clientWidth;
    overlay._prevOverflow = root.style.overflow;
    overlay._prevPad = root.style.paddingRight;
    root.style.overflow = 'hidden';
    if (sbw > 0) root.style.paddingRight = ((parseFloat(getComputedStyle(root).paddingRight) || 0) + sbw) + 'px';
    setVisible(overlay, true);
    this.openDialogEl = overlay;
    for (const el of document.body.children) {
      if (el !== overlay && !el.hasAttribute('inert')) { el.setAttribute('inert', ''); el._inertedByUs = true; }
    }
    const first = overlay.querySelector('button, input, select');
    if (first) first.focus();
  }

  closeDialog() {
    if (this._animHold) { this._animHold = false; this._animEnsureLoop(); }
    const overlay = this.openDialogEl;
    if (!overlay) return;
    setVisible(overlay, false);
    this.openDialogEl = null;
    for (const el of document.body.children) {
      if (el._inertedByUs) { el.removeAttribute('inert'); el._inertedByUs = false; }
    }
    const root = document.documentElement;
    root.style.overflow = overlay._prevOverflow || '';
    root.style.paddingRight = overlay._prevPad || '';
    if (overlay._opener && overlay._opener.focus) overlay._opener.focus();
  }

  setStatus(msg) {
    if (this.toolStatus) this.toolStatus.textContent = msg || '';
  }

  // The skin texture's alpha at a raycast hit's UV. GLTF uvs put v=0 at the image top and
  // every skin texture in this pipeline keeps flipY=false to match, so the sample maps
  // straight onto the canvas row. Anything unsampleable counts as opaque.

  // The poseable group under the pointer, or null. Shared by hover and click so the two
  // can never disagree about what you are pointing at.

  // HOVER. Nothing in this tool ever told the user the model was clickable: the only feedback was
  // AFTER you had already guessed and clicked. So a limb now lights up under the cursor and the
  // cursor turns into a pointer. That single change is what teaches direct manipulation, with no
  // tutorial, no tooltip and no help modal.

  // Hiding the block (rather than just blanking the name) is load-bearing: the +/- steppers only bail
  // on a disabled input, so with nothing selected they would happily mutate fields that
  // onTransformInput() then throws away.

  // Drag left/right on a transform field to scrub its value; tap it to type instead.
  //
  // This used to listen for `mousedown` and drive itself from `document.mousemove`, which meant it
  // was DEAD ON TOUCH: mousemove never fires during a finger drag, so on a phone the only way to
  // change a number was to type it, and even that half-failed because the preventDefault() on the
  // synthesized mousedown is exactly what suppresses the iOS numeric keyboard. Pointer events cover
  // mouse, touch and pen with one path, and setPointerCapture keeps the drag alive if the finger
  // slides off the input.

  // The captures (outline silhouette, PNG, GIF) hide the boxes the same way they hide the
  // gizmo. _selBoxesShown is the source of truth so nested save/restore cannot clobber it.

  captureFullState() {
    return {
      // Model & skin
      modelType: this.currentModelType,
      bodyTypeMode: this.bodyTypeMode,
      skinName: this.skinName,
      skinDataUri: this._skinDataUri,
      skinWidth: this._skinWidth,
      skinHeight: this._skinHeight,
      currentSkinImage: this.currentSkinImage,
      // Display settings
      material: this.currentMaterial,
      bgColor: this.bgColor,
      bgTransparent: this.bgTransparent,
      bgVignette: this.bgVignette,
      bgShape: this.bgShape,
      bgAspect: this.bgAspect,
      bgImageURI: this._bgImageURI,
      outlineWidth: this.outlineWidth,
      outlineSharp: this.outlineSharp,
      outlineColor: this.outlineColor,
      textureFilterPixelated: this.textureFilterPixelated,
      barebones: this.barebones,
      barebonesThreshold: this.barebonesThreshold,
      halfHeightUVs: this.halfHeightUVs,
      flatProfile: this.flatProfile,
      sideProfile: this.sideProfile,
      vertView: this.vertView,
      portraitView: this.portraitView,
      layerShadow: this.layerShadow,
      upsideDown: this.upsideDown,
      facing: this.facing,
      viewSide: this.viewSide,
      pose: this.pose,
      anim: this.anim,
      headOverlay: this.headOverlay,
      bodyOverlay: this.bodyOverlay,
      shading: this.shading,
      shadingStrength: this.shadingStrength,
      visibility: this._captureVisibility(),
    };
  }

  _captureVisibility() {
    return { ...this.partVisibility };
  }

  async restoreFullState(state) {
    // 2D chibi tool restore. The original Mojavatar restored a three.js scene here (pose, material,
    // lights, shadow ground, outline shader, per-mesh visibility via model.traverse); none of that
    // exists now, so this restores what the 2D engine actually has - body type, skin, and the chibi
    // options - and re-renders through the one chokepoint. Every DOM write is guarded so undo, redo and
    // config-import can never throw on a control the 2D shell doesn't ship. The 3D-only display fields
    // are still copied as plain data (harmless) so a later config round-trip keeps them.

    // Body type: the MODE is part of the snapshot, not just the resolved type - restoring only the type
    // would leave the switch reading "Auto" after an undo meant to bring back a manual Alex.
    if (state.bodyTypeMode) this.bodyTypeMode = state.bodyTypeMode;
    if (state.modelType && state.modelType !== this.currentModelType) {
      this.currentSkinImage = null;
      await this.loadModel(state.modelType, { clearUndo: false, preservePose: false });
    }
    this._syncBodyTypeButtons();

    // Skin
    this.skinName = state.skinName;
    this._skinDataUri = state.skinDataUri;
    this._skinWidth = state.skinWidth;
    this._skinHeight = state.skinHeight;
    this.currentSkinImage = state.currentSkinImage || null;
    if (state.skinName) {
      const dims = state.skinWidth ? ` (${state.skinWidth}x${state.skinHeight})` : '';
      this.showSkinStatus(`${state.skinName}${dims}`);
    } else {
      this.clearSkinStatus();
    }

    // Chibi options (the state the 2D renderer actually reads).
    if (state.flatProfile !== undefined) this.flatProfile = state.flatProfile;
    if (state.sideProfile !== undefined) this.sideProfile = state.sideProfile;
    if (state.vertView !== undefined) this.vertView = state.vertView;
    if (state.portraitView !== undefined) this.portraitView = state.portraitView;
    if (state.layerShadow !== undefined) { this.layerShadow = !!state.layerShadow; if (this.layerShadowInput) this.layerShadowInput.checked = this.layerShadow; }
    if (state.upsideDown !== undefined) this.upsideDown = !!state.upsideDown;
    if (state.facing !== undefined) this.facing = state.facing;
    if (state.viewSide !== undefined) this.viewSide = state.viewSide;
    if (state.flatView !== undefined) this.viewSide = state.flatView;   // pre-rename snapshots
    if (state.pose !== undefined) { this.pose = state.pose; this._syncPoseButtons(); }
    if (state.anim !== undefined) {
      const a = CHIBI_ANIM_ALIASES[state.anim] || state.anim;
      this.anim = CHIBI_ANIMS[a] ? a : 'none';
      this._syncAnimButtons();
    }
    if (state.headOverlay !== undefined) this.headOverlay = state.headOverlay;
    if (state.bodyOverlay !== undefined) this.bodyOverlay = state.bodyOverlay;
    if (state.shading !== undefined) this.shading = state.shading;
    if (state.shadingStrength !== undefined) {
      this.shadingStrength = state.shadingStrength;
      if (this.shadingSlider) this.shadingSlider.value = String(state.shadingStrength);
      if (this.shadingSliderValue) this.shadingSliderValue.textContent = String(state.shadingStrength);
    }
    if (state.visibility && typeof state.visibility === 'object' && !Array.isArray(state.visibility)) {
      this.partVisibility = { ...state.visibility };
      this.syncVisibilityCheckboxes();
    }
    this._syncViewButtons();   // the Camera panel's view grid mirrors the restored fields

    // Barebones colour-merge (2D path).
    this.barebones = !!state.barebones;
    if (this.barebonesToggle) this.barebonesToggle.checked = this.barebones;
    if (state.barebonesThreshold !== undefined) {
      this.barebonesThreshold = state.barebonesThreshold;
      if (this.barebonesStrength) this.barebonesStrength.value = state.barebonesThreshold;
      if (this.barebonesStrengthValue) this.barebonesStrengthValue.textContent = String(state.barebonesThreshold);
    }
    this._syncBarebonesRow(this.barebones);

    // Look fields: material tone, background, outline - live 2D settings; every control re-syncs.
    if (state.material !== undefined) {
      this.currentMaterial = state.material;
      if (this.materialSelect) this.materialSelect.value = state.material;
    }
    if (state.bgColor !== undefined) {
      this.bgColor = state.bgColor;
      if (this.bgColorPicker) this.bgColorPicker.value = state.bgColor;
    }
    if (state.bgTransparent !== undefined) {
      this.bgTransparent = state.bgTransparent;
      if (this.bgTransparentCheckbox) this.bgTransparentCheckbox.checked = !!state.bgTransparent;
      // vignette gating waits for bgShape, restored below
    }
    if (state.bgVignette !== undefined) {
      this.bgVignette = !!state.bgVignette;
      if (this.bgVignetteCheckbox) this.bgVignetteCheckbox.checked = !!state.bgVignette;
    }
    if (state.bgShape !== undefined) {
      this.bgShape = ['square', 'circle'].includes(state.bgShape) ? state.bgShape : 'none';
      this._syncBgShapeButtons();
      this._populateExportSizes();
      if (this.bgAspectRow) setVisible(this.bgAspectRow, this.bgShape === 'square');
    }
    if (state.bgAspect !== undefined) {
      this.bgAspect = state.bgAspect;
      this._syncAspectButtons();
    }
    // AFTER the aspect: a tile's lit state depends on both fields, and syncing between them lights
    // "Profile picture" against whatever aspect the previous state happened to leave behind.
    this._syncBgShapeButtons();
    // Same reason: a circle always paints, so whether the vignette is available depends on the
    // shape as well as on Transparent, and the shape only just landed.
    if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, this._bgPaints());
    if (state.bgImageURI !== undefined) await this._applyBgImageURI(state.bgImageURI);
    // Composition inside the badge: present in configs (and their defaults), absent from undo
    // snapshots - captureFullState skips these on purpose, like the 3D sibling's camera.
    if (state.charZoom !== undefined) this.charZoom = state.charZoom;
    if (state.charX !== undefined) this.charX = state.charX;
    if (state.charY !== undefined) this.charY = state.charY;
    this.updatePresetActive();   // after color+transparent+shape are all in place
    this.updateBackground();
    if (state.outlineWidth !== undefined) {
      this.outlineWidth = Math.max(0, Math.min(10, Number(state.outlineWidth) || 0));
      this.outlineEnabled = this.outlineWidth > 0;
      if (this.outlineWidthSlider) this.outlineWidthSlider.value = this.outlineWidth;
      if (this.outlineSettingsRow) setVisible(this.outlineSettingsRow, this.outlineEnabled);
    }
    if (state.outlineSharp !== undefined) {
      this.outlineSharp = !!state.outlineSharp;
      if (this.outlineSharpToggle) this.outlineSharpToggle.checked = this.outlineSharp;
    }
    if (state.outlineColor !== undefined) {
      this.outlineColor = state.outlineColor;
      if (this.outlineColorPicker) this.outlineColorPicker.value = state.outlineColor;
      if (this.outlineColorHexInput) this.outlineColorHexInput.value = String(state.outlineColor).replace('#', '');
    }
    if (state.textureFilterPixelated !== undefined) {
      this.textureFilterPixelated = state.textureFilterPixelated;
      if (this.filterToggleBtn) this.filterToggleBtn.checked = !!state.textureFilterPixelated;
    }
    if (state.halfHeightUVs !== undefined) {
      this.halfHeightUVs = state.halfHeightUVs;
      if (this.halfHeightUVsToggle) this.halfHeightUVsToggle.checked = !!state.halfHeightUVs;
    }

    // Rebuild the chibi from the restored skin + options.
    this._refreshSkinTexture();
  }

  pushUndo(preState = null) {
    const state = preState || this.captureFullState();
    this.undoStack.push(state);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateUndoButtons();
  }

  async undo() {
    if (this._undoLock || this._loading || this.undoStack.length === 0) return;
    this._undoLock = true;
    try {
      this.redoStack.push(this.captureFullState());
      await this.restoreFullState(this.undoStack.pop());
      this.updateUndoButtons();
    } finally {
      this._undoLock = false;
    }
  }

  async redo() {
    if (this._undoLock || this._loading || this.redoStack.length === 0) return;
    this._undoLock = true;
    try {
      this.undoStack.push(this.captureFullState());
      await this.restoreFullState(this.redoStack.pop());
      this.updateUndoButtons();
    } finally {
      this._undoLock = false;
    }
  }

  updateUndoButtons() {
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
    // The chip is absent from a fresh viewport entirely: there is nothing to undo, so showing two
    // dead buttons would just be clutter on the calm default screen. It fades in on the first edit.
    if (this.historyChip) {
      this.historyChip.classList.toggle('has-history', this.undoStack.length > 0 || this.redoStack.length > 0);
    }
  }

  // ===== Settings config: import / export ==========================================================
  // A full-snapshot JSON of the same look/pose surface undo captures, so an entire avatar setup can be
  // saved to a .json file and loaded back (mirrors the pixel-art tag generator's config).
  // Import deep-merges over CONFIG_DEFAULTS, so a config that predates a field simply gets that field's
  // default and unknown keys are ignored. Apply routes the parsed config through restoreFullState (the
  // proven undo path) rather than re-driving every control, so there is ONE place that knows how to put
  // a state onto the render. The v2 schema is the 2D surface: model, skin, view key, chibi toggles
  // (headOverlay/bodyOverlay/shading), material, background, outline, shading strength, part visibility,
  // pose and animation. The skin rides along embedded as a data URI, making the file self-contained.
  serializeConfig() {
    // The 2D chibi schema (v2). The Mojavatar-era v1 serialized a three.js scene - lights, camera,
    // pose, shadow ground - none of which exists here; reading those dead refs threw on Save. v2
    // carries exactly what the 2D renderer consumes: the view key, the chibi toggles, and the shared
    // display options. _migrateConfig still accepts v1 files (their 3D blocks are simply dropped).
    return {
      version: ChibiSkinMaker.CONFIG_VERSION,
      tool: 'minecraft-chibi-skin-maker',
      model: { bodyType: this.bodyTypeMode, resolved: this.currentModelType },
      skin: this._skinDataUri
        ? { name: this.skinName || null, width: this._skinWidth || null, height: this._skinHeight || null, dataUri: this._skinDataUri }
        : null,
      view: this._viewKey(),
      // The bust is framing, not a camera, so it rides alongside the view key rather than inside it.
      bust: this.portraitView || null,
      upsideDown: this.upsideDown,
      // Saved ALONGSIDE the view key because the key is lossy: 'portrait', 'head', 'top', 'bottom',
      // 'front' and 'back' encode no facing, so a config that only carried the key came back from
      // import mirrored (the bust is drawn from CHIBI_PARTS_LEFT when facing left). setView keeps
      // your facing when you pick one of those views, and now so does a saved config.
      facing: this.facing,
      pose: this.pose,
      anim: this.anim,
      chibi: { headOverlay: this.headOverlay, bodyOverlay: this.bodyOverlay, shading: this.shading, shadingStrength: this.shadingStrength, layerShadow: this.layerShadow },
      material: this.currentMaterial,
      background: { color: this.bgColor, transparent: !!this.bgTransparent, vignette: !!this.bgVignette, shape: this.bgShape || 'none', aspect: this.bgAspect || '1:1', image: this._bgImageURI || null, charZoom: Math.round((this.charZoom || 1) * 1000) / 1000, charX: Math.round(this.charX || 0), charY: Math.round(this.charY || 0) },
      outline: { width: this.outlineWidth, sharp: !!this.outlineSharp, color: this.outlineColor },
      texture: { pixelated: !!this.textureFilterPixelated, barebones: !!this.barebones, barebonesThreshold: this.barebonesThreshold, halfHeightUVs: !!this.halfHeightUVs },
      // The two export settings that change the FILE that gets written: the pixel size and the GIF
      // playback speed. Both were missing, so a shared config exported at a different resolution
      // and a different animation speed than the one it was saved from.
      export: { size: this.exportSize || null, gifSpeed: this.gifSpeedValue || 1 },
      visibility: this._captureVisibility(),
    };
  }

  // Pretty-print a config like JSON.stringify(x, null, 2), EXCEPT arrays whose items are all
  // primitives stay on one line as [ a, b, c ] instead of exploding one element per line. Keeps the
  // number triples ([3, 6, 4], each pose's q/p/s) readable while objects still break normally.
  _formatConfigJSON(value, indent = '') {
    const next = indent + '  ';
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      if (value.every(v => v === null || typeof v !== 'object')) {
        return '[ ' + value.map(v => JSON.stringify(v)).join(', ') + ' ]';
      }
      const items = value.map(v => next + this._formatConfigJSON(v, next));
      return '[\n' + items.join(',\n') + '\n' + indent + ']';
    }
    if (value && typeof value === 'object') {
      const keys = Object.keys(value);
      if (keys.length === 0) return '{}';
      const items = keys.map(k => next + JSON.stringify(k) + ': ' + this._formatConfigJSON(value[k], next));
      return '{\n' + items.join(',\n') + '\n' + indent + '}';
    }
    return JSON.stringify(value);
  }

  // Apply a parsed config (any version / partial). Builds the exact `state` object restoreFullState
  // consumes (view key, chibi toggles, look and pose fields), rebuilds the embedded skin's texture
  // through the tool's own pipeline, then hands it all to restoreFullState. Wrapped as ONE undo step;
  // a mid-way failure rolls back to the pre-import state so a broken file can't leave the render
  // half-changed.
  async applyConfig(input) {
    if (this._configApplying) return;
    this._configApplying = true;
    const preState = this.captureFullState();
    try {
      const c = this._configMerge(ChibiSkinMaker.CONFIG_DEFAULTS, this._migrateConfig({ ...(input || {}) }));

      // Decode the view key through the SAME table the Camera panel uses; an unknown key falls back
      // to the default 3/4. Fields a view leaves unset get explicit defaults here - a config apply is
      // a full state, not a delta.
      const v = CHIBI_VIEWS[c.view] || CHIBI_VIEWS['34-right'];
      const onOff = (x) => (x === 'off' ? 'off' : 'on');
      const state = {
        modelType: c.model.resolved === 'alex' ? 'alex' : 'steve',
        bodyTypeMode: ChibiSkinMaker.BODY_TYPES.includes(c.model.bodyType) ? c.model.bodyType : 'auto',
        sideProfile: !!v.side,
        vertView: v.vert || 'none',
        // 'bust' is the current field; configs written before the busts became framing put 'portrait'
        // or 'head' in the VIEW key instead, so honour that too and let the camera fall back.
        upsideDown: !!c.upsideDown,
        portraitView: ChibiSkinMaker.BUST_CUT[c.bust] !== undefined ? c.bust
          : (ChibiSkinMaker.BUST_CUT[c.view] !== undefined ? c.view : false),
        flatProfile: v.flat !== undefined ? v.flat : false,
        // A view key that names a side wins (34-left really is left); the views that name none take
        // the config's own facing, falling back to right for files written before it was saved.
        facing: v.facing || (c.facing === 'left' ? 'left' : 'right'),
        viewSide: v.vs || 'front',
        pose: CHIBI_POSES[c.pose] ? c.pose : 'none',
        anim: CHIBI_ANIMS[CHIBI_ANIM_ALIASES[c.anim] || c.anim] ? (CHIBI_ANIM_ALIASES[c.anim] || c.anim) : 'none',
        headOverlay: onOff(c.chibi.headOverlay),
        bodyOverlay: onOff(c.chibi.bodyOverlay),
        shading: onOff(c.chibi.shading),
        shadingStrength: Math.max(0, Math.min(100, Number.isFinite(Number(c.chibi.shadingStrength)) ? Number(c.chibi.shadingStrength) : 50)),
        layerShadow: !!c.chibi.layerShadow,
        material: c.material,
        bgColor: c.background.color,
        bgTransparent: !!c.background.transparent,
        bgVignette: !!c.background.vignette,
        bgShape: ['square', 'circle'].includes(c.background.shape) ? c.background.shape : 'none',
        bgAspect: ChibiSkinMaker.ASPECTS.includes(c.background.aspect) ? c.background.aspect : '1:1',
        bgImageURI: typeof c.background.image === 'string' && c.background.image.startsWith('data:image/') ? c.background.image : null,
        charZoom: (Number.isFinite(Number(c.background.charZoom)) && Number(c.background.charZoom) > 0)
          ? Math.max(0.1, Math.min(10, Number(c.background.charZoom))) : 1,
        charX: Math.max(-64, Math.min(64, Math.round(Number(c.background.charX) || 0))),
        charY: Math.max(-64, Math.min(64, Math.round(Number(c.background.charY) || 0))),
        outlineWidth: Math.max(0, Number(c.outline.width) || 0),
        outlineSharp: !!c.outline.sharp,
        outlineColor: c.outline.color,
        textureFilterPixelated: !!c.texture.pixelated,
        barebones: !!c.texture.barebones,
        // Clamped to the slider's own range: an out-of-range value from a hand-edited file used to
        // apply for real while the slider thumb pinned at its limit, so the control lied about what
        // the renderer was doing.
        barebonesThreshold: Math.max(12, Math.min(55, Number(c.texture.barebonesThreshold) || 30)),
        halfHeightUVs: !!c.texture.halfHeightUVs,
        visibility: (c.visibility && typeof c.visibility === 'object' && !Array.isArray(c.visibility)) ? c.visibility : {},
      };

      // Skin: rebuild the display texture from the embedded data URI on the CURRENT model. A skin
      // texture is model-agnostic (the UVs live on the geometry), so restoreFullState can reassign it
      // after any model switch. Seed the filter/Barebones flags first so they compose into the build.
      if (c.skin && c.skin.dataUri) {
        this.textureFilterPixelated = state.textureFilterPixelated;
        this.barebones = state.barebones;
        this.barebonesThreshold = state.barebonesThreshold;
        const img = await this._loadImage(c.skin.dataUri);
        if (!this._validSkinSize(img)) throw new Error(`Config skin has unusable dimensions ${img.width}x${img.height}.`);
        this.applySkinTexture(img);
        state.currentSkinImage = this.currentSkinImage;
        state.skinName = c.skin.name || null;
        state.skinDataUri = this._skinDataUri;   // applySkinTexture re-encodes; keep them identical
        state.skinWidth = this._skinWidth;
        state.skinHeight = this._skinHeight;
      } else {
        state.currentSkinImage = null;
        state.skinName = null;
        state.skinDataUri = null;
        state.skinWidth = null;
        state.skinHeight = null;
      }

      await this.restoreFullState(state);

      // Export settings go on AFTER the state restore: the size ladder is rebuilt from the format,
      // so setting a size before bgShape lands would be discarded as out-of-ladder. Both setters
      // validate their own input and sync their control. Absent in configs written before these
      // were saved, in which case the current values simply stand.
      if (c.export && typeof c.export === 'object') {
        if (Number.isFinite(Number(c.export.size))) this.setExportSize(Number(c.export.size));
        if (Number.isFinite(Number(c.export.gifSpeed))) this.setGifSpeed(Number(c.export.gifSpeed));
      }

      this.pushUndo(preState);
    } catch (err) {
      await this.restoreFullState(preState);   // roll a partial apply back to where we started
      throw err;
    } finally {
      this._configApplying = false;
    }
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image decode failed'));
      img.src = src;
    });
  }

  // version -> version transforms; only for breaking changes (rename / re-meaning). Additive fields
  // need nothing here — deepMerge defaults them. Bump CONFIG_VERSION and add a case when one is needed.
  _migrateConfig(cfg) {
    // v1 was the Mojavatar-era schema (lights/camera/pose/shadows around a three.js scene). The 2D
    // fields it shares (model, skin, material, background, outline, texture) keep their shape, so the
    // migration is: drop the 3D-only blocks and let the merge default the new view/chibi fields.
    if (!cfg || typeof cfg !== 'object') return cfg;
    if ((Number(cfg.version) || 1) < 2) {
      delete cfg.shadows; delete cfg.lights; delete cfg.camera; delete cfg.visibility; delete cfg.pose;
      cfg.version = 2;
      cfg.tool = 'minecraft-chibi-skin-maker';
    }
    return cfg;
  }

  _configClone(v) {
    if (Array.isArray(v)) return v.map(x => this._configClone(x));
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = this._configClone(v[k]); return o; }
    return v;
  }

  // Overlay src onto base (the defaults): objects merge key-by-key, arrays & scalars replace. Keys not
  // in src are deep-cloned so the returned config never aliases (or can corrupt) CONFIG_DEFAULTS. A src
  // that is the wrong TYPE for an object subtree is ignored so a malformed file can't crash applyConfig.
  _configMerge(base, src) {
    if (base && typeof base === 'object' && !Array.isArray(base)) {
      const out = {};
      for (const k of Object.keys(base)) out[k] = this._configClone(base[k]);
      if (src && typeof src === 'object' && !Array.isArray(src)) {
        for (const k of Object.keys(src)) out[k] = this._configMerge(base[k], src[k]);
      }
      return out;
    }
    if (Array.isArray(base)) return Array.isArray(src) ? src.map(x => this._configClone(x)) : this._configClone(base);
    if (src === undefined) return this._configClone(base);
    if (base === undefined) return (src && typeof src === 'object') ? this._configClone(src) : src;
    return (src && typeof src === 'object') ? this._configClone(base) : src;
  }

  // Wire the config button's modal: import via drop/browse, export via copy/download. Open/close, the
  // focus trap and the scroll lock all belong to setupModals() (it binds configBtn -> openDialog); this
  // only handles the panel's own controls and refreshes the export text whenever the modal opens.
  setupConfigModal() {
    const overlay = document.getElementById('configOverlay');
    if (!overlay) return;
    const dropZone = document.getElementById('configDropZone');
    const fileInput = document.getElementById('configFile');
    const exportText = document.getElementById('configExport');
    const copyBtn = document.getElementById('configCopy');
    const downloadBtn = document.getElementById('configDownload');
    const statusEl = document.getElementById('configStatus');

    const setStatus = (msg, kind) => { if (statusEl) { statusEl.textContent = msg || ''; statusEl.className = 'config-status' + (kind ? ' ' + kind : ''); } };
    const refreshExport = () => { if (exportText) exportText.value = this._formatConfigJSON(this.serializeConfig()); };

    const readFile = (file) => {
      const reader = new FileReader();
      reader.onload = (e) => importText(e.target.result, file.name);
      reader.onerror = () => setStatus('Could not read that file.', 'error');
      reader.readAsText(file);
    };
    const importText = async (text, name) => {
      if (this._configCloseTimer) { clearTimeout(this._configCloseTimer); this._configCloseTimer = null; }
      let cfg;
      try { cfg = JSON.parse(text); } catch { setStatus('That file is not valid JSON.', 'error'); return; }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) { setStatus('A config must be a JSON object.', 'error'); return; }
      try {
        setStatus('Applying...', '');
        await this.applyConfig(cfg);
        refreshExport();
        setStatus('Loaded ' + (name || 'config'), 'success');
        this._configCloseTimer = setTimeout(() => { if (this.openDialogEl === overlay) this.closeDialog(); }, 700);
      } catch (err) { console.error('Config import failed:', err); setStatus('Could not apply that config.', 'error'); }
    };

    // Refresh the export box (and clear any stale status) each time the modal opens.
    if (this.configBtn) this.configBtn.addEventListener('click', () => { refreshExport(); setStatus(''); });

    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput && fileInput.click());
      dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
      dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault(); dropZone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        const f = files.find(x => x.type === 'application/json' || x.name.toLowerCase().endsWith('.json')) || files[0];
        if (f) readFile(f);
      });
    }
    if (fileInput) fileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readFile(f); fileInput.value = ''; });
    // A file dropped anywhere on the overlay (not just the zone) must not navigate the page to it.
    ['dragover', 'drop'].forEach(ev => overlay.addEventListener(ev, (e) => e.preventDefault()));

    if (copyBtn) copyBtn.addEventListener('click', async () => {
      let ok = false;
      try { await navigator.clipboard.writeText(exportText.value); ok = true; }
      catch { try { exportText.select(); ok = document.execCommand('copy'); } catch { ok = false; } }
      this._flashConfigBtn(copyBtn, ok ? 'Copied!' : 'Failed', ok);
    });
    if (downloadBtn) downloadBtn.addEventListener('click', () => {
      const base = (this.skinName || this.currentModelType || 'chibi').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'chibi';
      const blob = new Blob([exportText.value], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${base}-chibi-config.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this._flashConfigBtn(downloadBtn, 'Saved!', true);
    });
  }

  // Momentary "Copied!" / "Saved!" confirmation on an action button, the way the glyph generator's
  // export tiles do it: swap the label, tint the button, then restore. Works on both button shapes we
  // have - the config modal's buttons wrap their label in a <span>, the export modal's are plain text -
  // by writing to the <span> when there is one and to the button itself when there is not. The
  // original label is cached on the node so repeated clicks mid-flash cannot bake the flash text in,
  // and the pending timer is cleared for the same reason.
  _flashBtn(btn, label, ok) {
    if (!btn) return;
    if (btn._flashTimer) clearTimeout(btn._flashTimer);
    const span = btn.querySelector('span');
    // ICON-ONLY buttons (the skin download/remove circles) hold an <svg> and no text. Writing
    // textContent on those wiped the icon out of the DOM, stuffed a word into a 12px circle, and
    // then "restored" an empty string - so the button came back blank and stayed that way. Swap the
    // GLYPH for those and leave the markup structure intact.
    const icon = !span && btn.querySelector('svg');
    if (icon) {
      if (btn._origHTML == null) btn._origHTML = btn.innerHTML;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        + (ok ? '<path d="M20 6 9 17l-5-5"/>' : '<path d="M18 6 6 18M6 6l12 12"/>') + '</svg>';
    } else {
      const target = span || btn;
      if (target.dataset.origLabel == null) target.dataset.origLabel = target.textContent;
      target.textContent = label;
    }
    btn.style.borderColor = ok ? '#4CAF50' : '#f44336';
    btn.style.color = ok ? '#4CAF50' : '#f44336';
    btn._flashTimer = setTimeout(() => {
      if (icon) { if (btn._origHTML != null) btn.innerHTML = btn._origHTML; }
      else { const t = btn.querySelector('span') || btn; t.textContent = t.dataset.origLabel; }
      btn.style.borderColor = ''; btn.style.color = '';
      btn._flashTimer = null;
    }, 1200);
  }
  _flashConfigBtn(btn, label, ok) { this._flashBtn(btn, label, ok); }

  // Snapshot BEFORE a slider/color drag starts, push it once the value actually settles.
  //
  // The trap: this used to snapshot on mousedown/focus but only ever CLEAR on 'change'. Focus a
  // slider without moving it, do five other things, then finally nudge that slider: the stale
  // snapshot is what got pushed, so a single undo rewound all six operations. Clearing on blur (when
  // nothing changed) is what keeps the snapshot honest, and it matters far more now that the sliders
  // live in panels that steal and lose focus as the user tabs between them.
  _trackContinuousInput(el) {
    const arm = () => { if (!this._preActionState) this._preActionState = this.captureFullState(); };
    let changed = false;

    el.addEventListener('pointerdown', (e) => {           // pointerdown, not mousedown: touch counts
      if (e.button !== undefined && e.button !== 0) return;
      changed = false;
      arm();
    });
    el.addEventListener('focus', () => { changed = false; arm(); });
    el.addEventListener('change', () => {
      changed = true;
      if (this._preActionState) {
        this.pushUndo(this._preActionState);
        this._preActionState = null;
      }
    });
    el.addEventListener('blur', () => {
      if (!changed) this._preActionState = null;          // armed but never used: drop it
    });
  }

  // One skin pixel in model units, measured off the head cube (8 texels across).

  // 2D EXPORT, two families. "Pixel art" is the sprite itself at an exact integer nearest-neighbor
  // scale. The "profile picture" layouts are what the 3D sibling and the reference offer: a square
  // canvas at a preset resolution with the sprite centered at the largest crisp integer scale that
  // fits, over the background the Look tab describes - Square fills the whole frame (or stays
  // transparent), Circle draws the reference's round badge in the background color with transparent
  // corners. Nothing is ever resampled.
  // A tile writes shape AND aspect together: "Profile picture" means 1:1, so picking it after a
  // 16:9 session has to put the aspect back or the tile would light over a wide frame.
  // A tile picks the SHAPE. It deliberately does NOT touch the aspect, the character composition
  // or anything in the Look tab: a preset that overwrites a choice the user already made is worse
  // than no preset at all. Aspect sits beside the sizes and stays exactly where it was left.
  setFormat(shape) {
    if (!['none', 'square', 'circle'].includes(shape)) shape = 'none';
    if (shape === (this.bgShape || 'none')) { this._syncBgShapeButtons(); return; }
    this.pushUndo();
    const wasFramed = (this.bgShape || 'none') !== 'none';
    this.bgShape = shape;
    this._afterFormatChange(wasFramed !== (shape !== 'none'));
  }

  // Everything a shape change implies, in one place. `familyChanged` says whether the size ladder
  // itself changed (sprite multipliers vs framed pixel resolutions): square -> circle keeps the same
  // ladder, so a chosen 2048 survives instead of snapping back to the default.
  _afterFormatChange(familyChanged = true) {
    this.updatePresetActive();
    this.updateBackground();
    if (this.bgAspectRow) setVisible(this.bgAspectRow, (this.bgShape || 'none') === 'square');
    if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, this._bgPaints());
    if (familyChanged) this.exportSize = this._defaultSizeFor(this.bgShape);
    this._draw();
    this._populateExportSizes();
    this._updateExportDims();
    this._updateGifInfo();
    this._syncBgShapeButtons();          // the sizes moved under it
    this.setStatus((this.bgShape || 'none') === 'none' ? 'Pixel art: the sprite itself.'
      : (this.bgShape === 'circle' ? 'Round avatar.' : 'Profile picture, ' + (this.bgAspect || '1:1') + '.'));
  }

  // The Background card's header Reset (the pose presets' pattern): everything the card owns back
  // to defaults - color, transparent, vignette, shape, and the character composition inside the
  // badge. One undo step for the config-tracked fields; composition stays out of undo by design.
  resetBackground() {
    const d = ChibiSkinMaker.CONFIG_DEFAULTS.background;
    const isDefault = this.bgColor === d.color && !!this.bgTransparent === d.transparent
      && !!this.bgVignette === d.vignette && (this.bgShape || 'none') === d.shape
      && (this.bgAspect || '1:1') === d.aspect
      && !this.bgImage && this.charZoom === 1 && !this.charX && !this.charY;
    if (isDefault) { this.setStatus('Background is already at its defaults.'); return; }
    this.pushUndo();
    this.bgColor = d.color;
    this.bgTransparent = d.transparent;
    this.bgVignette = d.vignette;
    this.bgShape = d.shape;
    this.bgImage = null; this._bgImageURI = null;
    this.bgAspect = d.aspect;
    this._syncAspectButtons();
    if (this.bgAspectRow) setVisible(this.bgAspectRow, false);
    this._syncBgImageTile();
    this.charZoom = 1; this.charX = 0; this.charY = 0;
    if (this.bgColorPicker) this.bgColorPicker.value = d.color;
    if (this.updatePresetActive) this.updatePresetActive(d.color);
    if (this.bgTransparentCheckbox) this.bgTransparentCheckbox.checked = d.transparent;
    if (this.bgVignetteCheckbox) this.bgVignetteCheckbox.checked = d.vignette;
    if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, this._bgPaints());
    this._syncBgShapeButtons();
    this._populateExportSizes();
    this.updateBackground();   // repaints the container CSS and ends with _draw()
    this.setStatus('Background reset.');
  }

  // Decode-and-apply for the custom background image (null clears). Setting an image means
  // "use it": Transparent switches off exactly like a swatch click would. Async because the
  // data URI has to decode into an Image before anything can paint it.
  async _applyBgImageURI(uri) {
    if (!uri) {
      this.bgImage = null; this._bgImageURI = null;
    } else if (uri !== this._bgImageURI) {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = uri; }).catch(() => null);
      if (!img.naturalWidth) { this.setStatus('That file could not be read as an image.'); return; }
      this.bgImage = img; this._bgImageURI = uri;
      if (this.bgTransparent) {
        this.bgTransparent = false;
        if (this.bgTransparentCheckbox) this.bgTransparentCheckbox.checked = false;
        if (this.bgVignetteRow) setRowEnabled(this.bgVignetteRow, true);
      }
    }
    this._syncBgImageTile();
    this.updatePresetActive();
    this.updateBackground();
  }

  // The image tile IS a swatch: it shows the picked image as its own thumbnail and lights up
  // while that image is what the background paints. There is no Remove button - choosing any
  // colour swatch clears the image, and Transparent hides it, so removal is already covered.
  _syncBgImageTile() {
    if (!this.bgImageTile) return;
    this.bgImageTile.style.backgroundImage = this._bgImageURI ? 'url("' + this._bgImageURI + '")' : '';
    this.bgImageTile.classList.toggle('has-image', !!this.bgImage);
    this.bgImageTile.title = this.bgImage ? 'Change the background image' : 'Use an image background';
  }

  // Lights the tile that still MATCHES the state, prints what Download would write for each, and
  // updates the readout. A tile whose aspect no longer holds goes dark rather than keep claiming
  // something untrue - the background swatches' contract, applied to the output format.
  _syncBgShapeButtons() {
    const shape = this.bgShape || 'none';

    for (const b of this.bgShapeBtns || []) {
      const on = b.dataset.shape === shape;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
      const px = b.querySelector('.vp-format-px');
      if (!px) continue;
      // Each tile prints what Download would write IF PRESSED NOW: the live size for the format in
      // force, that format's default for the others. Always a fact, never a guess.
      const s = b.dataset.shape;
      const size = on ? (this.exportSize || this._defaultSizeFor(s)) : this._defaultSizeFor(s);
      const d = this._exportDims(s === 'none' ? 'sprite' : s, size);
      px.textContent = (d.w && d.h) ? (d.w + ' \u00d7 ' + d.h) : '\u2014';
    }

  }

  // What Download writes for a format before anyone opens More options: the true sprite for pixel
  // art, a 1024px badge otherwise. One definition, so the tiles, the modal and the readout agree.
  // Is there a background to darken? A circle ALWAYS carries its color (a circle of nothing is
  // nothing), so Transparent does not apply to it - and the vignette, which the circle export does
  // render, must not be greyed out there. The compositor already used this predicate; the controls
  // did not, so the box that did nothing was also disabling the control that would have worked.
  _bgPaints() {
    return !this.bgTransparent || (this.bgShape || 'none') === 'circle';
  }

  _defaultSizeFor(shape) {
    // Pixel art means NATIVE. The whole point of that output is the sprite's own pixels; More
    // sizes carries the crisp upscales for anyone who wants a bigger file.
    return (shape || 'none') === 'none' ? 1 : 1024;
  }

  // The two quick sizes per layout. Pixel art gets the TRUE sprite and the largest CRISP integer
  // multiple that still fits 1024 on the long side (an exact 1024 would need a fractional scale and
  // resample the art); a framed badge gets the two profile-picture resolutions.
  _exportSizes() {
    if ((this.bgShape || 'none') !== 'none') {
      return { quick: [512, 1024], more: [256, 2048, 4096] };
    }
    return { quick: [1], more: [4, 8, 16, 32] };
  }

  // The chosen export size. The two buttons and the menu are ONE control with three faces, so a
  // pick in any of them lights that face and clears the others - they can never both look chosen.
  setExportSize(size) {
    if (!Number.isFinite(size) || size < 1) return;
    this.exportSize = size;
    this._syncExportSizeButtons();
    this._syncBgShapeButtons();      // the lit tile prints this size
    this._updateExportDims();
    this._updateGifInfo();
  }

  // The frame's aspect. A format tile never writes this - it is the user's - so it gets its own
  // undo step and its own sync.
  setAspect(aspect) {
    if (!ChibiSkinMaker.ASPECTS.includes(aspect) || aspect === this.bgAspect) { this._syncAspectButtons(); return; }
    this.pushUndo();
    this.bgAspect = aspect;
    this._syncAspectButtons();
    this._draw();
    this._populateExportSizes();
    this._updateExportDims();
    this._updateGifInfo();
    this._syncBgShapeButtons();
    this.setStatus('Aspect: ' + aspect + '.');
  }

  _syncAspectButtons() {
    if (this.bgAspectSelect) this.bgAspectSelect.value = this.bgAspect || '1:1';
  }

  setGifSpeed(speed) {
    if (!Number.isFinite(speed) || speed <= 0) return;
    this.gifSpeedValue = speed;
    this._syncGifSpeedButtons();
    this._updateGifInfo();
    this._animEnsureLoop();
  }

  _syncGifSpeedButtons() {
    if (this.gifSpeed) this.gifSpeed.value = String(this.gifSpeedValue || 1);
  }

  _syncExportSizeButtons() {
    if (this.exportSizeSelect) this.exportSizeSelect.value = String(this.exportSize);
  }

  _populateExportSizes() {
    const { quick, more } = this._exportSizes();
    const all = [...quick, ...more].sort((a, b) => a - b);
    // Only seed a size when the current one cannot be written in this format's ladder. Overwriting
    // it on every populate silently discarded a deliberate pick (choose 4096, reopen, get 1024).
    const valid = new Set(all);
    if (!valid.has(this.exportSize)) this.exportSize = this._defaultSizeFor(this.bgShape);
    if (this.exportSizeSelect) {
      const layout = (this.bgShape || 'none') === 'none' ? 'sprite' : this.bgShape;
      this.exportSizeSelect.innerHTML = '';
      for (const value of all) {
        const d = this._exportDims(layout, value);
        const o = document.createElement('option');
        o.value = value;
        o.textContent = d.w + ' × ' + d.h + (value === 1 ? '  ·  native' : '');
        this.exportSizeSelect.appendChild(o);
      }
    }
    this._syncExportSizeButtons();
    this._syncAspectButtons();
  }

  // Export pixel dimensions: for framed layouts `size` is the LONG side and the aspect fills in
  // the other one (the 3D sibling's rule); the pixel-art layout multiplies the sprite instead.
  _exportDims(layout, size) {
    const sprite = this._chibiCanvas;
    if (layout === 'sprite') {
      return { w: (sprite ? sprite.width : 0) * size, h: (sprite ? sprite.height : 0) * size };
    }
    const a = layout === 'circle' ? 1 : this._frameAspect();
    return {
      w: a >= 1 ? size : Math.round(size * a),
      h: a >= 1 ? Math.round(size / a) : size,
    };
  }

  _buildExportCanvas(layout, size, spriteSrc = null) {
    const sprite = spriteSrc || this._chibiCanvas;
    if (!sprite) return null;
    const out = document.createElement('canvas');
    const c = out.getContext('2d');
    if (layout === 'sprite') {
      out.width = sprite.width * size;
      out.height = sprite.height * size;
      if (!this.bgTransparent) this._paintExportBackground(c, out.width, out.height, false);
      c.imageSmoothingEnabled = false;
      c.drawImage(sprite, 0, 0, out.width, out.height);
      return out;
    }
    // Framed layouts: a canvas at the chosen aspect, sprite centered at the largest integer scale
    // that leaves breathing room (the circle needs more so the sprite stays inside the disc).
    const dims = this._exportDims(layout, size);
    out.width = dims.w; out.height = dims.h;
    const fill = layout === 'circle' ? 0.68 : 0.9;
    // Same fit basis as the preview (_fitScale): bust views measure against the portrait's 22-row
    // cut, so the character fills the exported frame exactly like the viewfinder showed it.
    const fitH = this.portraitView ? Math.max(sprite.height, ChibiSkinMaker.BUST_CUT[this.portraitView] || 22) : sprite.height;
    const auto = Math.max(1, Math.floor(Math.min(dims.w / sprite.width, dims.h / fitH) * fill));
    // The preview's composition, re-derived at this resolution: charZoom scales the auto fit
    // (still snapped to an integer so pixels stay crisp), charX/charY are in sprite pixels.
    const scale = Math.max(1, Math.round(auto * (this.charZoom || 1)));
    this._paintBadge(c, 0, 0, dims.w, dims.h, layout);
    c.imageSmoothingEnabled = false;
    const w = sprite.width * scale, h = sprite.height * scale;
    const ccx = dims.w / 2 + (this.charX || 0) * scale, ccy = dims.h / 2 + (this.charY || 0) * scale;
    c.drawImage(sprite, Math.round(ccx - w / 2), Math.round(ccy - h / 2), w, h);
    return out;
  }

  // The frame's aspect as a number. Only the Square frame takes one: a circle badge is round by
  // definition, and the pixel-art layout has no frame at all.
  _frameAspect() {
    if ((this.bgShape || 'none') !== 'square') return 1;
    const [aw, ah] = String(this.bgAspect || '1:1').split(':').map(Number);
    return (aw > 0 && ah > 0) ? aw / ah : 1;
  }

  // The preview frame's pixel size: the biggest rect of the current aspect that leaves a margin
  // inside the canvas. At 1:1 this is exactly the old round(min(w,h) * 0.92) square.
  _frameSize(cvW, cvH) {
    const a = this._frameAspect();
    const h = Math.round(Math.min(cvH, cvW / a) * 0.92);
    return { w: Math.round(h * a), h };
  }

  // Paint the profile-picture badge into a region. BOTH shapes respect Transparent: the circle used
  // to force its disc on the reasoning that "a circle of nothing is nothing", but that made the
  // checkbox dead on the Round avatar - it stayed lit, did nothing, and gave no hint why. A
  // transparent round avatar is a real output too (the character with no disc behind it), and a
  // control that silently ignores you is worse than one whose result you can see and undo.
  // Shared by export and preview.
  _paintBadge(c, x, y, w, h, shape) {
    if (this.bgTransparent) return;
    if (shape === 'circle') {
      const d = Math.min(w, h);
      c.save();
      c.beginPath();
      c.arc(x + w / 2, y + h / 2, d / 2, 0, Math.PI * 2);
      c.clip();
      c.translate(x, y);
      this._paintExportBackground(c, w, h, true);
      c.restore();
    } else if (!this.bgTransparent) {
      c.save();
      c.translate(x, y);
      this._paintExportBackground(c, w, h, false);
      c.restore();
    }
  }

  // The background the viewer paints, on a canvas: solid color, or the color easing into its
  // darkened self when the vignette is on (the viewer CSS is radial-gradient(bg 40%, shade 135%)).
  _paintExportBackground(c, w, h, force) {
    if (this.bgTransparent && !force) return;
    if (this.bgImage) {
      // Cover-fit: fill the region preserving aspect, center, crop the overflow.
      const iw = this.bgImage.naturalWidth, ih = this.bgImage.naturalHeight;
      const k = Math.max(w / iw, h / ih);
      const dw = iw * k, dh = ih * k;
      c.save();
      c.beginPath(); c.rect(0, 0, w, h); c.clip();
      // The color sits UNDER the image, so a background PNG with alpha can't punch holes
      // through the badge (a skin file as background was the discovering case).
      c.fillStyle = this.bgColor;
      c.fillRect(0, 0, w, h);
      c.drawImage(this.bgImage, (w - dw) / 2, (h - dh) / 2, dw, dh);
      c.restore();
      if (this.bgVignette) {
        // Over an image the vignette is a neutral darkening (the color version eases the color
        // into its shaded self; 0.45 black at the edge is the same end brightness).
        const cx = w / 2, cy = h / 2;
        const R = Math.hypot(cx, cy) * 1.35;
        const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(0.3, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.45)');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
      }
      return;
    }
    c.fillStyle = this.bgColor;
    c.fillRect(0, 0, w, h);
    if (this.bgVignette) {
      const cx = w / 2, cy = h / 2;
      const R = Math.hypot(cx, cy) * 1.35;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, this.bgColor);
      g.addColorStop(0.3, this.bgColor);
      g.addColorStop(1, this._shadeHex(this.bgColor, 0.55));
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
    }
  }

  _exportSelection() {
    const layout = (this.bgShape || 'none') === 'none' ? 'sprite' : this.bgShape;
    const v = parseInt(this.exportSize, 10);
    const size = Number.isFinite(v) && v >= 1 ? v : (layout === 'sprite' ? 16 : 1024);
    return { layout, size };
  }

  _exportName(layout, size, ext) {
    const base = (this.skinName || this.currentModelType || 'chibi')
      .replace(/\.(png|jpe?g|webp|gif)$/i, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'chibi';
    const d = this._exportDims(layout, size);
    const tag = layout === 'sprite' ? (size > 1 ? '-x' + size : '')
      : (layout === 'circle' ? '-circle-' + size : (d.w === d.h ? '-' + size : '-' + d.w + 'x' + d.h));
    return 'chibi-' + base + tag + '.' + ext;
  }

  _updateExportDims() {
    const cv = this._chibiCanvas;
    if (!this.exportDims || !cv) return;
    const { layout, size } = this._exportSelection();
    const lead = layout === 'sprite' ? 'Pixel art'
      : (layout === 'circle' ? 'Round avatar' : ChibiSkinMaker.ASPECT_NAMES[this.bgAspect || '1:1']);
    if (layout === 'sprite') {
      this.exportDims.textContent = lead + ' · ' + (cv.width * size) + ' × '
        + (cv.height * size) + ' px · never resampled.';
      return;
    }
    const fill = layout === 'circle' ? 0.68 : 0.9;
    const fitH = this.portraitView ? Math.max(cv.height, ChibiSkinMaker.BUST_CUT[this.portraitView] || 22) : cv.height;
    const d = this._exportDims(layout, size);
    const auto = Math.max(1, Math.floor(Math.min(d.w / cv.width, d.h / fitH) * fill));
    const k = Math.max(1, Math.round(auto * (this.charZoom || 1)));
    this.exportDims.textContent = lead + ' · ' + d.w + ' × ' + d.h
      + ' px · character at ' + k + 'x, scroll or pinch to resize it.';
  }

  // The Animation section states the clip it is about to write - name, frame count, and how long
  // one loop lasts at the chosen speed - and the button goes dead when there is nothing to write.
  _updateGifInfo() {
    const anim = CHIBI_ANIMS[this.anim];
    if (this.downloadGifBtn) this.downloadGifBtn.disabled = false;
    if (!this.gifInfo) return;
    const { layout, size } = this._exportSelection();
    const d = this._exportDims(layout, size);
    const px = ' \u00b7 ' + d.w + ' \u00d7 ' + d.h + ' px.';
    if (!anim) {
      this.gifInfo.textContent = 'No animation \u00b7 a single still frame' + px;
      return;
    }
    const speed = this.gifSpeedValue || 1;
    const count = (this._animFrames || anim.frames).length;
    const total = anim.frames.reduce((a, f) => a + f.d, 0) / speed;
    this.gifInfo.textContent = anim.label + ' \u00b7 ' + count + ' frames \u00b7 '
      + (total / 1000).toFixed(1) + 's per loop' + px;
  }

  exportPNG() {
    const { layout, size } = this._exportSelection();
    const cv = this._buildExportCanvas(layout, size);
    if (!cv) return;
    const link = document.createElement('a');
    link.download = this._exportName(layout, size, 'png');
    link.href = cv.toDataURL('image/png');
    link.click();
    this.setStatus('PNG saved (' + cv.width + ' x ' + cv.height + ').');
    this._flashBtn(this.downloadPngBtn, 'Saved!', true);
    this._afterExport();
  }

  async copyPNG() {
    const { layout, size } = this._exportSelection();
    const cv = this._buildExportCanvas(layout, size);
    if (!cv) return;
    try {
      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      this.setStatus('PNG copied to the clipboard (' + cv.width + ' x ' + cv.height + ').');
      this._flashBtn(this.copyPngBtn, 'Copied!', true);
      this._afterExport();
    } catch (e) {
      this.setStatus('Copy failed - your browser may not allow image clipboard access.');
      this._flashBtn(this.copyPngBtn, 'Failed', false);
    }
  }

  // The GIF is the selected animation on an endless loop, at the same layout the PNG export uses
  // (plain sprite scale, or the Square/Circle badge with the character composition baked in).
  // Encoding is gifenc, the 3D sibling's encoder, loaded on demand from the CDN. Our sprites have
  // hard binary alpha, so the rgba4444 palette carries transparency losslessly into the GIF's
  // 1-bit transparent index; dispose 2 wipes each frame so motion never smears.
  async exportGIF() {
    // No animation picked is not a failure: a GIF of the current picture is a perfectly good
    // answer, and a disabled button with no explanation is a dead end.
    const anim = CHIBI_ANIMS[this.anim];
    const frames = (anim && this._animFrames)
      ? this._animFrames
      : (this._chibiCanvas ? [{ cv: this._chibiCanvas, delay: 200 }] : null);
    if (!frames) {
      this.setStatus('Load a skin first.');
      return;
    }
    setBusy(this.downloadGifBtn, 'Encoding...');
    try {
      const { GIFEncoder, quantize, applyPalette } = await import(
        'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js'
      );
      const { layout, size } = this._exportSelection();
      const speed = this.gifSpeedValue || 1;
      const gif = GIFEncoder();
      let w = 0, h = 0;
      for (const f of frames) {
        const cv = this._buildExportCanvas(layout, size, f.cv);
        w = cv.width; h = cv.height;
        const { data } = cv.getContext('2d').getImageData(0, 0, w, h);
        // EXACT palette first: pixel-art frames have few unique colors, and gifenc's quantizer
        // formats snap channels to 4-5 bits (the "weird colors"). Collect the true RGB values -
        // GIF alpha is binary, so alpha snaps at 128 - and only fall back to the quantizer (at
        // its highest-precision rgb565) when a gradient (the vignette badge) exceeds 256 colors.
        let palette = [], ti = -1, exact = true;
        let index = new Uint8Array(data.length / 4);
        const seen = new Map();
        for (let i = 0, px = 0; i < data.length; i += 4, px++) {
          const key = data[i + 3] < 128 ? -1 : ((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
          let idx = seen.get(key);
          if (idx === undefined) {
            if (palette.length >= 256) { exact = false; break; }
            idx = palette.length;
            if (key === -1) { ti = idx; palette.push([0, 0, 0, 0]); }
            else palette.push([data[i], data[i + 1], data[i + 2], 255]);
            seen.set(key, idx);
          }
          index[px] = idx;
        }
        if (!exact) {
          palette = quantize(data, 255, { format: 'rgb565' });
          index = applyPalette(data, palette, 'rgb565');
          ti = palette.length;
          palette.push([0, 0, 0, 0]);
          let anyClear = false;
          for (let i = 0, px = 0; i < data.length; i += 4, px++) {
            if (data[i + 3] < 128) { index[px] = ti; anyClear = true; }
          }
          if (!anyClear) { palette.pop(); ti = -1; }
        }
        gif.writeFrame(index, w, h, {
          palette,
          delay: Math.max(20, Math.round(f.delay / speed)),
          transparent: ti >= 0,
          transparentIndex: Math.max(0, ti),
          dispose: 2,
        });
        await new Promise((r) => requestAnimationFrame(r));
      }
      gif.finish();
      const blob = new Blob([gif.bytes()], { type: 'image/gif' });
      const link = document.createElement('a');
      link.download = this._exportName(layout, size, 'gif').replace(/\.gif$/, (anim ? '-' + this.anim : '') + '.gif');
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
      this.setStatus('GIF saved (' + w + ' x ' + h + ', ' + frames.length + (frames.length === 1 ? ' frame).' : ' frames).'));
      this._gifSavedFlash = true;
    } catch (e) {
      // Two very different failures used to share one message, so an encode that ran out of
      // memory told the user to check their internet.
      const loading = /import|fetch|network|module|dynamically/i.test(String((e && e.message) || ''));
      this.setStatus(loading
        ? 'GIF export failed - the encoder could not load. Check your connection.'
        : 'GIF export failed - ' + ((e && e.message) || 'unknown error') + '.');
    } finally {
      // clearBusy restores the label from "Encoding...", so the confirmation flash has to come after
      // it or it would be immediately overwritten.
      clearBusy(this.downloadGifBtn);
      if (this._gifSavedFlash) { this._gifSavedFlash = false; this._flashBtn(this.downloadGifBtn, 'Saved!', true); this._afterExport(); }
    }
  }

  // Inverse of the export's bone-name sanitisation, applied only to files this tool produced
  // (marked by the embedded `mojavatar` settings key). "Right_Arm" comes back as "Right Arm" so
  // the pose presets — which look bones up by their canonical spaced names — keep working after
  // an export/reimport round-trip. Foreign files are left untouched.

  // A bigger gizmo alone still is not tappable: r168's arrow PICKERS are cones tapering to
  // ZERO radius at the arrowhead (the exact spot a finger aims for) and the rotate rings are
  // 0.1-tube tori, a few pixels on a phone canvas. Swap the invisible picker meshes for
  // constant-radius shapes on touch devices; the drawn gizmo is untouched. This reaches into
  // r168 internals (_gizmo.picker), which is safe while three stays pinned (see the importmap),
  // and is guarded so a future bump loses the fattening instead of throwing.
  //
  // ⚠ r168's setupGizmo BAKES each handle's placement into its geometry and zeroes the mesh
  // transform (updateMatrixWorld overwrites handle positions every frame), so a replacement
  // geometry must be baked the same way or every picker collapses onto the gizmo origin.
  // The baked placement is recovered from the old geometry's own bounding box: an arrow's
  // axis is its longest extent (offset sign from the box center), a ring's normal is its
  // flattest one.
}

// The only three values the body-type control may hold. Both controls (the desktop pills and the
// phone dropdown) are validated against this, so a stray data-model or <option> value cannot walk
// bodyTypeMode into a state loadModel has never heard of.
ChibiSkinMaker.BODY_TYPES = ['auto', 'steve', 'alex'];

// The Square frame's aspect ratios - the 3D sibling's exact set, so both tools frame alike.
ChibiSkinMaker.ASPECTS = ['1:1', '4:3', '16:9', '4:5', '9:16'];

// The framed layout is named after WHAT IT PRODUCES. A 16:9 frame is not a profile picture, so the
// readout must not call it one - the tile keeps its plain name because 1:1 is what it defaults to.
ChibiSkinMaker.ASPECT_NAMES = {
  '1:1': 'Profile picture', '4:3': 'Classic 4:3', '16:9': 'Wide 16:9',
  '4:5': 'Post 4:5', '9:16': 'Story 9:16',
};

// Settings-config schema. Bump CONFIG_VERSION only for a BREAKING change (rename / re-meaning) and add
// a matching case in _migrateConfig; additive fields just need a default here (import defaults anything
// an older file omits).
ChibiSkinMaker.CONFIG_VERSION = 2;
// Bust framings: the sprite row everything BELOW is cropped away. Ordered widest to tightest. 'head'
// additionally drops every non-head blit (the headOnly guard) rather than just cropping, so a head
// bust is the head alone whatever the pose. Full body is the absence of a bust, not an entry here.
ChibiSkinMaker.BUST_CUT = { torso: 27, portrait: 22, head: 17 };
ChibiSkinMaker.BUST_LABEL = { torso: 'half body', portrait: 'portrait bust', head: 'head bust' };

ChibiSkinMaker.CONFIG_DEFAULTS = {
  version: 2,
  tool: 'minecraft-chibi-skin-maker',
  model: { bodyType: 'auto', resolved: 'steve' },
  skin: { name: null, width: null, height: null, dataUri: null },
  view: '34-right',
  bust: null,          // null | 'portrait' | 'head' - framing, independent of view and pose
  upsideDown: false,   // Dinnerbone / Grumm
  pose: 'none',
  anim: 'none',
  chibi: { headOverlay: 'on', bodyOverlay: 'on', shading: 'on', shadingStrength: 53, layerShadow: false },
  material: 'soft',
  background: { color: '#4a4a4a', transparent: true, vignette: false, shape: 'none', aspect: '1:1', image: null, charZoom: 1, charX: 0, charY: 0 },
  outline: { width: 0, sharp: false, color: '#000000' },
  texture: { pixelated: true, barebones: false, barebonesThreshold: 30, halfHeightUVs: false },
  visibility: {},
};

if (typeof document !== 'undefined' && document.getElementById('viewerContainer')) {
  new ChibiSkinMaker();
}

export { ChibiSkinMaker };
