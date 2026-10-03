/**
 * Minimal QR Code generator - faithfully ported from lean-qr.
 * No external dependencies. Byte mode encoding, EC level L, versions 1-40.
 */

// --- Galois Field GF(256) mod 285 ---
const LOG = new Uint8Array(511);
for (let i = 0, v = 1; i < 255; v = (v * 2) ^ ((v > 127) * 285)) {
    LOG[(LOG[v + 255] = i++)] = v;
}
const gfE = (x) => LOG[x % 255];
const gfLn = (x) => LOG[x + 255];

const mult256PolyLn = (p1Ln, p2Ln) => {
    const result = new Uint8Array(p1Ln.length + p2Ln.length - 1);
    for (let i = 0; i < p1Ln.length; ++i) {
        for (let j = 0; j < p2Ln.length; ++j) {
            result[i + j] ^= gfE(p1Ln[i] + p2Ln[j]);
        }
    }
    return result.map(gfLn);
};

const rem256Poly = (num, denLn) => {
    const remainder = new Uint8Array(num.length + denLn.length - 1);
    remainder.set(num, 0);
    for (let i = 0; i < num.length; ++i) {
        if (remainder[i]) {
            const shift = gfLn(remainder[i]);
            for (let j = 0; j < denLn.length; ++j) {
                remainder[i + j] ^= gfE(denLn[j] + shift);
            }
        }
    }
    return remainder.slice(num.length);
};

// --- Generator polynomials ---
const generators = [[0], [0, 0]];
for (let i = 1; i < 30; ++i) {
    generators.push(mult256PolyLn(generators[i], [0, i]));
}

// --- Bitmap1D: bit stream ---
const Bitmap1D = () => ({
    _bytes: new Uint8Array(2956),
    _bits: 0,
    push(value, bits) {
        for (let b = bits, r = 8 - (this._bits & 7); b > 0; b -= r, r = 8) {
            this._bytes[this._bits >> 3] |= (value << r) >> b;
            this._bits += b < r ? b : r;
        }
    }
});

// --- Bitmap2D: flat array grid ---
const Bitmap2D = (size, _dataSource) => {
    const _data = _dataSource !== undefined ? new Uint8Array(_dataSource) : new Uint8Array(size * size);
    return {
        size,
        _data,
        get: (x, y) => x >= 0 && x < size && !!((_data[y * size + x]) & 1)
    };
};

// --- Correction data ---
const CORRECTION_DATA =
    "*-04-39?2$%%$%%'$%''%'''%')(%'))%(++'(++'(+.'+-.',/3',33)-/5)-43).36)058*18<+37<+4:<,4:E,5<A-7>C/8@F/:EH/<EK0=FM1?IP2@KS3BNV4DPY5FS\\6HV_6IXb7K[e8N^i9Pam;Rdp<Tgt";
const ECS_RATIO = [1 / 5, 3 / 8, 5 / 9, 2 / 3];

const correctionData = (version, totalBytes) => (correctionIndex) => {
    const p = version * 4 + correctionIndex - 4;
    const d = CORRECTION_DATA.charCodeAt(p) - 35;
    const totalGroups = p > 8 ? d : 1;
    const gs = (totalBytes / totalGroups) | 0;
    const g2n = totalBytes % totalGroups;
    const g1n = totalGroups - g2n;
    const ecs = p > 8 ? (gs * ECS_RATIO[correctionIndex] + (version > 5)) & ~1 : d;
    const g1s = gs - ecs;
    return {
        _capacityBytes: g1n * g1s + g2n * g1s + g2n,
        _groups: [[g1n, g1s], [g2n, g1s + 1]],
        _ecSize: ecs
    };
};

// --- Masks ---
const masks = [
    (x, y) => (x ^ y) & 1,
    (x, y) => y & 1,
    (x) => x % 3,
    (x, y) => (x + y) % 3,
    (x, y) => ((x / 3) ^ (y >> 1)) & 1,
    (x, y) => (x & y & 1) + ((x * y) % 3),
    (x, y) => ((x & y) + ((x * y) % 3)) & 1,
    (x, y) => ((x ^ y) + ((x * y) % 3)) & 1,
];

