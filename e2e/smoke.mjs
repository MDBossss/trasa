// Smoke test against a running dev server: node e2e/smoke.mjs [url]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const APP_URL = process.argv[2] ?? 'http://localhost:5177/'
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
// native file pickers cannot be driven, so exercise the download/input fallback
await page.addInitScript(() => { delete window.showSaveFilePicker; delete window.showOpenFilePicker })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
// expected 404s: the GitHub mock answers 404 for missing dirs/files
page.on('console', (m) => { if (m.type() === 'error' && !/status of (404|409)/.test(m.text())) errors.push(m.text()) })

const prompts = []
page.on('dialog', async (d) => {
  prompts.push(d.message())
  if (d.type() === 'confirm') return d.accept()
  const m = d.message()
  if (m.includes('metrima')) return d.accept('5')
  if (m.includes('sobe')) return d.accept('Dnevna')
  return d.accept()
})

process.on('uncaughtException', async (e) => {
  console.error(e)
  try { console.error(JSON.stringify((await page.evaluate(() => window.__trasa.getState().project.conduits)).map((c) => c.points))) } catch {}
  try { await page.screenshot({ path: `${SHOTS}/trasa-fail.png` }); console.error(JSON.stringify(await page.evaluate(() => { const p = window.__trasa.getState(); return { tool: p.tool, rooms: p.project.rooms.length, conduits: p.project.conduits.length, ppm: p.project.pxPerMeter } }))) } catch {}
  process.exit(1)
})
await page.goto(APP_URL)
await page.evaluate(() => new Promise((r) => { localStorage.clear(); const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
await page.reload()
await page.getByText('Ispusti sliku tlocrta ovdje').waitFor()

// synthetic floor plan 1200x800 with a thick wall outline
const planPng = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 800)
  g.lineWidth = 12; g.strokeStyle = '#222'; g.strokeRect(100, 100, 1000, 600); g.strokeRect(100, 100, 500, 300)
  return c.toDataURL('image/png')
})
await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.getByText('Ispusti sliku tlocrta ovdje').waitFor({ state: 'hidden' })
await page.waitForFunction(() => window.Konva?.stages?.[0]?.findOne('Image'))

const toScreen = async (x, y) => page.evaluate(([x, y]) => {
  const st = window.Konva.stages[0]
  const r = st.container().getBoundingClientRect()
  return { x: r.left + st.x() + x * st.scaleX(), y: r.top + st.y() + y * st.scaleY() }
}, [x, y])
const clickImg = async (x, y) => { const p = await toScreen(x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y) }
const state = () => page.evaluate(() => window.__trasa.getState().project)
const openSetup = () => page.evaluate(() => { document.querySelectorAll('details.setup').forEach((d) => { d.open = true }) })
const menu = async (label) => { await page.getByRole('button', { name: 'Datoteka' }).click(); await page.getByText(label).click() }

// calibrate: 500 px = 5 m → 100 px/m
await page.keyboard.press('c')
await clickImg(100, 100); await clickImg(600, 100)
await page.locator('.badge.ok').waitFor() // setup collapses once calibrated
await openSetup(); await page.getByText('100.0 px/m').waitFor()
assert.equal((await state()).pxPerMeter, 100)

// room: click corners, close by clicking first corner
await page.keyboard.press('r')
for (const [x, y] of [[100, 100], [600, 100], [600, 400], [100, 400], [100, 100]]) await clickImg(x, y)
await page.getByText('Dnevna').first().waitFor()
let st = await state()
assert.equal(st.rooms.length, 1)
assert.deepEqual(st.rooms[0].points, [{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 400 }])
// room label is centred on the room
{
  const r = await page.evaluate(() => { const t = window.Konva.stages[0].find('Text').find((n) => n.text() === 'Dnevna'); const b = t.getClientRect({ relativeTo: t.getStage() }); return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 } })
  // getClientRect relative to the stage is in plan coordinates; the room centre is (350,250)
  assert.ok(Math.abs(r.cx - 350) < 2 && Math.abs(r.cy - 250) < 3, `label at ${JSON.stringify(r)}`)
}

// conduit 1: straight down, finish with Enter → 2.60 m
await page.keyboard.press('b')
await clickImg(150, 120); await clickImg(153, 383); await page.keyboard.press('Enter')
await page.locator('.list').getByText('2.60 m').waitFor()
st = await state()
assert.deepEqual(st.conduits[0].points, [{ x: 150, y: 120 }, { x: 150, y: 380 }])

// conduit 2: 42° drag snaps to 45° on grid → (300,300), 1.41 m
await clickImg(200, 200); await clickImg(300, 296); await page.keyboard.press('Enter')
await page.locator('.list').getByText('1.41 m').waitFor()
st = await state()
assert.deepEqual(st.conduits[1].points, [{ x: 200, y: 200 }, { x: 300, y: 300 }])
assert.notEqual(st.conduits[0].color, st.conduits[1].color)

// select conduit by clicking its line, edit the name
await page.keyboard.press('v')
await clickImg(150, 250)
await page.locator('.props h3', { hasText: 'Bužir' }).waitFor()
const nameInput = page.locator('.props input').first()
assert.equal(await nameInput.inputValue(), 'B1')
await nameInput.fill('B1-ormar')
await page.locator('.list').getByText('B1-ormar').waitFor()
// "ormar" is a keyword of the Dolaz category → constant colour; "internet" switches it; a custom colour clears the category
st = await state()
assert.deepEqual([st.conduits[0].categoryId, st.conduits[0].color], ['dolaz', '#1f2430'])
await nameInput.fill('Internet dnevna')
st = await state()
assert.deepEqual([st.conduits[0].categoryId, st.conduits[0].color], ['internet', '#4363d8'])
await page.locator('.props select').first().selectOption('tv')
assert.deepEqual((await state()).conduits[0].categoryId, 'tv')
await page.locator('.props input[type=color]').fill('#123456')
st = await state()
assert.deepEqual([st.conduits[0].categoryId, st.conduits[0].color], [undefined, '#123456'])
await nameInput.fill('B1-ormar')
await page.locator('.list').getByText('B1-ormar').waitFor()

// drag the end vertex of the selected conduit (snaps to grid)
// angle snap applies relative to the previous vertex: (330,380) → 45° diag → (370,340)
const v = await toScreen(150, 380)
const v2 = await toScreen(330, 380)
await page.mouse.move(v.x, v.y); await page.mouse.down(); await page.mouse.move(v2.x, v2.y, { steps: 5 }); await page.mouse.up()
st = await state()
assert.deepEqual(st.conduits[0].points[1], { x: 370, y: 340 })

// undo the drag
await page.keyboard.press('Meta+z')
st = await state()
assert.deepEqual(st.conduits[0].points[1], { x: 150, y: 380 })

// drag a whole conduit by its line: snapped move, then a free (Alt) move
{
  const a = await toScreen(250, 250)
  const b = await toScreen(310, 250)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up()
  st = await state()
  assert.deepEqual(st.conduits[1].points, [{ x: 260, y: 200 }, { x: 360, y: 300 }])
  assert.equal(await page.evaluate(() => window.__trasa.getState().selectedId), st.conduits[1].id)
  await page.keyboard.press('Meta+z')
  assert.deepEqual((await state()).conduits[1].points, [{ x: 200, y: 200 }, { x: 300, y: 300 }])
  const c = await toScreen(313, 250)
  await page.keyboard.down('Alt')
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(c.x, c.y, { steps: 6 }); await page.mouse.up()
  await page.keyboard.up('Alt')
  st = await state()
  assert.ok(Math.abs(st.conduits[1].points[0].x - 263) < 1.5 && Math.abs(st.conduits[1].points[0].y - 200) < 1.5, JSON.stringify(st.conduits[1].points))
  await page.keyboard.press('Meta+z')
  assert.deepEqual((await state()).conduits[1].points, [{ x: 200, y: 200 }, { x: 300, y: 300 }])
  await page.keyboard.press('Escape')
}

// rotate the plan: drawing follows the image (1200x800 → 800x1200)
await openSetup(); await page.getByTitle('Rotiraj udesno').click()
st = await state()
assert.equal(st.planRotation, 90)
assert.deepEqual(st.conduits[0].points, [{ x: 680, y: 150 }, { x: 420, y: 150 }])
assert.deepEqual(st.rooms[0].points[0], { x: 700, y: 100 })
await page.waitForTimeout(200); await page.screenshot({ path: `${SHOTS}/trasa-rotated.png` })
await page.getByTitle('Rotiraj ulijevo').click()
await page.waitForTimeout(250) // refit after rotation
st = await state()
assert.equal(st.planRotation, 0)
assert.deepEqual(st.conduits[0].points, [{ x: 150, y: 120 }, { x: 150, y: 380 }])
assert.deepEqual(st.rooms[0].points[0], { x: 100, y: 100 })

// plan opacity slider drives the Konva image opacity
await openSetup(); await page.locator('input[type=range]').fill('0.4')
assert.equal((await state()).planOpacity, 0.4)
assert.equal(await page.evaluate(() => window.Konva.stages[0].findOne('Image').opacity()), 0.4)
await page.locator('input[type=range]').fill('1')
await page.locator('input[type=range]').blur() // keyboard shortcuts are ignored while an input has focus

// grid origin: click a wall corner, then snapping and the grid go through it
await page.keyboard.press('o')
await clickImg(105, 107)
st = await state()
assert.ok(Math.abs(st.gridOrigin.x - 105) < 1.5 && Math.abs(st.gridOrigin.y - 107) < 1.5, `origin ${JSON.stringify(st.gridOrigin)}`)
await page.evaluate(() => window.__trasa.getState().patchProject({ gridOrigin: { x: 105, y: 107 } }))
// the walkthrough below draws 3×1,5 everywhere; the section rules get their own step
await page.evaluate(() => window.__trasa.getState().patchProject({ rules: { feed25: false, socket25: false, flow: false }, cableStock: ['NYM-J 3x1.5', 'NYM-J 3x2.5', 'NYM-O 3x1.5', 'NYM-J 5x1.5', 'NYM-J 5x2.5', 'NYM-J 7x1.5'] }))
await page.keyboard.press('b')
await clickImg(153, 120); await clickImg(153, 300); await page.keyboard.press('Enter')
st = await state()
assert.deepEqual(st.conduits[2].points, [{ x: 155, y: 117 }, { x: 155, y: 297 }])
await page.keyboard.press('v'); await page.keyboard.press('Meta+z')
await openSetup(); await page.locator('.steps li').nth(2).getByText('Reset').click()
assert.deepEqual((await state()).gridOrigin, { x: 0, y: 0 })

// room focus: only conduits entering Dnevna stay on the canvas (B3 at x=-100 does not), camera stays put
{
  const linesOnCanvas = () => page.evaluate(() => window.Konva.stages[0].find('Line').filter((l) => l.name() && !l.closed()).map((l) => l.name()))
  const ids = (await state()).conduits.map((c) => c.id)
  assert.deepEqual((await linesOnCanvas()).sort(), [...ids].sort())
  const camBefore = await page.evaluate(() => window.__trasa.getState().camera)
  await page.getByRole('button', { name: 'Fokus Dnevna' }).click()
  await page.getByText('Fokus: Dnevna').waitFor()
  assert.deepEqual((await linesOnCanvas()).sort(), [ids[0], ids[1]].sort())
  assert.deepEqual(await page.evaluate(() => window.__trasa.getState().camera), camBefore)
  // list by category: group eye hides its conduits; the eye on a single conduit too
  await page.getByRole('tab', { name: 'Po kategoriji' }).click()
  await page.getByRole('button', { name: 'Sakrij Dolaz / napajanje' }).click()
  assert.deepEqual(await linesOnCanvas(), [ids[1]])
  await page.getByRole('button', { name: 'Prikaži Dolaz / napajanje' }).click()
  await page.getByRole('button', { name: 'Sakrij B2' }).click()
  assert.deepEqual(await linesOnCanvas(), [ids[0]])
  await page.getByRole('button', { name: 'Prikaži B2' }).click()
  // solo: only the Dolaz category stays, chip shows it, Esc clears
  await page.getByRole('button', { name: 'Samo Dolaz / napajanje' }).click()
  await page.getByText('Samo: Dolaz / napajanje').waitFor()
  assert.deepEqual(await linesOnCanvas(), [ids[0]])
  await page.keyboard.press('Escape')
  await page.getByText('Samo: Dolaz / napajanje').waitFor({ state: 'hidden' })
  assert.deepEqual((await linesOnCanvas()).sort(), [ids[0], ids[1]].sort())
  await page.getByText('Prikaži sve', { exact: true }).click()
  await page.getByText('Fokus: Dnevna').waitFor({ state: 'hidden' })
  assert.deepEqual((await linesOnCanvas()).sort(), [...ids].sort())
  // list by room: Dnevna holds B1 and B2, B3 is outside; the group's Fokus is the room focus
  await page.getByRole('tab', { name: 'Po sobama' }).click()
  await page.locator('.group', { hasText: 'Dnevna' }).locator('.group-head .count').getByText('2').waitFor()
  await page.getByRole('button', { name: 'Samo Dnevna' }).click()
  await page.getByText('Fokus: Dnevna').waitFor()
  assert.deepEqual((await linesOnCanvas()).sort(), [ids[0], ids[1]].sort())
  await page.getByText('Prikaži sve', { exact: true }).click()
  await page.getByRole('tab', { name: 'Svi' }).click()
  await page.getByRole('button', { name: 'Uklopi' }).click()
}

