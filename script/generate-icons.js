#!/usr/bin/env node
'use strict';

/**
 * Generate platform-native app icons from a single 1024x1024 PNG master.
 *
 *   macOS -> resources/icon.icns   (10 representations, HIG 824/1024 icon grid)
 *   Win   -> resources/favicon.ico (10 sizes, 32bpp BMP + PNG-compressed 256)
 *
 * Zero dependencies: PNG decode/encode, Lanczos-3 resampling, ICNS and ICO
 * containers are all implemented here, so it runs anywhere Node runs.
 *
 * Usage:
 *   node script/generate-icons.js [options]
 *
 *   --input <file>    master PNG (default script/generateIcns/icon1024.png)
 *   --outdir <dir>    output directory (default resources)
 *   --mac-only        only write the .icns
 *   --win-only        only write the .ico
 *   --no-mac-padding  keep the macOS artwork full-bleed instead of insetting
 *                     it to the 824x824 HIG icon grid
 *   --iconset         also emit script/generateIcns/AppIcon.iconset
 *   --quiet
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ *
 * CRC32 (PNG chunk checksums)
 * ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * PNG decoding -> { width, height, data: Uint8ClampedArray(RGBA) }
 * ------------------------------------------------------------------ */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decodePNG(buf) {
    if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
        throw new Error('not a PNG file');
    }

    let header = null;
    let palette = null;
    let transparency = null;
    const idat = [];

    let pos = 8;
    while (pos + 8 <= buf.length) {
        const length = buf.readUInt32BE(pos);
        const type = buf.toString('latin1', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + length);
        if (type === 'IHDR') {
            header = {
                width: data.readUInt32BE(0),
                height: data.readUInt32BE(4),
                depth: data[8],
                colorType: data[9],
                interlace: data[12]
            };
        } else if (type === 'PLTE') palette = Buffer.from(data);
        else if (type === 'tRNS') transparency = Buffer.from(data);
        else if (type === 'IDAT') idat.push(Buffer.from(data));
        else if (type === 'IEND') break;
        pos += 12 + length;
    }

    if (!header) throw new Error('PNG is missing its IHDR chunk');
    if (header.interlace !== 0) throw new Error('interlaced PNGs are not supported');

    const { width, height, depth, colorType } = header;
    const channels = CHANNELS[colorType];
    if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);
    if (colorType === 3 ? ![1, 2, 4, 8].includes(depth) : ![8, 16].includes(depth)) {
        throw new Error(`unsupported PNG bit depth ${depth} for color type ${colorType}`);
    }

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const bitsPerPixel = channels * depth;
    const bytesPerPixel = Math.max(1, bitsPerPixel >> 3);
    const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
    const scanlines = unfilter(raw, height, bytesPerRow, bytesPerPixel);

    return {
        width,
        height,
        data: toRGBA(scanlines, { width, height, depth, colorType, channels, bytesPerRow }, palette, transparency)
    };
}

/** Reverse the per-scanline PNG filters, in place, into one contiguous buffer. */
function unfilter(raw, height, bytesPerRow, bytesPerPixel) {
    const out = Buffer.alloc(height * bytesPerRow);
    let src = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[src++];
        const line = src;
        const dst = y * bytesPerRow;
        const up = dst - bytesPerRow;
        for (let x = 0; x < bytesPerRow; x++) {
            const value = raw[line + x];
            const left = x >= bytesPerPixel ? out[dst + x - bytesPerPixel] : 0;
            const above = y > 0 ? out[up + x] : 0;
            const upperLeft = y > 0 && x >= bytesPerPixel ? out[up + x - bytesPerPixel] : 0;
            let restored;
            switch (filter) {
                case 0:
                    restored = value;
                    break;
                case 1:
                    restored = value + left;
                    break;
                case 2:
                    restored = value + above;
                    break;
                case 3:
                    restored = value + ((left + above) >> 1);
                    break;
                case 4:
                    restored = value + paeth(left, above, upperLeft);
                    break;
                default:
                    throw new Error(`unknown PNG filter type ${filter} on row ${y}`);
            }
            out[dst + x] = restored & 0xff;
        }
        src += bytesPerRow;
    }
    return out;
}

