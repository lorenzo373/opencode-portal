#!/usr/bin/env node
/**
 * Generates build/icon.ico + build/icon.png for the portal.
 * Pure Node: analytic SDF raster + hand-rolled PNG encoder, no image deps.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = resolve(here, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    for (let x = 0; x < stride; x++) raw[y * (stride + 1) + 1 + x] = rgba[y * stride + x]
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function sdRoundBox(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ax = Math.max(qx, 0)
  const ay = Math.max(qy, 0)
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r
}

const mix = (a, b, t) => a + (b - a) * t

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const s = size
  const px = 1 / s
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const u = (x + 0.5) / s
      const v = (y + 0.5) / s
      const i = (y * s + x) * 4

      // Plate: rounded square occupying most of the canvas.
      const plate = sdRoundBox(u, v, 0.5, 0.5, 0.46, 0.46, 0.145)
      const plateCov = clamp01(0.5 - plate / px)

      // Vertical gradient body.
      const gy = smooth(0.04, 0.96, v)
      let r = mix(0.086, 0.043, gy)
      let g = mix(0.098, 0.055, gy)
      let b = mix(0.149, 0.098, gy)

      // Ambient glow behind the ring.
      const glow = Math.exp(-(((u - 0.5) ** 2 + (v - 0.46) ** 2) / 0.075)) * 0.55
      r = mix(r, 0.36, glow * 0.5)
      g = mix(g, 0.24, glow * 0.5)
      b = mix(b, 0.74, glow * 0.5)

      // Portal ring: donut with a 46 degree gap toward the top-right.
      const dx = u - 0.5
      const dy = v - 0.5
      const dist = Math.hypot(dx, dy)
      const angle = Math.atan2(dy, dx)
      const gapCenter = -Math.PI / 4
      let delta = Math.abs(((angle - gapCenter + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      if (delta > Math.PI) delta = Math.PI * 2 - delta
      const ringR = 0.215
      const ringW = 0.062
      const ringDist = Math.abs(dist - ringR) - ringW / 2
      const ringCov = clamp01(0.5 - ringDist / px) * smooth(0.1, 0.24, delta)

      // Ring stroke gradient (violet -> cyan around the circumference).
      const t = clamp01((angle + Math.PI) / (Math.PI * 2))
      let rr = mix(0.545, 0.133, t)
      let rg = mix(0.361, 0.827, t)
      let rb = mix(0.965, 0.933, t)

      // Inner core dot.
      const core = Math.hypot(u - 0.5, v - 0.5) - 0.055
      const coreCov = clamp01(0.5 - core / px)
      let cr = 0.93
      let cg = 0.95
      let cb = 1.0

      // Compose ring over body.
      let outR = mix(r, rr, ringCov)
      let outG = mix(g, rg, ringCov)
      let outB = mix(b, rb, ringCov)
      outR = mix(outR, cr, coreCov)
      outG = mix(outG, cg, coreCov)
      outB = mix(outB, cb, coreCov)

      // Subtle top highlight on the plate edge.
      const edge = clamp01(1 - Math.abs(plate) / (px * 1.6))
      outR = Math.min(1, outR + edge * 0.05)
      outG = Math.min(1, outG + edge * 0.05)
      outB = Math.min(1, outB + edge * 0.06)

      rgba[i] = Math.round(clamp01(outR) * 255)
      rgba[i + 1] = Math.round(clamp01(outG) * 255)
      rgba[i + 2] = Math.round(clamp01(outB) * 255)
      rgba[i + 3] = Math.round(plateCov * 255)
    }
  }
  return encodePng(size, size, rgba)
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const pngs = sizes.map((size) => ({ size, data: renderIcon(size) }))

// ICO container (PNG-compressed entries are supported on Windows Vista+).
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(pngs.length, 4)
const entries = []
let offset = 6 + pngs.length * 16
for (const png of pngs) {
  const entry = Buffer.alloc(16)
  entry[0] = png.size >= 256 ? 0 : png.size
  entry[1] = png.size >= 256 ? 0 : png.size
  entry[2] = 0
  entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.data.length, 8)
  entry.writeUInt32LE(offset, 12)
  entries.push(entry)
  offset += png.data.length
}
const ico = Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
writeFileSync(resolve(buildDir, 'icon.ico'), ico)

const big = renderIcon(512)
writeFileSync(resolve(buildDir, 'icon.png'), big)
const publicDir = resolve(here, '..', 'src', 'renderer', 'public')
mkdirSync(publicDir, { recursive: true })
writeFileSync(resolve(publicDir, 'icon.png'), renderIcon(256))
writeFileSync(resolve(publicDir, 'icon.ico'), ico)

console.log(`icon.ico ${(ico.length / 1024).toFixed(1)} kB · icon.png 512px · public/icon.png 256px`)