// HUD zoom buttons and fit
const s0 = (await page.evaluate(() => window.__trasa.getState().camera)).scale
await page.getByRole('button', { name: 'Uvećaj' }).click()
assert.ok((await page.evaluate(() => window.__trasa.getState().camera)).scale > s0)
await page.getByRole('button', { name: 'Uklopi' }).click()
await page.waitForTimeout(100)
assert.ok(Math.abs((await page.evaluate(() => window.__trasa.getState().camera)).scale - s0) < 1e-6)

// drawing outside the image works and snaps to the same grid (zoom out first so it is on screen)
const box = await page.locator('.canvas-wrap').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
// plain wheel pans (Excalidraw-style), Ctrl + wheel zooms at the pointer
{ const c0 = await page.evaluate(() => window.__trasa.getState().camera); await page.mouse.wheel(0, 120); await page.waitForTimeout(50)
  const c1 = await page.evaluate(() => window.__trasa.getState().camera); assert.equal(c1.scale, c0.scale); assert.ok(Math.abs(c1.y - (c0.y - 120)) < 1e-6, 'wheel pans'); await page.mouse.wheel(0, -120) }
await page.keyboard.down('Control')
for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 20)
await page.keyboard.up('Control')
await page.keyboard.press('b')
await clickImg(-100, 100); await clickImg(-97, 302); await page.keyboard.press('Enter')
st = await state()
assert.deepEqual(st.conduits[2].points, [{ x: -100, y: 100 }, { x: -100, y: 300 }])
await page.keyboard.press('v')

await page.screenshot({ path: `${SHOTS}/trasa-plan.png` })

// tilt: a plan scanned 3° off → Auto detects it, line align and ±1° buttons adjust it
const skewedPng = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 800)
  g.translate(600, 400); g.rotate((3 * Math.PI) / 180); g.translate(-600, -400)
  g.lineWidth = 12; g.strokeStyle = '#222'; g.strokeRect(100, 100, 1000, 600); g.strokeRect(100, 100, 500, 300); g.strokeRect(300, 400, 200, 300)
  return c.toDataURL('image/png')
})
await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'skew.png', mimeType: 'image/png', buffer: Buffer.from(skewedPng.split(',')[1], 'base64') })
await page.waitForTimeout(300)
await openSetup(); await page.getByText('Auto poravnaj').click()
await page.waitForFunction(() => Math.abs(window.__trasa.getState().project.planTilt) > 0.5)
st = await state()
assert.ok(Math.abs(st.planTilt + 3) < 0.3, `auto tilt ${st.planTilt}`)
await page.waitForTimeout(200)
await page.screenshot({ path: `${SHOTS}/trasa-tilt.png` })
await page.locator('.steps li').nth(1).getByText('Reset').click()
assert.equal((await state()).planTilt, 0)
await page.keyboard.press('a')
await clickImg(100, 100); await clickImg(600, 126)
st = await state()
// clicks land on whole screen pixels at ~0.5 zoom, so allow ~0.15°
assert.ok(Math.abs(st.planTilt + 2.98) < 0.15, `line tilt ${st.planTilt}`)
const t0 = st.planTilt
await page.getByText('−1°').click()
assert.ok(Math.abs((await state()).planTilt - (t0 - 1)) < 0.01)
await page.getByText('+0.1').click()
assert.ok(Math.abs((await state()).planTilt - (t0 - 0.9)) < 0.01)
await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z'); await page.keyboard.press('Meta+z')
assert.equal((await state()).planTilt, 0)
await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.waitForTimeout(300)

// room view: wall 1 (top) has B1 start 0.2 m away at 0.5 m from the left
await clickImg(350, 250)
await page.getByText('Otvori sobu').click()
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-nav', { hasText: 'Zid 1' }).waitFor() // first wall opens automatically
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText('0.50 m · strop').waitFor()

// wall canvas helpers: units are cm, y from the ceiling
// screen point of a wall position; snapped to the whole pixel that maps back closest to the target
const wallToScreen = async (xM, zM) => page.evaluate(([xM, zM, H]) => {
  const st = window.Konva.stages[0]
  const r = st.container().getBoundingClientRect()
  const fx = r.left + st.x() + xM * 100 * st.scaleX(), fy = r.top + st.y() + (H - zM * 100) * st.scaleY()
  const back = (px, py) => ({ xM: (px - r.left - st.x()) / st.scaleX() / 100, zM: (H - (py - r.top - st.y()) / st.scaleY()) / 100 })
  const x = [Math.floor(fx), Math.ceil(fx)].sort((a, b) => Math.abs(back(a, fy).xM - xM) - Math.abs(back(b, fy).xM - xM))[0]
  const y = [Math.floor(fy), Math.ceil(fy)].sort((a, b) => Math.abs(back(fx, a).zM - zM) - Math.abs(back(fx, b).zM - zM))[0]
  return { x, y }
}, [xM, zM, (await state()).ceilingM * 100])
const clickWall = async (xM, zM) => { const p = await wallToScreen(xM, zM); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y) }
const dragWall = async (from, to) => {
  const a = await wallToScreen(...from); const b = await wallToScreen(...to)
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up()
}

// drag the exit 1 m right along the ceiling → conduit start moves on the plan too
await dragWall([0.5, 2.6], [1.5, 2.6])
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText(/1\.(49|50|51) m · strop/).waitFor()
st = await state()
assert.ok(Math.abs(st.conduits[0].points[0].x - 250) < 1.5 && Math.abs(st.conduits[0].points[0].y - 120) < 0.01, JSON.stringify(st.conduits[0].points[0]))
await page.keyboard.press('Meta+z')
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText('0.50 m · strop').waitFor()
assert.deepEqual((await state()).conduits[0].points[0], { x: 150, y: 120 })
// vertical drag: exit height 1 m below the ceiling → 1.60 m, plan point unchanged
await dragWall([0.5, 2.6], [0.5, 1.6])
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText(/h 1\.(59|60|61)/).waitFor()
st = await state()
assert.ok(Math.abs(st.conduits[0].exitZ.start - 1.6) < 0.03, JSON.stringify(st.conduits[0].exitZ))
assert.deepEqual(st.conduits[0].points[0], { x: 150, y: 120 })
await page.keyboard.press('Meta+z')
assert.equal((await state()).conduits[0].exitZ, undefined)

// elements: box (K) at the clicked spot (1 cm snap); socket (U) snaps its x to the box
await page.keyboard.press('k')
await clickWall(1.0, 2.32)
st = await state()
assert.equal(st.elements.length, 1)
assert.deepEqual([st.elements[0].type, st.elements[0].label, st.elements[0].wall], ['box', 'K1', 0])
assert.ok(Math.abs(st.elements[0].xM - 1) < 0.015 && Math.abs(st.elements[0].zM - 2.32) < 0.015, JSON.stringify(st.elements[0]))
// pin exact values so the geometry below is deterministic despite screen-pixel rounding
await page.evaluate((id) => window.__trasa.getState().updateElement(id, { xM: 1, zM: 2.32 }), st.elements[0].id)
await page.keyboard.press('u')
await clickWall(1.02, 0.31)
st = await state()
assert.deepEqual([st.elements[1].type, st.elements[1].label, st.elements[1].xM], ['socket', 'U1', 1]) // x snapped to the box
assert.ok(Math.abs(st.elements[1].zM - 0.31) < 0.015)
await page.evaluate((id) => window.__trasa.getState().updateElement(id, { xM: 1, zM: 0.31 }), st.elements[1].id)
await page.keyboard.press('Escape')
assert.equal(await page.evaluate(() => window.__trasa.getState().wallTool), 'select')

// cable: exit B1 → corner at (1.0, 2.6) → box; cable binds to both ports
await page.keyboard.press('c')
await clickWall(0.5, 2.6)
await clickWall(1.0, 2.62)
await clickWall(1.0, 2.32)
st = await state()
assert.equal(st.cables.length, 1)
assert.deepEqual(st.cables[0].from, { kind: 'exit', conduitId: st.conduits[0].id, end: 'start' })
assert.deepEqual(st.cables[0].to, { kind: 'element', id: st.elements[0].id })
assert.deepEqual(st.cables[0].via, [{ xM: 1, zM: 2.6 }])
await page.locator('.props', { hasText: 'Kabel' }).getByText('0.78 m').waitFor()
// box → socket straight down
await clickWall(1.0, 2.32)
await clickWall(1.0, 0.31)
st = await state()
assert.equal(st.cables.length, 2)
await page.locator('.props', { hasText: 'Kabel' }).getByText('2.01 m').waitFor()

// moving the box drags both cables along (binding); Alt drag = no snap
await page.keyboard.press('v')
await dragWall([1.0, 2.32], [1.5, 2.32])
st = await state()
assert.deepEqual([st.elements[0].xM, st.elements[0].zM], [1.5, 2.32])
await page.locator('.sidebar .list li', { hasText: 'K1 → U1' }).getByText(/2\.0[0-9] m/).waitFor()
await page.locator('.sidebar .list li', { hasText: 'B1-ormar (bužir) → K1' }).getByText(/1\.0[0-9] m/).waitFor()

// deleting the socket frees that cable end at the socket's last spot
await clickWall(1.0, 0.31)
await page.locator('.props h3', { hasText: 'Utičnica' }).waitFor()
await page.keyboard.press('Delete')
st = await state()
assert.equal(st.elements.length, 1)
assert.deepEqual(st.cables[1].to, { kind: 'free', xM: 1, zM: 0.31 })
await page.keyboard.press('Meta+z')
assert.equal((await state()).elements.length, 2)
await page.screenshot({ path: `${SHOTS}/trasa-wall.png` })