function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    return pb <= pc ? b : c;
}

function toRGBA(scanlines, info, palette, transparency) {
    const { width, height, depth, colorType, channels, bytesPerRow } = info;
    const out = new Uint8ClampedArray(width * height * 4);
    const step = depth === 16 ? 2 : 1;

    for (let y = 0; y < height; y++) {
        const row = y * bytesPerRow;
        for (let x = 0; x < width; x++) {
            const o = (y * width + x) * 4;
            if (colorType === 3) {
                const index = readBits(scanlines, row, x, depth);
                out[o] = palette[index * 3];
                out[o + 1] = palette[index * 3 + 1];
                out[o + 2] = palette[index * 3 + 2];
                out[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
                continue;
            }
            const p = row + x * channels * step;
            const sample = (i) => scanlines[p + i * step]; // 16-bit -> keep the high byte
            switch (colorType) {
                case 0:
                    out[o] = out[o + 1] = out[o + 2] = sample(0);
                    out[o + 3] = 255;
                    break;
                case 4:
                    out[o] = out[o + 1] = out[o + 2] = sample(0);
                    out[o + 3] = sample(1);
                    break;
                case 2:
                    out[o] = sample(0);
                    out[o + 1] = sample(1);
                    out[o + 2] = sample(2);
                    out[o + 3] = 255;
                    break;
                case 6:
                    out[o] = sample(0);
                    out[o + 1] = sample(1);
                    out[o + 2] = sample(2);
                    out[o + 3] = sample(3);
                    break;
            }
        }
    }
    return out;
}

function readBits(buf, rowOffset, x, depth) {
    if (depth === 8) return buf[rowOffset + x];
    const perByte = 8 / depth;
    const byte = buf[rowOffset + Math.floor(x / perByte)];
    const shift = 8 - depth * ((x % perByte) + 1);
    return (byte >> shift) & ((1 << depth) - 1);
}

/* ------------------------------------------------------------------ *
 * PNG encoding (8-bit RGBA, adaptive filtering)
 * ------------------------------------------------------------------ */

function encodePNG(image) {
    const { width, height, data } = image;
    const bytesPerRow = width * 4;
    const raw = Buffer.alloc(height * (bytesPerRow + 1));
    const candidate = Buffer.alloc(bytesPerRow);
    const prev = Buffer.alloc(bytesPerRow);
    const current = Buffer.alloc(bytesPerRow);

    for (let y = 0; y < height; y++) {
        current.set(data.subarray(y * bytesPerRow, (y + 1) * bytesPerRow));
        let bestFilter = 0;
        let bestScore = Infinity;
        let best = null;
        for (let filter = 0; filter <= 4; filter++) {
            let score = 0;
            for (let x = 0; x < bytesPerRow; x++) {
                const left = x >= 4 ? current[x - 4] : 0;
                const above = prev[x];
                const upperLeft = x >= 4 ? prev[x - 4] : 0;
                let value;
                switch (filter) {
                    case 0:
                        value = current[x];
                        break;
                    case 1:
                        value = current[x] - left;
                        break;
                    case 2:
                        value = current[x] - above;
                        break;
                    case 3:
                        value = current[x] - ((left + above) >> 1);
                        break;
                    default:
                        value = current[x] - paeth(left, above, upperLeft);
                }
                value &= 0xff;
                candidate[x] = value;
                score += value < 128 ? value : 256 - value;
            }
            if (score < bestScore) {
                bestScore = score;
                bestFilter = filter;
                best = Buffer.from(candidate);
            }
        }
        raw[y * (bytesPerRow + 1)] = bestFilter;
        best.copy(raw, y * (bytesPerRow + 1) + 1);
        prev.set(current);
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // truecolor + alpha
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0))
    ]);
}

function pngChunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, crc]);
}

/* ------------------------------------------------------------------ *
 * Resampling: separable Lanczos-3 on premultiplied alpha
 * ------------------------------------------------------------------ */

