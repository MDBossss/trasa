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
page.on('console', (m) => { if (m.type() === 'error' && !/status of 404/.test(m.text())) errors.push(m.text()) })

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
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
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
const openSetup = () => page.evaluate(() => { document.querySelector('details.setup').open = true })
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
await page.keyboard.press('b')
await clickImg(153, 120); await clickImg(153, 300); await page.keyboard.press('Enter')
st = await state()
assert.deepEqual(st.conduits[2].points, [{ x: 155, y: 117 }, { x: 155, y: 297 }])
await page.keyboard.press('v'); await page.keyboard.press('Meta+z')
await openSetup(); await page.locator('.steps li').nth(2).getByText('Reset').click()
assert.deepEqual((await state()).gridOrigin, { x: 0, y: 0 })

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
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 300)
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
const wallToScreen = async (xM, zM) => page.evaluate(([xM, zM, H]) => {
  const st = window.Konva.stages[0]
  const r = st.container().getBoundingClientRect()
  return { x: r.left + st.x() + xM * 100 * st.scaleX(), y: r.top + st.y() + (H - zM * 100) * st.scaleY() }
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

// wall 3 (bottom): B1 end 0.2 m away; from inside, the bottom wall runs right→left, so 4.5 m from the left
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).click()
await page.locator('.sidebar .list li', { hasText: 'B1-ormar' }).getByText('4.50 m · strop').waitFor()
await page.locator('input[type=file][capture]').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.waitForFunction(() => window.Konva.stages[0].findOne('Image'))
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).getByText('foto').waitFor()
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

// persistence across reload
await page.waitForTimeout(600)
await page.reload()
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
await page.route('https://api.github.com/**', async (route) => {
  const req = route.request()
  const url = new URL(req.url())
  const path = decodeURIComponent(url.pathname.replace(/^\/repos\/[^/]+\/[^/]+\/contents\//, ''))
  if (req.headers()['authorization'] !== 'Bearer tok123') return route.fulfill({ status: 401, json: { message: 'Bad credentials' } })
  if (req.method() === 'GET') {
    const f = repo.get(path)
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
await page.getByPlaceholder('mislavvv/trasa').fill('https://github.com/mislavvv/trasa')
await page.getByPlaceholder('obavezno ako je repo javan').fill('tajna')
await page.locator('.modal-head button').click() // config is only saved on login; set it the way the login button does
await page.evaluate(() => localStorage.setItem('trasa-github', JSON.stringify({ token: '', repo: 'mislavvv/trasa', branch: 'main', passphrase: 'tajna', auth: null })))
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
await page.locator('.sidebar .list li', { hasText: 'Dnevna' }).getByText('Otvori').click()
await page.locator('.sidebar .list li', { hasText: 'Zid 3' }).click()
await page.locator('.wall-nav', { hasText: 'Zid 3' }).waitFor()
await page.getByRole('button', { name: 'GitHub' }).click()
await page.locator('.modal').getByText('Spremi "Kuća" u repo').click()
await page.locator('.modal .list').getByText('kuca').waitFor()
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
// saving again re-uses the images and updates project.json with the sha
const shaBefore = repo.get('projects/kuca/project.json.enc').sha
await page.locator('.modal').getByText('Spremi "Kuća" u repo').click()
for (let i = 0; i < 50 && repo.get('projects/kuca/project.json.enc').sha === shaBefore; i++) await page.waitForTimeout(100)
assert.notEqual(repo.get('projects/kuca/project.json.enc').sha, shaBefore)
assert.equal(repo.size, 2)
await page.locator('.modal-head button').click()

// wipe, open from GitHub → identical project and view
await menu('Novi projekt')
await page.locator('.list').getByText('B1-ormar').waitFor({ state: 'hidden' })
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
await page.getByRole('button', { name: 'GitHub' }).click()
await page.locator('.modal .list li', { hasText: 'kuca' }).getByText('Otvori').click()
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-nav', { hasText: 'Zid 3' }).waitFor()
await page.waitForFunction(() => window.Konva.stages[0].findOne('Image'))
st = await state()
assert.equal(st.planImage, before.planImage)
assert.deepEqual(st.rooms[0].walls, before.rooms[0].walls)
assert.deepEqual(st.conduits, before.conduits)
await page.screenshot({ path: `${SHOTS}/trasa-github.png` })

assert.deepEqual(errors, [], 'console/page errors')
console.log('OK', { prompts })
await browser.close()