// junctions (Spojevi): switch P1 controls light S1; the box derives roles, terminals and WAGOs from the drawing
{
  const ids = await page.evaluate(() => {
    const s = window.__trasa.getState()
    const room = s.project.rooms[0].id
    const box = s.project.elements.find((e) => e.type === 'box')
    const p1 = s.addElement({ roomId: room, wall: 0, type: 'switch', xM: 2.5, zM: 1.05, note: '', switchKind: 'obicni' })
    const s1 = s.addElement({ roomId: room, wall: 0, type: 'light', xM: 3.5, zM: 2.5, note: '' })
    s.updateElement(p1, { controls: [s1] })
    s.addCable({ roomId: room, wall: 0, type: 'NYM-O 3x1.5', from: { kind: 'element', id: box.id }, to: { kind: 'element', id: p1 }, via: [], note: '' })
    s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box.id }, to: { kind: 'element', id: s1 }, via: [], note: '' })
    return { box: box.id, p1, s1 }
  })
  await page.getByRole('button', { name: 'Spojevi' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).locator('.dot.ok').waitFor()
  // Spojevi opens on the room board; picking a box in the list shows that box
  await page.locator('.sbox', { has: page.locator('.sbox-head b', { hasText: /^K1$/ }) }).waitFor()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.getByText('Sve žile uparene: 5 stezaljki, 4 kabela.').waitFor()
  await page.locator('.bom div', { hasText: 'WAGO 221-413' }).getByText('3 kom').waitFor()
  await page.locator('.bom div', { hasText: 'WAGO 221-412' }).getByText('2 kom').waitFor()
  assert.equal(await page.locator('.jc-wire').count(), 12)
  // project setting: the spare grey core of the NYM-O switch cable gets a cap instead of its own WAGO
  await page.locator('.jsteps li.hdr', { hasText: '221-412 · parkirano' }).waitFor()
  await menu('Postavke projekta…')
  await page.locator('.modal.settings .choice-item', { hasText: 'Presavij i izoliraj' }).click()
  await page.locator('.modal.settings .choice-item.on', { hasText: 'Presavij i izoliraj' }).waitFor()
  await page.locator('.modal.settings button', { hasText: '✕' }).click()
  await page.locator('.bom div', { hasText: 'WAGO 221-412' }).getByText('1 kom').waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'kapica · rezerva' }).waitFor()
  await page.getByText('Sve žile uparene: 5 stezaljki, 4 kabela.').waitFor()
  assert.equal((await state()).spareCores, 'cap')
  await page.screenshot({ path: `${SHOTS}/trasa-junction-cap.png` })
  await page.evaluate(() => window.__trasa.getState().patchProject({ spareCores: 'wago' }))
  await page.locator('.bom div', { hasText: 'WAGO 221-412' }).getByText('2 kom').waitFor()
  await page.locator('.jsteps', { hasText: 'B1-ormar ← dolaz' }).waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'S1 · 221-412 · povratna P1 → svjetlo' }).waitFor()
  // step mode: first wire is the feed's brown core into L; → advances
  await page.getByRole('tab', { name: 'Korak po korak' }).click()
  await page.locator('.stepbar').getByText('1 / 12').waitFor()
  await page.locator('.stepbar p').getByText(/Smeđu žilu kabela B1-ormar ← dolaz .* stezaljci L \(221-413\), utakni u port 1/).waitFor()
  await page.keyboard.press('ArrowRight')
  await page.locator('.stepbar').getByText('2 / 12').waitFor()
  assert.equal(await page.locator('.jc-wire.dim').count(), 10)
  // unlink the light: the switch and the light both get warnings, the dot turns yellow
  await page.evaluate(({ p1 }) => window.__trasa.getState().updateElement(p1, { controls: [] }), ids)
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).locator('.dot.warn').waitFor()
  await page.locator('.junctions-list .checks').getByText(/Prekidač P1 ne pali nijedno svjetlo/).waitFor()
  await page.locator('.junctions-list .checks').getByText(/Svjetlo S1 nitko ne pali/).waitFor()
  await page.evaluate(({ p1, s1 }) => window.__trasa.getState().updateElement(p1, { controls: [s1] }), ids)
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).locator('.dot.ok').waitFor()
  await page.screenshot({ path: `${SHOTS}/trasa-junction.png` })
  // whole room on one board: a card per box, back to steps through "Otvori"
  await page.getByRole('tab', { name: 'Cijela soba' }).click()
  await page.locator('.sbox', { has: page.locator('.sbox-head b', { hasText: /^K1$/ }) }).waitFor()
  assert.equal(await page.locator('.sidebar .jsteps').count(), 0, 'per-box sidebar hidden on the board')
  await page.locator('.sbox', { has: page.locator('.sbox-head b', { hasText: /^K1$/ }) }).click()
  await page.locator('.jsteps li.hdr', { hasText: 'L · 221-413 · faza' }).waitFor()
  assert.equal(await page.locator('.stepbar').count(), 0, 'opens in Sve žile, not steps')
  // one box on an A4 sheet
  await page.getByRole('button', { name: 'Ispiši kutiju' }).click()
  await page.locator('.page-landscape h1', { hasText: 'K1' }).waitFor()
  await page.locator('.pb-card', { hasText: 'Gdje je' }).waitFor()
  assert.equal(await page.locator('.pb-junction').count(), 1)
  assert.equal(await page.locator('.pb-terminals').count(), 0)
  await page.screenshot({ path: `${SHOTS}/trasa-printbox.png`, fullPage: true })
  await page.getByRole('button', { name: 'Natrag na spojeve' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).waitFor()
  // back to the wall with the box selected; the wall props show the derived role and the switch's lights
  await page.getByRole('button', { name: 'Otvori na zidu' }).click()
  await page.locator('.props h3', { hasText: 'Razvodna kutija' }).waitFor()
  await page.evaluate(({ p1 }) => window.__trasa.getState().select(p1), ids)
  await page.locator('.props .controls input[type=checkbox]').waitFor()
  assert.equal(await page.locator('.props .controls input[type=checkbox]').isChecked(), true)
  await page.evaluate(() => { const s = window.__trasa.getState(); s.select(s.project.cables[1].id) })
  await page.locator('.props select', { hasText: 'izvedeno: Utičnica' }).waitFor()
  // phase 2: modular frame D1 with a button T1 and a Shelly R1; S1 is now fed by R1 output 1.
  // K1 → D1 is drawn with 3×1.5 first: the box needs 4 cores (L N PE + O) and says so.
  const ids2 = await page.evaluate(({ s1, p1 }) => {
    const s = window.__trasa.getState()
    const room = s.project.rooms[0].id
    const box = s.project.elements.find((e) => e.type === 'box')
    // the classic switch P1 and its cable go away: the relay takes over
    s.select(p1); s.removeSelected()
    s.patchProject({ cables: s.project.cables.filter((x) => !(x.to.kind === 'element' && x.to.id === p1)) })
    const d1 = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 4, zM: 1.05, note: '', modules: 3, depth: 'duboka' })
    const t1 = s.addElement({ roomId: room, wall: 0, type: 'switch', xM: 4, zM: 1.05, note: '', host: d1, switchKind: 'tipkalo' })
    const r1 = s.addElement({ roomId: room, wall: 0, type: 'relay', xM: 4, zM: 1.05, note: '', host: d1, relayModel: 'gen4' })
    s.updateElement(t1, { relayId: r1, relayInput: 1 })
    s.updateElement(s1, { feedRelayId: r1, feedOutput: 1 })
    const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box.id }, to: { kind: 'element', id: d1 }, via: [], note: '' })
    return { d1, t1, r1, c }
  }, ids)
  await page.getByRole('button', { name: 'Spojevi' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'D1' }).click()
  await page.locator('.junctions-list .checks').getByText(/Kabel D1 modularna doza treba 4 žila \(L, N, PE, S1\), nema mjesta za S1\. Rješenje: 5×1,5/).waitFor()
  await page.evaluate(({ c }) => window.__trasa.getState().updateCable(c, { type: 'NYM-J 5x1.5' }), ids2)
  await page.locator('.junctions-list .list li', { hasText: 'D1' }).locator('.dot.ok').waitFor()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).locator('.dot.ok').waitFor()
  // D1: L has the cable core + relay L + button 1; the button's return goes straight to the relay SW1 (no WAGO)
  await page.locator('.jsteps li.hdr', { hasText: 'L · 221-413 · faza' }).waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'SW1 · izravno · R1 ulaz 1 ← tipkalo' }).waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'S1 · izravno · R1 izlaz 1 → svjetlo' }).waitFor()
  await page.locator('.bom div', { hasText: 'Shelly 1 Gen4' }).getByText('1 kom').waitFor()
  // the Plus 1 shows its I terminal; in light mode a short jumper bridges L to I on the device
  await page.locator('.jsteps li.hdr', { hasText: 'L→I · izravno · premosnica na Shellyju' }).waitFor()
  await page.getByText('Sve žile uparene: 7 stezaljki, 1 kabela, 2 uređaja.').waitFor()
  await page.screenshot({ path: `${SHOTS}/trasa-doza.png` })
  // the same frame with a Sonoff ZBMINIR2: the button goes to S1/S2 (low voltage), the light leaves on Lout, no L→I jumper
  await page.evaluate(({ r1 }) => window.__trasa.getState().updateElement(r1, { relayModel: 'zbminir2' }), ids2)
  await page.locator('.jsteps li.hdr', { hasText: 'S1 · izravno · tipkalo → R1 S1, niski napon' }).waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'S2 · izravno · tipkalo → R1 S2, niski napon' }).waitFor()
  assert.equal(await page.locator('.jsteps li.hdr', { hasText: 'L→I' }).count(), 0)
  await page.locator('.bom div', { hasText: 'Sonoff ZBMINIR2' }).getByText('1 kom').waitFor()
  await page.screenshot({ path: `${SHOTS}/trasa-sonoff.png` })
  await page.evaluate(({ r1 }) => window.__trasa.getState().updateElement(r1, { relayModel: 'gen4' }), ids2)
  await page.locator('.jsteps li.hdr', { hasText: 'L→I' }).waitFor()
  // garage door: a Plus 1 in K1 drives a door unit V1 as a dry contact (I/O → impuls), fed by a 5×1,5
  const gar = await page.evaluate(({ box }) => {
    // (box id comes from the first junction block)
    const s = window.__trasa.getState()
    const room = s.project.rooms[0].id
    const r2 = s.addElement({ roomId: room, wall: 0, type: 'relay', xM: 2, zM: 2.3, note: '', host: box, relayModel: 'gen4' })
    const v1 = s.addElement({ roomId: room, wall: 0, type: 'motor', xM: 4.2, zM: 2.3, note: '', feedRelayId: r2 })
    const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: v1 }, via: [], note: '' })
    return { r2, v1, c }
  }, ids)
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.locator('.junctions-list .checks').getByText(/Kabel do V1 \(NYM-J 3x1.5\) nema 2 slobodne žile za impuls: uzmi 5×1,5/).waitFor()
  await page.evaluate(({ c }) => window.__trasa.getState().updateCable(c, { type: 'NYM-J 5x1.5' }), gar)
  await page.locator('.jsteps li.hdr', { hasText: 'IMP1 · izravno · impuls R2: suhi kontakt, bez napona' }).waitFor()
  await page.locator('.jsteps li.hdr', { hasText: 'IMP2 · izravno · impuls R2: suhi kontakt, bez napona' }).waitFor()
  assert.equal(await page.locator('.jsteps li.hdr', { hasText: 'L→I' }).count(), 0, 'R2 in pulse mode has no L→I jumper (R1 with its jumper sits in D1)')
  await page.locator('.bom div', { hasText: 'Shelly 1 Gen4' }).getByText('1 kom').waitFor()
  await page.screenshot({ path: `${SHOTS}/trasa-vrata.png` })
  // power and pulse may come over two cables: 3×1,5 for L N PE and a separate control pair; two control cables
  // through one conduit each keep their own door (cables through a conduit pair one-to-one)
  const sep = await page.evaluate(({ box, v1, c, r2 }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    s.updateCable(c, { type: 'NYM-J 3x1.5' }); s = window.__trasa.getState()
    const r9 = s.addElement({ roomId: room, wall: 0, type: 'relay', xM: 2, zM: 2.3, note: '', host: box, relayModel: 'gen4' })
    const v2 = s.addElement({ roomId: room, wall: 0, type: 'motor', xM: 4.4, zM: 2.3, note: '', feedRelayId: r9 })
    const cd = s.addConduit([{ x: 300, y: 20 }, { x: 300, y: 102 }]); s = window.__trasa.getState()
    const cab = (type, f, t) => { const id = s.addCable({ roomId: room, wall: 0, type, from: f, to: t, via: [], note: '' }); s = window.__trasa.getState(); return id }
    const el = (id) => ({ kind: 'element', id }), ex = (end) => ({ kind: 'exit', conduitId: cd, end })
    const ids = [cab('NYM-J 3x1.5', el(box), el(v2)), cab('upravljački 2x0.75', el(box), ex('start')), cab('upravljački 2x0.75', el(box), ex('start')), cab('upravljački 2x0.75', ex('end'), el(v1)), cab('upravljački 2x0.75', ex('end'), el(v2))]
    const P = window.__trasa.getState().project
    const k1 = E.allJunctions(P).find((j) => j.box.id === box)
    const leaf = (id) => E.allLeafJunctions(P).find((j) => j.box.id === id)
    const imp = k1.terminals.filter((t) => t.id.startsWith('IMP:')).map((t) => t.wires.length)
    const out = { imp, k1err: k1.checks.filter((x) => x.level === 'err').map((x) => x.text), v1: leaf(v1).level, v2: leaf(v2).level, v1imp: leaf(v1).terminals.filter((t) => t.id.startsWith('IMP')).map((t) => t.wires.find((w) => w.kind === 'core')?.cableId) }
    s = window.__trasa.getState(); s.updateCable(c, { type: 'NYM-J 5x1.5' }); s = window.__trasa.getState()
    const drop = new Set([...ids, r9, v2, cd]); s.patchProject({ cables: s.project.cables.filter((x) => !drop.has(x.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)), conduits: s.project.conduits.filter((x) => !drop.has(x.id)) })
    return { ...out, ctl1: ids[3] } }, { box: ids.box, ...gar })
  assert.deepEqual(sep.imp, [2, 2, 2, 2], 'each door pulse pair lands on its own relay I/O in K1')
  assert.deepEqual(sep.k1err, [], 'a 3×1,5 is enough once a control cable carries the pulse')
  assert.equal(sep.v1, 'ok'); assert.equal(sep.v2, 'ok')
  assert.deepEqual(sep.v1imp, [sep.ctl1, sep.ctl1], 'V1 takes its pulse from its own control cable')
  // the door props offer only Plus 1 relays
  await page.evaluate(({ v1 }) => { const s = window.__trasa.getState(); s.setView({ kind: 'room', roomId: s.project.rooms[0].id, wall: 0 }); s.select(v1) }, gar)
  await page.locator('.props h3', { hasText: 'Vrata / motor' }).waitFor()
  await page.locator('.props label', { hasText: 'Pali ga relej' }).locator('option', { hasText: 'R2 Shelly 1 Gen4' }).waitFor({ state: 'attached' })
  // a second box fed from K1 through a 5×1,5 is fed too (daisy chain), not "bez dolaza"
  const k3 = await page.evaluate(({ box }) => { const s = window.__trasa.getState(); const room = s.project.rooms[0].id; const k3 = s.addElement({ roomId: room, wall: 0, type: 'box', xM: 4.6, zM: 2.3, note: '', label: 'K3' }); const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 5x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: k3 }, via: [], note: '' }); return { k3, c } }, ids)
  await page.getByRole('button', { name: 'Spojevi' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'K3' }).click()
  assert.equal(await page.locator('.junction-main .room-head h2', { hasText: 'K3' }).count(), 1)
  assert.equal(await page.locator('.checks').getByText(/nema dolaza/).count(), 0)
  // a relay in K3 driven by the tipkalo in D1: the signal rides D1 → K1 → K3, K1 passes it through a 412
  const r3 = await page.evaluate(({ k3, t1 }) => { const s = window.__trasa.getState(); const r3 = s.addElement({ roomId: s.project.rooms[0].id, wall: 0, type: 'relay', xM: 4.6, zM: 2.3, note: '', host: k3, relayModel: 'gen4', label: 'R3' }); s.updateElement(t1, { relayId: r3, relayInput: 1 }); return r3 }, { k3: k3.k3, t1: ids2.t1 })
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.locator('.jsteps li.hdr', { hasText: 'SW1 · 221-412 · R3 ulaz 1 ← tipkalo' }).waitFor()
  await page.locator('.junctions-list .list li', { hasText: 'K3' }).click()
  await page.locator('.jsteps li.hdr', { hasText: 'SW1 · izravno · R3 ulaz 1 ← tipkalo' }).waitFor()
  await page.evaluate(({ t1, r1 }) => window.__trasa.getState().updateElement(t1, { relayId: r1, relayInput: 1 }), ids2)
  await page.evaluate(({ k3, c, r3 }) => { const s = window.__trasa.getState(); s.patchProject({ cables: s.project.cables.filter((x) => x.id !== c), elements: s.project.elements.filter((e) => e.id !== k3 && e.id !== r3) }) }, { ...k3, r3 })
  // an RJ45 keystone in a frame: the UTP cable lands on it directly, no WAGO, and the material lists the module
  const rj = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const cd = s.addConduit([{ x: 300, y: 30 }, { x: 300, y: 98 }]); s = window.__trasa.getState(); s.updateConduit(cd, { name: 'DOLAZ INTERNET', categoryId: 'internet' }); s = window.__trasa.getState()
    const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 2.6, zM: 0.3, modules: 3, note: '' }); const r = s.addElement({ roomId: room, wall: 0, type: 'socket', socketKind: 'rj45', xM: 2.6, zM: 0.3, note: '', host: d })
    const c1 = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: d }, via: [], note: '' }); const c2 = s.addCable({ roomId: room, wall: 0, type: 'UTP cat6', from: { kind: 'exit', conduitId: cd, end: 'end' }, to: { kind: 'element', id: d }, via: [], note: '' })
    const j = window.__trasaEngine.allJunctions(window.__trasa.getState().project).find((x) => x.box.id === d)
    return { d, r, cd, c1, c2, utp: j.terminals.find((t) => t.label === 'UTP'), checks: j.checks.map((c) => c.level) } }, ids)
  assert.equal(rj.utp?.wago, 0, 'UTP goes straight onto the keystone, no WAGO'); assert.equal(rj.utp?.wires.length, 2); assert.ok(!rj.checks.includes('err') && !rj.checks.includes('warn'), 'RJ45 frame has no complaints')
  await page.evaluate(() => window.__trasa.getState().setView({ kind: 'bom' }))
  await page.getByText('KM32 · utičnica RJ45 CAT6a', { exact: false }).first().waitFor()
  await page.evaluate(({ rj }) => { const s = window.__trasa.getState(); s.patchProject({ cables: s.project.cables.filter((c) => c.id !== rj.c1 && c.id !== rj.c2), elements: s.project.elements.filter((e) => e.id !== rj.d && e.id !== rj.r), conduits: s.project.conduits.filter((c) => c.id !== rj.cd) }); s.setView({ kind: 'junctions', elementId: null }) }, { rj })

  // classic three-way chain: two-way at the ends, a cross switch in the middle, travellers on a direct frame-to-frame cable
  const cx = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const light = s.addElement({ roomId: room, wall: 0, type: 'light', xM: 2, zM: 2.6, note: '' }); s = window.__trasa.getState()
    const lc = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: light }, via: [], note: '' }); s = window.__trasa.getState()
    const fr = [0.6, 1.4, 2.2].map((x) => { const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: x, zM: 1.05, modules: 3, note: '' }); s = window.__trasa.getState(); return d })
    const kinds = ['izmjenicni', 'krizni', 'izmjenicni']
    const sws = fr.map((d, i) => { const t = s.addElement({ roomId: room, wall: 0, type: 'switch', switchKind: kinds[i], xM: 0, zM: 1.05, note: '', host: d, controls: [light] }); s = window.__trasa.getState(); return t })
    const feed = fr.map((d) => { const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 5x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: d }, via: [], note: '' }); s = window.__trasa.getState(); return c })
    const direct = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 5x1.5', from: { kind: 'element', id: fr[1] }, to: { kind: 'element', id: fr[2] }, via: [], note: '' }); s = window.__trasa.getState()
    const P = s.project
    const need = (id) => { const n = E.cableNeeds(P.cables.find((c) => c.id === id), P); return n.signals.map((t) => E.terminalMeta(t, P).label).join(',') }
    const mid = E.allJunctions(P).find((j) => j.box.id === fr[1])
    return { feeds: feed.map(need), direct: need(direct), midPorts: mid.devices[0].ports.length, bad: E.allJunctions(P).filter((j) => fr.includes(j.box.id) || j.box.id === box).flatMap((j) => j.checks.filter((c) => c.level === 'err').map((c) => c.text)), ids: [light, lc, ...fr, ...sws, ...feed, direct] } }, ids)
  assert.deepEqual(cx.feeds, ['L,N,PE,p1,p2', 'L,N,PE,p1,p2', 'L,N,PE,S'.replace('S', cx.feeds[2].split(',')[3])], 'first two frames get the first traveller pair, the last one only the return')
  assert.equal(cx.direct, 'L,N,PE,p1′,p2′', 'the direct cable carries the second traveller pair')
  assert.equal(cx.midPorts, 4, 'a cross switch has four terminals'); assert.deepEqual(cx.bad, [], 'no errors in the chain')
  await page.evaluate(({ cx }) => { const s = window.__trasa.getState(); const drop = new Set(cx.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) }) }, { cx })

  // any conduit can be flagged as the supply from the board (e.g. a TODO one): its cable feeds the box
  const fd = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const k = s.addElement({ roomId: room, wall: 0, type: 'box', xM: 3.6, zM: 2.3, note: '' }); s = window.__trasa.getState()
    const cd = s.addConduit([{ x: 480, y: 20 }, { x: 480, y: 102 }]); s = window.__trasa.getState(); s.updateConduit(cd, { name: 'TODO dolaz', categoryId: 'todo' }); s = window.__trasa.getState()
    const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'exit', conduitId: cd, end: 'end' }, to: { kind: 'element', id: k }, via: [], note: '' }); s = window.__trasa.getState()
    const before = E.allJunctions(s.project).find((j) => j.box.id === k).checks.some((x) => /nema dolaza/.test(x.text))
    s.updateConduit(cd, { feed: true }); s = window.__trasa.getState()
    const j = E.allJunctions(s.project).find((x) => x.box.id === k)
    return { before, after: j.checks.some((x) => /nema dolaza/.test(x.text)), role: j.cables[0].role, cat: s.project.conduits.find((x) => x.id === cd).categoryId, ids: [k, cd, c] } }, ids)
  assert.ok(fd.before && !fd.after, 'flagging the conduit as a feed gives the box its supply'); assert.equal(fd.role, 'feed'); assert.equal(fd.cat, 'todo')
  await page.evaluate(({ fd }) => { const s = window.__trasa.getState(); const drop = new Set(fd.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)), conduits: s.project.conduits.filter((c) => !drop.has(c.id)) }) }, { fd })

  // every wall tool is in the rail
  await page.evaluate(() => { const s = window.__trasa.getState(); s.setView({ kind: 'room', roomId: s.project.rooms[0].id, wall: 0 }) })
  for (const name of ['Kabel', 'Bojler', 'KIP · izjednačenje potencijala', 'Vrata / motor', 'Uređaj (indukcija, pećnica, napa, klima)']) await page.locator('.tool-rail').getByRole('button', { name, exact: true }).waitFor({ state: 'attached' })
  // two supplies meeting in one frame is an error (the drawing would bridge two circuits); a leaf beyond it is not flagged
  const two = await page.evaluate(() => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const mk = (name, x) => { const cd = s.addConduit([{ x, y: 20 }, { x, y: 102 }]); s = window.__trasa.getState(); s.updateConduit(cd, { name, categoryId: 'dolaz' }); s = window.__trasa.getState(); return cd }
    const a = mk('DOLAZ A', 420), b = mk('DOLAZ B', 470)
    const ka = s.addElement({ roomId: room, wall: 0, type: 'box', xM: 3.2, zM: 2.3, note: '' }), kb = s.addElement({ roomId: room, wall: 0, type: 'box', xM: 3.7, zM: 2.3, note: '' }), d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 3.5, zM: 1.1, modules: 3, note: '' }), d2 = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 3.5, zM: 0.4, modules: 3, note: '' }); s = window.__trasa.getState()
    const cab = (f, t) => { const id = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: f, to: t, via: [], note: '' }); s = window.__trasa.getState(); return id }
    const cs = [cab({ kind: 'exit', conduitId: a, end: 'end' }, { kind: 'element', id: ka }), cab({ kind: 'exit', conduitId: b, end: 'end' }, { kind: 'element', id: kb }), cab({ kind: 'element', id: ka }, { kind: 'element', id: d }), cab({ kind: 'element', id: kb }, { kind: 'element', id: d }), cab({ kind: 'element', id: d }, { kind: 'element', id: d2 })]
    const P = window.__trasa.getState().project
    const j = E.allJunctions(P).find((x) => x.box.id === d)
    const Ls = j.terminals.filter((t) => /^L@/.test(t.id)).map((t) => t.desc)
    const tie = j.checks.some((c) => c.level === 'err' && /ne zna se na kojem/.test(c.text))
    // pick the circuit for the branch to d2: the tie error goes away
    s.updateCable(cs[4], { circuit: a }); s = window.__trasa.getState()
    const j2 = E.allJunctions(s.project).find((x) => x.box.id === d)
    const pe = j2.terminals.filter((t) => t.id === 'PE').length
    return { Ls, tie, tieAfter: j2.checks.some((c) => c.level === 'err' && /ne zna se na kojem/.test(c.text)), pe, d2: E.allJunctions(s.project).find((x) => x.box.id === d2).terminals.some((t) => t.id.includes('@')), ids: [ka, kb, d, d2, ...cs], cds: [a, b] } })
  assert.deepEqual(two.Ls.sort(), ['faza · DOLAZ A', 'faza · DOLAZ B'], 'each circuit keeps its own L'); assert.equal(two.pe, 1, 'PE stays common')
  assert.ok(two.tie && !two.tieAfter, 'an equidistant branch asks for its circuit; choosing one settles it'); assert.ok(!two.d2, 'a single-circuit frame keeps plain L / N')
  await page.evaluate(({ two }) => { const s = window.__trasa.getState(); const drop = new Set([...two.ids, ...two.cds]); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)), conduits: s.project.conduits.filter((c) => !drop.has(c.id)) }) }, { two })

  // a LED strip with a Plus RGBW PM: its supply stays live (plain L N PE), the push button is a 24 V pair over a control cable
  const led = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const n = s.addElement({ roomId: room, wall: 0, type: 'ledpsu', xM: 3.6, zM: 1.75, note: '', ledM: 2.4 }); s = window.__trasa.getState()
    const r = s.addElement({ roomId: room, wall: 0, type: 'relay', relayModel: 'rgbw', host: n, xM: 3.6, zM: 1.75, note: '' })
    const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 3.9, zM: 1.1, modules: 2, note: '' }); s = window.__trasa.getState()
    const t = s.addElement({ roomId: room, wall: 0, type: 'switch', switchKind: 'tipkalo', host: d, xM: 3.9, zM: 1.1, note: '', relayId: r, relayInput: 1 }); s = window.__trasa.getState()
    const cab = (type, f, to) => { const id = s.addCable({ roomId: room, wall: 0, type, from: { kind: 'element', id: f }, to: { kind: 'element', id: to }, via: [], note: '' }); s = window.__trasa.getState(); return id }
    const cs = [cab('NYM-J 3x1.5', box, n), cab('upravljački 2x0.75', d, n)]
    const P = window.__trasa.getState().project
    const jk = E.allJunctions(P).find((j) => j.box.id === box), jd = E.allJunctions(P).find((j) => j.box.id === d)
    const jl = E.allLeafJunctions(P).find((j) => j.box.id === n)
    const out = { n, drop: [n, r, d, t, ...cs], strip: jk.cables.find((c) => c.cable.id === cs[0]).wires.map((w) => w.terminal), dErr: jd.checks.filter((c) => c.level !== 'ok').map((c) => c.text), dT: jd.terminals.map((x) => x.label).sort(), leafT: jl.terminals.map((x) => x.label).sort(), leafLevel: jl.level }
    s.setView({ kind: 'junctions', elementId: n })
    return out }, { box: ids.box })
  await page.locator('.junction-main .room-head h2', { hasText: 'LED traka' }).waitFor()
  await page.locator('.checks').getByText(/napajanje 24 V od barem 30 W/).waitFor()
  await page.evaluate(({ drop }) => { const s = window.__trasa.getState(); const d = new Set(drop); s.patchProject({ cables: s.project.cables.filter((x) => !d.has(x.id)), elements: s.project.elements.filter((e) => !d.has(e.id)) }) }, led)
  assert.deepEqual(led.leafT, ['+24', 'L', 'N', 'PE', 'SW1'], 'the LED socket shows L N PE and the button pair on the controller'); assert.equal(led.leafLevel, 'ok')
  assert.deepEqual(led.strip, ['L', 'N', 'PE'], 'the LED supply is fed straight, not through a switch')
  assert.deepEqual(led.dErr, [], 'a frame with only a 24 V push button needs no phase')
  assert.deepEqual(led.dT, ['+24', 'SW1'], 'the button lands on the controller +24 V and SW1')

  // a 2×7M box: two rows of seven, a šuko never straddles the rows (6 fit, the 7th does not)
  const two7 = await page.evaluate(() => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 2.4, zM: 0.4, modules: 14, note: '' }); s = window.__trasa.getState()
    const add = () => { const id = s.addElement({ roomId: room, wall: 0, type: 'socket', xM: 2.4, zM: 0.4, note: '', host: d }); s = window.__trasa.getState(); return id }
    const us = Array.from({ length: 6 }, add)
    const err = () => E.allJunctions(window.__trasa.getState().project).find((j) => j.box.id === d).checks.some((c) => c.level === 'err' && /Doza je 2×7M/.test(c.text))
    const six = err(); us.push(add()); const seven = err()
    const drop = new Set([d, ...us]); s = window.__trasa.getState(); s.patchProject({ elements: s.project.elements.filter((e) => !drop.has(e.id)) })
    return { six, seven } })
  assert.deepEqual(two7, { six: false, seven: true }, '2×7M holds six šuko, a seventh would straddle the rows')

  // a split AC is a fixed connection that needs 2,5 mm²
  const ac = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const a = s.addElement({ roomId: room, wall: 0, type: 'appliance', appliance: 'ac', xM: 3.4, zM: 2.2, note: '' }); s = window.__trasa.getState()
    const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: a }, via: [], note: '' }); s = window.__trasa.getState()
    const thin = E.allLeafJunctions(s.project).find((j) => j.box.id === a).checks.some((x) => x.level === 'err' && /Klima .* treba barem 2,5 mm²/i.test(x.text))
    s.updateCable(c, { type: 'NYM-J 3x2.5' }); s = window.__trasa.getState()
    const ok = !E.allLeafJunctions(s.project).find((j) => j.box.id === a).checks.some((x) => x.level === 'err')
    s.patchProject({ cables: s.project.cables.filter((x) => x.id !== c), elements: s.project.elements.filter((e) => e.id !== a) })
    return { thin, ok } }, { box: ids.box })
  assert.deepEqual(ac, { thin: true, ok: true }, 'a split AC on 3×1,5 is an error, on 3×2,5 it is fine')

  // a switch can drive a light in another room (a terrace light switched from inside)
  const xr = await page.evaluate(() => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id
    const other = s.addRoom([{ x: 900, y: 900 }, { x: 1000, y: 900 }, { x: 1000, y: 1000 }], 'Terasa X'); s = window.__trasa.getState()
    const lx = s.addElement({ roomId: other, wall: 0, type: 'light', xM: 0.5, zM: 2.2, note: '', label: 'SX' }); s = window.__trasa.getState()
    const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 0.3, zM: 1.1, modules: 2, note: '' }); s = window.__trasa.getState()
    const sw = s.addElement({ roomId: room, wall: 0, type: 'switch', xM: 0.3, zM: 1.1, note: '', host: d }); s = window.__trasa.getState()
    s.setView({ kind: 'room', roomId: room, wall: 0 }); s.select(sw)
    return { other, lx, d, sw } })
  await page.locator('.props select[aria-label="Svjetlo u drugoj sobi"]').selectOption(xr.lx)
  await page.locator('.props label.inline', { hasText: 'Terasa X' }).waitFor()
  assert.deepEqual(await page.evaluate(({ sw }) => window.__trasa.getState().project.elements.find((e) => e.id === sw).controls, xr), [xr.lx])
  await page.evaluate(({ other, lx, d, sw }) => { const s = window.__trasa.getState(); const drop = new Set([lx, d, sw]); s.patchProject({ elements: s.project.elements.filter((e) => !drop.has(e.id)), rooms: s.project.rooms.filter((r) => r.id !== other) }) }, xr)

  // a LED supply without a controller: control cables leaving it are its 24 V outputs, joined in parallel (V+ / V−)
  const psu = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const n = s.addElement({ roomId: room, wall: 0, type: 'ledpsu', xM: 3.8, zM: 0.3, note: '', ledM: 3, ledWpm: 6 }); s = window.__trasa.getState()
    const cab = (type, f, t) => { const id = s.addCable({ roomId: room, wall: 0, type, from: f, to: t, via: [], note: '' }); s = window.__trasa.getState(); return id }
    const el = (id) => ({ kind: 'element', id })
    const cs = [cab('NYM-J 3x1.5', el(box), el(n)), ...[0, 1, 2].map(() => cab('upravljački 2x0.75', el(n), { kind: 'corner', corner: 1, zM: 0.3 }))]
    const j = E.allLeafJunctions(window.__trasa.getState().project).find((x) => x.box.id === n)
    const out = { vplus: j.terminals.find((t) => t.id === 'V+')?.wires.length, vminus: j.terminals.find((t) => t.id === 'V-')?.wires.length, wago: j.terminals.find((t) => t.id === 'V+')?.wago }
    s = window.__trasa.getState(); const drop = new Set([n, ...cs]); s.patchProject({ cables: s.project.cables.filter((x) => !drop.has(x.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) })
    return out }, { box: ids.box })
  assert.deepEqual(psu, { vplus: 4, vminus: 4, wago: 415 }, 'three strips and the supply output share one 5-way WAGO per pole')

  // section rules and cable bundles, on a small project of their own: feeds and socket circuits need 2,5 mm²,
  // a thicker cable after a thinner one is flagged, and two cables between the same boxes share the cores
  const rules = await page.evaluate(() => { const E = window.__trasaEngine
    const room = { id: 'rr', name: 'R', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }], walls: {} }
    const e = (o) => ({ roomId: 'rr', wall: 0, note: '', ...o })
    const cab = (id, type, f, t) => ({ id, roomId: 'rr', wall: 0, type, from: f, to: t, via: [], note: '' })
    const el = (id) => ({ kind: 'element', id })
    const base = (feed, link, sock) => ({ ...window.__trasa.getState().project, rules: undefined, cableStock: ['NYM-J 3x1.5', 'NYM-J 3x2.5', 'NYM-J 5x1.5'], rooms: [room],
      conduits: [{ id: 'fd', name: 'DOLAZ', points: [{ x: 200, y: -50 }, { x: 200, y: 0 }], categoryId: 'dolaz', color: '#000' }],
      elements: [e({ id: 'k', label: 'K1', type: 'box', xM: 2, zM: 2.3 }), e({ id: 'k2', label: 'K2', type: 'box', xM: 4, zM: 2.3 }), e({ id: 'u', label: 'U1', type: 'socket', xM: 4.5, zM: 0.3 })],
      cables: [cab('f', feed, { kind: 'exit', conduitId: 'fd', end: 'end' }, el('k')), cab('l', link, el('k'), el('k2')), cab('s', sock, el('k2'), el('u'))] })
    const errs = (p) => E.allJunctions(p).flatMap((j) => j.checks.filter((c) => c.level !== 'ok').map((c) => c.text))
    const thin = errs(base('NYM-J 3x1.5', 'NYM-J 3x1.5', 'NYM-J 3x1.5'))
    const good = errs(base('NYM-J 3x2.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'))
    const bed = base('NYM-J 3x2.5', 'NYM-J 3x1.5', 'NYM-J 3x1.5'); bed.rooms = [{ ...room, name: 'Spavaća soba' }]
    const bedroom = errs(bed).filter((t) => /utičnica/.test(t)).length
    // a light hanging off the socket box on 1,5 is fine: it never carries socket current
    const lit = base('NYM-J 3x2.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'); lit.elements.push(e({ id: 'sl', label: 'S9', type: 'light', xM: 5, zM: 2.6 }), e({ id: 'sp', label: 'P9', type: 'switch', xM: 5, zM: 1.1, controls: ['sl'] }))
    lit.cables.push(cab('ll', 'NYM-J 3x1.5', el('k2'), el('sl')), cab('lp', 'NYM-O 3x1.5', el('k2'), el('sp')))
    const branch = errs(lit).filter((t) => /utičnica/.test(t)).length
    // a frame with a socket and two switches for lamps off K1: L N PE carry socket current (2,5), the returns do not
    const mix = base('NYM-J 3x2.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'); mix.elements.push(e({ id: 'dm', label: 'D9', type: 'modbox', xM: 1, zM: 1.1, modules: 4 }), e({ id: 'um', label: 'U9', type: 'socket', host: 'dm', xM: 1, zM: 1.1 }))
    for (let i = 0; i < 2; i++) { mix.elements.push(e({ id: 'ml' + i, label: 'S' + (7 + i), type: 'light', xM: 3, zM: 2.6 }), e({ id: 'mp' + i, label: 'P' + (7 + i), type: 'switch', host: 'dm', xM: 1, zM: 1.1, controls: ['ml' + i] })); mix.cables.push(cab('mc' + i, 'NYM-J 3x1.5', el('k'), el('ml' + i))) }
    mix.cables.push(cab('mx', 'NYM-J 5x1.5', el('k'), el('dm')))
    const mixFix = E.cableNeeds(mix.cables.find((c) => c.id === 'mx'), mix).suggest
    const mix2 = { ...mix, cables: [...mix.cables.map((c) => (c.id === 'mx' ? { ...c, type: 'NYM-J 3x2.5' } : c)), cab('my', 'NYM-J 5x1.5', el('k'), el('dm'))] }
    const mixErr = errs(mix2).filter((t) => /žila|utičnica/.test(t)).length
    const p3 = base('NYM-J 3x1.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'); p3.rules = { feed25: false, socket25: false }
    const grow = errs(p3)
    // bundle: four switches in D1 lighting four lamps off K1 need L N PE + 4 returns = 7 cores
    const b = base('NYM-J 3x2.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'); b.rules = { socket25: false }
    // the socket in D1 wants N, so the bundle keeps L N PE on its first cable
    b.elements.push(e({ id: 'd', label: 'D1', type: 'modbox', xM: 1, zM: 1.1, modules: 7 }), e({ id: 'du', label: 'U7', type: 'socket', host: 'd', xM: 1, zM: 1.1 }))
    for (let i = 0; i < 4; i++) { b.elements.push(e({ id: 'l' + i, label: 'S' + i, type: 'light', xM: 3 + i * 0.3, zM: 2.6 }), e({ id: 'p' + i, label: 'P' + i, type: 'switch', host: 'd', xM: 1, zM: 1.1, controls: ['l' + i] })); b.cables.push(cab('c' + i, 'NYM-J 3x1.5', el('k'), el('l' + i))) }
    b.cables.push(cab('b0', 'NYM-J 5x1.5', el('k'), el('d')), cab('b1', 'NYM-J 3x1.5', el('k'), el('d')))
    const short = E.cableNeeds(b.cables.find((c) => c.id === 'b0'), b)
    const strict = E.cableNeeds(b.cables.find((c) => c.id === 'b0'), { ...b, rules: { socket25: false, blueReturn: false } }).suggest
    // fifth return: only green-yellow is left in the second 3×1,5
    const g5 = { ...b, rules: { socket25: false, gnyeReturn: true } }
    g5.elements = [...b.elements, e({ id: 'l4', label: 'S4', type: 'light', xM: 4.2, zM: 2.6 }), e({ id: 'p4', label: 'P4', type: 'switch', host: 'd', xM: 1, zM: 1.1, controls: ['l4'] })]
    g5.cables = [...b.cables, cab('c4', 'NYM-J 3x1.5', el('k'), el('l4'))]
    const gnyeHas = E.cableNeeds(g5.cables.find((c) => c.id === 'b0'), g5).has
    const gnyeSecond = E.cableNeeds(g5.cables.find((c) => c.id === 'b1'), g5).rows.map((r) => r.sig ? r.sig.split(':')[0] : '-')
    const gnyeErr = errs(g5).filter((t) => /žila/.test(t)).length
    // one light fewer: the second green-yellow is not needed and must stay PE
    const gnyeSpare = E.cableNeeds(b.cables.find((c) => c.id === 'b1'), { ...b, rules: { socket25: false, gnyeReturn: true } }).rows.map((r) => r.sig ? r.sig.split(':')[0] : '-')
    const b2 = { ...b, cables: b.cables.map((c) => (c.id === 'b1' ? { ...c, type: 'NYM-J 5x1.5' } : c)) }
    const fixed = errs(b2).filter((t) => /žila/.test(t))
    const second = E.cableNeeds(b2.cables.find((c) => c.id === 'b1'), b2).rows.map((r) => r.sig ? r.sig.split(':')[0] : '-')
    // by default every frame gets N (room for a smart switch later); with that rule off a plain switch drop is 3×1,5, blue the return
    const dr = base('NYM-J 3x2.5', 'NYM-J 3x2.5', 'NYM-J 3x2.5'); dr.rules = { socket25: false, neutralEverywhere: false }
    dr.elements.push(e({ id: 'dd', label: 'D8', type: 'modbox', xM: 1, zM: 1.1, modules: 2 }), e({ id: 'dl', label: 'S8', type: 'light', xM: 3, zM: 2.6 }), e({ id: 'dp', label: 'P8', type: 'switch', host: 'dd', xM: 1, zM: 1.1, controls: ['dl'] }))
    dr.cables.push(cab('dlc', 'NYM-J 3x1.5', el('k'), el('dl')), cab('dc', 'NYM-J 3x1.5', el('k'), el('dd')))
    const dn = E.cableNeeds(dr.cables.find((c) => c.id === 'dc'), dr)
    const drop = { needed: dn.needed, rows: dn.rows.map((r) => r.sig ? r.sig.split(':')[0] : '-'), err: errs(dr).filter((t) => /žila|nule/.test(t)).length, strict: E.cableNeeds(dr.cables.find((c) => c.id === 'dc'), { ...dr, rules: { socket25: false, neutralEverywhere: false, blueReturn: false } }).suggest, dflt: E.cableNeeds(dr.cables.find((c) => c.id === 'dc'), { ...dr, rules: { socket25: false } }).needed }
    return { drop, thin: thin.filter((t) => /2,5/.test(t)).length, good: good.length, bedroom, branch, mixFix, mixErr, strict, gnyeHas, gnyeSecond, gnyeErr, gnyeSpare, grow: grow.some((t) => /ne povećava/.test(t)), suggest: short.suggest, has: short.has, fixed: fixed.length, fixedT: fixed, second } })
  assert.ok(rules.thin >= 2, 'a 3×1,5 feed and a 3×1,5 socket circuit are both flagged'); assert.equal(rules.good, 0, 'all 2,5 passes'); assert.equal(rules.bedroom, 0, 'bedroom sockets may stay on 3×1,5'); assert.equal(rules.branch, 0, 'light and switch branches on a socket circuit may stay 1,5')
  assert.equal(rules.mixFix, '3×2,5 + 3×1,5', 'power on 3×2,5, the two returns on a second 3×1,5 (brown + blue)'); assert.equal(rules.mixErr, 0, '3×2,5 + 5×1,5 satisfies cores and sections')
  assert.ok(rules.grow, '2,5 after a 1,5 feed is flagged')
  // problems are tied to the cable itself, so the wall can mark it without opening the box
  assert.ok(await page.evaluate(() => { const E = window.__trasaEngine; const room = { id: 'ri', name: 'R', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }, { x: 0, y: 400 }], walls: {} }
    const p = { ...window.__trasa.getState().project, rules: undefined, rooms: [room], conduits: [{ id: 'fd', name: 'DOLAZ', points: [{ x: 200, y: -50 }, { x: 200, y: 0 }], categoryId: 'dolaz', color: '#000' }],
      elements: [{ id: 'k', label: 'K1', type: 'box', roomId: 'ri', wall: 0, xM: 2, zM: 2.3, note: '' }], cables: [{ id: 'f', roomId: 'ri', wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'exit', conduitId: 'fd', end: 'end' }, to: { kind: 'element', id: 'k' }, via: [], note: '' }] }
    return E.cableIssues(p).get('f')?.level === 'err' }), 'a 3×1,5 feed carries an error mark')
  assert.equal(rules.suggest, '5×1,5 + 3×1,5', 'no 7-core cable: 5×1,5 + 3×1,5, the second one using blue as a return'); assert.equal(rules.has, 7)
  assert.equal(rules.strict, '5×1,5 + 5×1,5', 'with blue kept free the second cable must be a 5-core')
  assert.deepEqual(rules.drop, { needed: 3, rows: ['L', 'SW', 'PE'], err: 0, strict: '5×1,5', dflt: 4 }, 'a plain switch drop needs no N: 3×1,5, blue is the return')
  assert.equal(rules.gnyeHas, 8, 'žuto-zelena kao povratna: drugi 3×1,5 daje sve tri žile'); assert.deepEqual(rules.gnyeSecond, ['SW', 'SW', 'SW'], 'pet povratnih: žuto-zelena nosi zadnju'); assert.equal(rules.gnyeErr, 0, '5×1,5 + 3×1,5 nosi osam žila kad i žuto-zelena radi'); assert.deepEqual(rules.gnyeSpare, ['SW', 'SW', 'PE'], 'nepotrebna žuto-zelena u drugom kabelu ostaje PE')
  assert.equal(rules.fixed, 0, '5×1,5 + 5×1,5 carries all seven: ' + rules.fixedT.join(' ;; ')); assert.deepEqual(rules.second, ['SW', 'SW', '-', '-', 'PE'], 'the second cable: brown and black carry returns, blue unused, PE on green-yellow')

  // a push button with a control lamp: the lamp hangs on the relay output and N, so the frame cable carries the output too
  const lp = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const r = s.addElement({ roomId: room, wall: 0, type: 'relay', xM: 0, zM: 0, note: '', host: box, relayModel: 'gen4pm' })
    const d = s.addElement({ roomId: room, wall: 0, type: 'modbox', xM: 3.4, zM: 1.1, modules: 2, note: '' })
    const t = s.addElement({ roomId: room, wall: 0, type: 'switch', switchKind: 'tipkalo', xM: 3.4, zM: 1.1, note: '', host: d, relayId: r, relayInput: 1, lamp: true })
    const l = s.addElement({ roomId: room, wall: 0, type: 'light', xM: 3.4, zM: 2.6, note: '', feedRelayId: r, feedOutput: 1 }); s = window.__trasa.getState()
    const c1 = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 5x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: d }, via: [], note: '' })
    const c2 = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: l }, via: [], note: '' }); s = window.__trasa.getState()
    const P = s.project, j = E.allJunctions(P).find((x) => x.box.id === d)
    const port = (pt) => j.terminals.find((x) => x.wires.some((w) => w.kind === 'port' && w.port === pt))?.id
    return { x1: port('X1'), x2: port('X2'), r, need: E.cableNeeds(P.cables.find((c) => c.id === c1), P).needed, ids: [r, d, t, l, c1, c2] } }, ids)
  assert.equal(lp.x1, `O:${lp.r}:1`, 'lamp on the relay output'); assert.equal(lp.x2, 'N', 'lamp on N'); assert.equal(lp.need, 5, 'L N PE + input + output')
  await page.evaluate(({ lp }) => { const s = window.__trasa.getState(); const drop = new Set(lp.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) }) }, { lp })

  // kitchen appliances on a fixed connection: a hob on 5 cores is three-phase, a thin oven cable is an error
  const ap = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const hob = s.addElement({ roomId: room, wall: 0, type: 'appliance', appliance: 'hob', xM: 3.1, zM: 0.6, note: '' })
    const oven = s.addElement({ roomId: room, wall: 0, type: 'appliance', appliance: 'oven', xM: 3.4, zM: 0.2, note: '' }); s = window.__trasa.getState()
    const c1 = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 5x2.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: hob }, via: [], note: '' })
    const c2 = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: oven }, via: [], note: '' }); s = window.__trasa.getState()
    const L = E.allLeafJunctions(s.project)
    return { hob: L.find((j) => j.box.id === hob).devices[0].ports, ovenErr: L.find((j) => j.box.id === oven).checks.some((c) => c.level === 'err' && /2,5 mm²/.test(c.text)), ids: [hob, oven, c1, c2] } }, ids)
  assert.deepEqual(ap.hob, ['L1', 'L2', 'L3', 'N', 'PE']); assert.ok(ap.ovenErr)
  await page.evaluate(({ ap }) => { const s = window.__trasa.getState(); const drop = new Set(ap.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) }) }, { ap })

  // water heater: fixed L N PE, too-thin cable or a feed through a room box is flagged
  const bo = await page.evaluate(({ box }) => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const b = s.addElement({ roomId: room, wall: 0, type: 'boiler', xM: 3.2, zM: 1.8, note: '' }); s = window.__trasa.getState()
    const c = s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: b }, via: [], note: '' }); s = window.__trasa.getState()
    const j = E.allLeafJunctions(s.project).find((x) => x.box.id === b)
    return { terms: j.terminals.map((t) => t.label), warns: j.checks.filter((x) => x.level === 'warn').map((x) => x.text), ids: [b, c] } }, ids)
  assert.deepEqual(bo.terms, ['L', 'N', 'PE'])
  assert.ok(bo.warns.some((t) => /3×2,5/.test(t)) && bo.warns.some((t) => /ormara/.test(t)), bo.warns.join(' | '))
  // a Shelly 1PM Gen4 can switch the boiler: its output feeds the boiler's L
  const pm = await page.evaluate(({ bo, box }) => { let s = window.__trasa.getState(); const E = window.__trasaEngine
    const r = s.addElement({ roomId: s.project.rooms[0].id, wall: 0, type: 'relay', xM: 0, zM: 0, note: '', host: box, relayModel: 'gen4pm' }); s = window.__trasa.getState()
    s.updateElement(bo.ids[0], { feedRelayId: r, feedOutput: 1 }); s = window.__trasa.getState()
    const j = E.allJunctions(s.project).find((x) => x.box.id === box)
    const t = j.terminals.find((x) => x.id === `O:${r}:1`)
    const leaf = E.allLeafJunctions(s.project).find((x) => x.box.id === bo.ids[0])
    return { r, desc: t?.desc, wires: t?.wires.length, warns: leaf.checks.filter((x) => x.level === 'warn').map((x) => x.text) } }, { bo, box: ids.box })
  assert.match(pm.desc ?? '', /→ bojler/); assert.equal(pm.wires, 2); assert.ok(!pm.warns.some((t) => /preko kutije|Shelly 1PM/.test(t)), pm.warns.join(' | '))
  bo.ids.push(pm.r)
  await page.evaluate(({ bo }) => { const s = window.__trasa.getState(); const drop = new Set(bo.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) }) }, { bo })

  // main earthing terminal: FeZn tail on a busbar, Cu 16 to the board, Cu 6 bonding; sections are checked
  const kp = await page.evaluate(() => { let s = window.__trasa.getState(); const room = s.project.rooms[0].id; const E = window.__trasaEngine
    const kip = s.addElement({ roomId: room, wall: 0, type: 'kip', xM: 0.4, zM: 1, note: '' }); const ro = s.addElement({ roomId: room, wall: 0, type: 'panel', xM: 1.2, zM: 1.5, note: '' }); s = window.__trasa.getState()
    const c1 = s.addCable({ roomId: room, wall: 0, type: 'PE Cu 16 mm²', from: { kind: 'element', id: kip }, to: { kind: 'element', id: ro }, via: [], note: '' }); s = window.__trasa.getState()
    const c2 = s.addCable({ roomId: room, wall: 0, type: 'PE Cu 6 mm²', from: { kind: 'element', id: kip }, to: { kind: 'free', xM: 0.2, zM: 0.3 }, via: [], note: 'vodovod' }); s = window.__trasa.getState()
    const ok = E.allLeafJunctions(s.project).find((j) => j.box.id === kip)
    s.updateCable(c1, { type: 'PE Cu 6 mm²' }); s = window.__trasa.getState()
    const thin = E.allLeafJunctions(s.project).find((j) => j.box.id === kip)
    return { ports: ok.devices[0].ports, okLevels: ok.checks.map((c) => c.level), thinErr: thin.checks.filter((c) => c.level === 'err').map((c) => c.text), ids: [kip, ro, c1, c2] } })
  assert.deepEqual(kp.ports, ['FeZn', 'RO', 'vodovod']); assert.ok(!kp.okLevels.includes('err') && !kp.okLevels.includes('warn'), 'a complete KIP has no complaints')
  assert.ok(kp.thinErr.some((t) => /16 mm²/.test(t)), 'a thin main earthing conductor is an error')
  await page.evaluate(() => window.__trasa.getState().setView({ kind: 'bom' }))
  await page.getByText('KIP kutija za izjednačenje potencijala', { exact: false }).first().waitFor()
  await page.evaluate(({ kp }) => { const s = window.__trasa.getState(); const drop = new Set(kp.ids); s.patchProject({ cables: s.project.cables.filter((c) => !drop.has(c.id)), elements: s.project.elements.filter((e) => !drop.has(e.id)) }); s.setView({ kind: 'junctions', elementId: null }) }, { kp })

  // an overfull box first grows along the catalogue of real boxes; a split is offered only when the entries run out
  const extra = await page.evaluate(({ box }) => { const s = window.__trasa.getState(); const room = s.project.rooms[0].id; const ids = []; for (let i = 0; i < 3; i++) { const u = s.addElement({ roomId: room, wall: 0, type: 'socket', xM: 0.3 + i * 0.4, zM: 0.3, note: '' }); ids.push(u, s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: u }, via: [], note: '' })) } return ids }, ids)
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.locator('.junction-svg text', { hasText: /kutija (10 × 12|15 × 13|17 × 17)/ }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Podijeli na dvije', exact: true }).count(), 0, 'no split while a bigger real box still fits')
  // with only 10 × 10 and 30 × 20 in Postavke the box jumps straight to the big one
  const big = await page.evaluate(({ box }) => { const s = window.__trasa.getState(), E = window.__trasaEngine; const j = (p) => E.allJunctions(p).find((x) => x.box.id === box); return [j({ ...s.project, boxStock: ['10 × 10', '30 × 20'] }), j(s.project)].map((x) => E.boxSizeLabel(x.size.W, x.size.H)) }, ids)
  assert.equal(big[0], '30 × 20'); assert.notEqual(big[1], '30 × 20')
  // a size picked by hand wins over the list, and a box that does not fit it says so
  const pick = await page.evaluate(({ box }) => { const s = window.__trasa.getState(), E = window.__trasaEngine; const at = (size) => { const q = { ...s.project, elements: s.project.elements.map((e) => (e.id === box ? { ...e, boxSize: size } : e)) }; return E.allJunctions(q).find((x) => x.box.id === box) }; const a = at('23 × 18'), b = at('10 × 10'); return [E.boxSizeLabel(a.size.W, a.size.H), b.checks.some((c) => c.level === 'err' && /odabranu 10 × 10/.test(c.text))] }, ids)
  assert.deepEqual(pick, ['23 × 18', true])
  // Shift + hover on a WAGO lights up every wire on it
  const wg = page.locator('.junction-svg .jc-wago').first()
  await page.keyboard.down('Shift'); await wg.locator('rect').nth(1).hover({ force: true })
  await page.locator('.junction-svg .jc-wago.hl').waitFor()
  assert.ok(await page.locator('.junction-svg .jc-wire.hl').count() >= 2, 'Shift-hover highlights the WAGO wires')
  await page.keyboard.up('Shift'); await page.mouse.move(2, 2)
  const more = await page.evaluate(({ box }) => { const s = window.__trasa.getState(); const room = s.project.rooms[0].id; const ids = []; for (let i = 0; i < 14; i++) { const u = s.addElement({ roomId: room, wall: 0, type: 'socket', xM: 2 + i * 0.2, zM: 0.3, note: '' }); ids.push(u, s.addCable({ roomId: room, wall: 0, type: 'NYM-J 3x1.5', from: { kind: 'element', id: box }, to: { kind: 'element', id: u }, via: [], note: '' })) } return ids }, ids)
  await page.getByRole('button', { name: 'Podijeli na dvije', exact: true }).click()
  const split = await page.evaluate(() => { const s = window.__trasa.getState(); const nb = s.project.elements.filter((e) => e.type === 'box').at(-1); return { id: nb.id, label: nb.label, link: s.project.cables.at(-1) } })
  assert.equal(split.link.to.id, split.id)
  await page.locator('.junction-main .room-head h2', { hasText: split.label }).waitFor()
  // undo the split by hand: U1's cable moved to the new box too, so point it back at K1
  await page.evaluate(({ extra, split, box }) => { const s = window.__trasa.getState(); const drop = new Set([...extra, split.id, split.link.id]); const back = (e) => (e.kind === 'element' && e.id === split.id ? { ...e, id: box } : e); s.patchProject({ cables: s.project.cables.filter((x) => !drop.has(x.id)).map((c) => ({ ...c, from: back(c.from), to: back(c.to) })), elements: s.project.elements.filter((e) => !drop.has(e.id)) }) }, { extra: [...extra, ...more], split, box: ids.box })
  await page.evaluate(({ v1, r2, c }) => { const s = window.__trasa.getState(); s.patchProject({ cables: s.project.cables.filter((x) => x.id !== c), elements: s.project.elements.filter((e) => e.id !== v1 && e.id !== r2) }) }, gar)
  await page.getByRole('button', { name: 'Spojevi' }).click()
  // K1 now has an O terminal pairing the cable's black core with the light's brown
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.locator('.jsteps li.hdr', { hasText: 'S1 · 221-412 · R1 izlaz 1 → svjetlo' }).waitFor()
  // the wall props say how many cores the frame cable needs
  await page.evaluate(({ c }) => { const s = window.__trasa.getState(); s.setView({ kind: 'room', roomId: s.project.rooms[0].id, wall: 0 }); s.select(c) }, ids2)
  await page.locator('.props .cores .check', { hasText: 'Dovoljno žila: 4 od 5, 1 rezervna' }).waitFor()
  await page.locator('.props .core-table tr', { hasText: 'smeđa' }).getByText('L', { exact: true }).waitFor()
  // too few cores: red status, the missing signal is listed, and the quick fix swaps the cable type
  await page.evaluate(({ c }) => window.__trasa.getState().updateCable(c, { type: 'NYM-J 3x1.5' }), ids2)
  await page.locator('.props .cores .check.err', { hasText: 'Treba 4 žila, kabel ima 3' }).waitFor()
  await page.locator('.props .core-table tr.missing').first().waitFor()
  await page.getByRole('button', { name: 'Zamijeni s 5×1,5' }).click()
  await page.locator('.props .cores .check', { hasText: 'Dovoljno žila: 4 od 5' }).waitFor()
  // phase 3: material for the house and the print preview
  await page.getByRole('button', { name: 'Materijal' }).click()
  await page.locator('.bom-table tr', { hasText: 'Doza modularna 3M (TEM PM3), duboka' }).getByText('1 kom').waitFor()
  await page.locator('.bom-table tr', { hasText: 'Shelly 1 Gen4' }).getByText('1 kom').waitFor()
  await page.locator('.bom-table tr', { hasText: 'SM11 · tipkalo' }).getByText('1 kom').waitFor()
  // the 3M frame: TEM frame + carrier, and a blank for each empty module (tipkalo 1M of 3M → 2 blanks)
  await page.locator('.bom-table tr', { hasText: 'OL30 · okvir LINE 3M' }).waitFor()
  await page.locator('.bom-table tr', { hasText: 'NM30 · nosač s vijcima 3M' }).waitFor()
  await page.locator('.bom-table tr', { hasText: 'TM21 · slijepi modul' }).waitFor()
  await page.locator('.bom-table tr', { hasText: 'NYM-J 5x1.5' }).getByText(/m$/).waitFor()
  // shopping list: tick an item (kept in localStorage), hide bought, copy as text
  await page.locator('.bom-table tr', { hasText: 'Shelly 1 Gen4' }).locator('input[type=checkbox]').check()
  await page.locator('.mat-progress', { hasText: '1 /' }).waitFor()
  await page.locator('.bom-table tr.done', { hasText: 'Shelly 1 Gen4' }).waitFor()
  await page.getByLabel('sakrij nabavljeno').check()
  assert.equal(await page.locator('.bom-table tr', { hasText: 'Shelly 1 Gen4' }).count(), 0)
  await page.getByLabel('sakrij nabavljeno').uncheck()
  await page.getByRole('button', { name: /Kopiraj popis/ }).click()
  await page.getByRole('button', { name: 'Kopirano' }).waitFor()
  await page.getByRole('button', { name: 'Poništi kvačice' }).click()
  await page.locator('.mat-progress', { hasText: '0 /' }).waitFor()
  await page.screenshot({ path: `${SHOTS}/trasa-material.png` })
  await page.getByRole('button', { name: 'PDF za majstora' }).click()
  await page.locator('.page h1', { hasText: 'Dnevna · elektroinstalacija' }).waitFor()
  await page.locator('.page h2', { hasText: 'Dnevna · K1' }).waitFor()
  await page.locator('.page h2', { hasText: 'Dnevna · D1' }).waitFor()
  await page.locator('.page h2', { hasText: 'Dnevna · releji' }).waitFor()
  assert.equal(await page.locator('.print-junction').count(), 4, 'K1, D1 and the two devices (S1, U1) each get a drawing')
  await page.screenshot({ path: `${SHOTS}/trasa-print.png`, fullPage: true })
  await page.getByRole('button', { name: 'Natrag' }).click()
  await page.getByRole('button', { name: 'Spojevi' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.getByRole('button', { name: 'Otvori na zidu' }).click()
  // cleanup: remove the frame (takes T1 and R1 with it), the extra cable, P1 and S1
  await page.evaluate(({ d1, c }) => { const s = window.__trasa.getState(); s.select(d1); s.removeSelected(); s.patchProject({ cables: s.project.cables.filter((x) => x.id !== c) }) }, ids2)
  assert.equal((await state()).elements.filter((e) => e.host).length, 0)

  // corner: a cable from K1 ends on the right edge of wall 1 and continues on wall 2 to a frame D2
  const d2 = await page.evaluate(() => { const s = window.__trasa.getState(); return s.addElement({ roomId: s.project.rooms[0].id, wall: 1, type: 'modbox', xM: 2, zM: 1.05, note: '', modules: 3 }) })
  await page.evaluate(() => { const s = window.__trasa.getState(); s.setView({ kind: 'room', roomId: s.project.rooms[0].id, wall: 0 }); s.select(null) })
  await page.keyboard.press('c')
  await clickWall(1.5, 2.32)
  await clickWall(5.0, 1.05)
  st = await state()
  let last = st.cables[st.cables.length - 1]
  assert.deepEqual(last.from, { kind: 'element', id: st.elements[0].id })
  assert.equal(last.to.kind, 'corner'); assert.equal(last.to.corner, 1); assert.ok(Math.abs(last.to.zM - 1.05) < 0.03, JSON.stringify(last.to))
  await page.locator('.sidebar .list li', { hasText: 'Zid 2' }).click()
  await page.keyboard.press('c')
  await clickWall(0, 1.05)
  await clickWall(2, 1.05)
  st = await state()
  last = st.cables[st.cables.length - 1]
  assert.equal(last.from.kind, 'corner'); assert.equal(last.from.corner, 1); assert.deepEqual(last.to, { kind: 'element', id: d2 })
  await page.locator('.props', { hasText: 'Kabel' }).getByText('kut 2 (dalje na susjedni zid)').waitFor()
  await page.getByRole('button', { name: 'Spojevi' }).click()
  await page.locator('.junctions-list .list li', { hasText: 'K1' }).click()
  await page.locator('.jsteps', { hasText: /kut 2 → D\d/ }).waitFor()
  await page.locator('.junctions-list .list li', { hasText: /^D\d/ }).click()
  await page.locator('.jsteps', { hasText: 'kut 2 → K1' }).waitFor()
  await page.evaluate((d2) => { const s = window.__trasa.getState(); s.select(d2); s.removeSelected(); s.patchProject({ cables: s.project.cables.slice(0, 2) }); s.setView({ kind: 'room', roomId: s.project.rooms[0].id, wall: 0 }) }, d2)
  assert.equal((await state()).cables.length, 2)
// phone = field mode: tab bar + sheets, tap selects, pinch zooms, no drawing tools
{
  const { devices } = await import('playwright')
  const snapshot = await page.evaluate(() => window.__trasa.getState().project)
  const mctx = await browser.newContext({ ...devices['iPhone 14'] })
  const m = await mctx.newPage()
  const merrors = []
  m.on('pageerror', (e) => merrors.push(String(e)))
  await m.goto(APP_URL)
  await m.waitForFunction(() => window.__trasa)
  await m.evaluate((pr) => window.__trasa.getState().replaceProject(pr), snapshot)
  await m.locator('.tabbar button', { hasText: 'Tlocrt' }).waitFor()
  assert.equal(await m.locator('.tool-rail').isVisible(), false)
  assert.equal(await m.locator('.header .view-nav').isVisible(), false)
  const mst = () => m.evaluate(() => { const s = window.__trasa.getState(); return { tool: s.tool, sel: s.selectedId, cam: s.camera, wcam: s.wallCamera } })
  // tap on a conduit selects it
  const c0 = snapshot.conduits[0]
  const pt = await m.evaluate((id) => { const st = window.Konva.stages[0]; const n = st.findOne((x) => x.name?.() === id); const p = n.points(); const t = n.getAbsoluteTransform(); const a = t.point({ x: p[0], y: p[1] }), b = t.point({ x: p[2], y: p[3] }); const r = st.container().getBoundingClientRect(); return { x: r.x + (a.x + b.x) / 2, y: r.y + (a.y + b.y) / 2 } }, c0.id)
  await m.touchscreen.tap(pt.x, pt.y)
  await m.waitForFunction((id) => window.__trasa.getState().selectedId === id, c0.id)
  await m.locator('.sheet-handle').tap()
  await m.locator('.sheet.open .props', { hasText: 'Bužir' }).waitFor()
  await m.locator('.sheet-handle').tap()
  await m.waitForFunction(() => document.querySelector('.sheet').getBoundingClientRect().height < 60) // closed, animation done
  // pinch zooms the plan
  const cdp = await mctx.newCDPSession(m)
  const two = (cx, cy, d) => [{ x: cx - d / 2, y: cy }, { x: cx + d / 2, y: cy }]
  const before = (await mst()).cam.scale
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(200, 350, 80) })
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(200, 350, 80 + i * 20) })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await m.waitForFunction((b) => window.__trasa.getState().camera.scale > b * 1.5, before)
  // rooms: tap the box on the wall → details sheet opens
  await m.locator('.tabbar button', { hasText: 'Sobe' }).tap()
  await m.locator('.room-head', { hasText: 'Zid 1' }).waitFor()
  await m.locator('.room-head button[aria-label="Slikaj zid"]').waitFor()
  const k1 = snapshot.elements.find((e) => e.type === 'box')
  const kp = await m.evaluate((id) => { const st = window.Konva.stages[window.Konva.stages.length - 1]; const n = st.findOne((x) => x.name?.() === id); const r = n.getClientRect(); const b = st.container().getBoundingClientRect(); return { x: b.x + r.x + r.width / 2, y: b.y + r.y + r.height / 2 } }, k1.id)
  await m.touchscreen.tap(kp.x, kp.y)
  try { await m.locator('.sheet.open .props').waitFor() } catch (e) { await m.screenshot({ path: `${SHOTS}/trasa-mobile-fail.png` }); console.error('mobile tap state', await m.evaluate(() => { const s = window.__trasa.getState(); return { view: s.view, sel: s.selectedId, tool: s.wallTool } })); throw e }
  // the tap lands on the box or on one of the cables drawn into it; either opens its details
  const tapped = await m.evaluate(() => window.__trasa.getState().selectedId)
  assert.ok(tapped === k1.id || snapshot.cables.some((c) => c.id === tapped && [c.from, c.to].some((e) => e.kind === 'element' && e.id === k1.id)), `tapped ${tapped}`)
  // junctions: picker + steps + sheet; material
  await m.locator('.tabbar button', { hasText: 'Spojevi' }).tap()
  await m.locator('.jpick option', { hasText: 'K1' }).waitFor({ state: 'attached' })
  await m.locator('.junctions.mobile .segmented button', { hasText: 'Koraci' }).tap()
  await m.locator('.stepbar', { hasText: '1 /' }).waitFor()
  await m.locator('.sheet-handle').tap()
  await m.locator('.sheet.open', { hasText: 'Spojevi po stezaljci' }).waitFor()
  await m.locator('.tabbar button', { hasText: 'Materijal' }).tap()
  await m.locator('.material .panel-card', { hasText: 'Kabeli' }).waitFor()
  assert.deepEqual(merrors, [], 'mobile console/page errors')
  assert.deepEqual(await m.evaluate(() => [document.documentElement.scrollWidth, innerWidth]).then(([a, b]) => a <= b), true, 'no horizontal page scroll')
  await m.screenshot({ path: `${SHOTS}/trasa-mobile.png` })
  await mctx.close()
}

  // cleanup so the rest of the test sees the same elements as before
  await page.evaluate(({ s1 }) => { const s = window.__trasa.getState(); s.select(s1); s.removeSelected(); const p = s.project; s.patchProject({ cables: p.cables.slice(0, 2) }); s.select(null) }, ids)
  assert.equal((await state()).elements.length, 2)
}