function lanczos(x) {
    if (x === 0) return 1;
    const ax = Math.abs(x);
    if (ax >= 3) return 0;
    const px = Math.PI * x;
    return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/** Precompute, for every destination pixel, which source pixels feed it. */
function buildWeights(srcLength, dstLength) {
    const scale = dstLength / srcLength;
    const spread = scale < 1 ? 1 / scale : 1; // widen the kernel when downscaling
    const support = 3 * spread;
    const taps = [];

    for (let i = 0; i < dstLength; i++) {
        const center = (i + 0.5) / scale;
        const start = Math.max(0, Math.floor(center - support - 0.5) + 1);
        const end = Math.min(srcLength - 1, Math.ceil(center + support - 0.5));
        const weights = new Float64Array(end - start + 1);
        let sum = 0;
        for (let j = start; j <= end; j++) {
            const w = lanczos((j + 0.5 - center) / spread);
            weights[j - start] = w;
            sum += w;
        }
        if (sum !== 0) for (let k = 0; k < weights.length; k++) weights[k] /= sum;
        taps.push({ start, weights });
    }
    return taps;
}

function resize(image, width, height) {
    if (image.width === width && image.height === height) {
        return { width, height, data: new Uint8ClampedArray(image.data) };
    }

    // Premultiply so transparent pixels never bleed their color into edges.
    const src = new Float64Array(image.width * image.height * 4);
    for (let i = 0; i < image.data.length; i += 4) {
        const a = image.data[i + 3] / 255;
        src[i] = image.data[i] * a;
        src[i + 1] = image.data[i + 1] * a;
        src[i + 2] = image.data[i + 2] * a;
        src[i + 3] = image.data[i + 3];
    }

    const horizontal = buildWeights(image.width, width);
    const tmp = new Float64Array(width * image.height * 4);
    for (let y = 0; y < image.height; y++) {
        const rowIn = y * image.width * 4;
        const rowOut = y * width * 4;
        for (let x = 0; x < width; x++) {
            const { start, weights } = horizontal[x];
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let k = 0; k < weights.length; k++) {
                const p = rowIn + (start + k) * 4;
                const w = weights[k];
                r += src[p] * w;
                g += src[p + 1] * w;
                b += src[p + 2] * w;
                a += src[p + 3] * w;
            }
            const o = rowOut + x * 4;
            tmp[o] = r;
            tmp[o + 1] = g;
            tmp[o + 2] = b;
            tmp[o + 3] = a;
        }
    }

    const vertical = buildWeights(image.height, height);
    const out = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        const { start, weights } = vertical[y];
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let k = 0; k < weights.length; k++) {
                const p = ((start + k) * width + x) * 4;
                const w = weights[k];
                r += tmp[p] * w;
                g += tmp[p + 1] * w;
                b += tmp[p + 2] * w;
                a += tmp[p + 3] * w;
            }
            const o = (y * width + x) * 4;
            a = Math.min(255, Math.max(0, a));
            out[o + 3] = Math.round(a);
            if (a <= 0) continue;
            const inv = 255 / a;
            out[o] = Math.round(r * inv);
            out[o + 1] = Math.round(g * inv);
            out[o + 2] = Math.round(b * inv);
        }
    }
    return { width, height, data: out };
}

/** Center `image` on a transparent canvas of `size` x `size`. */
function pad(image, size) {
    const out = new Uint8ClampedArray(size * size * 4);
    const left = Math.round((size - image.width) / 2);
    const top = Math.round((size - image.height) / 2);
    for (let y = 0; y < image.height; y++) {
        const dst = ((top + y) * size + left) * 4;
        out.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), dst);
    }
    return { width: size, height: size, data: out };
}

/* ------------------------------------------------------------------ *
 * ICNS (macOS)
 * ------------------------------------------------------------------ */

// OSTypes Finder actually reads today; every one carries a PNG payload.
// Retina variants intentionally duplicate their @1x counterpart's pixel size.
const ICNS_TYPES = [
    { type: 'ic04', size: 16 }, // 16pt @1x
    { type: 'ic11', size: 32 }, // 16pt @2x
    { type: 'ic05', size: 32 }, // 32pt @1x
    { type: 'ic12', size: 64 }, // 32pt @2x
    { type: 'ic07', size: 128 }, // 128pt @1x
    { type: 'ic13', size: 256 }, // 128pt @2x
    { type: 'ic08', size: 256 }, // 256pt @1x
    { type: 'ic14', size: 512 }, // 256pt @2x
    { type: 'ic09', size: 512 }, // 512pt @1x
    { type: 'ic10', size: 1024 } // 512pt @2x
];

