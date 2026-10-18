// Regenerates the README screenshots in docs/img from a made-up demo house (never a real project).
// Run: pnpm shots  (starts its own dev server on :5179)
import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'

const OUT = new URL('../docs/img/', import.meta.url).pathname
const dev = spawn('pnpm', ['dev', '--port', '5179', '--strictPort'], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 3000))
const URL_ = 'http://localhost:5179/'
const b = await chromium.launch({ channel: 'chrome' })


// a simple architect-style floor plan for the demo (walls, doors, windows), drawn to the 1 m = 100 px grid
const PLAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1640" height="900" viewBox="0 0 1640 900">
<rect width="1640" height="900" fill="#fbfaf7"/>
<g fill="none" stroke="#2b2b2b" stroke-linecap="square">
<path d="M100 100H1500V560H1000V500H400V760H100Z" stroke-width="14"/>
<path d="M600 100V500M1000 100V500M100 500H400" stroke-width="8"/>
</g>
<g fill="#fbfaf7"><rect x="520" y="494" width="70" height="12"/><rect x="900" y="494" width="70" height="12"/><rect x="300" y="494" width="70" height="12"/><rect x="1080" y="553" width="300" height="14"/>
<rect x="230" y="93" width="160" height="14"/><rect x="700" y="93" width="180" height="14"/><rect x="93" y="600" width="14" height="90"/></g>
<g stroke="#2b2b2b" stroke-width="2" fill="none"><path d="M230 100h160M230 96h160M230 104h160M700 100h180M700 96h180M700 104h180M100 600v90M96 600v90M104 600v90"/>
<path d="M520 500a70 70 0 0 1 70-70v70M900 500a70 70 0 0 1 70-70v70M300 500a70 70 0 0 0 70 70v-70"/>
<path d="M1080 560h300" stroke-dasharray="10 8"/></g>
<g stroke="#c9ced6" stroke-width="2" fill="none"><rect x="140" y="380" width="200" height="80" rx="10"/><rect x="740" y="250" width="170" height="210" rx="8"/><rect x="130" y="700" width="160" height="50" rx="20"/><rect x="1090" y="160" width="230" height="340" rx="16"/></g>
</svg>`
const PLAN_URL = 'data:image/svg+xml;base64,' + Buffer.from(PLAN_SVG).toString('base64')

async function seed(page) {
  await page.goto(URL_)
  await page.evaluate(() => { try { localStorage.clear() } catch {} })
  await page.reload()
  await page.waitForFunction(() => window.__trasa && window.__trasaEngine)
  return page.evaluate((planUrl) => {
    let s = window.__trasa.getState()
    const re = () => (s = window.__trasa.getState())
    s.patchProject({ name: 'Demo kuća', pxPerMeter: 100, ceilingM: 2.6, planImage: planUrl, planSize: { w: 1640, h: 900 }, planRotation: 0 }); re()
    const living = s.addRoom([{ x: 100, y: 100 }, { x: 600, y: 100 }, { x: 600, y: 500 }, { x: 100, y: 500 }], 'Dnevni boravak'); re()
    const bed = s.addRoom([{ x: 600, y: 100 }, { x: 1000, y: 100 }, { x: 1000, y: 500 }, { x: 600, y: 500 }], 'Spavaća'); re()
    s.addRoom([{ x: 100, y: 500 }, { x: 400, y: 500 }, { x: 400, y: 760 }, { x: 100, y: 760 }], 'Kupaonica'); re()
    s.addRoom([{ x: 1000, y: 100 }, { x: 1500, y: 100 }, { x: 1500, y: 560 }, { x: 1000, y: 560 }], 'Garaža'); re()
    const cond = (pts, name, categoryId) => { const id = s.addConduit(pts); re(); s.updateConduit(id, { name, categoryId }); re(); return id }
    const feed = cond([{ x: 150, y: 880 }, { x: 150, y: 300 }, { x: 190, y: 130 }], 'DOLAZ ORMAR BORAVAK', 'dolaz')
    const net = cond([{ x: 60, y: 880 }, { x: 60, y: 420 }, { x: 470, y: 420 }, { x: 470, y: 130 }], 'INTERNET BORAVAK', 'internet')
    const pass = cond([{ x: 290, y: 130 }, { x: 600, y: 60 }, { x: 760, y: 130 }], 'PROLAZ BORAVAK → SPAVAĆA', 'struja')
    const lamp = cond([{ x: 390, y: 130 }, { x: 350, y: 280 }], 'SVJETLO BORAVAK', 'rasvjeta')
    const lampB = cond([{ x: 820, y: 130 }, { x: 800, y: 300 }], 'SVJETLO SPAVAĆA', 'rasvjeta')
    const garFeed = cond([{ x: 1560, y: 860 }, { x: 1560, y: 300 }, { x: 1300, y: 130 }], 'DOLAZ ORMAR GARAŽA', 'dolaz')
    cond([{ x: 940, y: 130 }, { x: 940, y: 300 }], 'TODO bužir uz krevet', 'todo')
    const el = (o) => { const id = s.addElement({ note: '', ...o }); re(); return id }
    const cab = (o) => { const id = s.addCable({ note: '', via: [], ...o }); re(); return id }
    const E = (id) => ({ kind: 'element', id }), X = (conduitId, end = 'end') => ({ kind: 'exit', conduitId, end })
    // living room, wall 1: box with a Sonoff, switch frame below it, media frame by the TV
    const k1 = el({ roomId: living, wall: 0, type: 'box', xM: 1.9, zM: 2.3 })
    const r1 = el({ roomId: living, wall: 0, type: 'relay', xM: 1.9, zM: 2.3, host: k1, relayModel: 'zbminir2' })
    const d1 = el({ roomId: living, wall: 0, type: 'modbox', xM: 0.6, zM: 1.1, modules: 3, depth: 'plitka' })
    const t1 = el({ roomId: living, wall: 0, type: 'switch', switchKind: 'tipkalo', xM: 0.6, zM: 1.1, host: d1 })
    el({ roomId: living, wall: 0, type: 'socket', socketKind: 'schuko', xM: 0.6, zM: 1.1, host: d1 })
    const d2 = el({ roomId: living, wall: 0, type: 'modbox', xM: 3.7, zM: 0.4, modules: 7 })
    el({ roomId: living, wall: 0, type: 'socket', socketKind: 'schuko', xM: 3.7, zM: 0.4, host: d2 })
    el({ roomId: living, wall: 0, type: 'socket', socketKind: 'schuko', xM: 3.7, zM: 0.4, host: d2 })
    el({ roomId: living, wall: 0, type: 'socket', socketKind: 'rj45', xM: 3.7, zM: 0.4, host: d2 })
    el({ roomId: living, wall: 0, type: 'socket', socketKind: 'tv', xM: 3.7, zM: 0.4, host: d2 })
    const s1 = el({ roomId: living, wall: 0, type: 'light', xM: 3.0, zM: 2.6, feedRelayId: r1, feedOutput: 1 })
    s.updateElement(t1, { relayId: r1, relayInput: 1 }); re()
    cab({ roomId: living, wall: 0, type: 'NYM-J 3x1.5', from: X(feed), to: E(k1) })
    cab({ roomId: living, wall: 0, type: 'NYM-J 5x1.5', from: E(k1), to: E(d1), via: [{ xM: 0.6, zM: 2.3 }] })
    cab({ roomId: living, wall: 0, type: 'NYM-J 3x1.5', from: E(k1), to: E(d2), via: [{ xM: 3.7, zM: 2.3 }] })
    cab({ roomId: living, wall: 0, type: 'NYM-J 3x1.5', from: E(k1), to: X(lamp, 'start') })
    cab({ roomId: living, wall: 0, type: 'NYM-J 3x1.5', from: X(lamp, 'end'), to: E(s1) })
    cab({ roomId: living, wall: 0, type: 'UTP cat6', from: X(net), to: E(d2), via: [{ xM: 3.75, zM: 2.5 }] })
    cab({ roomId: living, wall: 0, type: 'koaks', from: X(net), to: E(d2), via: [{ xM: 3.85, zM: 2.5 }] })
    cab({ roomId: living, wall: 0, type: 'NYM-J 3x1.5', from: E(k1), to: X(pass, 'start') })
    // bedroom: box fed through the ceiling, two-way switches by the door and the bed
    const k2 = el({ roomId: bed, wall: 0, type: 'box', xM: 1.6, zM: 2.3 })
    const s2 = el({ roomId: bed, wall: 0, type: 'light', xM: 2.2, zM: 2.6 })
    const d3 = el({ roomId: bed, wall: 0, type: 'modbox', xM: 0.4, zM: 1.1, modules: 3 })
    const d4 = el({ roomId: bed, wall: 0, type: 'modbox', xM: 3.3, zM: 0.8, modules: 4 })
    el({ roomId: bed, wall: 0, type: 'switch', switchKind: 'obicni', xM: 0.4, zM: 1.1, host: d3, controls: [s2] })
    el({ roomId: bed, wall: 0, type: 'socket', socketKind: 'schuko', xM: 3.3, zM: 0.8, host: d4 })
    el({ roomId: bed, wall: 0, type: 'socket', socketKind: 'schuko', xM: 3.3, zM: 0.8, host: d4 })
    cab({ roomId: bed, wall: 0, type: 'NYM-J 3x1.5', from: X(pass, 'end'), to: E(k2) })
    cab({ roomId: bed, wall: 0, type: 'NYM-J 5x1.5', from: E(k2), to: E(d3), via: [{ xM: 0.4, zM: 2.3 }] })
    cab({ roomId: bed, wall: 0, type: 'NYM-J 3x1.5', from: E(k2), to: E(d4), via: [{ xM: 3.3, zM: 2.3 }] })
    cab({ roomId: bed, wall: 0, type: 'NYM-J 3x1.5', from: E(k2), to: X(lampB, 'start') })
    cab({ roomId: bed, wall: 0, type: 'NYM-J 3x1.5', from: X(lampB, 'end'), to: E(s2) })
    // garage: Shelly 1 Gen4 as a dry contact for a roller door, push button in a frame
    const k3 = el({ roomId: s.project.rooms[3].id, wall: 0, type: 'box', xM: 3.0, zM: 2.3 })
    const r3 = el({ roomId: s.project.rooms[3].id, wall: 0, type: 'relay', xM: 3.0, zM: 2.3, host: k3, relayModel: 'gen4' })
    const v1 = el({ roomId: s.project.rooms[3].id, wall: 0, type: 'motor', xM: 1.4, zM: 2.4, feedRelayId: r3 })
    const d5 = el({ roomId: s.project.rooms[3].id, wall: 0, type: 'modbox', xM: 4.3, zM: 1.1, modules: 3 })
    el({ roomId: s.project.rooms[3].id, wall: 0, type: 'switch', switchKind: 'tipkalo', xM: 4.3, zM: 1.1, host: d5, relayId: r3, relayInput: 1 })
    const gr = s.project.rooms[3].id
    cab({ roomId: gr, wall: 0, type: 'NYM-J 3x1.5', from: X(garFeed), to: E(k3) })
    cab({ roomId: gr, wall: 0, type: 'NYM-J 5x1.5', from: E(k3), to: E(v1) })
    cab({ roomId: gr, wall: 0, type: 'NYM-J 5x1.5', from: E(k3), to: E(d5), via: [{ xM: 4.3, zM: 2.3 }] })
    s.markSaved('demo.trasa.json')
    return { living, bed, garage: gr, k1, k2, k3, d2 }
  }, PLAN_URL)
}

const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}${name}.png`, ...opts })
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 })
  const ids = await seed(page)
  await page.evaluate(() => { const s = window.__trasa.getState(); s.setView({ kind: 'plan' }); s.select(null) })
  await page.waitForTimeout(600); await page.evaluate(() => window.__trasa.getState().fitView()); await page.waitForTimeout(500)
  await shot(page, 'plan')
  await page.evaluate(({ living }) => { const s = window.__trasa.getState(); s.setRoom(living); s.setView({ kind: 'room', roomId: living, wall: 0 }); s.select(null) }, ids)
  await page.waitForTimeout(700); await shot(page, 'wall')
  await page.evaluate(({ k1 }) => { const s = window.__trasa.getState(); s.setView({ kind: 'junctions', elementId: k1 }) }, ids)
  await page.waitForTimeout(700); await page.getByRole('tab', { name: 'Sve žile' }).click(); await page.waitForTimeout(500); await shot(page, 'junction')
  await page.evaluate(({ k3, garage }) => { const s = window.__trasa.getState(); s.setRoom(garage); s.setView({ kind: 'junctions', elementId: k3 }) }, ids)
  await page.waitForTimeout(700); await page.getByRole('tab', { name: 'Sve žile' }).click(); await page.waitForTimeout(500); await shot(page, 'junction-shelly')
  await page.evaluate(({ living }) => { const s = window.__trasa.getState(); s.setRoom(living); s.setView({ kind: 'junctions', elementId: null }) }, ids)
  await page.waitForTimeout(500); await page.getByRole('tab', { name: 'Cijela soba' }).click(); await page.waitForTimeout(1200); await shot(page, 'room-board')
  await page.evaluate(() => { const s = window.__trasa.getState(); s.setRoom(null); s.setView({ kind: 'bom' }) })
  await page.waitForTimeout(800); await shot(page, 'material')
  await page.close()

  const phone = await b.newContext({ ...devices['iPhone 14'], deviceScaleFactor: 3 })
  const mp = await phone.newPage()
  const mids = await seed(mp)
  await mp.evaluate(({ k1 }) => window.__trasa.getState().setView({ kind: 'junctions', elementId: k1 }), mids)
  await mp.waitForTimeout(1000); await shot(mp, 'mobile')
  await phone.close()
} catch (e) { console.error(e); process.exitCode = 1 }
await b.close(); dev.kill()

