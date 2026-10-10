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
await page.getByText('Učitaj tlocrt (gumb gore)').waitFor()

// synthetic floor plan 1200x800 with a thick wall outline
const planPng = await page.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 1200; c.height = 800
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 1200, 800)
  g.lineWidth = 12; g.strokeStyle = '#222'; g.strokeRect(100, 100, 1000, 600); g.strokeRect(100, 100, 500, 300)
  return c.toDataURL('image/png')
})
await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({ name: 'plan.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.getByText('Učitaj tlocrt (gumb gore)').waitFor({ state: 'hidden' })
await page.waitForFunction(() => window.Konva?.stages?.[0]?.findOne('Image'))

const toScreen = async (x, y) => page.evaluate(([x, y]) => {
  const st = window.Konva.stages[0]
  const r = st.container().getBoundingClientRect()
  return { x: r.left + st.x() + x * st.scaleX(), y: r.top + st.y() + y * st.scaleY() }
}, [x, y])
const clickImg = async (x, y) => { const p = await toScreen(x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y) }
const state = () => page.evaluate(() => window.__trasa.getState().project)

// calibrate: 500 px = 5 m → 100 px/m
await page.keyboard.press('c')
await clickImg(100, 100); await clickImg(600, 100)
await page.getByText('100.0 px/m').waitFor()
assert.equal((await state()).pxPerMeter, 100)

// room: click corners, close by clicking first corner
await page.keyboard.press('r')
for (const [x, y] of [[100, 100], [600, 100], [600, 400], [100, 400], [100, 100]]) await clickImg(x, y)
await page.getByText('Dnevna').first().waitFor()
let st = await state()
assert.equal(st.rooms.length, 1)
assert.deepEqual(st.rooms[0].points, [{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 400 }, { x: 100, y: 400 }])

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

// rotate the plan: drawing follows the image (1200x800 → 800x1200)
await page.getByText('↻ 90°').click()
st = await state()
assert.equal(st.planRotation, 90)
assert.deepEqual(st.conduits[0].points, [{ x: 680, y: 150 }, { x: 420, y: 150 }])
assert.deepEqual(st.rooms[0].points[0], { x: 700, y: 100 })
await page.waitForTimeout(200); await page.screenshot({ path: `${SHOTS}/trasa-rotated.png` })
await page.getByText('↺ 90°').click()
await page.waitForTimeout(250) // refit after rotation
st = await state()
assert.equal(st.planRotation, 0)
assert.deepEqual(st.conduits[0].points, [{ x: 150, y: 120 }, { x: 150, y: 380 }])
assert.deepEqual(st.rooms[0].points[0], { x: 100, y: 100 })

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
await page.getByText('Reset').first().click()
assert.deepEqual((await state()).gridOrigin, { x: 0, y: 0 })

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
await page.getByText('Auto poravnaj').click()
await page.waitForFunction(() => Math.abs(window.__trasa.getState().project.planTilt) > 0.5)
st = await state()
assert.ok(Math.abs(st.planTilt + 3) < 0.3, `auto tilt ${st.planTilt}`)
await page.waitForTimeout(200)
await page.screenshot({ path: `${SHOTS}/trasa-tilt.png` })
await page.getByText('Reset').last().click()
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
await page.getByText('Otvori sobu →').click()
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.room-mini .list li').nth(0).click()
await page.locator('table.exits').getByText('B1-ormar').waitFor()
await page.locator('table.exits').getByText('0.50 m').waitFor()
await page.locator('table.exits').getByText('0.20 m').waitFor()
// wall 3 (bottom): B1 end 0.2 m away; from inside, the bottom wall runs right→left, so 4.5 m from the left
await page.locator('.room-mini .list li').nth(2).click()
await page.locator('table.exits').getByText('4.50 m').waitFor()
await page.locator('input[type=file][capture]').setInputFiles({ name: 'wall.png', mimeType: 'image/png', buffer: Buffer.from(planPng.split(',')[1], 'base64') })
await page.locator('svg.elevation image').waitFor()
await page.locator('.room-mini .list').getByText('1/4 fotki').waitFor().catch(() => {})
await page.screenshot({ path: `${SHOTS}/trasa-room.png` })

// save (Cmd+S) while on wall 3 → file carries project + ui position
await page.locator('.toolbar').getByText('Spremi •').waitFor()
const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Meta+s')])
assert.match(dl.suggestedFilename(), /\.trasa\.json$/)
const saved = JSON.parse(await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'))
assert.equal(saved.app, 'trasa')
assert.equal(saved.project.conduits.length, 3)
assert.deepEqual(saved.ui.view, { kind: 'room', roomId: saved.project.rooms[0].id, wall: 2 })
await page.locator('.toolbar').getByText('Spremi', { exact: true }).waitFor()

// persistence across reload
await page.waitForTimeout(600)
await page.reload()
await page.locator('.list').getByText('B1-ormar').waitFor()
await page.locator('.list').getByText('1/4 fotki').waitFor()

// wipe, then open the saved file → everything back, including the wall view
await page.getByText('Novi').click()
await page.locator('.list').getByText('B1-ormar').waitFor({ state: 'hidden' })
await page.getByText('Otvori').click()
await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles(await dl.path())
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-head h3', { hasText: 'Zid 3' }).waitFor()
await page.locator('svg.elevation image').waitFor()
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
await page.getByText('GitHub', { exact: true }).click()
await page.getByPlaceholder('mislavvv/trasa-projects').fill('https://github.com/mislavvv/trasa-projects')
await page.getByPlaceholder('github_pat_…').fill('tok123')
await page.getByText('Poveži').click()
await page.getByText('Još nema projekata.').waitFor()
await page.locator('.modal').getByText('Spremi "Kuća" u repo').click()
await page.locator('.modal .list').getByText('kuca').waitFor()
// plan and wall photo are the same PNG here, so they dedupe to one image file
assert.deepEqual([...repo.keys()].filter((k) => !k.includes('/img/')), ['projects/kuca/project.json'])
assert.equal([...repo.keys()].filter((k) => k.includes('/img/')).length, 1)
const remote = JSON.parse(Buffer.from(repo.get('projects/kuca/project.json').content, 'base64').toString())
assert.match(remote.project.planImage, /^gh:projects\/kuca\/img\/[0-9a-f]{16}\.(jpg|png)$/)
assert.equal(remote.ui.view.kind, 'room')
assert.equal(await page.evaluate(() => window.__trasa.getState().fileName), 'gh:kuca')
// saving again re-uses the images and updates project.json with the sha
const shaBefore = repo.get('projects/kuca/project.json').sha
await page.locator('.modal').getByText('Spremi "Kuća" u repo').click()
for (let i = 0; i < 50 && repo.get('projects/kuca/project.json').sha === shaBefore; i++) await page.waitForTimeout(100)
assert.notEqual(repo.get('projects/kuca/project.json').sha, shaBefore)
assert.equal(repo.size, 2)
await page.locator('.modal-head button').click()

// wipe, open from GitHub → identical project and view
await page.getByText('Novi').click()
await page.locator('.list').getByText('B1-ormar').waitFor({ state: 'hidden' })
await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('keyval-store'); q.onsuccess = q.onerror = q.onblocked = () => r() }))
await page.getByText('GitHub', { exact: true }).click()
await page.locator('.modal .list li', { hasText: 'kuca' }).getByText('Otvori').click()
await page.locator('.room-head h2', { hasText: 'Dnevna' }).waitFor()
await page.locator('.wall-head h3', { hasText: 'Zid 3' }).waitFor()
await page.locator('svg.elevation image').waitFor()
st = await state()
assert.equal(st.planImage, before.planImage)
assert.deepEqual(st.rooms[0].walls, before.rooms[0].walls)
assert.deepEqual(st.conduits, before.conduits)
await page.screenshot({ path: `${SHOTS}/trasa-github.png` })

assert.deepEqual(errors, [], 'console/page errors')
console.log('OK', { prompts })
await browser.close()