function buildICNS(pngBySize) {
    const entries = ICNS_TYPES.map(({ type, size }) => {
        const payload = pngBySize.get(size);
        const header = Buffer.alloc(8);
        header.write(type, 0, 'latin1');
        header.writeUInt32BE(payload.length + 8, 4);
        return Buffer.concat([header, payload]);
    });

    // 'TOC ' lets Finder index representations without reading the whole file.
    const toc = Buffer.alloc(8 + entries.length * 8);
    toc.write('TOC ', 0, 'latin1');
    toc.writeUInt32BE(toc.length, 4);
    entries.forEach((entry, i) => {
        entry.copy(toc, 8 + i * 8, 0, 8);
    });

    const body = Buffer.concat([toc, ...entries]);
    const head = Buffer.alloc(8);
    head.write('icns', 0, 'latin1');
    head.writeUInt32BE(body.length + 8, 4);
    return Buffer.concat([head, body]);
}

/* ------------------------------------------------------------------ *
 * ICO (Windows)
 * ------------------------------------------------------------------ */

// Shell sizes: 16/32/48/256 are required, the rest cover 125-400% DPI scaling.
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
// Windows has read PNG-compressed entries since Vista, but the convention
// (and what every icon editor emits) is PNG for 256 only, BMP below that.
const ICO_PNG_THRESHOLD = 256;

