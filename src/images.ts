export async function fileToDataUrl(file: File, maxDim = 2500): Promise<{ url: string; w: number; h: number }> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  const url = c.toDataURL('image/jpeg', 0.88)
  return { url, w, h }
}

export function download(name: string, url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

// Dominant wall angle in degrees (-45..45) by projection profiles: the
// angle at which row/column sums of ink pixels are sharpest is the skew.
export function detectSkew(img: HTMLImageElement): number {
  const scale = Math.min(1, 500 / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, w, h)
  const d = g.getImageData(0, 0, w, h).data
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114
      if (v < 110) { xs.push(x - w / 2); ys.push(y - h / 2) }
    }
  }
  if (xs.length < 50 || xs.length > w * h * 0.5) return 0
  const diag = Math.ceil(Math.hypot(w, h))
  const rows = new Int32Array(diag + 2)
  const cols = new Int32Array(diag + 2)
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180
    const cs = Math.cos(t)
    const sn = Math.sin(t)
    rows.fill(0)
    cols.fill(0)
    for (let i = 0; i < xs.length; i++) {
      rows[Math.round(-xs[i] * sn + ys[i] * cs + diag / 2)]++
      cols[Math.round(xs[i] * cs + ys[i] * sn + diag / 2)]++
    }
    let sum = 0
    for (let i = 0; i < rows.length; i++) sum += rows[i] * rows[i] + cols[i] * cols[i]
    return sum
  }
  let best = 0
  let bestScore = -1
  for (let a = -45; a <= 45; a += 0.5) {
    const sc = score(a)
    if (sc > bestScore) { bestScore = sc; best = a }
  }
  for (let a = best - 0.5; a <= best + 0.5; a += 0.05) {
    const sc = score(a)
    if (sc > bestScore) { bestScore = sc; best = a }
  }
  return Math.round(best * 100) / 100
}