// --- Error correction ---
const calculateEC = (versionBytes, correction) => {
    const blocks = [[], []];
    let p = 0;
    let size = 0;
    for (const [nBlocks, bytes] of correction._groups) {
        for (let b = 0; b < nBlocks; ++b, p += bytes) {
            const block = versionBytes.slice(p, p + bytes);
            blocks[0].push(block);
            blocks[1].push(rem256Poly(block, generators[correction._ecSize]));
            size += bytes + correction._ecSize;
        }
    }
    const result = new Uint8Array(size);
    size = 0;
    for (const bs of blocks) {
        for (let i = 0, prev; size !== prev; ++i) {
            prev = size;
            for (const block of bs) {
                if (i < block.length) {
                    result[size++] = block[i];
                }
            }
        }
    }
    return result;
};

// --- Drawing ---
const remBinPoly = (num, den, denBitsMinusOne) => {
    num <<= denBitsMinusOne;
    let r = num;
    for (let i = 0x8000000; (i >>= 1);) {
        if (r & i) {
            r ^= den * (i >> denBitsMinusOne);
        }
    }
    return r | num;
};

const drawFrame = ({ size, _data }, version) => {
    const drawRect = (p, w, h, value) => {
        for (; h-- > 0; p += size) {
            _data.fill(value, p, p + w);
        }
    };

    const drawAlignment = (x, y, diameter) => {
        for (let n = 0; n++ < 3; diameter -= 2) {
            drawRect(y * size + x - (diameter >> 1) * (size + 1), diameter, diameter, n | 2);
        }
    };

    const numAlignmentM = ((version / 7) | 0) + 1;
    const stepAlignment = (((size - 13) / numAlignmentM / 2 + 0.75) | 0) * 2;
    if (version > 1) {
        for (let i = size - 7; i > 8; i -= stepAlignment) {
            for (let j = i; j > 8; j -= stepAlignment) {
                drawAlignment(i, j, 5);
            }
            if (i < size - 7) {
                drawAlignment(i, 6, 5);
            }
        }
    }
    if (version > 6) {
        for (let dat = remBinPoly(version, 0b1111100100101, 12), j = 1; j < 7; ++j) {
            for (let i = 12; i-- > 9; dat >>= 1) {
                _data[j * size - i] = 2 | (dat & 1);
            }
        }
    }
    drawRect(7, 2, 9, 2);
    drawRect(size - 8, 8, 9, 2);
    for (let i = 0; i < size; ++i) {
        _data[6 * size + i] = 3 ^ (i & 1);
    }
    drawAlignment(3, 3, 7);
    drawAlignment(size - 4, 3, 7);
    for (let j = 0; j < size; ++j) {
        for (let i = j; i < size; ++i) {
            _data[i * size + j] = _data[j * size + i];
        }
    }
    _data[(size - 8) * size + 8] = 3;
};

const getPath = ({ size, _data }) => {
    const result = [];
    for (let xB = size - 2, y = size, dirY = -1; xB >= 0; xB -= 2) {
        if (xB === 5) {
            xB = 4;
        }
        while (((y += dirY), y !== -1 && y !== size)) {
            const p = y * size + xB;
            if (!_data[p + 1]) {
                result.push(p + 1);
            }
            if (!_data[p]) {
                result.push(p);
            }
        }
        dirY *= -1;
    }
    return result;
};

const drawCode = ({ _data }, path, data) =>
    path.forEach((p, bit) => (_data[p] = (data[bit >> 3] >> (~bit & 7)) & 1));

const applyMask = ({ size, _data }, mask, maskId, ecLevel) => {
    for (let j = 0; j < size; ++j) {
        for (let i = 0; i < size; ++i) {
            const p = j * size + i;
            _data[p] ^= !(mask(i, j) || _data[p] & 2);
        }
    }
    const info = ((ecLevel ^ 1) << 3) | maskId;
    let pattern = 0b101010000010010 ^ remBinPoly(info, 0b10100110111, 10);
    for (let i = 0; i++ < 8; pattern >>= 1) {
        _data[(i - (i < 7)) * size + 8] = pattern & 1;
        _data[9 * size - i] = pattern & 1;
    }
    for (let i = 8; --i, pattern; pattern >>= 1) {
        _data[8 * size + i - (i < 7)] = pattern & 1;
        _data[(size - i) * size + 8] = pattern & 1;
    }
};