// wall 3 (bottom): B1 end 0.2 m away; from inside, the bottom wall runs right→left, so 4.5 m from the left
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).click()
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText('4.50 m · strop').waitFor()
// two ways in: the camera (capture) and the gallery (no capture); the gallery one is used here
assert.equal(await page.locator('.sidebar input[type=file][capture]').count(), 1)
await page.locator('.sidebar').getByRole('button', { name: /Iz galerije/ }).waitFor()
await page.locator('.sidebar input[type=file]:not([capture])').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.waitForFunction(() => window.Konva.stages[0].findOne('Image'))
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).getByText('foto').waitFor()
// the 1200x800 photo keeps its 3:2 ratio: height = wall height (260 cm), width 390 cm, centred on the 500 cm wall
{
  const im = await page.evaluate(() => { const i = window.Konva.stages[0].findOne('Image'); return [i.x(), i.width(), i.height()] })
  assert.deepEqual(im.map((n) => Math.round(n)), [55, 390, 260])
  // "Rastegni na širinu zida" stretches it over the whole 500 cm wall, and unticking restores the ratio
  await page.locator('.sidebar').getByText('Rastegni na širinu zida').click()
  await page.waitForFunction(() => Math.round(window.Konva.stages[0].findOne('Image').width()) === 500)
  const st = await page.evaluate(() => { const i = window.Konva.stages[0].findOne('Image'); return [i.x(), i.width(), i.height()] })
  assert.deepEqual(st.map((n) => Math.round(n)), [0, 500, 260])
  await page.locator('.sidebar').getByText('Rastegni na širinu zida').click()
  await page.waitForFunction(() => Math.round(window.Konva.stages[0].findOne('Image').width()) === 390)
}
await page.screenshot({ path: `${SHOTS}/trasa-room.png` })

