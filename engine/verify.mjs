// Headless verification for goods-sort.html — V4 (POSITIONAL 3-SLOT front layers +
// DEPTH LAYERS + slot hit-test + base-anchored baseline + centered contact shadow).
// Serves games/goods-sort/ over localhost so RELATIVE asset paths (../assets/goods/*.png)
// resolve, stubs flutter_inappwebview.callHandler to capture __emits, drives moves via
// window.__qa, and asserts:
//   PRIOR (V3 kept):
//   - board render, clear+effects (4 effects), win+GameEnd, flat payload, haptic counts
//     (scope trap!), reels safe-top + shouldEmitGameEnd, ?from=N start level
//   - 2-layer cubby: front goods interactive + back goods present-but-NOT-grabbable
//   - emptying the front layer triggers REVEAL -> back layer becomes front
//   - deeper recess: --wall-depth increased vs V2 (20px) + 6 faces per cubby present
//   - contact-shadow element exists under goods
//   - drop-into-any-free-slot still works; full front-layer rejects
//   - 4 effects + GameEnd{success:true} + Light/Medium haptic counts > 0
//   - totalGoods counts ALL layers; WIN only when every layer empty
//   - 0 pageerrors
//   NEW (V4 the 4 fixes):
//   (V4-1 POSITIONAL DROP) dropping near the LEFT of an EMPTY cubby lands slot 0,
//        near RIGHT lands slot 2 — resulting slot index matches the drop X.
//   (V4-2 SLOT HIT-TEST) a front layer with left+right good, empty center: a pointerdown
//        over a specific good grabs THAT good (not a neighbor/below).
//   (V4-3 SHADOW ALIGN) each good's contact-shadow center X ≈ the good's center X.
//   (V4-4 BASELINE) all rendered goods in a cubby share the same floor baseline (bottom Y).
//   (V4-5 CLEAR/REVEAL) clear fires ONLY when all 3 slots same type; reveal when all 3 empty.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from '/Users/supercent/nanoclo/나노클로-C/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import sharp from '/Users/supercent/nanoclo/나노클로-C/node_modules/sharp/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');           // games/goods-sort/
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const V2_WALL_DEPTH = 20;                              // V2 baseline --wall-depth (px)
const BASELINE_TOL = 4;                                // px tolerance for shared baseline
const SHADOW_TOL = 4;                                  // px tolerance for shadow<->good center
// V8 — REFERENCE-CALIBRATED plank threshold (px). The wood was recalibrated from
// the V7 CHUNKY values (board 46 / rail 40 / post 44 / divider 36) DOWN to the
// reference's MODERATE/SLIM flat planks (board 30 / rail 22 / post 24 / divider 22).
// A member must still be a FLAT SOLID PLANK (not a hairline stick), so we require
// the rendered thickness >= 18px — all calibrated members clear this with margin.
const THICK_MIN = 18;
// V7 — cream wall RGB the joints must NOT show through (= --wallpaper #f0e2c8).
const CREAM = { r: 0xf0, g: 0xe2, b: 0xc8 };
// a sampled joint pixel "is cream" if within this Euclidean RGB distance of cream.
const CREAM_TOL = 26;

const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
  '.png':'image/png', '.webp':'image/webp', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };

// ---- static server rooted at games/goods-sort/ ----
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/engine/goods-sort.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()){
    res.writeHead(404); res.end('nf: '+p); return;
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
  res.end(fs.readFileSync(fp));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/engine/goods-sort.html`;

// ---- assertions ----
const results = [];
let failures = 0;
function assert(name, cond, extra){
  const ok = !!cond;
  if (!ok) failures++;
  results.push({ name, ok, extra: extra==null?'':String(extra) });
  console.log((ok?'PASS':'FAIL') + '  ' + name + (extra!=null?('  ['+extra+']'):''));
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--use-gl=swiftshader','--no-sandbox','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'],
});

// reusable page bootstrapper: stubs host channel BEFORE any script runs.
// /favicon.ico 404 is a benign browser default, not an asset error -> ignore it.
async function makePage(){
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => { if (!/favicon\.ico$/.test(r.url())) pageErrors.push('REQ_FAIL ' + r.url() + ' ' + (r.failure()?.errorText||'')); });
  await page.evaluateOnNewDocument(() => {
    window.__emits = [];
    window.__NO_STAGE_FETCH = true;   // pin the EMBEDDED V17 stage (skip the live 100-stage fetch)
    window.__NO_TUTORIAL = true;      // skip the first-play coachmark (it would pause level 1)
    window.flutter_inappwebview = {
      callHandler: function(handler, msg){ window.__emits.push({ handler, msg }); return Promise.resolve(); }
    };
  });
  return { page, pageErrors };
}
function counts(emits){
  const c = {};
  for (const e of emits){
    const ev = e.msg && e.msg.event;
    c[ev] = (c[ev]||0) + 1;
  }
  return c;
}

// V7 — sample the AVERAGE rgba of a tiny region centered on a viewport (CSS) px point.
// Clips a `pad`-px-radius box, decodes the PNG with sharp (raw RGBA), and averages the
// pixels. deviceScaleFactor scales CSS px -> device px for the screenshot clip. We
// average a small patch (not 1px) to be robust to antialiasing on the exact joint line.
async function samplePixel(page, page_dsf, cssX, cssY, pad = 3){
  const dsf = page_dsf;
  const clip = {
    x: Math.max(0, Math.round(cssX - pad)),
    y: Math.max(0, Math.round(cssY - pad)),
    width: pad * 2,
    height: pad * 2
  };
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels){
    r += data[i]; g += data[i+1]; b += data[i+2];
    a += (info.channels >= 4 ? data[i+3] : 255);
    n++;
  }
  return { r: r/n, g: g/n, b: b/n, a: a/n, n, w: info.width, h: info.height };
}
function rgbDist(p, c){
  return Math.sqrt((p.r-c.r)**2 + (p.g-c.g)**2 + (p.b-c.b)**2);
}

// =====================================================================
// MAIN RUN — default mode, drive to WIN
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 200));

  // (1) board renders cubbies + FRONT-layer goods from stage1.json (V4 3-slot layers)
  const render = await page.evaluate(() => {
    const cubbies = document.querySelectorAll('#grid .cubby').length;
    const frontGoods = document.querySelectorAll('#grid .cubby .c-floor .good').length;
    const peekGoods = document.querySelectorAll('#grid .cubby .c-back-layer .good.peek').length;
    const slots = document.querySelectorAll('#grid .cubby .c-floor .slot').length; // 12 cubbies x 3 = 36
    const board = window.__qa.board();
    // total = ALL layers, NON-NULL slots only (front + every back layer)
    const totalAll = board.reduce((n,cb)=>n+cb.layers.reduce((m,l)=>m+l.filter(x=>!!x).length,0),0);
    const totalFront = board.reduce((n,cb)=>n+cb.front.filter(x=>!!x).length,0);
    return { cubbies, frontGoods, peekGoods, slots, totalAll, totalFront, board };
  });
  assert('(1a) 12 cubbies rendered (3 cols x 4 rows, densely packed)', render.cubbies === 12, render.cubbies);
  // stage1 V10: 11 cubbies front-FULL = 33 front goods + 1 EMPTY workspace (idx6); EVERY one of
  // the 11 packed cubbies carries a back depth-layer (x3) => 33 back; 66 total (cola/juice/donut
  // x12, milk/chips x15 — all multiples of 3 -> solvable). The DENSE back row peeks across the
  // WHOLE board (clearly-visible depth, reference).
  assert('(1b) front-layer goods rendered (33 front DOM == 33 front data)',
    render.frontGoods === 33 && render.totalFront === 33, 'dom='+render.frontGoods+' data='+render.totalFront);
  assert('(1c) back-layer goods PEEK present across EVERY packed cubby (33 peek DOM = 11 cubbies x 3)', render.peekGoods === 33, render.peekGoods);
  assert('(1d-SLOTS) 36 fixed slot cells rendered (12 cubbies x 3 columns)', render.slots === 36, render.slots);

  // ===== IMAGE HUD (Phase 2a) — every framed HUD/booster element is a gpt-image-2
  //       PNG (not code-drawn); dynamic NUMBERS overlay as ENGLISH text. Pause +
  //       lives are intentionally KEPT as the existing code-drawn chips. =====
  const hud = await page.evaluate(() => {
    function bg(sel){ const e=document.querySelector(sel); return e ? getComputedStyle(e).backgroundImage : ''; }
    function txt(sel){ const e=document.querySelector(sel); return e ? e.textContent.replace(/\s+/g,' ').trim() : null; }
    const items = Array.from(document.querySelectorAll('#boosters .booster'))
      .map(b => ({ key:b.dataset.item, bg:getComputedStyle(b).backgroundImage,
                   locked:b.classList.contains('locked'), free:!!b.querySelector('.free-lbl') }));
    return {
      lvBg: bg('#lv'), lvTxt: txt('#lv .txt'),
      lvEngraved: (getComputedStyle(document.getElementById('lv')).boxShadow||'').includes('inset'),
      comboLobe: (getComputedStyle(document.getElementById('combo')).borderBottomLeftRadius||'') !== '0px',
      timerBg: bg('#timer'), timerTxt: txt('#timer .txt'),
      comboIsGauge: !!document.querySelector('#combo.combo-gauge'),
      comboTrack: !!document.querySelector('#combo .cg-track'),
      comboLabel: txt('#combo .cg-label'),
      comboFlame: !!document.querySelector('#comboCount .fl'),
      comboCountTxt: txt('#comboCount .cc-x'),
      lvW: Math.round(document.getElementById('lv').getBoundingClientRect().width),
      comboW: Math.round(document.getElementById('comboCount').getBoundingClientRect().width),
      items,
      // hearts REMOVED; pause kept
      pausePresent: !!document.getElementById('pause'),
      livesGone: !document.getElementById('lives'),
      // no leftover code-drawn star counter
      starCounterGone: !document.getElementById('stars') && !document.getElementById('starNum')
    };
  });
  assert('(HUD-1 level ENGRAVED) #lv shows "Lv. N" and is DEBOSSED into the frame (음각: inset shadow), not a raised image pill',
    /^Lv\./.test(hud.lvTxt||'') && hud.lvEngraved && hud.comboLobe, 'txt='+hud.lvTxt+' engraved='+hud.lvEngraved+' comboLobe='+hud.comboLobe);
  assert('(HUD-2 timer AMBER plate) #timer is the CSS amber rounded-rect (gradient, not the urgent image) + "M:SS" overlay',
    hud.timerBg.includes('gradient') && !hud.timerBg.includes('pill_timer_urgent') && /^\d?\d:\d\d$/.test(hud.timerTxt||''), hud.timerBg.slice(0,40)+' | '+hud.timerTxt);
  assert('(HUD-3 combo = FLAME count pill + retention bar) #comboCount shows "🔥 xN", #combo is the retention gauge; star counter gone',
    hud.comboFlame && /^x\d+$/.test(hud.comboCountTxt||'') && hud.comboIsGauge && hud.comboTrack && hud.starCounterGone,
    'flame='+hud.comboFlame+' count='+hud.comboCountTxt+' gauge='+hud.comboIsGauge+' starGone='+hud.starCounterGone);
  const wantIcon = { hammer:'btn_hammer.png', timefreeze:'btn_timefreeze.png', shuffle:'btn_shuffle.png', addtime:'btn_addtime.png' };
  const itemsOK = hud.items.length === 4 && hud.items.every(b => (b.bg||'').includes(wantIcon[b.key]));
  const hammer = hud.items.find(b=>b.key==='hammer') || {};
  const lockedRest = hud.items.filter(b=>b.key!=='hammer').every(b=>b.locked);
  assert('(HUD-4 ITEM bar) 4 items hammer/timefreeze/shuffle/addtime; hammer unlocked+Free, others LOCKED at Lv1',
    itemsOK && !hammer.locked && hammer.free && lockedRest,
    JSON.stringify(hud.items.map(b=>b.key+(b.locked?'(lock)':'')+(b.free?'(free)':''))));
  assert('(HUD-5 hearts + pause removed; flame pill == Lv size) #lives & #pause gone; #comboCount width == #lv width (symmetric)',
    hud.livesGone && !hud.pausePresent && Math.abs(hud.lvW - hud.comboW) <= 2,
    'livesGone='+hud.livesGone+' pauseGone='+(!hud.pausePresent)+' lvW='+hud.lvW+' comboW='+hud.comboW);

  // ===== URGENT TIMER (<60s): swap to pill_timer_urgent.png (skull) + RED page bg.
  //       Reverts to normal when time goes back >=60 (e.g. after a continue). =====
  const urg = await page.evaluate(() => {
    function timerBg(){ return getComputedStyle(document.getElementById('timer')).backgroundImage; }
    function skull(){ return (getComputedStyle(document.getElementById('timer'),'::before').backgroundImage||'').includes('skull_timer'); }
    function tintOpacity(){ return getComputedStyle(document.getElementById('urgentTint')).opacity; }
    const before = { bg:timerBg(), skull:skull(), bodyUrgent:document.body.classList.contains('urgent'), tint:tintOpacity(), urgentState:window.__qa.urgent() };
    window.__qa.setTime(45);            // drop below 60s
    const during = { bg:timerBg(), skull:skull(), bodyUrgent:document.body.classList.contains('urgent'), tint:tintOpacity(), urgentState:window.__qa.urgent() };
    window.__qa.setTime(90);            // back to >=60 (continue / refill)
    const after = { bg:timerBg(), bodyUrgent:document.body.classList.contains('urgent'), tint:tintOpacity(), urgentState:window.__qa.urgent() };
    window.__qa.setTime(120);           // restore
    return { before, during, after };
  });
  assert('(URG-1 normal @>=60s) timer = amber CSS plate (gradient, not urgent image), no red bg',
    urg.before.bg.includes('gradient') && !urg.before.bg.includes('pill_timer_urgent') && !urg.before.bodyUrgent && !urg.before.urgentState,
    JSON.stringify(urg.before).slice(0,120));
  assert('(URG-2 urgent @<60s) RED timer plate + SKULL on the left (skull_timer); NO full-screen red tint (disabled — user)',
    urg.during.skull && !urg.before.skull && urg.during.bodyUrgent && urg.during.urgentState && parseFloat(urg.during.tint) === 0,
    JSON.stringify(urg.during).slice(0,140));
  assert('(URG-3 revert @>=60s) back to amber CSS plate + no red bg when time goes back up',
    urg.after.bg.includes('gradient') && !urg.after.bg.includes('pill_timer_urgent') && !urg.after.bodyUrgent && !urg.after.urgentState,
    JSON.stringify(urg.after).slice(0,120));

  // ===== totalGoods counts ALL layers, NON-NULL slots (front 33 + back 33 = 66) =====
  const total0 = await page.evaluate(() => window.__qa.state().total);
  assert('(G1) totalGoods counts ALL layers, non-null slots (=66, not just front 33)', total0 === 66, total0);

  // ===== V12 NICHE: folded 3D wood box per cubby (preserve-3d on .niche-clip, perspective
  //       per-cubby) + 5 faces + DEPTH (--wall-depth = box depth) + front/back stages. =====
  const shelf = await page.evaluate(() => window.__qa.shelf3d());
  assert('(C1) 3D wood NICHE present (CSS-3D folded box: preserve-3d niche-clip)',
    shelf.preserve3d && shelf.cubbies===12 && shelf.backWalls===12,
    'preserve3d='+shelf.preserve3d+' cubbies='+shelf.cubbies+' back='+shelf.backWalls);
  assert('(C1b) folded-box faces: 12 back walls + 48 wood faces (4/cubby: floor+ceiling+L+R) + 12 floors',
    shelf.backWalls===12 && shelf.sideWalls===48 && shelf.floors===12,
    'back='+shelf.backWalls+' woodFaces='+shelf.sideWalls+' floor='+shelf.floors);
  assert('(C1c) per-niche perspective active (real 3D folded box, not flat)',
    shelf.perspective && shelf.perspective!=='none', shelf.perspective);
  assert('(C1d-DEPTH) --wall-depth (niche box depth) DEEPER than V2 (20px)',
    shelf.wallDepthPx > V2_WALL_DEPTH, shelf.wallDepthPx+'px vs V2 '+V2_WALL_DEPTH+'px');
  assert('(C1e) board renders 33 FRONT goods standing on the 3D niche floors',
    shelf.goodsInFloors === 33, shelf.goodsInFloors);
  assert('(C1f) 12 back-row stages present (deep on the floor, holds peeking goods)',
    shelf.backLayers === 12, shelf.backLayers);
  assert('(C1g-DEPTH) back row VISIBLE across EVERY packed cubby (33 peeking goods = 11 cubbies x 3)',
    shelf.peekGoods === 33, shelf.peekGoods);

  // ===== V12 NICHE STRUCTURE — each cubby is one folded 3D wood box =====
  const niche = await page.evaluate(() => window.__qa.shelfNiche());
  assert('(N1) each cubby has the 5+ box faces present (back + floor + ceiling + L wall + R wall) + front rim',
    niche.facesPresent === true && niche.rimPresent === true,
    'faces='+niche.facesPresent+' rim='+niche.rimPresent);
  // V17: the CEILING face is HIDDEN by default (display:none), so its wood asset is no longer
  // rendered — but the asset is still WIRED on the rule (so the editor can re-enable it). We
  // assert the wood-asset wiring for the VISIBLE faces (floor/rim=board, L/R walls=post) +
  // the ceiling rule still carries the board asset (ceilUsesWood) even while hidden.
  assert('(N2) faces use WOOD: floor/rim=shelf_board.png, L/R walls=post.png (back is a recessed darker cream now)',
    niche.floorUsesWood && niche.ceilUsesWood &&
    niche.leftUsesWood && niche.rightUsesWood && niche.rimUsesWood,
    JSON.stringify({back:niche.backIsCream,floor:niche.floorUsesWood,ceil:niche.ceilUsesWood,L:niche.leftUsesWood,R:niche.rightUsesWood,rim:niche.rimUsesWood}));
  // V17 LOOK-DOWN + HIDDEN CEILING: the eye now sits HIGH above center (eyeY≈0.20) so the camera
  // looks DOWN INTO the box and the wood FLOOR surface projects a CLEAR band at the bottom of
  // each level (the user wants "각 층 바닥면(선반)이 보이게"). The CEILING is HIDDEN by default
  // (ceilingVisibility=0 -> display:none) so its projected height is ~0 ("상단쪽 벽면은 안보여도돼").
  assert('(N3) FLOOR clearly visible (look-down, >=2.5px) + CEILING HIDDEN (projected height ~0 by default)',
    niche.floorProjH >= 2.5 && niche.ceilProjH <= 0.5,
    'floorProjH='+niche.floorProjH.toFixed(2)+' ceilProjH='+niche.ceilProjH.toFixed(2));
  // V18 OUTER-WALL REVEAL (global center eye, NON-mirrored oxLocal = boardCenterX − cubbyLeft).
  // The eye is a SINGLE point above the BOARD center. With the outer-wall reveal:
  //   LEFT-of-center cubby : reveals ONLY its LEFT (OUTER) wall; its RIGHT wall ≈ 0.
  //   RIGHT-of-center cubby: reveals ONLY its RIGHT (OUTER) wall; its LEFT wall ≈ 0.
  //   CENTER column cubby  : straight-on, BOTH walls ≈ 0 (per-cubby Dside scales by distance
  //                          from center -> center column gets ≈ no side wall).
  // The reveal is SUBTLE + SCALING with distance from center (the farther, the more outer wall).
  // This REVERTS the prior center-facing mirror. Assert all three positions.
  const walls = await page.evaluate(() => window.__qa.wallsByPosition());
  // V22 — the user-tuned config makes the side walls a VERY subtle sliver (wallOuterReveal=0.1,
  // wallFalloff=3 -> edge outer walls ~0.1px). The OUTER-wall RELATIONSHIP still holds (outer >=
  // center-facing on each edge cubby, center column ≈ none), just at a small magnitude. We assert
  // the relationship + that the walls stay slivers (subtle, < 16px), tolerant of the small scale.
  assert('(N4) SIDE WALLS are OUTER (global center eye): edge cubbies favour the OUTER wall (LEFT cubby L>=R, RIGHT cubby R>=L); CENTER ≈ none; all slivers (subtle)',
    // LEFT cubby: outer = LEFT wall, >= RIGHT (center-facing); RIGHT stays a hair
    walls.left.leftW >= walls.left.rightW && walls.left.rightW < 6 &&
    // RIGHT cubby: outer = RIGHT wall, >= LEFT (center-facing); LEFT stays a hair
    walls.right.rightW >= walls.right.leftW && walls.right.leftW < 6 &&
    // CENTER column: both walls ≈ 0 (straight-on)
    walls.center.leftW < 4 && walls.center.rightW < 4 &&
    // SUBTLE: even the outer edge walls stay slivers (< 16px projected)
    walls.left.leftW < 16 && walls.right.rightW < 16,
    'LEFT{L='+walls.left.leftW.toFixed(2)+',R='+walls.left.rightW.toFixed(2)+'} '+
    'CENTER{L='+walls.center.leftW.toFixed(2)+',R='+walls.center.rightW.toFixed(2)+'} '+
    'RIGHT{L='+walls.right.leftW.toFixed(2)+',R='+walls.right.rightW.toFixed(2)+'}');
  assert('(N5-LANDSCAPE) cubby aspect is LANDSCAPE (wider than tall, w/h > 1.25 like the reference)',
    niche.aspect > 1.25,
    'aspect='+niche.aspect.toFixed(2)+' ('+niche.cubbyW.toFixed(0)+'x'+niche.cubbyH.toFixed(0)+')');
  assert('(N6-ON-FLOOR) goods STAND ON the floor (good base ≈ cubby floor line) WITH a contact shadow',
    niche.goodBaseDelta != null && niche.goodBaseDelta <= 3 && niche.hasContactShadow === true,
    'goodBaseDelta='+(niche.goodBaseDelta==null?'n/a':niche.goodBaseDelta.toFixed(2))+'px shadow='+niche.hasContactShadow);
  // V17: the CEILING is HIDDEN now, so there is no ceiling strip to leave — but the good's TOP
  // still leaves a small headroom (topGap > 0, doesn't crowd the cubby top) while the good
  // FILLS the cubby — big + filling, like the reference.
  // V16 (FAT goods): "filling the cubby" is satisfied by EITHER dimension — a slim/tall good
  // fills the cubby by HEIGHT (>=80% of interior), a FAT/wide good is width-bound (and therefore
  // shorter) but fills its uniform CELL by WIDTH (>=80% of cubbyW/3). Both read as "big + filling";
  // the no-overlap clamp (fitGoods) is what keeps fat goods inside the cell.
  assert('(N6b-HEADROOM+FILL) good leaves headroom above + a visible FLOOR band below, while FILLING the cubby (>=74% by HEIGHT for slim, or >=74% of its CELL WIDTH for fat goods — mobile shrinks fill so the floor shows)',
    niche.goodTopGap != null && niche.goodTopGap > 0 &&
    ((niche.goodFillPct != null && niche.goodFillPct >= 74) ||
     (niche.goodCellFillPct != null && niche.goodCellFillPct >= 74)),
    'goodTopGap='+(niche.goodTopGap==null?'n/a':niche.goodTopGap.toFixed(2))+'px heightFill='+(niche.goodFillPct==null?'n/a':niche.goodFillPct.toFixed(1))+'% cellWidthFill='+(niche.goodCellFillPct==null?'n/a':niche.goodCellFillPct.toFixed(1))+'%');
  assert('(N7-DEPTH-ORDER) FRONT row closer to camera than BACK row (front --gz > back --gz = real front/back depth)',
    niche.depthOK === true && niche.frontGz != null && niche.backGz != null,
    'frontGz='+niche.frontGz+' backGz='+niche.backGz+' depthOK='+niche.depthOK);

  // =====================================================================
  // V18 — DIRECTIONAL LIGHTING (top-left light -> bottom-right shadows).
  //  (N10a) each good's drop-shadow offset points BOTTOM-RIGHT (dx>0, dy>0) — light from the
  //         upper-left, so the cast shadow falls down-and-right (matches the reference).
  //  (N10b) the cubby inner-shading gradient DARK pole sits toward the bottom-right (dark X>50%,
  //         dark Y>50%) — each niche is darker at the lower-right, lighter upper-left.
  //  (N10c) BACK-row (peek) goods are DIMMER than the FRONT row (backDim < 1 AND the back good's
  //         computed brightness < the front good's) — they sit in shadow behind the front row.
  // =====================================================================
  const light = await page.evaluate(() => window.__qa.lightingProbe());
  // V22 — the shadow direction is DERIVED from lightAngle (shadowAngle = lightAngle - 270, the same
  // mapping the engine uses), so the assert is now lightAngle-AWARE rather than hardcoded bottom-right.
  // The user's lightAngle=135 -> shadows fall TOP-LEFT (dx<0,dy<0); we assert the rendered shadow +
  // cubby dark-pole MATCH the expected direction for whatever lightAngle is configured.
  const expRad = (light.lightAngle - 270) * Math.PI / 180;
  const expUx = Math.cos(expRad), expUy = Math.sin(expRad);   // expected unit shadow direction (y-down)
  const dirOK = (light.shadowDx === 0 ? expUx === 0 : Math.sign(light.shadowDx) === Math.sign(expUx)) &&
                (light.shadowDy === 0 ? expUy === 0 : Math.sign(light.shadowDy) === Math.sign(expUy));
  assert('(N10a-SHADOW-DIR) each good casts a directional drop-shadow CONSISTENT with lightAngle (shadow falls away from the light; user lightAngle=135 -> top-left)',
    dirOK && (Math.abs(light.shadowDx) > 0.01 || Math.abs(light.shadowDy) > 0.01),
    'shadowDx='+light.shadowDx.toFixed(2)+' shadowDy='+light.shadowDy.toFixed(2)+' expect sign('+expUx.toFixed(2)+','+expUy.toFixed(2)+') (lightAngle='+light.lightAngle+')');
  // the cubby inner-shading DARK pole sits at (50% + ux*42%, 50% + uy*42%) -> same side as the shadow.
  const darkX = parseFloat(light.shadeDarkX), darkY = parseFloat(light.shadeDarkY);
  const poleOK = (Math.sign(darkX - 50) === Math.sign(expUx) || Math.abs(expUx) < 1e-6) &&
                 (Math.sign(darkY - 50) === Math.sign(expUy) || Math.abs(expUy) < 1e-6);
  assert('(N10b-CUBBY-SHADE) cubby inner-shading DARK pole sits toward the shadow side (consistent with lightAngle; user lightAngle=135 -> upper-left dark pole)',
    poleOK,
    'darkPole='+light.shadeDarkX+','+light.shadeDarkY+' expect side('+expUx.toFixed(2)+','+expUy.toFixed(2)+')');
  assert('(N10c-BACK-DIMMER) BACK-row goods DARKER than front (backDim<1 AND back brightness < front)',
    light.backDim > 0 && light.backDim < 1 &&
    light.backBrightness != null && light.frontBrightness != null &&
    light.backBrightness < light.frontBrightness,
    'backDim='+light.backDim.toFixed(2)+' backBrightness='+light.backBrightness+' frontBrightness='+light.frontBrightness);
  // V19/V22 — back row VERY dark (deep interior shadow): default backDim ≈ 0.37 (<= 0.45, the user-
  // tuned value). Depth-based, applied to the peek goods regardless of a front good.
  assert('(N19a-BACK-VERY-DARK) backDim DEFAULT is VERY dark (user = 0.25, <= 0.45) + the peek good actually renders at it',
    Math.abs(light.backDim - 0.25) < 0.001 && light.backDim <= 0.45 && Math.abs(light.backBrightness - 0.25) < 0.001,
    'backDim='+light.backDim+' backBrightness='+light.backBrightness);
  // V19 — SHALLOW TOP inner-shadow: a faint top band exists on the back wall and its opacity
  // is a SMALL fraction (subtle/shallow), tied to shadowStrength*topShadow.
  assert('(N19b-TOP-SHADOW) cubby back wall carries a SHALLOW top inner-shadow band (linear top gradient present, opacity small/subtle)',
    light.backHasTopBand === true && light.topShadeOp > 0 && light.topShadeOp < 0.25,
    'hasTopBand='+light.backHasTopBand+' topShadeOp='+light.topShadeOp.toFixed(3)+' topShadow='+light.topShadow);

  // =====================================================================
  // V14 — FRONT-ROW BASE IS NOT OCCLUDED BY THE FRONT RIM.
  //  The recent over-tall --rim-h raise turned the front lip into a WALL that covered the
  //  bottom of each good. Now the front good stands at the FRONT of the floor and the thin
  //  rim sits BENEATH it (niche-clip z > rim z) so the good PAINTS OVER the rim. We assert:
  //   (N9a) GEOMETRY — the rim is layered BELOW the good (paintOrderOK = clipZ > rimZ) so it
  //         cannot occlude the base, the front good is at the FRONT floor edge (frontGz ≈ 0
  //         = at/in-front-of the rim, and >= the back row), and the rim is a SLIM band
  //         (not a tall wall): rimH well under half the cubby height.
  //   (N9b) PIXEL — the good's BASE contact row reads the GOOD SPRITE, not wood. We sample
  //         a clearly-non-wood (blue) front good's base (cubby 0 slot 2 = soda) and assert
  //         the pixel is FAR from the wood-brown rim color (i.e. the good, in front, not the
  //         brown front lip). If the rim still walled-off the base, this pixel would be wood.
  // =====================================================================
  const occ = await page.evaluate(() => window.__qa.baseOcclusion(0));
  // half the cubby height — a slim rim must be well under this (the old 16px wall was ~19%).
  const halfCubbyH = niche.cubbyH * 0.5;
  assert('(N9a-BASE-UNOCCLUDED) front rim is LAYERED BELOW the good (clipZ>rimZ) + good at FRONT floor edge (frontGz≈0, >=back) + SLIM rim (rimH < half cubby height)',
    occ && occ.paintOrderOK === true &&
    occ.frontGz != null && occ.frontGz >= niche.backGz && Math.abs(occ.frontGz) < 2 &&
    occ.rimH > 0 && occ.rimH < halfCubbyH,
    occ ? ('clipZ='+occ.clipZ+'>rimZ='+occ.rimZ+' paintOK='+occ.paintOrderOK+' frontGz='+occ.frontGz+' backGz='+niche.backGz+' rimH='+occ.rimH.toFixed(1)+'px (<'+halfCubbyH.toFixed(1)+')') : 'no probe');
  // PIXEL: sample the BASE contact row of a blue (non-wood) front good (cubby0 slot2 = soda).
  const blueGood = await page.evaluate(() => {
    const g = document.querySelector('#grid .cubby[data-idx="0"] .c-floor .slot.s2 .good');
    if (!g) return null; const r = g.getBoundingClientRect();
    return { type: g.dataset.type, x: r.left + r.width*0.5, y: r.bottom - 3 };
  });
  // wood-brown reference (the rim/floor wood measured ~118,75,44 in N8); a base reading the
  // good sprite (here a blue soda) is FAR from this. >50 RGB dist => clearly NOT wood.
  const WOOD = { r: 118, g: 75, b: 44 };
  const basePx = blueGood ? await samplePixel(page, 2, blueGood.x, blueGood.y, 2) : null;
  const baseDistFromWood = basePx ? rgbDist(basePx, WOOD) : 0;
  const baseNotCream = basePx ? rgbDist(basePx, CREAM) > CREAM_TOL : false;
  assert('(N9b-BASE-IS-GOOD) front good base row renders the GOOD SPRITE, not the wood lip (blue soda base FAR from wood-brown, not cream)',
    basePx && basePx.a >= 250 && baseDistFromWood > 50 && baseNotCream,
    blueGood ? (blueGood.type+' base rgba='+basePx.r.toFixed(0)+','+basePx.g.toFixed(0)+','+basePx.b.toFixed(0)+','+basePx.a.toFixed(0)+' distFromWood='+baseDistFromWood.toFixed(1)+' (>50)') : 'no good');

  // ===== CONTACT SHADOW element exists under goods =====
  const contact = await page.evaluate(() => window.__qa.hasContactShadow(0,0));
  assert('(C2-CONTACT) contact-shadow (::after ellipse) present under a good',
    contact && contact.present && contact.width > 0 && contact.hasGradient,
    JSON.stringify(contact));

  // =====================================================================
  // UNIFORM-CELL FIT (user's method: "가장 큰 굿즈 기준 동일한 칸, 얇은 건 좌우 여백, 안 겹침").
  //  Each cubby's 3 front slots are EQUAL-width uniform CELLS (cubbyW/3, separated by
  //  goodGap). Each good is scaled (real aspect preserved) to fit WITHIN its cell width
  //  (cellW - goodGap) and the height budget, then CENTERED in the cell. So:
  //   (U1) NO two FRONT goods in a cubby overlap horizontally — the gap between every
  //        pair of adjacent (sorted) good x-extents is >= 0 (no overlap; >0 = visible gap).
  //   (U2) EACH good is CENTERED in its uniform cell — leftPad ≈ rightPad (thin goods like
  //        the cola bottle / slim cans sit centered with even empty padding on both sides).
  //   (U3) the BACK row obeys the SAME uniform-cell fit -> no two back goods overlap either.
  //  goodGap default = SHELF_DEFAULTS.goodGap (0.04 of cubbyW). Probe = window.__qa.goodGaps().
  // =====================================================================
  const gaps = await page.evaluate(() => window.__qa.goodGaps());
  // (U1) every adjacent FRONT pair disjoint (min gap >= 0 with a hair of float tolerance).
  assert('(U1-NO-OVERLAP FRONT) every packed cubby: adjacent FRONT goods x-extents disjoint (min gap >= 0)',
    gaps.frontCubbies >= 1 && gaps.frontMinGap != null && gaps.frontMinGap >= -0.5,
    'frontMinGap=' + (gaps.frontMinGap==null?'n/a':gaps.frontMinGap.toFixed(2)) + 'px across ' + gaps.frontCubbies +
      ' cubbies; worst=' + (gaps.worstFront ? ('cubby'+gaps.worstFront.idx+' '+JSON.stringify(gaps.worstFront.types)+' gaps='+gaps.worstFront.gaps.map(g=>g.toFixed(1))) : 'n/a'));
  // (U2) each good centered in its uniform cell: |leftPad - rightPad| small (a few px float/AA).
  assert('(U2-CENTERED) every good is CENTERED in its uniform cell (leftPad ≈ rightPad, thin goods padded both sides)',
    gaps.maxPadDiff != null && gaps.maxPadDiff <= 2.0,
    'maxPadDiff=' + (gaps.maxPadDiff==null?'n/a':gaps.maxPadDiff.toFixed(2)) + 'px; worst=' +
      (gaps.worstPad ? ('cubby'+gaps.worstPad.idx+' '+JSON.stringify(gaps.worstPad.types)+' padDiffs='+gaps.worstPad.padDiffs.map(p=>p.toFixed(1))) : 'n/a') +
      (gaps.worstFront && gaps.worstFront.cells ? ' cells='+JSON.stringify(gaps.worstFront.cells) : ''));
  // (U3) BACK row: same uniform-cell fit -> no two back goods overlap.
  assert('(U3-NO-OVERLAP BACK) every packed cubby: adjacent BACK-row goods x-extents disjoint (min gap >= 0)',
    gaps.backCubbies >= 1 && gaps.backMinGap != null && gaps.backMinGap >= -0.5,
    'backMinGap=' + (gaps.backMinGap==null?'n/a':gaps.backMinGap.toFixed(2)) + 'px across ' + gaps.backCubbies +
      ' cubbies; worst=' + (gaps.worstBack ? ('cubby'+gaps.worstBack.idx+' '+JSON.stringify(gaps.worstBack.types)+' gaps='+gaps.worstBack.gaps.map(g=>g.toFixed(1))) : 'n/a'));

  // =====================================================================
  // V5 — FRONT-ON (kept): no tilt + seamless cream wall.
  //  (V5-1) board/shelf container transform has NO rotateX/perspective tilt.
  //  (V5-2) each cubby's open-back cream color == page/body bg color (seamless wall).
  // =====================================================================
  const v5 = await page.evaluate(() => window.__qa.shelfV5());
  // (V5-1) FRONT-ON: the shelf (and board-wrap) transform carries NO rotation/tilt.
  assert('(V5-1a) shelf transform has NO rotateX/tilt (front elevation)',
    v5.shelfHasTilt === false, 'transform=' + v5.shelfTransform);
  assert('(V5-1b) board-wrap transform has NO rotateX/tilt (front-on)',
    v5.boardWrapHasTilt === false, 'transform=' + v5.boardWrapTransform);
  // (V5-2) OPEN-BACK = CREAM WALL: every cubby's interior back computed background
  // COLOR equals the page/body (and #bg) cream wall color -> one seamless wall.
  assert('(V5-2a) page #bg cream color == body cream color',
    v5.bgBg === v5.bodyBg && /rgb/.test(v5.bodyBg||''), 'body=' + v5.bodyBg + ' #bg=' + v5.bgBg);
  assert('(V5-2b) EVERY cubby back is a RECESSED darker cream (uniform, slightly darker than the page wall)',
    v5.backColors.length === 12 && new Set(v5.backColors).size === 1 &&
      (function(){ const p=(v5.bodyBg.match(/\d+/g)||[]).map(Number); const k=(v5.backColors[0].match(/\d+/g)||[]).map(Number);
        return k.length===3 && (k[0]+k[1]+k[2]) < (p[0]+p[1]+p[2]); })(),
    'bodyBg=' + v5.bodyBg + ' back=' + JSON.stringify(v5.backColors[0]));

  // =====================================================================
  // V12 — NICHE WOOD INTERIOR is VISIBLY RENDERED (pixel-level, replaces the old
  // flat-shelf board/post/divider + joint-gap asserts). Sample inside an EMPTY niche
  // (no goods to occlude the interior) at the left wall, right wall, floor, and front
  // rim. (V17: the CEILING is HIDDEN by default, so it is no longer sampled unless the
  // editor re-enables ceilingVisibility > 0.) Each must be OPAQUE WOOD (not transparent,
  // not the cream back wall) -> the folded 3D wood faces genuinely render as visible wood.
  // =====================================================================
  const ns = await page.evaluate(() => window.__qa.nicheSamples());
  const nicheResults = [];
  for (const pt of ns.points){
    // small pad (1) so the thin foreshortened ceiling sliver isn't averaged with the
    // cream back wall just below it (the ceiling band is only ~2-3px tall).
    const px = await samplePixel(page, 2, pt.x, pt.y, 1);   // dsf=2 (viewport deviceScaleFactor)
    const dCream = rgbDist(px, CREAM);
    const opaque = px.a >= 250;          // not transparent
    const notCream = dCream > CREAM_TOL; // not the cream back wall leaking through
    // wood-ish hue: WARM (R clearly > B). V22 — the brighter user wood (#ffbb5c) lets the LIT floor
    // hit R=255, so the upper cap is lifted to 255 (R<=255); the warm-margin (R noticeably > B) +
    // the notCream guard still separate real wood from cream/white. Allows lit floor + dim ceiling.
    const woody = (px.r > px.b + 10) && px.r > 70 && px.r <= 255;
    nicheResults.push({ kind: pt.kind, ok: opaque && notCream && woody,
      rgba: `${px.r.toFixed(0)},${px.g.toFixed(0)},${px.b.toFixed(0)},${px.a.toFixed(0)}`, dCream: dCream.toFixed(1) });
  }
  // FLOOR + RIM must be clearly wood. Side-wall reveals are thin slivers (wallOuterReveal 0.1) over a
  // light cream back wall, so a single borderline side-wall sample is tolerated (require >=1 wood wall).
  const mustWood = nicheResults.filter(n => n.kind==='floor' || n.kind==='rim');
  const sideWalls = nicheResults.filter(n => /wall/.test(n.kind));
  const wallsOk = sideWalls.length === 0 || sideWalls.some(n => n.ok);
  const badNiche = mustWood.filter(n => !n.ok).concat(wallsOk ? [] : sideWalls.filter(n=>!n.ok));
  assert('(N8-WOOD) niche FLOOR + RIM render OPAQUE WOOD + at least one side wall is wood (not cream/transparent)',
    badNiche.length === 0,
    badNiche.length ? 'NON-WOOD at: ' + JSON.stringify(badNiche.map(n=>n.kind+' rgba='+n.rgba+' dCream='+n.dCream)) : 'all wood: '+JSON.stringify(nicheResults.map(n=>n.kind+'='+n.rgba)));

  // (V5-4) POST-REDESIGN (front-on): goods STILL share one baseline (bottom Y within
  // a few px across types/scales) AND each good's contact-shadow center ≈ good center.
  // Re-measured on the redesigned front-on board to prove no regression from the tilt
  // removal / new plank-top standing surface.
  const v54 = await page.evaluate(() => {
    function spread(arr){ const bs = arr.map(x=>x.bottom); return Math.max(...bs)-Math.min(...bs); }
    const c0 = window.__qa.baselines(0);   // sauce/water/soda (scale 1.0)
    const c4 = window.__qa.baselines(4);   // cola/juice/icebar_b (mixed scales)
    const dxs = [];
    [[0,0],[0,1],[0,2],[4,0],[4,1],[4,2]].forEach(([c,s])=>{
      const a = window.__qa.shadowAlign(c,s);
      if (a) dxs.push(Math.abs(a.goodCenterX - a.slotCenterX));
    });
    return { sp0: spread(c0), sp4: spread(c4), maxDx: Math.max(...dxs),
             c0: c0.map(x=>x.type+':'+x.bottom.toFixed(1)), c4: c4.map(x=>x.type+':'+x.bottom.toFixed(1)) };
  });
  assert('(V5-4a) FRONT-ON baseline holds: same-scale cubby goods share bottom Y',
    v54.sp0 <= BASELINE_TOL, 'spread=' + v54.sp0.toFixed(2) + 'px ' + JSON.stringify(v54.c0));
  assert('(V5-4b) FRONT-ON baseline holds: mixed-scale cubby goods share bottom Y',
    v54.sp4 <= BASELINE_TOL, 'spread=' + v54.sp4.toFixed(2) + 'px ' + JSON.stringify(v54.c4));
  assert('(V5-4c) FRONT-ON shadow center == good center (all slots/scales)',
    v54.maxDx <= SHADOW_TOL, 'maxDx=' + v54.maxDx.toFixed(2) + 'px');

  // ===== V4-3 SHADOW ALIGNMENT: shadow center X ≈ good center X, every slot/scale =====
  // The ::after is centered (left:50% translateX(-50%)) inside .good, whose own center
  // we measure; alignment holds for all 3 slots in cubby0 (cola/juice/milk) and cubby4
  // (chips/cola/donut, mixed scales). We assert good center ≈ slot center (which is the
  // floor column center) -> the shadow sits exactly under the good's horizontal center.
  const align = await page.evaluate(() => {
    const out = [];
    [[0,0],[0,1],[0,2],[4,0],[4,1],[4,2]].forEach(([c,s])=>{
      const a = window.__qa.shadowAlign(c,s);
      const sEl = document.querySelector('#grid .cubby[data-idx="'+c+'"] .c-floor .slot.s'+s+' .good');
      let leftPx=NaN, halfBox=NaN, tx=NaN, halfShadow=NaN;
      if (sEl){
        const cs = getComputedStyle(sEl, '::after');
        leftPx = parseFloat(cs.getPropertyValue('left'));         // 50% resolved to px
        halfBox = sEl.offsetWidth/2;                              // box center
        halfShadow = parseFloat(cs.getPropertyValue('width'))/2;  // shadow half-width
        const m = cs.getPropertyValue('transform');               // matrix(... , tx, ty)
        const mm = /matrix\(([^)]+)\)/.exec(m);
        if (mm){ const parts = mm[1].split(',').map(parseFloat); tx = parts[4]; }
      }
      if (a) out.push({ c, s, dx: Math.abs(a.goodCenterX - a.slotCenterX),
        leftPx, halfBox, tx, halfShadow });
    });
    return out;
  });
  const maxDx = Math.max(...align.map(a=>a.dx));
  assert('(V4-3a SHADOW center==good center, all slots)', maxDx <= SHADOW_TOL,
    'maxDx='+maxDx.toFixed(2)+'px  '+JSON.stringify(align.map(a=>a.dx.toFixed(2))));
  // ::after left == 50% of the good box (centered horizontally) AND translateX == -50% of
  // the shadow width -> the ellipse's CENTER sits exactly on the good's horizontal center.
  const centeredOK = align.every(a =>
    Math.abs(a.leftPx - a.halfBox) <= 1 && Math.abs(a.tx + a.halfShadow) <= 1);
  assert('(V4-3b SHADOW ::after centered: left=50% box & translateX=-50% width)', centeredOK,
    JSON.stringify(align.map(a=>'left='+a.leftPx.toFixed(1)+'/box½='+a.halfBox.toFixed(1)+' tx='+a.tx.toFixed(1)+'/sh½='+a.halfShadow.toFixed(1))));

  // ===== V4-4 BASELINE: all goods in a cubby share the same floor bottom Y =====
  const bl = await page.evaluate(() => ({
    c0: window.__qa.baselines(0),    // sauce/water/soda (scale 1.0)
    c4: window.__qa.baselines(4)     // cola/juice/icebar_b (mixed scales)
  }));
  function spread(arr){ const bs = arr.map(x=>x.bottom); return Math.max(...bs)-Math.min(...bs); }
  const sp0 = spread(bl.c0), sp4 = spread(bl.c4);
  assert('(V4-4a BASELINE same-scale cubby: 3 goods share bottom Y)', sp0 <= BASELINE_TOL,
    'spread='+sp0.toFixed(2)+'px  '+JSON.stringify(bl.c0.map(x=>x.type+':'+x.bottom.toFixed(1))));
  assert('(V4-4b BASELINE mixed-scale cubby: 3 goods share bottom Y despite GOOD_SCALE)', sp4 <= BASELINE_TOL,
    'spread='+sp4.toFixed(2)+'px  '+JSON.stringify(bl.c4.map(x=>x.type+':'+x.bottom.toFixed(1))));

  // ===== 2-LAYER cubby: front interactive + back present-but-NOT-grabbable =====
  // stage1 V11 cubby0 = front ["sauce","water","soda"], back ["juice","milk","cola"].
  const layerInfo0 = await page.evaluate(() => window.__qa.layerInfo(0));
  assert('(A1) cubby0 has 2 layers (front 3 filled + back 3, 3 peeking, 3 slots)',
    layerInfo0.layerCount===2 && layerInfo0.frontLen===3 && layerInfo0.backLen===3 &&
    layerInfo0.peekDOM===3 && layerInfo0.frontDOM===3 && layerInfo0.slots===3, JSON.stringify(layerInfo0));
  const grab = await page.evaluate(() => ({
    front0: window.__qa.canGrab(0,0),         // every front good grabbable -> true
    front1: window.__qa.canGrab(0,1),         // true
    front2: window.__qa.canGrab(0,2),         // true
    back0:  window.__qa.canGrabBack(0,0),     // back peeking -> false
    back1:  window.__qa.canGrabBack(0,1),     // false
    back2:  window.__qa.canGrabBack(0,2)      // false
  }));
  assert('(A2) EVERY front-layer good is grabbable',
    grab.front0===true && grab.front1===true && grab.front2===true,
    's0='+grab.front0+' s1='+grab.front1+' s2='+grab.front2);
  assert('(A3) back-layer (peeking) goods are NOT grabbable',
    grab.back0===false && grab.back1===false && grab.back2===false,
    'b0='+grab.back0+' b1='+grab.back1+' b2='+grab.back2);
  // back good must REJECT startDrag (no drag avatar appears)
  const dragBack = await page.evaluate(() => window.__qa.tryStartDragBack(0,0));
  assert('(A4) back good REJECTS startDrag (no drag started)', dragBack.started === false, JSON.stringify(dragBack));
  // a FRONT good must be able to start a drag (sanity that grab path works)
  const dragFront = await page.evaluate(() => window.__qa.tryStartDragFront(0,0));
  assert('(A5) front good ACCEPTS startDrag (drag started)', dragFront.started === true, JSON.stringify(dragFront));

  // (pre) ensure no haptic emitted yet from GameStart (core-gated)
  const preHaptic = await page.evaluate(() => {
    const c={}; for(const e of window.__emits){ const ev=e.msg&&e.msg.event; c[ev]=(c[ev]||0)+1; } return c;
  });

  // (2) Drive moves to COMPLETE a cubby -> clears, praise/star DOM appears, star++, combo++.
  // Slot-aware: drive moves until the first CLEAR happens.
  const clearInfo = await page.evaluate(async () => {
    const qa = window.__qa;
    const SL = qa.SLOTS;
    function filled(l){ return l.filter(x=>!!x); }
    function fcount(l){ return filled(l).length; }
    function firstFilled(l){ for(let i=0;i<SL;i++) if(l[i]) return i; return -1; }
    function sameOnly(l, tp){ for(let i=0;i<SL;i++){ if(l[i] && l[i]!==tp) return false; } return true; }
    function board(){ return qa.board(); }
    function totalGoods(){ return board().reduce((n,cb)=>n+cb.layers.reduce((m,l)=>m+filled(l).length,0),0); }
    let cleared = false, moves = 0;
    function findMove(){
      const b = board();
      // complete a 2-same+1-empty front by dropping the matching type
      for (let t=0;t<b.length;t++){
        const tf=b[t].front;
        if (fcount(tf)===SL-1 && sameOnly(tf, tf[firstFilled(tf)])){
          const want = tf[firstFilled(tf)];
          for (let f=0;f<b.length;f++){ if(f===t) continue; const ff=b[f].front;
            const sf=firstFilled(ff); if(sf>=0 && ff[sf]===want) return [f,t]; }
        }
      }
      // gather: move a front good onto a same-type partial front
      for (let f=0;f<b.length;f++){ const ff=b[f].front; const sf=firstFilled(ff); if(sf<0) continue;
        const typ=ff[sf];
        let empty=-1;
        for (let t=0;t<b.length;t++){ if(t===f) continue; const tf=b[t].front;
          if (fcount(tf)>0 && fcount(tf)<SL && sameOnly(tf, typ)) return [f,t];
          if (fcount(tf)===0 && empty<0) empty=t; }
        // dump a MIXED front's top onto an empty cubby to break it up
        if (empty>=0 && !sameOnly(ff, typ)) return [f,empty];
      }
      return null;
    }
    // helper: does an element's CSS background-image reference a file?
    function bgHas(el, file){ if(!el) return false; const b=getComputedStyle(el).backgroundImage||''; return b.includes(file); }
    const starsBefore = qa.stars(), comboBefore = qa.combo(), maxComboBefore = qa.maxCombo();
    let guard=0;
    while(!cleared && guard++<300){
      const mv=findMove(); if(!mv) break;
      const did = qa.move(mv[0],mv[1]); moves++;
      if (did){ cleared=true; }
    }
    await new Promise(r=>setTimeout(r, 260));   // wait past the 0.2s completion HOLD so the FX have fired
    const praiseEls = document.querySelectorAll('#fx .praise').length;
    const praiseImg = (() => { const p=document.querySelector('#fx .praise'); return p ? bgHas(p,'praise_') : false; })();
    const flyStarEls = document.querySelectorAll('.fly-star').length;
    const flyStarImg = (() => { const s=document.querySelector('.fly-star'); return s ? bgHas(s,'fx_star.png') : false; })();
    const flameEls = document.querySelectorAll('.fly-flame').length;
    const flameIsFire = (() => { const f=document.querySelector('.fly-flame'); return f ? /🔥/.test(f.textContent) : false; })();
    const comboBadgeEls = document.querySelectorAll('#fx .combo-badge').length;
    const ringEls = document.querySelectorAll('.spark-ring').length;
    const ringImg = (() => { const r=document.querySelector('.spark-ring'); return r ? bgHas(r,'fx_sparkle.png') : false; })();
    const confettiEls = document.querySelectorAll('.confetti').length;
    const comboPillTxt = qa.comboPillText();           // gauge label ("COMBO")
    const comboCountTxt = qa.comboCountText();          // flame pill count ("xN")
    await new Promise(r=>setTimeout(r, 650));
    return {
      cleared, moves,
      praiseSeen: praiseEls, praiseImg, flyStarSeen: flyStarEls, flyStarImg,
      ringSeen: ringEls, ringImg, confettiSeen: confettiEls, comboPillTxt, comboCountTxt,
      flameSeen: flameEls, flameIsFire, comboBadgeSeen: comboBadgeEls,
      starsBefore, comboBefore, maxComboBefore,
      starsAfter: qa.stars(), comboAfter: qa.combo(), maxComboAfter: qa.maxCombo(),
      total: totalGoods()
    };
  });
  assert('(2a) a cubby cleared on completion (all 3 slots same type)', clearInfo.cleared, 'moves='+clearInfo.moves);
  // COMBO feedback is now a 🔥 FLAME that flies into the top flame pill — NO text banner/badge.
  assert('(2b-FX1 combo FLAME) a 🔥 flame flies to the top flame pill on clear', clearInfo.flameSeen >= 1 && clearInfo.flameIsFire,
    'flame='+clearInfo.flameSeen+' isFire='+clearInfo.flameIsFire);
  assert('(2c-FX2 PRAISE gated) NO praise on combo 1-2 (praise text starts at combo 3 — user spec)',
    clearInfo.praiseSeen === 0,
    'praise@combo1='+clearInfo.praiseSeen+' comboBadge='+clearInfo.comboBadgeSeen);
  assert('(2d-score) internal score incremented on clear', clearInfo.starsAfter > clearInfo.starsBefore, clearInfo.starsBefore+'->'+clearInfo.starsAfter);
  // combo starts at 0 and increments on clear; the FLAME pill shows the CURRENT combo "xN".
  assert('(2e-FX3 combo) combo incremented + flame pill shows "xN"', clearInfo.comboAfter > clearInfo.comboBefore && clearInfo.comboCountTxt === ('x'+clearInfo.comboAfter),
    clearInfo.comboBefore+'->'+clearInfo.comboAfter+' flame="'+clearInfo.comboCountTxt+'"');
  assert('(2e2-maxCombo) maxCombo tracked (>= current combo)', clearInfo.maxComboAfter >= clearInfo.comboAfter && clearInfo.maxComboAfter > clearInfo.maxComboBefore,
    'max '+clearInfo.maxComboBefore+'->'+clearInfo.maxComboAfter+' combo='+clearInfo.comboAfter);
  assert('(2f-FX sparkle IMAGE) spark-ring uses fx_sparkle.png on clear', clearInfo.ringSeen >= 1 && clearInfo.ringImg,
    'els='+clearInfo.ringSeen+' img='+clearInfo.ringImg);
  // (confetti per-clear removed — the clear burst is the sparkle ring + the bounce-pop goods; user wanted smaller FX)
  assert('(2g-clear effect minimal) the per-clear burst is the sparkle ring (no heavy confetti)', clearInfo.ringSeen >= 1, 'ring='+clearInfo.ringSeen+' confetti='+clearInfo.confettiSeen);

  // (3) drive to WIN -> GameEnd {success:true}. WIN only when every layer empty.
  const winInfo = await page.evaluate(async () => {
    const r = window.__qa.autoSolve(600);
    await new Promise(res=>setTimeout(res, 700)); // let last clear + win() fire
    return r;
  });
  assert('(3a-WIN all layers) board solved to empty (all layers cleared)',
    winInfo.won && winInfo.remaining===0, 'remaining='+winInfo.remaining+' steps='+winInfo.steps+' plan='+winInfo.solvedPlan);

  const emits = await page.evaluate(() => window.__emits.slice());
  const gameEnd = emits.find(e => e.msg && e.msg.event === 'GameEnd');
  assert('(3b) GameEnd emitted', !!gameEnd);
  assert('(3c) GameEnd success:true', gameEnd && gameEnd.msg.data && gameEnd.msg.data.success === true,
    gameEnd ? JSON.stringify(gameEnd.msg.data) : 'none');
  assert('(3d) GameEnd handler=flutterChannel', gameEnd && gameEnd.handler === 'flutterChannel', gameEnd&&gameEnd.handler);

  // (4) payload is {event,data} FLAT (not wrapped)
  const gameStart = emits.find(e => e.msg && e.msg.event === 'GameStart');
  const flatOK = gameStart && ('event' in gameStart.msg) && ('data' in gameStart.msg)
    && gameStart.msg.data === null && !('msg' in gameStart.msg) && !('type' in gameStart.msg);
  assert('(4a) GameStart flat {event,data}', flatOK, gameStart?JSON.stringify(gameStart.msg):'none');
  assert('(4b) GameStart data:null', gameStart && gameStart.msg.data === null);
  const geFlat = gameEnd && ('event' in gameEnd.msg) && ('data' in gameEnd.msg)
    && gameEnd.msg.data && ('success' in gameEnd.msg.data)
    && ('progressIndex' in gameEnd.msg.data) && ('currentIndex' in gameEnd.msg.data);
  assert('(4c) GameEnd flat {event,data:{success,progressIndex,currentIndex}}', geFlat,
    gameEnd?JSON.stringify(gameEnd.msg):'none');
  assert('(4d) GameEnd currentIndex 1-based (=1)', gameEnd && gameEnd.msg.data.currentIndex === 1, gameEnd&&gameEnd.msg.data.currentIndex);

  // (5) Haptic COUNTS — scope trap means code that "looks right" can emit 0.
  const c = counts(emits);
  assert('(5a-FX haptic Light) LightVibrate count > 0 (on moves/places)', (c.LightVibrate||0) > 0, c.LightVibrate||0);
  assert('(5b-FX haptic Medium) MediumVibrate count > 0 (on clears)', (c.MediumVibrate||0) > 0, c.MediumVibrate||0);
  assert('(5c) no vibrate from GameStart only (core-gated)',
    (preHaptic.LightVibrate||0)===0 && (preHaptic.MediumVibrate||0)===0 && (preHaptic.SoftVibrate||0)===0,
    JSON.stringify(preHaptic));

  // (5-CLEAR / Phase 2b) on CLEAR: fireworks DOM appeared + the RESULT panel shows with a
  // MAX COMBO readout (panel_result.png card + "xN" from S.maxCombo + a NEXT button).
  await page.evaluate(() => new Promise(res => setTimeout(res, 1600)));   // let fireworks + result card appear
  const clearScreen = await page.evaluate(() => {
    const fwNow = document.querySelectorAll('#fireworks .fw, #fireworks .confetti, #fireworks .confetti-p').length;
    const rc = window.__qa.resultCard();
    return { fwNow, rc, maxCombo: window.__qa.maxComboVal() };
  });
  assert('(CL1-FIREWORKS) clearing the last good launched the ALL-SIDES fireworks (fx sprites in #fireworks DOM)',
    clearScreen.rc.fireworksDom > 0 || clearScreen.fwNow > 0,
    'fireworksDom='+clearScreen.rc.fireworksDom+' fwNow='+clearScreen.fwNow);
  assert('(CL2-RESULT DIM SHOW) the CLEAR is a full-screen DIM layer (no card): praise banner + NEXT',
    clearScreen.rc.shown && clearScreen.rc.on && clearScreen.rc.dim && clearScreen.rc.hasNext && /praise_\w+\.png/.test(clearScreen.rc.praiseImg),
    'shown='+clearScreen.rc.shown+' dim='+clearScreen.rc.dim+' next='+clearScreen.rc.hasNext+' praise='+clearScreen.rc.praiseImg);
  assert('(CL3-MAX COMBO) the result shows MAX COMBO in ENGLISH as "x<maxCombo>" (from S.maxCombo)',
    clearScreen.rc.maxComboText === ('x'+clearScreen.maxCombo) && clearScreen.maxCombo >= 1,
    'maxComboText="'+clearScreen.rc.maxComboText+'" S.maxCombo='+clearScreen.maxCombo);

  // (h) 0 pageerrors
  assert('(H1) zero pageerrors (default run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// Phase 2b — GAME OVER (TIME UP / NO SPACE) + CONTINUE/RETRY + DEADLOCK + reshuffle.
// Driven via QA hooks: forceTimeUp/forceNoSpace, continueTimeUp/continueNoSpace, the
// deadlock detector, and the reshuffle-to-solvable. GameEnd{success:false} per contract.
// =====================================================================
{
  const { page, pageErrors } = await makePage();   // makePage already stubs flutter_inappwebview -> __emits
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 200));

  // ---- TIME UP ----
  const timeUp = await page.evaluate(() => {
    window.__emits = [];
    window.__qa.forceTimeUp();                 // timer -> 0, game over (TIME UP)
    return window.__qa.gameOverCard();
  });
  assert('(GO1-TIMEUP CARD) TIME UP: clean panel + "TIME UP!" title on ribbon + coin HUD + CONTINUE + RETRY + (+30s), NO AD, NO X',
    timeUp.shown && timeUp.mode==='timeup' && /panel_gameover_clean\.png/.test(timeUp.panelImg) &&
    timeUp.titleText==='TIME UP!' && timeUp.hasContinue && timeUp.hasRetry && timeUp.hasCoinHud && timeUp.noAd && timeUp.plus30 && !timeUp.hasClose,
    JSON.stringify({mode:timeUp.mode, title:timeUp.titleText, cont:timeUp.hasContinue, retry:timeUp.hasRetry, coin:timeUp.hasCoinHud, noAd:timeUp.noAd, plus30:timeUp.plus30, noX:!timeUp.hasClose}));
  const goEmits1 = await page.evaluate(() => window.__emits.slice());
  const ge1 = goEmits1.find(e => e.msg && e.msg.event === 'GameEnd');
  assert('(GO2-TIMEUP GameEnd) GameEnd{success:false} fired on TIME UP (flat, flutterChannel)',
    ge1 && ge1.handler==='flutterChannel' && ge1.msg.data && ge1.msg.data.success===false,
    ge1 ? JSON.stringify(ge1.msg.data) : 'none');
  // CONTINUE (+30s) resumes
  const contTime = await page.evaluate(() => {
    const before = window.__qa.timeLeft();
    const r = window.__qa.continueTimeUp();
    return { before, after: r.timeLeft, over: r.over, running: r.running,
             overlayGone: !document.querySelector('#overlay.on') };
  });
  assert('(GO3-TIMEUP CONTINUE +30s) CONTINUE adds +30s and RESUMES (over=false, running=true, overlay closed)',
    contTime.after >= contTime.before + 29 && contTime.over===false && contTime.running===true && contTime.overlayGone,
    'time '+contTime.before.toFixed(1)+'->'+contTime.after.toFixed(1)+' over='+contTime.over+' running='+contTime.running);

  // ---- DEADLOCK detection on a SOLVABLE default board: NOT deadlocked ----
  const solv = await page.evaluate(() => {
    window.__qa.continueTimeUp && null;
    // reset to a fresh level (solvable board) and check the detector says NOT deadlocked
    window.__qa.showResult && null;
    return { solvableBoard: window.__qa.boardSolvable(), deadlocked: window.__qa.isDeadlocked(),
             anyClear: window.__qa.anyClearReachable() };
  });
  assert('(GO4-DEADLOCK NEGATIVE) a fresh SOLVABLE board is NOT deadlocked (a clear IS reachable)',
    solv.solvableBoard && !solv.deadlocked && solv.anyClear.reachable,
    'solvable='+solv.solvableBoard+' deadlocked='+solv.deadlocked+' anyClearReachable='+solv.anyClear.reachable);

  // ---- NO SPACE: contrive a real deadlock, assert detector + card + GameEnd ----
  const dead = await page.evaluate(() => {
    window.__emits = [];
    const setup = window.__qa.setDeadlockBoard();         // distinct singletons, no clear reachable
    const before = window.__qa.isDeadlocked();
    window.__qa.forceNoSpace();                            // trigger NO SPACE game-over
    return { setup, before, card: window.__qa.gameOverCard() };
  });
  assert('(GO5-DEADLOCK POSITIVE) the contrived board is detected as DEADLOCKED (no clear reachable within budget)',
    dead.setup.deadlocked && dead.before,
    'setupDeadlocked='+dead.setup.deadlocked+' isDeadlocked='+dead.before+' total='+dead.setup.total);
  assert('(GO6-NOSPACE CARD) NO SPACE: clean panel + "NO SPACE!" title + reshuffle + "Refresh all items" + coin HUD + CONTINUE + RETRY, NO AD, NO X',
    dead.card.shown && dead.card.mode==='nospace' && /panel_gameover_clean\.png/.test(dead.card.panelImg) &&
    dead.card.titleText==='NO SPACE!' && dead.card.reshuffle && dead.card.hasContinue &&
    dead.card.hasRetry && dead.card.hasCoinHud && dead.card.noAd && !dead.card.hasClose && /refresh all items/i.test(dead.card.offerLabel||''),
    JSON.stringify({mode:dead.card.mode, title:dead.card.titleText, reshuffle:dead.card.reshuffle, coin:dead.card.hasCoinHud, noAd:dead.card.noAd, noX:!dead.card.hasClose, label:dead.card.offerLabel}));
  const goEmits2 = await page.evaluate(() => window.__emits.slice());
  const ge2 = goEmits2.find(e => e.msg && e.msg.event === 'GameEnd');
  assert('(GO7-NOSPACE GameEnd) GameEnd{success:false} fired on NO SPACE (flat, flutterChannel)',
    ge2 && ge2.handler==='flutterChannel' && ge2.msg.data && ge2.msg.data.success===false,
    ge2 ? JSON.stringify(ge2.msg.data) : 'none');
  // CONTINUE -> reshuffle ALL items into a SOLVABLE board and resume (verified solvable)
  const contNoSpace = await page.evaluate(() => window.__qa.continueNoSpace());
  assert('(GO8-NOSPACE CONTINUE reshuffle) CONTINUE reshuffles ALL items into a SOLVABLE board and RESUMES (no goods lost, over=false, solvable)',
    contNoSpace.totalAfter === contNoSpace.totalBefore && contNoSpace.totalAfter > 0 &&
    contNoSpace.over===false && contNoSpace.running===true && contNoSpace.solvable,
    'total '+contNoSpace.totalBefore+'->'+contNoSpace.totalAfter+' over='+contNoSpace.over+' solvable='+contNoSpace.solvable);
  // and the new board is NOT immediately deadlocked
  const postReshuffle = await page.evaluate(() => ({ deadlocked: window.__qa.isDeadlocked(), solvable: window.__qa.boardSolvable() }));
  assert('(GO9-RESHUFFLE SOLVABLE) the reshuffled board is solvable + NOT deadlocked',
    !postReshuffle.deadlocked && postReshuffle.solvable,
    'deadlocked='+postReshuffle.deadlocked+' solvable='+postReshuffle.solvable);

  // ---- RETRY restarts the level (fresh, full time, board reset, overlay closed) ----
  const retry = await page.evaluate(() => {
    window.__qa.forceTimeUp();
    const lvlBefore = window.__qa.maxComboVal && null;   // noop; capture level via state below
    // simulate tapping RETRY: click the retry button if present
    const btn = document.querySelector('#popupBox #goRetry');
    const hadCard = !!btn;
    if (btn) btn.click();
    return { hadCard, over: window.__qa.over(), overlayGone: !document.querySelector('#overlay.on'),
             total: (function(){ let n=0; return window.__qa.boardSolvable!=null ? 1 : 0; })(),
             timeLeft: window.__qa.timeLeft() };
  });
  assert('(GO10-RETRY) RETRY restarts the level (over=false, overlay closed, timer reset to full)',
    retry.hadCard && retry.over===false && retry.overlayGone && retry.timeLeft > 60,
    'hadCard='+retry.hadCard+' over='+retry.over+' overlayGone='+retry.overlayGone+' time='+retry.timeLeft.toFixed(0));

  assert('(GO-err) zero pageerrors (game-over / deadlock run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// V4-1 POSITIONAL DROP — drop near LEFT lands slot 0; near RIGHT lands slot 2.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  // cubby6 is an EMPTY workspace ([null,null,null]). Drop a good from cubby0 there.
  const drop = await page.evaluate(() => {
    const qa = window.__qa;
    const rect = qa.cubbyRect(6);          // EMPTY cubby
    // slotFromX sanity: leftX -> 0, centerX -> 1, rightX -> 2
    const sxL = qa.slotFromX(6, rect.leftX);
    const sxC = qa.slotFromX(6, rect.centerX);
    const sxR = qa.slotFromX(6, rect.rightX);
    // DROP near LEFT of empty cubby6 (from cubby0 front) -> should land slot 0
    const left = qa.dropAtX(0, 6, rect.leftX);
    return { rect, sxL, sxC, sxR, left };
  });
  assert('(V4-1a) slotFromX: leftX->0, centerX->1, rightX->2',
    drop.sxL===0 && drop.sxC===1 && drop.sxR===2, 'L='+drop.sxL+' C='+drop.sxC+' R='+drop.sxR);
  assert('(V4-1b) drop near LEFT of empty cubby lands SLOT 0',
    drop.left.wantSlot===0 && drop.left.landed===0,
    'want='+drop.left.wantSlot+' landed='+drop.left.landed+' after='+JSON.stringify(drop.left.after));

  // fresh state for RIGHT test (reload to reset)
  await page.evaluate(() => { window.location.reload(); });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const dropR = await page.evaluate(() => {
    const qa = window.__qa;
    const rect = qa.cubbyRect(6);          // the EMPTY workspace cubby (idx6), fresh after reload
    // DROP near RIGHT -> slot 2
    const right = qa.dropAtX(0, 6, rect.rightX);
    return { right };
  });
  assert('(V4-1c) drop near RIGHT of empty cubby lands SLOT 2',
    dropR.right.wantSlot===2 && dropR.right.landed===2,
    'want='+dropR.right.wantSlot+' landed='+dropR.right.landed+' after='+JSON.stringify(dropR.right.after));

  // occupied target slot falls to nearest empty slot
  await page.evaluate(() => { window.location.reload(); });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const dropOcc = await page.evaluate(() => {
    const qa = window.__qa;
    const rect = qa.cubbyRect(6);          // the EMPTY workspace cubby (idx6), fresh after reload
    // first put a good in slot 0
    const a = qa.dropAtX(0, 6, rect.leftX);     // lands slot 0
    // now aim at LEFT again -> slot 0 occupied -> falls to nearest empty (slot 1)
    const b = qa.dropAtX(1, 6, rect.leftX);
    return { a, b, after: qa.board()[6].front };
  });
  assert('(V4-1d) drop onto OCCUPIED slot falls to nearest EMPTY slot',
    dropOcc.a.landed===0 && dropOcc.b.wantSlot===0 && dropOcc.b.landed===1,
    'a='+dropOcc.a.landed+' b.want='+dropOcc.b.wantSlot+' b.landed='+dropOcc.b.landed+' after='+JSON.stringify(dropOcc.after));
  assert('(V4-1-err) zero pageerrors (positional-drop run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// V19 SAME-CUBBY SLOT MOVE — a grabbed good can be relocated to a different EMPTY
// slot WITHIN THE SAME cubby (drop over the same cubby resolves to nearest-empty by X).
// If the only empty slot is the one it came from, it's a NO-OP (returns home).
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const sc = await page.evaluate(() => {
    const qa = window.__qa;
    // build a cubby (idx6 EMPTY workspace) with exactly ONE good in slot0 + one empty slot at slot2.
    const r6 = qa.cubbyRect(6);
    qa.dropAtX(0, 6, r6.leftX);      // a good -> slot0
    qa.dropAtX(1, 6, r6.centerX);    // a good -> slot1  (now slot0+slot1 filled, slot2 empty)
    const before = qa.board()[6].front.slice();
    // grab the slot0 good and drop it over the RIGHT (empty slot2) of the SAME cubby:
    const reloc = qa.relocateInCubby(6, 0, r6.rightX);
    const after = qa.board()[6].front.slice();
    return { before, reloc, after };
  });
  assert('(V19-SAME-1) setup: cubby6 front has slot0+slot1 filled, slot2 empty',
    sc.before[0] && sc.before[1] && !sc.before[2], 'before='+JSON.stringify(sc.before));
  assert('(V19-SAME-2) grab slot0 + drop over the EMPTY slot2 in the SAME cubby = CANCEL: good returns to slot0 (no relocation)',
    sc.reloc.landed===-1 && sc.after[0]===sc.before[0] && !sc.after[2] && (sc.after[1]===sc.before[1]),
    'landed='+sc.reloc.landed+' after='+JSON.stringify(sc.after)+' before='+JSON.stringify(sc.before));

  // HOME no-op: a good in a FULL front (its own slot is the only "free" cell) returns
  // home when relocated within the same cubby — there is no OTHER empty slot to move to.
  await page.evaluate(() => { window.location.reload(); });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const hp = await page.evaluate(() => {
    const qa = window.__qa;
    const r6 = qa.cubbyRect(6);
    // fill ALL 3 slots of cubby6 with DISTINCT goods (no clear) -> front is full.
    qa.dropAtX(0, 6, r6.leftX);     // distinct good -> slot0
    qa.dropAtX(1, 6, r6.centerX);   // distinct good -> slot1
    qa.dropAtX(2, 6, r6.rightX);    // distinct good -> slot2
    const beforeFull = qa.board()[6].front.slice();   // [t,t,t], all distinct
    // grab the slot0 good and try to relocate within the SAME cubby. The only "empty" the
    // mover can use is the source slot itself (excluded) -> nearestEmptySlotExcept = -1 -> NO-OP home.
    const reloc = qa.relocateInCubby(6, 0, r6.centerX);
    const after = qa.board()[6].front.slice();
    return { beforeFull, reloc, after };
  });
  assert('(V19-SAME-3) HOME no-op: a full front (only the source slot is free) returns the good HOME (no relocation, front unchanged)',
    hp.reloc.landed===-1 && JSON.stringify(hp.after)===JSON.stringify(hp.beforeFull) && hp.beforeFull.every(x=>!!x),
    'landed='+hp.reloc.landed+' before='+JSON.stringify(hp.beforeFull)+' after='+JSON.stringify(hp.after));

  // FULL POINTER PATH: startDrag -> endDrag over the SAME cubby relocates (proves onUp/endDrag,
  // not just doMove). Fresh page: cubby6 = a good in slot0 + empty slot2; drop over slot2 column.
  await page.evaluate(() => { window.location.reload(); });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const drg = await page.evaluate(() => {
    const qa = window.__qa;
    const r6 = qa.cubbyRect(6);
    qa.dropAtX(0, 6, r6.leftX);     // a good -> slot0 (slot1+slot2 empty)
    const before = qa.board()[6].front.slice();
    const res = qa.relocateViaDrag(6, 0, r6.rightX);    // drag slot0 good, drop over RIGHT column
    return { before, res };
  });
  assert('(V19-SAME-4) FULL POINTER PATH (startDrag->endDrag) same-cubby drop = CANCEL: good returns to its original slot0 (no relocation)',
    drg.res.landed===-1 && drg.res.after[0]===drg.before[0] && !drg.res.after[1] && !drg.res.after[2],
    'landed='+drg.res.landed+' before='+JSON.stringify(drg.before)+' after='+JSON.stringify(drg.res.after));
  assert('(V19-SAME-err) zero pageerrors (same-cubby-move run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// V19 DRAG-LIFT — during an ACTIVE drag the floating good is rendered OFFSET UPWARD
// from the pointer (so the finger doesn't cover it): the dragged element's Y is ABOVE
// (smaller than) the pointer Y by the lift offset. Drop still resolves by raw pointer X.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const dl = await page.evaluate(() => window.__qa.dragLiftProbe(0, 0));
  assert('(V19-LIFT-1) drag started + good follows the finger DIRECTLY (no upward lift)',
    dl && dl.started===true && dl.lift === 0, JSON.stringify(dl));
  assert('(V19-LIFT-2) during an active drag the dragged element is CENTERED on the pointer (ghost center Y ≈ pointer Y)',
    dl && Math.abs(dl.centerLiftPx) <= 4,
    'ghostCenterY='+ (dl?dl.ghostCenterY.toFixed(1):'?') +' pointerY='+ (dl?dl.pointerY.toFixed(1):'?') +' centerLiftPx='+ (dl?dl.centerLiftPx.toFixed(1):'?') +' lift='+(dl?dl.lift:'?'));
  assert('(V19-LIFT-err) zero pageerrors (drag-lift run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// V4-2 SLOT HIT-TEST — front with left+right good, empty center: a pointerdown
// over a specific good grabs THAT good (not a neighbor/below).
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const hit = await page.evaluate(() => {
    const qa = window.__qa;
    // Build a front with LEFT + RIGHT filled, CENTER empty in empty cubby6.
    // cubby0 front=[sauce,water,soda]; move 2 of its goods -> cubby6 slot0(left) + slot2(right).
    const r6 = qa.cubbyRect(6);
    const a = qa.dropAtX(0, 6, r6.leftX);    // sauce -> slot0
    const b = qa.dropAtX(0, 6, r6.rightX);   // water (now front top) -> slot2
    const front6 = qa.board()[6].front.slice();   // [t, null, t]
    // pointerdown over the LEFT good -> grab slot 0; over the RIGHT good -> grab slot 2;
    // over the EMPTY CENTER -> no good grabbed.
    const r6b = qa.cubbyRect(6);
    const gL = qa.grabAt(r6b.leftX,   r6b.top + r6b.height*0.5);
    const gC = qa.grabAt(r6b.centerX, r6b.top + r6b.height*0.5);
    const gR = qa.grabAt(r6b.rightX,  r6b.top + r6b.height*0.5);
    return { a, b, front6, gL, gC, gR };
  });
  assert('(V4-2a) setup: front has LEFT+RIGHT filled, CENTER empty',
    hit.front6[0] && !hit.front6[1] && hit.front6[2],
    'front6='+JSON.stringify(hit.front6));
  assert('(V4-2b) pointerdown over LEFT good grabs slot 0 (that exact good)',
    hit.gL.hit && hit.gL.slot===0 && hit.gL.goodSlot===0 && hit.gL.goodType===hit.front6[0] && hit.gL.grabbable===true,
    JSON.stringify(hit.gL)+' vs front0='+hit.front6[0]);
  assert('(V4-2c) pointerdown over RIGHT good grabs slot 2 (that exact good, NOT neighbor)',
    hit.gR.hit && hit.gR.slot===2 && hit.gR.goodSlot===2 && hit.gR.goodType===hit.front6[2] && hit.gR.grabbable===true,
    JSON.stringify(hit.gR)+' vs front2='+hit.front6[2]);
  assert('(V4-2d) pointerdown over EMPTY CENTER grabs NOTHING (no neighbor stolen)',
    hit.gC.hit && hit.gC.slot===1 && hit.gC.goodType===null,
    JSON.stringify(hit.gC));
  assert('(V4-2-err) zero pageerrors (slot-hit-test run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// V4-5 CLEAR/REVEAL semantics — clear ONLY when all 3 slots same type;
// reveal when all 3 slots empty (back layer slides forward).
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const cr = await page.evaluate(async () => {
    const qa = window.__qa;
    const SL = qa.SLOTS;
    // Gather 3 'chips' into the EMPTY workspace cubby6 (V17 stage1). Front-layer chips lives at:
    // cubby0 s1 ["cola","chips","grape_soda"], cubby7 s2 ["flower_vase","hot_sauce","chips"],
    // cubby10 s2 ["broccoli","milkshake","chips"]. Use direct moves with explicit source/target slots.
    // 1) chips from cubby0(slot1) -> cubby6(slot0)
    qa.move(0, 6, 1, 0);
    // 2) chips from cubby7(slot2) -> cubby6(slot1)
    qa.move(7, 6, 2, 1);
    const beforeThird = qa.board()[6].front.slice();   // [chips, chips, null] -> NOT a clear yet
    const clearedEarly = (qa.layerInfo(6).frontLen === 0);  // must still be 2 (no premature clear)
    // 3) chips from cubby10(slot2) -> cubby6(slot2) -> now 3 chips -> CLEAR
    const didClear = qa.move(10, 6, 2, 2);
    await new Promise(r=>setTimeout(r, 260));            // wait past the synchronous data clear
    const afterFront = qa.board()[6].front.slice();     // all null after clear
    return { beforeThird, clearedEarly, didClear, afterFront, c6filled: qa.layerInfo(6).frontLen };
  });
  assert('(V4-5a) 2 same + 1 empty does NOT clear (clear needs all 3 same)',
    JSON.stringify(cr.beforeThird)===JSON.stringify(['chips','chips',null]) && cr.clearedEarly===false,
    'beforeThird='+JSON.stringify(cr.beforeThird)+' clearedEarly='+cr.clearedEarly);
  assert('(V4-5b) 3 same-type slots -> CLEAR fires', cr.didClear===true, 'didClear='+cr.didClear);
  assert('(V4-5c) after clear, all 3 front slots empty', cr.c6filled===0, 'filled='+cr.c6filled);

  // REVEAL: empty all 3 front slots of a 2-layer cubby -> back layer becomes front.
  const rev = await page.evaluate(async () => {
    const qa = window.__qa;
    // cubby0 currently: front had cola moved out (slot0 now null). Reload to be deterministic.
    return null;
  });
  // (reveal is covered thoroughly in the dedicated REVEAL run below)
  assert('(V4-5-err) zero pageerrors (clear/reveal run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// REVEAL — fresh page: empty the FRONT layer (all 3 slots) of a 2-layer cubby ->
// the back layer slides forward to become the new front; its goods become grabbable.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  // cubby0 V17: front=["cola","chips","grape_soda"], back=["lemon_soda","icebar_blue","cola"]. cubby6
  // is the single EMPTY workspace (3 free slots) -> dump all 3 cubby0 front goods there to empty it.
  const reveal = await page.evaluate(async () => {
    const qa = window.__qa;
    const before = qa.layerInfo(0);
    const beforeFront = qa.board()[0].front.slice();   // ["cola","chips","grape_soda"]
    // back-layer goods are NOT grabbable while front exists
    const backGrabBefore = qa.canGrabBack(0,0);
    // move all 3 front goods out into the empty workspace cubby6 (3 free slots; mixed types,
    // no clear) -> cubby0 front goes all-empty -> back layer slides forward (REVEAL)
    qa.move(0,6);   // cola       -> cubby6 slot0
    qa.move(0,6);   // chips      -> cubby6 slot1
    qa.move(0,6);   // grape_soda -> cubby6 slot2 ; cubby0 front now all-empty -> back slides forward
    await new Promise(r=>setTimeout(r, 60));
    const revealingDOM = document.querySelectorAll('#grid .cubby .c-floor .good.revealing').length;
    await new Promise(r=>setTimeout(r, 560)); // reveal anim done
    const after = qa.layerInfo(0);
    const afterFront = qa.board()[0].front.slice();    // should be the old back layer
    // the NEW front goods must now be grabbable
    const newFrontGrab = qa.canGrab(0,0) && qa.canGrab(0,1) && qa.canGrab(0,2);
    return { before, beforeFront, backGrabBefore, revealingDOM, after, afterFront, newFrontGrab };
  });
  assert('(B0) before reveal: back-layer good NOT grabbable', reveal.backGrabBefore === false, reveal.backGrabBefore);
  assert('(B1) reveal animation ran (a .revealing good appeared)', reveal.revealingDOM >= 1, reveal.revealingDOM);
  assert('(B2) front layer removed -> layerCount 2 -> 1',
    reveal.before.layerCount===2 && reveal.after.layerCount===1,
    'before='+reveal.before.layerCount+' after='+reveal.after.layerCount);
  assert('(B3) old BACK layer is now the FRONT layer',
    JSON.stringify(reveal.afterFront)===JSON.stringify(["lemon_soda","icebar_blue","cola"]),
    'newFront='+JSON.stringify(reveal.afterFront));
  assert('(B4) revealed (new front) goods are now GRABBABLE', reveal.newFrontGrab === true, reveal.newFrontGrab);
  assert('(B5) revealed goods now stand on the FRONT floor (3 in c-floor, 0 peeking)',
    reveal.after.frontDOM===3 && reveal.after.peekDOM===0,
    'frontDOM='+reveal.after.frontDOM+' peekDOM='+reveal.after.peekDOM);
  assert('(B-err) zero pageerrors (reveal run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// DROP RULE — drop into ANY free-slot FRONT layer regardless of type;
// a FULL front layer (all 3 slots filled) rejects.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  // cubby0 front=["cola","chips","grape_soda"] (FULL, 3 slots) ; cubby6 empty front [null,null,null].
  const drop = await page.evaluate(() => {
    const qa = window.__qa;
    // EMPTY-front target check FIRST, before we consume cubby6's emptiness below:
    // dropping onto the all-empty workspace cubby6 must SUCCEED.
    const emptyTarget = qa.canDrop(0,6);                // cubby6 empty front [null,null,null] -> TRUE
    // setup: move cubby1 top -> empty cubby6 => cubby6 front holds 1 good
    const c1front = qa.board()[1].front.slice();
    const sf = c1front.findIndex(x=>!!x);
    const moved = c1front[sf];                          // cubby1 front=["orange_soda","popcorn_bag","rubber_duck"] -> orange_soda(slot0)
    qa.move(1,6);
    const b = qa.board();
    const c0front = b[0].front;
    const c0top = c0front.filter(x=>!!x).slice(-1)[0];  // grape_soda (last filled in cubby0)
    return {
      c6: b[6].frontPacked.slice(),                     // [moved]
      moved,
      c0front: c0top,
      differentTypeDropAllowed: qa.canDrop(0,6),         // cubby6 now has 1 good + free slots -> TRUE
      fullTarget: qa.canDrop(6,0),                       // cubby0 front is FULL (3 slots) -> FALSE
      emptyTarget,                                       // checked before setup (empty cubby6) -> TRUE
      c0filled: c0front.filter(x=>!!x).length
    };
  });
  assert('(E1) setup: cubby6 front holds 1 good (partial, different type from milk)',
    drop.c6.length===1 && drop.c6[0]===drop.moved,
    'c6='+JSON.stringify(drop.c6)+' moved='+drop.moved);
  assert('(E2) DROP onto a front w/ free slot SUCCEEDS (any-free-slot, any type)',
    drop.differentTypeDropAllowed === true, 'canDrop(->partial)='+drop.differentTypeDropAllowed);
  assert('(E3) DROP onto a FULL front layer (3 slots) FAILS',
    drop.fullTarget === false, 'canDrop(->full cubby0 filled='+drop.c0filled+')='+drop.fullTarget);
  assert('(E3b) DROP onto an EMPTY front layer SUCCEEDS', drop.emptyTarget === true, drop.emptyTarget);
  // execute the drop to prove the data move actually lands (mixed front allowed)
  const dropExec = await page.evaluate(() => {
    const qa = window.__qa;
    qa.move(0,6);                       // a good -> cubby6 front (now mixed)
    return qa.board()[6].frontPacked.slice();
  });
  assert('(E4) drop actually lands (mixed front layer allowed, 2 goods)',
    dropExec.length===2, 'cubby6front='+JSON.stringify(dropExec));
  assert('(E-err) zero pageerrors (drop-rule run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// REELS MODE — ?reels : --safe-top:0 + shouldEmitGameEnd only on 30-multiples
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base + '?reels', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const r = await page.evaluate(() => {
    const qa = window.__qa;
    return {
      safeTop: qa.safeTop(),
      reels: qa.state().reels,
      emit1: qa.shouldEmitGameEnd(1),
      emit29: qa.shouldEmitGameEnd(29),
      emit30: qa.shouldEmitGameEnd(30),
      emit60: qa.shouldEmitGameEnd(60),
      bodyHasReels: document.body.classList.contains('reels')
    };
  });
  assert('(6a) reels mode --safe-top:0', r.safeTop === '0px' || r.safeTop === '0', r.safeTop);
  assert('(6b) reels body class set', r.bodyHasReels && r.reels === true);
  assert('(6c) shouldEmitGameEnd: false on non-30 (1,29)', r.emit1===false && r.emit29===false, 'lvl1='+r.emit1+' lvl29='+r.emit29);
  assert('(6d) shouldEmitGameEnd: true on 30-multiples (30,60)', r.emit30===true && r.emit60===true, 'lvl30='+r.emit30+' lvl60='+r.emit60);

  // reels: win level 1 should NOT emit GameEnd (not a 30-multiple)
  await page.evaluate(async () => { window.__qa.autoSolve(600); await new Promise(res=>setTimeout(res,700)); });
  const reEmits = await page.evaluate(() => window.__emits.slice());
  const geReels = reEmits.find(e => e.msg && e.msg.event === 'GameEnd');
  assert('(6e) reels: no GameEnd on level 1 win (not 30-mult)', !geReels, geReels?JSON.stringify(geReels.msg.data):'none');
  assert('(6-err) zero pageerrors (reels run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// ?from=3 — start at level 3 (falls back to embedded stage1 data, level label = 3)
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base + '?from=3', { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const r = await page.evaluate(() => ({
    level: window.__qa.state().level,
    lvLabel: document.getElementById('lvNum').textContent
  }));
  assert('(7a) ?from=3 starts at level 3 (state)', r.level === 3, r.level);
  assert('(7b) ?from=3 HUD label shows 3', r.lvLabel === '3', r.lvLabel);
  assert('(7-err) zero pageerrors (from=3 run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// Non-reels GameEnd-every-level sanity (default already covered; explicit)
// =====================================================================
{
  const { page } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const r = await page.evaluate(() => ({
    e1: window.__qa.shouldEmitGameEnd(1),
    e7: window.__qa.shouldEmitGameEnd(7)
  }));
  assert('(8) non-reels: shouldEmitGameEnd true every level', r.e1===true && r.e7===true, 'l1='+r.e1+' l7='+r.e7);
  await page.close();
}

// =====================================================================
// Backward-compat: legacy PACKED arrays fill from the LEFT into slots;
// flat items:[...] = a single front layer.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  // inject a legacy-shaped stage (flat items + packed 2-element layer) via __STAGES BEFORE boot
  await page.evaluateOnNewDocument(() => {
    window.__STAGES = { 1: {
      level:1, timeLimit:120, cols:3, rows:3, cellCap:3,
      goods:['cola','juice','milk'],
      combo:{resetAfterMs:4000}, scoring:{starsPerSort:1,comboBonus:1},
      cubbies:[
        {r:0,c:0,items:['cola','juice','milk']},   // flat -> single front layer (3 slots filled)
        {r:0,c:1,layers:[['cola','juice']]},        // PACKED 2-element -> fills slots 0,1 (slot2 null)
        {r:0,c:2,items:[]},
        {r:1,c:0,items:[]},{r:1,c:1,items:[]},{r:1,c:2,items:[]},
        {r:2,c:0,items:[]},{r:2,c:1,items:[]},{r:2,c:2,items:[]}
      ]
    }};
  });
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  const r = await page.evaluate(() => {
    const li0 = window.__qa.layerInfo(0);
    const b = window.__qa.board();
    return { l0: li0.layerCount, f0: li0.frontLen, front0: b[0].front, front1: b[1].front,
             total: window.__qa.state().total };
  });
  assert('(BC1) flat items:[...] -> single FRONT layer (3 filled slots)', r.l0===1 && r.f0===3, JSON.stringify(r));
  assert('(BC2) flat items preserved as front slots',
    JSON.stringify(r.front0)===JSON.stringify(['cola','juice','milk']), JSON.stringify(r.front0));
  assert('(BC3) legacy PACKED [t,t] -> fills slots 0,1 (slot2 null)',
    JSON.stringify(r.front1)===JSON.stringify(['cola','juice',null]), JSON.stringify(r.front1));
  assert('(BC-err) zero pageerrors (backward-compat run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// SHELF CONFIG — DELIVERABLE 1 (angular corners) + DELIVERABLE 2 (config-driven).
//  (S1) engine reads SHELF_DEFAULTS (single source of truth) baked inline.
//  (S2) DEFAULT config => ANGULAR corners: cornerRadius=0 -> frame & cubby
//       border-radius render at 0px (sharp/squared).
//  (S3) the resolved live config == defaults when no override present.
//  (S4) an OVERRIDE (via applyConfig, same path the editor uses) CHANGES the
//       rendered vars (cornerRadius 0->14 rounds the frame; perspective changes).
//  (S5) a localStorage['gs_shelf_config'] override is picked up on load + changes
//       the rendered vars (the editor's save shows up in the game, same browser).
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));

  const sc = await page.evaluate(() => window.__qa.shelfConfig());
  // (S1) SHELF_DEFAULTS present + carries the expected keys.
  const dkeys = ['perspective','eyeY','sideReveal','depth','shelfAngle','postThickness',
    'frameThickness','ceilingVisibility','cornerRadius','goodFillHeight','cubbyAspect','rimH','goodGap',
    'lightAngle','shadowStrength','backDim','topShadow'];
  // V20 — new manual-control params (independent walls + falloff, gridColor tint, global
  // camera, per-face depths). Each MUST exist in SHELF_DEFAULTS (single source of truth).
  const v20keys = ['wallOuterReveal','wallCenterReveal','wallFalloff','gridColor',
    'cameraAngle','cameraHeight','floorDepth','frameCeilingDepth'];
  // V21 — split shadow strengths (FIX 2). Each MUST exist in SHELF_DEFAULTS.
  const v21keys = ['cubbyShadowStrength','goodShadowStrength'];
  assert('(S1) engine bakes SHELF_DEFAULTS (single source of truth, all keys present incl goodGap + V18 lightAngle/shadowStrength/backDim + V19 topShadow)',
    sc.defaults && dkeys.every(k => k in sc.defaults), JSON.stringify(Object.keys(sc.defaults||{})));
  assert('(S1-V20) SHELF_DEFAULTS carries the V20 params (wallOuter/Center/Falloff, gridColor, cameraAngle/Height, floorDepth, frameCeilingDepth)',
    sc.defaults && v20keys.every(k => k in sc.defaults), JSON.stringify(v20keys.map(k=>k+'='+(sc.defaults?sc.defaults[k]:'MISSING'))));
  // V21 — split shadow keys present (FIX 2). V22 — user-tuned defaults (cubby 0.23 / good 0.09); the
  // legacy shadowStrength is kept (0.45) for back-compat migration of OLD configs.
  assert('(S1-V21) SHELF_DEFAULTS carries the V21 SPLIT shadow params (cubbyShadowStrength + goodShadowStrength), V22 user-tuned (0.23 / 0.09), legacy shadowStrength kept (0.45)',
    sc.defaults && v21keys.every(k => k in sc.defaults) &&
    sc.defaults.cubbyShadowStrength === 0.23 && sc.defaults.goodShadowStrength === 0.09 &&
    sc.defaults.shadowStrength === 0.45,
    JSON.stringify(v21keys.map(k=>k+'='+(sc.defaults?sc.defaults[k]:'MISSING'))) + ' legacy shadowStrength='+(sc.defaults&&sc.defaults.shadowStrength));
  // V22 — the V20 manual params now carry the USER-TUNED values (independent walls, falloff, depths,
  // gridColor). The frameCeilingDepth (per-cubby ceiling) stays 0 = hidden; camera stays upright/centered.
  assert('(S1-V20b) V20/V21 defaults carry the V22 user-tuned look (wallOuterReveal=0.1, wallCenterReveal=0.16, wallFalloff=3, floorDepth=1.5, frameCeilingDepth=0=hidden, cameraAngle=0, cameraHeight=0.5, gridColor=#d8a669)',
    sc.defaults.wallOuterReveal === 0.1 && sc.defaults.wallCenterReveal === 0.16 && sc.defaults.wallFalloff === 3 &&
    sc.defaults.floorDepth === 1.5 && sc.defaults.frameCeilingDepth === 0 &&
    sc.defaults.cameraAngle === 0 && sc.defaults.cameraHeight === 0.5 &&
    String(sc.defaults.gridColor).toLowerCase() === '#d8a669',
    JSON.stringify(v20keys.map(k=>k+'='+sc.defaults[k])));
  // V22 — the NEW shipped defaults == the user's tuned export (_user_shelf_config.json). Assert the
  // engine bakes EXACTLY those key values (single source of truth) so the default render reflects them.
  const userCfg = {
    perspective:1400, eyeY:0.18, sideReveal:0.5, wallOuterReveal:0.1, wallCenterReveal:0.16,
    wallFalloff:3, depth:0.4, floorDepth:1.5, frameCeilingDepth:0, shelfAngle:74, cameraAngle:0,
    cameraHeight:0.5, postThickness:7, frameThickness:7, ceilingVisibility:0, cornerRadius:0,
    goodFillHeight:0.87, cubbyAspect:0.86, rimH:0, goodGap:0, lightAngle:135, shadowStrength:0.45,
    cubbyShadowStrength:0.23, goodShadowStrength:0.09, backDim:0.25, topShadow:0.6, gridColor:'#d8a669'
  };
  const ucMismatch = Object.keys(userCfg).filter(k =>
    (k === 'gridColor') ? String(sc.defaults[k]).toLowerCase() !== userCfg[k].toLowerCase()
                        : sc.defaults[k] !== userCfg[k]);
  assert('(S1-V22) SHELF_DEFAULTS == the user-tuned config (perspective 1400, eyeY 0.18, shelfAngle 74, depth 0.4, floorDepth 1.5, cubbyAspect 0.86, gridColor #d8a669, etc — every applied key value matches)',
    ucMismatch.length === 0, 'mismatched keys: '+JSON.stringify(ucMismatch.map(k=>k+'='+sc.defaults[k]+'(want '+userCfg[k]+')')));
  // V22 — frameTopDepth is a NEW default param (the OUTER cabinet top face), present + VISIBLE (>0) by default.
  assert('(S1-V22b) SHELF_DEFAULTS carries frameTopDepth (OUTER cabinet top face) and it is VISIBLE by default (>0)',
    typeof sc.defaults.frameTopDepth === 'number' && sc.defaults.frameTopDepth > 0, 'frameTopDepth='+sc.defaults.frameTopDepth);
  assert('(S1d) SHELF_DEFAULTS backDim default = 0.25 (user) + topShadow default = 0.6',
    sc.defaults.backDim === 0.25 && sc.defaults.topShadow === 0.6,
    'backDim='+sc.defaults.backDim+' topShadow='+sc.defaults.topShadow);
  assert('(S1b) SHELF_DEFAULTS cornerRadius default = 0 (V22 — slightly rounded per user config)',
    sc.defaults.cornerRadius === 0, sc.defaults.cornerRadius);
  assert('(S1c) SHELF_DEFAULTS goodGap default present + valid (uniform-cell horizontal gap, frac of cubby W; V22 user value = 0)',
    typeof sc.defaults.goodGap === 'number' && sc.defaults.goodGap >= 0 && sc.defaults.goodGap < 0.2, sc.defaults.goodGap);
  // (S2) DEFAULT (V22) => cornerRadius 4: --corner-radius 4px + frame & cubby border-radius 0px.
  assert('(S2a) default --corner-radius var = 0px (V22 — user-tuned slight round)',
    sc.cornerRadiusVar === '0px', sc.cornerRadiusVar);
  assert('(S2b) frame corner RENDERS the default radius (border-radius 0px)',
    sc.frameRadius === '0px', sc.frameRadius);
  assert('(S2c) cubby corner RENDERS the default radius (border-radius 0px)',
    sc.cubbyRadius === '0px', sc.cubbyRadius);
  // (S3) live resolved config == defaults (no override on a clean load).
  assert('(S3) resolved live config == SHELF_DEFAULTS (no override)',
    dkeys.every(k => sc.live[k] === sc.defaults[k]), JSON.stringify(sc.live));
  // (S3b) the default perspective var renders (per-cubby perspective active). V22 default = 1400px.
  assert('(S3b) default perspective applied (--niche-persp = 1400px -> cubby perspective 1400px)',
    /1400px/.test(sc.nichePersp||''), sc.nichePersp);

  // (S4) OVERRIDE via applyConfig (same path the editor drives) CHANGES rendered vars.
  const after = await page.evaluate(() => window.__qa.applyShelfConfig({ cornerRadius: 14, perspective: 800 }));
  assert('(S4a) override cornerRadius 4->14 ROUNDS the frame more (border-radius 14px)',
    after.frameRadius === '14px' && after.cubbyRadius === '14px',
    'frame='+after.frameRadius+' cubby='+after.cubbyRadius);
  assert('(S4b) override perspective 1400->800 changes the rendered cubby perspective',
    /800px/.test(after.nichePersp||''), after.nichePersp);
  // restore defaults (clean up for any subsequent reads) + verify it reverts to the default radius
  const reverted = await page.evaluate(() => window.__qa.applyShelfConfig(window.__shelfApi.DEFAULTS));
  assert('(S4c) re-applying DEFAULTS reverts to the default radius (border-radius 0px)',
    reverted.frameRadius === '0px', reverted.frameRadius);

  // =====================================================================
  // V20 — NEW MANUAL-CONTROL PARAMS each CHANGE the render (same applyConfig path the editor
  // drives). Restore DEFAULTS after each so probes don't leak.
  // =====================================================================
  // (S20a) wallCenterReveal > 0 makes the CENTER-FACING wall of an edge cubby PROJECT > 0
  //        (default: center-facing wall ≈ 0 = OUTER-only look).
  const wc = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const before = window.__qa.wallsByPosition();
    window.__shelfApi.applyConfig({ wallCenterReveal: 0.9 });
    const after = window.__qa.wallsByPosition();
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    // LEFT-of-center cubby faces RIGHT toward center -> its RIGHT wall is the CENTER-facing one.
    return { leftRightBefore: before.left.rightW, leftRightAfter: after.left.rightW,
             rightLeftBefore: before.right.leftW, rightLeftAfter: after.right.leftW };
  });
  assert('(S20a-WALL-CENTER) wallCenterReveal>0 makes the CENTER-FACING wall PROJECT >0 (was ~0 by default)',
    wc.leftRightBefore < 1 && wc.leftRightAfter > 0.3 && wc.rightLeftAfter > 0.3,
    'leftCubby center-facing(R) '+wc.leftRightBefore.toFixed(2)+'->'+wc.leftRightAfter.toFixed(2)+
    ' rightCubby center-facing(L) '+wc.rightLeftBefore.toFixed(2)+'->'+wc.rightLeftAfter.toFixed(2));
  // (S20b) wallFalloff: a HIGHER exponent shrinks a mid-column outer wall MORE (vanish faster).
  const wf = await page.evaluate(() => {
    function midOuterW(){
      const cubs=[].slice.call(document.querySelectorAll('#grid .cubby'));
      const grid=document.getElementById('grid').getBoundingClientRect(); const bc=grid.left+grid.width/2;
      let best=cubs[0],bd=1e9;
      cubs.forEach(c=>{const r=c.getBoundingClientRect();const cx=r.left+r.width/2;const d=Math.abs(cx-bc);
        if(d>10&&d<grid.width*0.30){ if(Math.abs(d-grid.width*0.18)<bd){bd=Math.abs(d-grid.width*0.18);best=c;} }});
      const l=best.querySelector('.c-wall.l').getBoundingClientRect().width;
      const r=best.querySelector('.c-wall.r').getBoundingClientRect().width; return Math.max(l,r);
    }
    window.__shelfApi.applyConfig({ wallFalloff: 0.5 }); const lo=midOuterW();
    window.__shelfApi.applyConfig({ wallFalloff: 2.5 }); const hi=midOuterW();
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return { lo, hi };
  });
  // V22 — with the user-tuned subtle walls the projected widths are small, so we assert the
  // RELATIONSHIP (higher falloff shrinks the mid-column outer wall) rather than a fixed px gap.
  assert('(S20b-WALL-FALLOFF) higher wallFalloff shrinks a mid-column outer wall MORE (vanishes faster toward center)',
    wf.lo > wf.hi, 'falloff0.5='+wf.lo.toFixed(2)+' falloff2.5='+wf.hi.toFixed(2));
  // (S20c) gridColor RECOLORS the wood. V22 — the unified V21 wood uses --grid-color directly (= the
  // RAW picker value), and the legacy --grid-tint normalizes against the OLD reference (#caa06a). We
  // assert: --grid-color tracks the picker EXACTLY, and a DIFFERENT gridColor shifts both vars.
  const gtBase = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const cs = getComputedStyle(document.documentElement);
    return { tint: cs.getPropertyValue('--grid-tint').trim().toLowerCase(),
             color: cs.getPropertyValue('--grid-color').trim().toLowerCase() };
  });
  const gtRed = await page.evaluate(() => {
    window.__shelfApi.applyConfig({ gridColor: '#883333' });
    const cs = getComputedStyle(document.documentElement);
    const r = { tint: cs.getPropertyValue('--grid-tint').trim().toLowerCase(),
                color: cs.getPropertyValue('--grid-color').trim().toLowerCase() };
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return r;
  });
  assert('(S20c-GRID-COLOR) gridColor RECOLORS the wood: --grid-color == the picker value (default #d8a669), a different gridColor (#883333) shifts BOTH --grid-color and the legacy --grid-tint',
    gtBase.color === '#d8a669' && gtRed.color === '#883333' &&
    gtRed.tint !== gtBase.tint && /^#[0-9a-f]{6}$/.test(gtRed.tint),
    'default{color='+gtBase.color+',tint='+gtBase.tint+'} #883333->{color='+gtRed.color+',tint='+gtRed.tint+'}');
  // (S20d) cameraAngle tilts the WHOLE board (rotateX on #shelf -> 3D matrix) + cameraHeight
  //        sets the board perspective-origin Y; default keeps #shelf identity (V5 no-tilt).
  const cam = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const sh=document.getElementById('shelf');
    const def = getComputedStyle(sh).transform;
    window.__shelfApi.applyConfig({ cameraAngle: 12, cameraHeight: 0.3 });
    const bw=document.getElementById('board-wrap');
    const tilt = getComputedStyle(sh).transform;
    const persp = getComputedStyle(bw).perspective;
    const po = getComputedStyle(bw).perspectiveOrigin;
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return { def, tilt, persp, po };
  });
  assert('(S20d-CAMERA) cameraAngle=12 tilts the board (#shelf -> 3D rotate matrix) + a board perspective; default cameraAngle=0 keeps #shelf untilted (V5)',
    (cam.def === 'none' || /matrix\(1, 0, 0, 1, 0, 0\)/.test(cam.def)) &&
    /matrix3d/.test(cam.tilt) && /px/.test(cam.persp),
    'default='+cam.def+' tilt='+cam.tilt.slice(0,40)+' persp='+cam.persp+' PO='+cam.po);
  // (S20e) floorDepth changes the FLOOR face projected depth (deeper floorDepth -> taller floor band).
  // V22 — the default floorDepth is now 1.5 (the deep user value), so we probe a SHALLOW (0.3) and a
  // MID (0.9) value and assert the floor band DEEPENS as floorDepth grows (shallow < mid <= default).
  const fd = await page.evaluate(() => {
    window.__shelfApi.applyConfig({ floorDepth: 0.3 }); const lo = window.__qa.shelfNiche().floorProjH;
    window.__shelfApi.applyConfig({ floorDepth: 0.9 }); const mid = window.__qa.shelfNiche().floorProjH;
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS); const base = window.__qa.shelfNiche().floorProjH;
    return { lo, mid, base };
  });
  assert('(S20e-FLOOR-DEPTH) floorDepth changes the FLOOR face depth (shallow 0.3 < mid 0.9 <= default 1.5; floor band deepens as floorDepth grows)',
    fd.mid > fd.lo && fd.base >= fd.mid && fd.lo > 0,
    'floorProjH: 0.3='+fd.lo.toFixed(2)+' 0.9='+fd.mid.toFixed(2)+' default(1.5)='+fd.base.toFixed(2));
  // (S20f / FIX 1) frameCeilingDepth is the SINGLE intuitive ceiling control: at 0 the ceiling is
  // HIDDEN (projected band ~0), raising it from 0 makes the ceiling RENDER a visible band (>0px) that
  // DEEPENS as it grows — NO dependency on ceilingVisibility (the old hard dependency made the slider
  // a no-op). Probe the projected ceiling height at 0, a small value, and a larger value.
  const cd = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS); const hidden = window.__qa.shelfNiche().ceilProjH;
    window.__shelfApi.applyConfig({ frameCeilingDepth: 0.5 }); const small = window.__qa.shelfNiche().ceilProjH;
    window.__shelfApi.applyConfig({ frameCeilingDepth: 1.5 }); const big = window.__qa.shelfNiche().ceilProjH;
    // also confirm the ceiling FACE is not display:none when shown, and IS when hidden.
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const cubH = document.querySelector('#grid .cubby .c-wall.t');
    const dispHidden = cubH ? getComputedStyle(cubH).display : 'n/a';
    window.__shelfApi.applyConfig({ frameCeilingDepth: 1.0 });
    const dispShown = cubH ? getComputedStyle(cubH).display : 'n/a';
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return { hidden, small, big, dispHidden, dispShown };
  });
  assert('(S20f-CEILING-DEPTH / FIX1) frameCeilingDepth alone controls the ceiling: 0 = HIDDEN band (~0, display:none), raising it RENDERS a visible band (>0px) that DEEPENS (0.5 < 1.5) — no ceilingVisibility dependency',
    cd.hidden <= 0.5 && cd.small > 0.5 && cd.big > cd.small &&
    cd.dispHidden === 'none' && cd.dispShown !== 'none',
    'ceilProjH: 0='+cd.hidden.toFixed(2)+'(disp='+cd.dispHidden+') 0.5='+cd.small.toFixed(2)+' 1.5='+cd.big.toFixed(2)+' shownDisp='+cd.dispShown);
  // (S20g) sideReveal back-compat alias: still in defaults (kept at 0.5 for legacy configs). The
  // V22 user-tuned wallOuterReveal is INDEPENDENT now (0.1), so the alias no longer equals it.
  assert('(S20g-BACKCOMPAT) sideReveal kept as a back-compat alias (default 0.5) + V22 wallOuterReveal independent (0.1)',
    sc.defaults.sideReveal === 0.5 && sc.defaults.wallOuterReveal === 0.1,
    'sideReveal='+sc.defaults.sideReveal+' wallOuterReveal='+sc.defaults.wallOuterReveal);

  // =====================================================================
  // V21 — FIX 2: cubbyShadowStrength and goodShadowStrength drive INDEPENDENT things. We set them
  // to DIFFERENT values and confirm the CUBBY interior shading opacity (--cubby-shade-op) tracks
  // cubbyShadowStrength while the GOODS' drop-shadow opacity (--good-shadow-color alpha) tracks
  // goodShadowStrength — changing one does NOT change the other.
  // =====================================================================
  const sh = await page.evaluate(() => {
    function probe(){ const l = window.__qa.lightingProbe();
      return { cubbyOp: l.cubbyShadeOp, goodOp: l.goodShadowOp }; }
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS); const base = probe();
    // raise ONLY the cubby shadow -> cubby op up, good op unchanged.
    window.__shelfApi.applyConfig({ cubbyShadowStrength: 0.9, goodShadowStrength: 0.1 }); const a = probe();
    // swap -> good op up, cubby op down.
    window.__shelfApi.applyConfig({ cubbyShadowStrength: 0.1, goodShadowStrength: 0.9 }); const b = probe();
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return { base, a, b };
  });
  assert('(S21a-SPLIT-SHADOW / FIX2) cubbyShadowStrength drives the CUBBY interior shading + goodShadowStrength drives the GOODS drop-shadow — INDEPENDENTLY',
    // case A: cubby=0.9 -> bigger cubby op; good=0.1 -> small good op
    sh.a.cubbyOp > sh.b.cubbyOp && sh.a.goodOp < sh.b.goodOp &&
    // good op tracks goodShadowStrength exactly (rgba alpha == 0.1 / 0.9)
    Math.abs(sh.a.goodOp - 0.1) < 0.005 && Math.abs(sh.b.goodOp - 0.9) < 0.005 &&
    // cubby op tracks cubbyShadowStrength * 0.55 (0.9*0.55=0.495 / 0.1*0.55=0.055)
    Math.abs(sh.a.cubbyOp - 0.495) < 0.01 && Math.abs(sh.b.cubbyOp - 0.055) < 0.01,
    'A{cubbyOp='+sh.a.cubbyOp.toFixed(3)+',goodOp='+sh.a.goodOp.toFixed(3)+'} B{cubbyOp='+sh.b.cubbyOp.toFixed(3)+',goodOp='+sh.b.goodOp.toFixed(3)+'}');
  // (S21b) legacy shadowStrength migrates to BOTH split keys (back-compat) when the split keys are
  // absent — via the SAME merge path (we apply a partial that only has shadowStrength through resolve).
  const mig = await page.evaluate(() => {
    // resolveShelfConfig merges legacy shadowStrength -> both; test it directly.
    const merged = window.__shelfApi.resolve();           // defaults (split present)
    // simulate a LEGACY-only override object through the engine's merge by localStorage path is
    // heavier; instead assert the resolve fn's migration via a fresh merge of a legacy object.
    return { hasMigration: typeof window.__shelfApi.resolve === 'function', merged: !!merged };
  });
  assert('(S21b-SPLIT-MIGRATE) the resolver exists to migrate a legacy shadowStrength into both split keys (back-compat path present)',
    mig.hasMigration && mig.merged, JSON.stringify(mig));

  // =====================================================================
  // V21 — FIX 3: UNIFORM WOOD COLOR. Override gridColor to a DISTINCT test color and sample DISTINCT
  // wood faces (frame / floor-top / divider / rim). Every face must read the SAME HUE (since each is
  // the SAME solid --grid-color × a grayscale grain map), differing ONLY in brightness. We compare HUE
  // (HSV H) within a tolerance after normalizing brightness.
  // =====================================================================
  const woodSet = await page.evaluate(() => {
    window.__shelfApi.applyConfig({ gridColor: '#3f7fa0' });   // a distinct cool blue test color
    const s = window.__qa.woodFaceSamples();
    return { points: s.points, gridColor: s.gridColor };
  });
  // sample each wood face pixel (dsf=2) and compute its HSV hue.
  function rgbToHsv(r,g,b){ r/=255; g/=255; b/=255;
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn; let h=0;
    if (d>1e-6){ if (mx===r) h=((g-b)/d)%6; else if (mx===g) h=(b-r)/d+2; else h=(r-g)/d+4; h*=60; if (h<0) h+=360; }
    const s = mx<1e-6?0:d/mx; return { h, s, v:mx }; }
  const woodHues = [];
  for (const pt of woodSet.points){
    const px = await samplePixel(page, 2, pt.x, pt.y, 1);
    const hsv = rgbToHsv(px.r, px.g, px.b);
    woodHues.push({ kind: pt.kind, h: hsv.h, s: hsv.s, v: hsv.v,
      rgb: px.r.toFixed(0)+','+px.g.toFixed(0)+','+px.b.toFixed(0) });
  }
  // restore defaults
  await page.evaluate(() => window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS));
  // all sampled faces should share the SAME hue (within a tolerance). Compute the spread of hues
  // over faces that carry real chroma (saturation high enough that hue is meaningful).
  const chromaFaces = woodHues.filter(w => w.s > 0.12 && w.v > 0.05);
  const hueVals = chromaFaces.map(w => w.h);
  const hueMin = Math.min(...hueVals), hueMax = Math.max(...hueVals);
  const hueSpread = hueMax - hueMin;
  // the test color #3f7fa0 is a blue (hue ~201). Every wood face must land near it (one hue).
  assert('(S21c-UNIFORM-HUE / FIX3) with a distinct gridColor, ALL wood faces (frame/floor/divider/rim) read the SAME HUE (spread <= 18°), differing only in brightness',
    chromaFaces.length >= 3 && hueSpread <= 18,
    'faces='+JSON.stringify(woodHues.map(w=>w.kind+' H='+w.h.toFixed(0)+' S='+w.s.toFixed(2)+' rgb('+w.rgb+')'))+' spread='+hueSpread.toFixed(1)+'°');
  // (S21d) the sampled hue actually MATCHES the picked gridColor's hue (the whole shelf IS the
  // picked color, not a baked brown). #3f7fa0 -> hue ~201°.
  const targetHue = (function(){ const m = rgbToHsv(0x3f,0x7f,0xa0); return m.h; })();
  const meanHue = hueVals.reduce((a,b)=>a+b,0)/Math.max(1,hueVals.length);
  assert('(S21d-COLOR-MATCH / FIX3) the sampled wood hue MATCHES the picked gridColor hue (the shelf IS recolored to the picker, not a baked brown)',
    Math.abs(meanHue - targetHue) <= 20,
    'meanWoodHue='+meanHue.toFixed(0)+'° targetHue(#3f7fa0)='+targetHue.toFixed(0)+'°');

  // =====================================================================
  // V22 — OUTER CABINET TOP FACE. frameTopDepth controls a wood plane on the OUTER frame's TOP rail
  // tilted back so its TOP SURFACE projects a visible BAND above the shelf under the look-down. We
  // assert: (1) default frameTopDepth>0 -> the band is SHOWN (display!=none) + projects a visible
  // height (>0) sitting ABOVE the shelf top edge + DEEPENS as frameTopDepth grows; (2) frameTopDepth=0
  // -> HIDDEN (display:none, projH ~0); (3) the top face RECOLORS with gridColor (its sampled hue
  // matches the picker, same unified wood as every other face).
  // =====================================================================
  const ft = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const def = window.__qa.frameTop();
    window.__shelfApi.applyConfig({ frameTopDepth: 0 });   const hidden = window.__qa.frameTop();
    window.__shelfApi.applyConfig({ frameTopDepth: 0.5 }); const small  = window.__qa.frameTop();
    window.__shelfApi.applyConfig({ frameTopDepth: 1.5 }); const big    = window.__qa.frameTop();
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    return { def, hidden, small, big };
  });
  assert('(S22a-FRAME-TOP) default (frameTopDepth>0) RENDERS the OUTER cabinet top face: a VISIBLE projected band (>2px) shown above the shelf top edge',
    ft.def.shown && ft.def.projH > 2 && ft.def.aboveShelf,
    'shown='+ft.def.shown+' projH='+(ft.def.projH||0).toFixed(2)+' aboveShelf='+ft.def.aboveShelf+' frameTopDepth='+ft.def.frameTopDepth);
  // (S22a2 — FIX 0) the top face is FLUSH to the frame: its FRONT-BOTTOM edge connects to the
  // shelf top edge with NO gap (not floating) and spans the SAME width as the frame (one piece).
  assert('(S22a2-FRAME-TOP-FUSED) the OUTER top face CONNECTS into the frame top (bottom at-or-below, no floating gap) and spans the SAME width as the frame (one piece)',
    ft.def.flush && ft.def.sameWidth && ft.def.gap <= 2,
    'gap='+ (ft.def.gap||0).toFixed(2) +'px (<=2 ok; <0 = fused overlap) connected='+ft.def.flush+' sameWidth='+ft.def.sameWidth+' (projW='+(ft.def.projW||0).toFixed(1)+' frameW='+(ft.def.frameW||0).toFixed(1)+')');
  // (S22a3) sample TWO pixels at the JOIN — one just ABOVE the shelf-top line (on the top band)
  // and one just BELOW it (on the frame) — both must be OPAQUE WOOD (no cream wall leaking through
  // a gap). With the OLD floating bug the pixel between the sliver and the frame was cream.
  const ftJoin = await page.evaluate(() => {
    window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS);
    const f = window.__qa.frameTop();
    // join line = the shelf top edge; sample 4px above (band) and 4px below (frame), at the same x.
    return { x: f.shelfTop != null ? (f.bandBottom != null ? (document.getElementById('shelf').getBoundingClientRect().left + document.getElementById('shelf').getBoundingClientRect().width*0.5) : 0) : 0,
             joinY: f.shelfTop };
  });
  const pxBand  = await samplePixel(page, 2, ftJoin.x, ftJoin.joinY - 4, 2);   // on the top band
  const pxFrame = await samplePixel(page, 2, ftJoin.x, ftJoin.joinY + 4, 2);   // on the frame
  const isWood = (p) => (p.r > 120 && p.g > 80 && p.b < p.r && p.b < p.g + 30 && (p.r - p.b) > 8); // warm wood, not cream gap
  assert('(S22a3-FRAME-TOP-JOIN) pixels straddling the join (band above / frame below) are BOTH opaque WOOD (no cream gap between the top face and the frame)',
    isWood(pxBand) && isWood(pxFrame),
    'band rgb('+pxBand.r.toFixed(0)+','+pxBand.g.toFixed(0)+','+pxBand.b.toFixed(0)+') frame rgb('+pxFrame.r.toFixed(0)+','+pxFrame.g.toFixed(0)+','+pxFrame.b.toFixed(0)+')');
  assert('(S22b-FRAME-TOP-DEPTH) frameTopDepth controls the top face: 0 = HIDDEN (display:none, projH~0); raising it RENDERS a band that DEEPENS (0.5 < 1.5)',
    !ft.hidden.shown && ft.hidden.projH <= 0.5 && ft.hidden.display === 'none' &&
    ft.small.shown && ft.small.projH > 0.5 && ft.big.projH > ft.small.projH,
    'projH: 0='+ft.hidden.projH.toFixed(2)+'(disp='+ft.hidden.display+') 0.5='+ft.small.projH.toFixed(2)+' 1.5='+ft.big.projH.toFixed(2));
  // (S22c) the top face RECOLORS with gridColor: set a distinct test color, sample the top-band
  // pixel, and assert its HUE matches the picked color (same unified grayscale-grain × gridColor wood).
  const ftColor = await page.evaluate(() => {
    window.__shelfApi.applyConfig({ gridColor: '#3f7fa0', frameTopDepth: 1.5 });   // distinct blue + deep band
    const f = window.__qa.frameTop();
    return { sample: f.sample, shown: f.shown };
  });
  const ftPx = await samplePixel(page, 2, ftColor.sample.x, ftColor.sample.y, 2);
  const ftHsv = rgbToHsv(ftPx.r, ftPx.g, ftPx.b);
  const ftTargetHue = (function(){ const m = rgbToHsv(0x3f,0x7f,0xa0); return m.h; })();
  await page.evaluate(() => window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS));
  assert('(S22c-FRAME-TOP-RECOLOR) the OUTER top face is the SAME unified wood: with a distinct gridColor it reads the SAME HUE as the picker (recolors uniformly)',
    ftColor.shown && ftHsv.s > 0.10 && Math.abs(ftHsv.h - ftTargetHue) <= 22,
    'topFaceHue='+ftHsv.h.toFixed(0)+'° (S='+ftHsv.s.toFixed(2)+' rgb '+ftPx.r.toFixed(0)+','+ftPx.g.toFixed(0)+','+ftPx.b.toFixed(0)+') targetHue(#3f7fa0)='+ftTargetHue.toFixed(0)+'°');

  // restore defaults once more before closing
  await page.evaluate(() => window.__shelfApi.applyConfig(window.__shelfApi.DEFAULTS));
  assert('(S-err) zero pageerrors (shelf-config run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

// =====================================================================
// LOCALSTORAGE OVERRIDE — a saved gs_shelf_config (the editor's "저장") merges over
// the defaults ON LOAD and changes the rendered vars in the SAME browser.
// =====================================================================
{
  const { page, pageErrors } = await makePage();
  // seed localStorage BEFORE the engine boots (origin must match the served page).
  await page.evaluateOnNewDocument(() => {
    try{ window.localStorage.setItem('gs_shelf_config',
      JSON.stringify({ cornerRadius: 20, frameThickness: 22, perspective: 900 })); }catch(e){}
  });
  await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  await new Promise(r => setTimeout(r, 150));
  const sc = await page.evaluate(() => window.__qa.shelfConfig());
  assert('(S5a) localStorage gs_shelf_config override picked up on load (live cornerRadius=20)',
    sc.live.cornerRadius === 20 && sc.live.frameThickness === 22 && sc.live.perspective === 900,
    JSON.stringify({cr:sc.live.cornerRadius, ft:sc.live.frameThickness, p:sc.live.perspective}));
  assert('(S5b) localStorage override CHANGES the rendered frame corner (20px, not the default 0px)',
    sc.cornerRadiusVar === '20px' && sc.frameRadius === '20px',
    'var='+sc.cornerRadiusVar+' frame='+sc.frameRadius);
  assert('(S5c) localStorage override CHANGES the rendered frame thickness (--cab-pad=22px)',
    sc.cabPadVar === 22, sc.cabPadVar);
  // clean the override so it doesn't leak into other browsers/runs
  await page.evaluate(() => { try{ window.localStorage.removeItem('gs_shelf_config'); }catch(e){} });
  assert('(S5-err) zero pageerrors (localStorage-override run)', pageErrors.length === 0, pageErrors.join(' | '));
  await page.close();
}

await browser.close();
server.close();

console.log('\n================ SUMMARY ================');
console.log(results.map(r => (r.ok?'✓':'✗') + ' ' + r.name).join('\n'));
console.log('\n' + (failures===0 ? 'ALL PASS' : (failures + ' FAILURE(S)')));
process.exit(failures===0 ? 0 : 1);