// social preview card (GitHub: Settings → Social preview), 1280 × 640
{
  const b2 = await chromium.launch({ channel: 'chrome' })
  const p = await b2.newPage({ viewport: { width: 1280, height: 640 } })
  const fs = await import('node:fs')
  const logo = fs.readFileSync(`${OUT}logo.svg`, 'utf8')
  const shot = fs.readFileSync(`${OUT}junction-shelly.png`).toString('base64')
  await p.setContent(`<html><body style="margin:0;width:1280px;height:640px;background:linear-gradient(135deg,#1e3a5f,#0b1422);font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#e8eef6;display:flex;overflow:hidden">
    <div style="padding:72px 0 0 72px;width:520px;flex:none">
      <div style="width:120px;height:120px">${logo.replace('width="128" height="128"', 'width="120" height="120"')}</div>
      <div style="font-size:84px;font-weight:800;color:#4dabf7;letter-spacing:-2px;margin-top:28px">Trasa</div>
      <div style="font-size:30px;line-height:1.35;margin-top:14px;color:#c9d6e6">Planer bužira, razvodnih kutija i spojeva za kuću</div>
      <div style="font-size:20px;margin-top:28px;color:#8fa5bf">WAGO u mjerilu · Shelly / Sonoff · popis materijala</div>
    </div>
    <img src="data:image/png;base64,${shot}" style="width:900px;margin:70px 0 0 0;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.55);object-fit:cover;object-position:28% 30%;height:620px">
  </body></html>`)
  await p.screenshot({ path: `${OUT}social-preview.png` })
  await b2.close()
}