// save (Cmd+S) while on wall 3 → file carries project + ui position
await page.locator('.save-state.dirty').waitFor()
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Meta+s')])
assert.match(dl.suggestedFilename(), /\.trasa\.json$/)
const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'))
assert.equal(saved.app, 'trasa')
assert.equal(saved.project.conduits.length, 3)
assert.deepEqual(saved.ui.view, { kind: 'room', roomId: saved.project.rooms[0].id, wall: 2 })
await page.locator('.save-state:not(.dirty)').waitFor()

// persistence across reload: project, and also where the user was (view, wall, selection)
await page.waitForTimeout(600)
await page.reload()
// comes back to the wall it was on, then the plan lists are intact too
await page.locator('.room-head', { hasText: 'Zid 3' }).waitFor()
await page.getByRole('button', { name: 'Tlocrt' }).click()
await page.locator('.list').getByText('B1-ormar').waitFor()
await page.locator('.list').getByText('1/4 fotki').waitFor()

// wipe, then open the saved file → everything back, including the wall view
await menu('Novi projekt')
await page.locator('.list').getByText('B1-ormar').waitFor({ state: 'hidden' })
await menu('Otvori…')
await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(await dl.path())
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-nav', { hasText: 'Zid 3' }).waitFor()
await page.waitForFunction(() => window.Konva.stages[0].findOne('Image'))
st = await state()
assert.equal(st.conduits[0].name, 'B1-ormar')
assert.equal(await page.evaluate(() => window.__trasa.getState().dirty), false)

