/*
 * Icon builder — one source of truth for every launcher icon.
 *
 *   node icons/build-icons.cjs      (or: npm run icons)
 *
 * NOTE THE .cjs EXTENSION, AND DO NOT RENAME IT BACK. This script is CommonJS
 * — it uses require() — and package.json declares "type": "module", which the
 * kit needs for the ES-module app code and the test runner. As build-icons.js
 * it therefore died on its own first line with "require is not defined in ES
 * module scope", so `npm run icons` failed on every app ever scaffolded from
 * this kit and no icon was generated. The extension is what tells node how to
 * parse the file; renaming it back means converting the whole file to import
 * syntax first.
 *
 * Requires @resvg/resvg-js, dev-only, never shipped with the app:
 *   npm i -D @resvg/resvg-js      (or: npx --yes -p @resvg/resvg-js node icons/build-icons.js)
 *
 * Reads icons/source.svg (512x512) and writes the full set:
 *
 *   icon.svg              the mark, as authored
 *   icon-maskable.svg     the same mark, inset into the Android safe zone
 *   favicon.svg           small-size variant
 *   icon-192.png          \
 *   icon-512.png           |  Chrome's installability criteria REQUIRE a 192
 *   icon-1024.png          |  and a 512 PNG. An SVG does not satisfy them —
 *   apple-touch-icon.png   |  without both, everything else can be in order
 *   icon-192-maskable.png  |  and the install offer simply never appears.
 *   icon-512-maskable.png /
 *
 * Two rules, both learned the hard way:
 *
 * 1. EVERYTHING IS DRAWN FULL-BLEED AND FULLY OPAQUE. An icon with alpha, or
 *    with a "ground" band baked into it from an older source, shows up as a
 *    clipped mark or a transparent tile on a home screen.
 *
 * 2. THE MASKABLE COPY IS NOT OPTIONAL. Given only `any` icons, an Android
 *    launcher declines to crop and shrinks instead — letterboxing your mark
 *    onto a white tile beside every other app on the phone. Maskable art must
 *    keep everything meaningful inside the centre 80% circle, because the
 *    launcher will crop to whatever shape it likes.
 *
 * Never hand-edit a PNG. Change source.svg (or BACKGROUND below) and re-run.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT = __dirname;
const SOURCE = path.join(OUT, "source.svg");

/* The opaque plate every icon is drawn on. Must match the app's theme_color
 * family — this is what the user sees behind the mark on their home screen. */
const BACKGROUND = "#1f5f3b";   // turf green — the source is drawn on it too

/* Android's maskable safe zone is the centre 80%. Scaling the mark to 78%
 * leaves a hair of margin so a circular crop never clips a stroke. */
const MASKABLE_SCALE = 0.78;

const SIZES = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-1024.png", size: 1024, maskable: false },
  { file: "apple-touch-icon.png", size: 180, maskable: false },
  { file: "icon-192-maskable.png", size: 192, maskable: true },
  { file: "icon-512-maskable.png", size: 512, maskable: true },
];

function readSource() {
  if (!fs.existsSync(SOURCE)) {
    console.error(
      `No ${path.relative(process.cwd(), SOURCE)}.\n` +
      "Author the mark as a 512x512 SVG there, then re-run."
    );
    process.exit(1);
  }
  const svg = fs.readFileSync(SOURCE, "utf8");
  // Strip the outer <svg> wrapper so the mark can be re-wrapped and
  // transformed below. Keeps this script agnostic about how it was authored.
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  return inner.trim();
}

function wrap(inner, { maskable }) {
  const plate = `<rect width="512" height="512" fill="${BACKGROUND}"/>`;
  if (!maskable) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${plate}${inner}</svg>`;
  }
  const s = MASKABLE_SCALE;
  const offset = (512 * (1 - s)) / 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `${plate}<g transform="translate(${offset.toFixed(1)} ${offset.toFixed(1)}) scale(${s})">${inner}</g></svg>`
  );
}

/* ---------------------------------------------------------------------------
 * Byte-verify that a rendered PNG is actually opaque.
 *
 * "Set a background colour" is an instruction to the renderer, not a
 * guarantee about the bytes. A source SVG with a transparent region, a
 * blend mode, or a clip that overshoots can still produce alpha < 255 — and
 * the failure only shows up as a see-through tile on somebody's home screen,
 * long after the deploy. So decode what was actually written and assert.
 * ------------------------------------------------------------------------- */

function pngIsOpaque(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");

  let i = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    i += 12 + len;
  }

  // No alpha channel at all is the ideal outcome — nothing to check.
  if (colorType !== 4 && colorType !== 6) return true;
  if (bitDepth !== 8) throw new Error(`unhandled bit depth ${bitDepth}`);

  const channels = colorType === 6 ? 4 : 2;
  const bpp = channels;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idat));

  // Undo the per-scanline filters. This is the whole of the PNG filter spec
  // for 8-bit samples; it is short enough to be worth not taking a dependency.
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 255;
      else if (filter === 2) line[x] = (line[x] + b) & 255;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[x] = (line[x] + pred) & 255;
      }
    }
    for (let x = bpp - 1; x < stride; x += bpp) {
      if (line[x] !== 255) return false;
    }
    prev = line;
  }
  return true;
}

function main() {
  const inner = readSource();

  const plain = wrap(inner, { maskable: false });
  const maskable = wrap(inner, { maskable: true });

  fs.writeFileSync(path.join(OUT, "icon.svg"), plain);
  fs.writeFileSync(path.join(OUT, "icon-maskable.svg"), maskable);
  // favicon is the same art; a separate file so it can be simplified later
  // without touching the launcher icon.
  fs.writeFileSync(path.join(OUT, "favicon.svg"), plain);

  let Resvg;
  try {
    ({ Resvg } = require("@resvg/resvg-js"));
  } catch (err) {
    console.error(
      "SVGs written. PNGs skipped — @resvg/resvg-js is not installed.\n" +
      "  npm i -D @resvg/resvg-js   then re-run."
    );
    process.exit(1);
  }

  for (const { file, size, maskable: isMask } of SIZES) {
    const svg = isMask ? maskable : plain;
    const png = new Resvg(svg, {
      fitTo: { mode: "width", value: size },
      // Opaque background at the renderer level too, belt and braces: an
      // icon that reaches a launcher with alpha in it is the failure this
      // whole script exists to prevent.
      background: BACKGROUND,
    }).render().asPng();
    if (!pngIsOpaque(png)) {
      console.error(
        `\n${file} came out with transparent pixels.\n` +
        "A home-screen icon with alpha shows as a clipped mark or a see-through\n" +
        "tile. Fix source.svg (or BACKGROUND) rather than shipping this."
      );
      process.exit(1);
    }
    fs.writeFileSync(path.join(OUT, file), png);
    console.log(`wrote ${file} (${size}x${size}${isMask ? ", maskable" : ""}) — verified opaque`);
  }
}

main();