// --- Scoring ---
const scoreCode = ({ size, _data }) => {
    let score = 0;
    let totalOn = 0;
    const initial = 0b10000000000_10000000000;
    const pat = 0b10111010000_00001011101;
    const mtch = 0b00000000001_00000000001;

    for (let i = 0; i < size; ++i) {
        for (let n = 0; n < 2; ++n) {
            for (let j = 0, state = 0, consec = 0, last; j < size; ++j) {
                const cur = _data[n ? i * size + j : j * size + i] & 1;
                totalOn += cur;
                state = ((state >> 1) | initial) & (pat ^ (cur - 1));
                if (state & mtch) {
                    score += 40;
                }
                if (cur !== last) {
                    consec = 0;
                }
                last = cur;
                score += ++consec === 5 ? 3 : consec > 5;
            }
        }
        if (i) {
            for (
                let j = size + i, last = (_data[i - 1] * 5) ^ _data[i];
                j < size * size;
                j += size
            ) {
                const cur = (_data[j - 1] * 5) ^ _data[j];
                score += !(((last | cur) & 1) | ((last ^ cur) & 4)) * 3;
                last = cur;
            }
        }
    }
    return score + ((10 * Math.abs(totalOn / (size * size) - 1)) | 0) * 10;
};

// --- Frame cache ---
const baseCache = [];

/**
 * Generate QR code modules for the given text (byte mode, EC level L).
 * @param {string} text
 * @returns {{ modules: number[][], size: number, version: number }}
 */
export function generateQRModules(text) {
    const textBytes = new TextEncoder().encode(text);
    const ecLevel = 0; // L

    for (let version = 1; version <= 40; ++version) {
        let base = baseCache[version];
        if (!base) {
            base = Bitmap2D(version * 4 + 17);
            drawFrame(base, version);
            base.p = getPath(base);
            baseCache[version] = base;
        }

        const versionCorrection = correctionData(version, base.p.length >> 3);
        const correction = versionCorrection(ecLevel);

        // Encode data as byte mode (mode indicator 0100)
        const data = Bitmap1D();
        data.push(0b0100, 4);
        data.push(textBytes.length, 8 + (version > 9) * 8);
        textBytes.forEach((b) => data.push(b, 8));

        const dataLengthBits = data._bits;
        if (correction._capacityBytes * 8 < dataLengthBits) {
            continue;
        }

        // Pad: terminator + alignment to byte boundary
        data._bits = (dataLengthBits + 11) & ~7;
        const trailer = 0b11101100_00010001;
        while (data._bits < correction._capacityBytes * 8) {
            data.push(trailer, 16);
        }

        // Build code on copy of base frame
        const code = Bitmap2D(base.size, base._data);
        drawCode(code, base.p, calculateEC(data._bytes, correction));

        // Pick best mask
        let bestMasked = null;
        let bestScore = Infinity;
        for (let maskId = 0; maskId < 8; maskId++) {
            const masked = Bitmap2D(code.size, code._data);
            applyMask(masked, masks[maskId], maskId, ecLevel);
            const s = scoreCode(masked);
            if (s < bestScore) {
                bestScore = s;
                bestMasked = masked;
            }
        }

        const sz = bestMasked.size;
        const modules = [];
        for (let y = 0; y < sz; y++) {
            const row = [];
            for (let x = 0; x < sz; x++) {
                row.push(bestMasked._data[y * sz + x] & 1);
            }
            modules.push(row);
        }
        return { modules, size: sz, version };
    }
    throw new Error('Text too long to encode as QR code');
}

/**
 * Render QR modules onto a canvas element.
 */
export function renderQRToCanvas(modules, size, canvas, cellSize = 8) {
    const margin = 4;
    const totalSize = (size + margin * 2) * cellSize;
    canvas.width = totalSize;
    canvas.height = totalSize;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            if (modules[r][c]) {
                ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
            }
        }
    }
}

/**
 * Convenience: generate QR and render to canvas in one call.
 */
export function generateQR(text, canvas, cellSize = 8) {
    const { modules, size } = generateQRModules(text);
    renderQRToCanvas(modules, size, canvas, cellSize);
}