// GitHub storage against an in-memory mock of the Contents API
const repo = new Map()
let lastPut = 0
await page.route('https://api.github.com/**', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } })
  const path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''))
  if (req.headers()['authorization'] !== 'Bearer tok123') return route.fulfill({ status: 401, json: { message: 'Bad credentials' } })
  if (url.pathname.includes('/git/blobs/')) {
    const sha = url.pathname.split('/git/blobs/')[1]
    const f = [...repo.values()].find((x) => x.sha === sha)
    if (!f) return route.fulfill({ status: 404, json: { message: 'Not Found' } })
    return route.fulfill({ status: 200, body: Buffer.from(f.content, 'base64'), headers: { 'content-type': 'application/vnd.github.raw+json', 'access-control-allow-origin': '*' } })
  }
  if (req.method() === 'GET') {
    const f = repo.get(path)
    // GitHub omits content for files over 1 MB; the mock does it for images so the blobs path is exercised
    if (f && path.includes('/img/')) return route.fulfill({ json: { sha: f.sha, content: '', encoding: 'none', path, size: f.content.length } })
    if (f) return route.fulfill({ json: { sha: f.sha, content: f.content, encoding: 'base64', path } })
    const names = new Map()
    for (const k of repo.keys()) if (k.startsWith(path + '/')) { const rest = k.slice(path.length + 1); names.set(rest.split('/')[0], rest.includes('/') ? 'dir' : 'file') }
    if (!names.size) return route.fulfill({ status: 404, json: { message: 'Not Found' } })
    return route.fulfill({ json: [...names].map(([name, type]) => ({ name, path: `${path}/${name}`, type, sha: 'x', size: 0 })) })
  }
  if (req.method() === 'PUT') {
    const body = req.postDataJSON()
    const cur = repo.get(path)
    if (cur && body.sha !== cur.sha) return route.fulfill({ status: 409, json: { message: 'conflict' } })
    // GitHub's branch race: a commit right after another one gets a 409; the client must retry
    if (lastPut && Date.now() - lastPut < 150) { lastPut = 0; return route.fulfill({ status: 409, json: { message: 'is at x but expected y' } }) }
    lastPut = Date.now()
    const sha = 'sha_' + Math.random().toString(36).slice(2)
    repo.set(path, { sha, content: body.content })
    return route.fulfill({ json: { content: { sha } } })
  }
  return route.fulfill({ status: 500 })
})
const before = await state()
// OAuth: the worker sends the browser back with #gh=<tokens>; an expired token is refreshed through the worker
let refreshed = 0
await page.route('https://trasa-auth.trasa-auth.workers.dev/refresh', async (route) => {
  refreshed++
  const body = route.request().postDataJSON()
  assert.equal(body.refresh_token, 'r1')
  return route.fulfill({ json: { access_token: 'tok123', refresh_token: 'r2', expires_at: Date.now() + 3600e3 }, headers: { 'access-control-allow-origin': '*' } })
})
await page.getByRole('button', { name: 'GitHub' }).click()
await page.getByPlaceholder('mdbossss/trasa').fill('https://github.com/mdbossss/trasa')
await page.getByPlaceholder('obavezno ako je repo javan').fill('tajna')
await page.locator('.modal-head button').click() // config is only saved on login; set it the way the login button does
await page.evaluate(() => localStorage.setItem('trasa-github', JSON.stringify({ token: '', repo: 'mdbossss/trasa', branch: 'main', passphrase: 'tajna', auth: null })))
const ghHash = Buffer.from(JSON.stringify({ access_token: 'old', refresh_token: 'r1', expires_at: Date.now() - 1000 })).toString('base64')
await page.goto('about:blank') // a hash-only goto would not reload; the real redirect comes from another origin
await page.goto(`${APP_URL}#gh=${encodeURIComponent(ghHash)}`)
await page.locator('.modal h3', { hasText: 'GitHub projekti' }).waitFor() // panel opens itself after login
assert.equal(await page.evaluate(() => location.hash), '')
await page.getByText('Još nema projekata.').waitFor()
assert.equal(refreshed, 1)
assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('trasa-github')).auth.refresh_token), 'r2')
await page.getByText('GitHub prijava').waitFor()
// back to the room view so the saved file carries wall 3 again
await page.locator('.modal-head button').click()
await page.getByRole('button', { name: 'Tlocrt' }).click()
await page.locator('.sidebar .list li', { hasText: 'Dnevna' }).getByText('Otvori').click()
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).click()
await page.locator('.wall-nav', { hasText: 'Zid 3' }).waitFor()
await page.getByRole('button', { name: 'GitHub' }).click()
await page.locator('.gh-card').getByRole('button', { name: 'Spremi na GitHub' }).click()
await page.locator('.gh-list').getByText('kuca').waitFor()
await page.locator('.gh-card .gh-state.ok', { hasText: 'Spremljeno' }).waitFor()
// plan and wall photo are the same PNG here, so they dedupe to one image file
assert.deepEqual([...repo.keys()].filter((k) => !k.includes('/img/')), ['projects/kuca/project.json.enc'])
assert.equal([...repo.keys()].filter((k) => k.includes('/img/')).length, 1)
// at rest everything is ".enc" ciphertext: no plaintext JSON or JPEG markers
assert.ok([...repo.keys()].every((k) => k.endsWith('.enc')), [...repo.keys()].join())
const rawProj = Buffer.from(repo.get('projects/kuca/project.json.enc').content, 'base64')
assert.ok(!rawProj.toString('latin1').includes('conduits'))
const decryptedRemote = await page.evaluate(async ([b64, pass]) => {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey'])
  const k = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: data.subarray(0, 16), iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(16, 28) }, k, data.subarray(28)))
}, [rawProj.toString('base64'), 'tajna'])
const remote = JSON.parse(decryptedRemote)
assert.match(remote.project.planImage, /^gh:projects\/kuca\/img\/[0-9a-f]{16}\.(jpg|png)$/)
assert.equal(remote.ui.view.kind, 'room')
assert.equal(await page.evaluate(() => window.__trasa.getState().fileName), 'gh:kuca')
// saving again re-uses the images and updates project.json even if the file changed elsewhere (stale sha → refetch)
repo.get('projects/kuca/project.json.enc').sha = 'sha_changed_on_another_device'
const shaBefore = repo.get('projects/kuca/project.json.enc').sha
// the project is now linked to GitHub: Cmd+S in the app saves there (no file dialog)
await page.locator('.modal-head button').click()
await page.evaluate(() => window.__trasa.getState().patchProject({ name: 'Kuća' }))
await page.keyboard.press('ControlOrMeta+s')
for (let i = 0; i < 50 && repo.get('projects/kuca/project.json.enc').sha === shaBefore; i++) await page.waitForTimeout(100)
assert.notEqual(repo.get('projects/kuca/project.json.enc').sha, shaBefore)
assert.equal(repo.size, 2)
await page.locator('.save-state', { hasText: 'GitHub/kuca' }).waitFor()