/** 32bpp bottom-up DIB + 1bpp AND mask, i.e. an icon's classic BMP payload. */
function buildIcoBMP(image) {
    const { width, height, data } = image;
    const maskStride = Math.ceil(width / 8 / 4) * 4;
    const header = Buffer.alloc(40);
    header.writeUInt32LE(40, 0); // biSize
    header.writeInt32LE(width, 4); // biWidth
    header.writeInt32LE(height * 2, 8); // biHeight: XOR + AND stacked
    header.writeUInt16LE(1, 12); // biPlanes
    header.writeUInt16LE(32, 14); // biBitCount
    header.writeUInt32LE(0, 16); // BI_RGB
    header.writeUInt32LE(width * height * 4 + maskStride * height, 20);

    const xor = Buffer.alloc(width * height * 4);
    const and = Buffer.alloc(maskStride * height);
    for (let y = 0; y < height; y++) {
        const srcRow = y * width * 4;
        const dstRow = (height - 1 - y) * width * 4; // DIBs are bottom-up
        const maskRow = (height - 1 - y) * maskStride;
        for (let x = 0; x < width; x++) {
            const s = srcRow + x * 4;
            const d = dstRow + x * 4;
            xor[d] = data[s + 2]; // B
            xor[d + 1] = data[s + 1]; // G
            xor[d + 2] = data[s]; // R
            xor[d + 3] = data[s + 3]; // A
            if (data[s + 3] === 0) and[maskRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
    }
    return Buffer.concat([header, xor, and]);
}

function buildICO(imagesBySize) {
    const sizes = [...ICO_SIZES].sort((a, b) => a - b);
    const payloads = sizes.map((size) => {
        const image = imagesBySize.get(size);
        return size >= ICO_PNG_THRESHOLD ? encodePNG(image) : buildIcoBMP(image);
    });

    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // 1 = icon
    header.writeUInt16LE(sizes.length, 4);

    const directory = Buffer.alloc(sizes.length * 16);
    let offset = header.length + directory.length;
    sizes.forEach((size, i) => {
        const o = i * 16;
        directory[o] = size >= 256 ? 0 : size; // 0 means 256
        directory[o + 1] = size >= 256 ? 0 : size;
        directory[o + 2] = 0; // palette size
        directory[o + 3] = 0; // reserved
        directory.writeUInt16LE(1, o + 4); // color planes
        directory.writeUInt16LE(32, o + 6); // bits per pixel
        directory.writeUInt32LE(payloads[i].length, o + 8);
        directory.writeUInt32LE(offset, o + 12);
        offset += payloads[i].length;
    });

    return Buffer.concat([header, directory, ...payloads]);
}

/* ------------------------------------------------------------------ *
 * Driver
 * ------------------------------------------------------------------ */

const ROOT = path.resolve(__dirname, '..');
// Apple's macOS icon grid: the artwork occupies 824x824 of the 1024x1024
// canvas, the remaining 100px ring is the shadow/hover margin the system
// draws into. Windows icons are full-bleed, so this applies to .icns only.
const MAC_ARTWORK_RATIO = 824 / 1024;

const ICONSET_FILES = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
];

function parseArgs(argv) {
    const options = {
        input: path.join(ROOT, 'script', 'generateIcns', 'icon1024.png'),
        outdir: path.join(ROOT, 'resources'),
        mac: true,
        win: true,
        macPadding: true,
        iconset: false,
        quiet: false
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--input' || arg === '-i') options.input = path.resolve(argv[++i]);
        else if (arg === '--outdir' || arg === '-o') options.outdir = path.resolve(argv[++i]);
        else if (arg === '--mac-only') options.win = false;
        else if (arg === '--win-only') options.mac = false;
        else if (arg === '--no-mac-padding') options.macPadding = false;
        else if (arg === '--iconset') options.iconset = true;
        else if (arg === '--quiet' || arg === '-q') options.quiet = true;
        else if (arg === '--help' || arg === '-h') {
            console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('/**')[1].trim());
            process.exit(0);
        } else throw new Error(`unknown option: ${arg}`);
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const log = options.quiet ? () => {} : (...args) => console.log(...args);

    const master = decodePNG(fs.readFileSync(options.input));
    if (master.width !== master.height) {
        throw new Error(`master icon must be square, got ${master.width}x${master.height}`);
    }
    if (master.width < 1024) {
        console.warn(`warning: master is only ${master.width}px; 1024x1024 is required for crisp Retina output`);
    }
    log(`master  ${path.relative(ROOT, options.input)} (${master.width}x${master.height})`);
    fs.mkdirSync(options.outdir, { recursive: true });

    if (options.mac) {
        // Inset once at full resolution, then derive every size from that
        // canvas so the artwork keeps the exact same proportions everywhere.
        const canvas = options.macPadding
            ? pad(resize(master, Math.round(1024 * MAC_ARTWORK_RATIO), Math.round(1024 * MAC_ARTWORK_RATIO)), 1024)
            : resize(master, 1024, 1024);

        const pngBySize = new Map();
        for (const size of new Set(ICNS_TYPES.map((t) => t.size))) {
            pngBySize.set(size, encodePNG(resize(canvas, size, size)));
        }

        const icns = path.join(options.outdir, 'icon.icns');
        fs.writeFileSync(icns, buildICNS(pngBySize));
        log(
            `macOS   ${path.relative(ROOT, icns)} — ${ICNS_TYPES.length} representations, ` +
                `${options.macPadding ? '824/1024 HIG grid' : 'full-bleed'} (${kb(fs.statSync(icns).size)})`
        );

        if (options.iconset) {
            const dir = path.join(ROOT, 'script', 'generateIcns', 'AppIcon.iconset');
            fs.mkdirSync(dir, { recursive: true });
            for (const [name, size] of ICONSET_FILES) {
                fs.writeFileSync(path.join(dir, name), pngBySize.get(size));
            }
            log(`        ${path.relative(ROOT, dir)} — ${ICONSET_FILES.length} PNGs`);
        }
    }

    if (options.win) {
        // Windows composites icons onto the desktop unmasked: full-bleed.
        const canvas = resize(master, 1024, 1024);
        const imagesBySize = new Map(ICO_SIZES.map((size) => [size, resize(canvas, size, size)]));
        const ico = path.join(options.outdir, 'favicon.ico');
        fs.writeFileSync(ico, buildICO(imagesBySize));
        log(
            `Windows ${path.relative(ROOT, ico)} — ${ICO_SIZES.length} sizes ` +
                `(${ICO_SIZES.join('/')}), 32bpp (${kb(fs.statSync(ico).size)})`
        );
    }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(`generate-icons: ${error.message}`);
        process.exit(1);
    }
}

module.exports = { decodePNG, encodePNG, resize, pad, buildICNS, buildICO };
