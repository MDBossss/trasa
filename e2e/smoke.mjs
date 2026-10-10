// Smoke test against a running dev server: node e2e/smoke.mjs [url]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'

const URL = process.argv[2] ?? 'http://localhost:5177/'
const SHOTS = process.env.SHOTS ?? '/tmp'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

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
await page.goto(URL)
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
st = await state()
assert.equal(st.planRotation, 0)
assert.deepEqual(st.conduits[0].points, [{ x: 150, y: 120 }, { x: 150, y: 380 }])
assert.deepEqual(st.rooms[0].points[0], { x: 100, y: 100 })

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

// persistence across reload
await page.waitForTimeout(600)
await page.reload()
await page.locator('.list').getByText('B1-ormar').waitFor()
await page.locator('.list').getByText('1/4 fotki').waitFor()

// export json download
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByText('Export JSON').click()])
assert.match(dl.suggestedFilename(), /\.trasa\.json$/)

assert.deepEqual(errors, [], 'console/page errors')
console.log('OK', { prompts })
await browser.close()