// wipe, open from GitHub → identical project and view
await menu('Novi projekt')
await page.locator('.list').getByText('B1-ormar').waitFor({ state: 'hidden' })
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
await page.getByRole('button', { name: 'GitHub' }).click()
await page.locator('.gh-list li', { hasText: 'kuca' }).getByRole('button', { name: 'Otvori', exact: true }).click()
if (await page.getByRole('button', { name: 'Otvori svejedno' }).isVisible().catch(() => false)) await page.getByRole('button', { name: 'Otvori svejedno' }).click()
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-nav', { hasText: 'Zid 3' }).waitFor()
await page.waitForFunction(() => window.Konva.stages[0].findOne('Image'))
st = await state()
assert.equal(st.planImage, before.planImage)
assert.deepEqual(st.rooms[0].walls, before.rooms[0].walls)
assert.deepEqual(st.conduits, before.conduits)
await page.screenshot({ path: `${SHOTS}/trasa-github.png` })
// the GitHub link survives a reload, and a new project is not linked to it
await page.reload(); await page.waitForFunction(() => window.__trasa?.getState().loaded)
assert.equal(await page.evaluate(() => window.__trasa.getState().fileName), 'gh:kuca')
await page.locator('.save-state', { hasText: 'GitHub/kuca' }).waitFor()
await page.evaluate(() => window.__trasa.getState().replaceProject({ ...window.__trasa.getState().project }))
assert.equal(await page.evaluate(() => window.__trasa.getState().fileName), null)

assert.deepEqual(errors, [], 'console/page errors')
console.log('OK', { prompts })
await browser.close()
