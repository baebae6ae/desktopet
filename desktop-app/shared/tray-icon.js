"use strict";

/**
 * 트레이 아이콘을 실행 중에 직접 그려서 PNG 바이트로 만든다.
 * 바이너리 이미지 파일을 저장소에 넣지 않기 위해, 아주 작은 PNG 인코더를
 * (zlib만 사용해) 직접 구현했다. 16x16 고정 크기의 간단한 아이콘 전용이다.
 */

const zlib = require("zlib");

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** rgba: width*height*4 바이트짜리 Uint8Array/Buffer (RGBA, 행 우선) */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  // 각 행 앞에 필터 타입 바이트(0 = None)를 붙여야 한다
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer || rgba, rgba.byteOffset || 0).copy(
      raw,
      y * (stride + 1) + 1,
      y * stride,
      y * stride + stride
    );
  }
  const idatData = zlib.deflateSync(raw);
  const idat = chunk("IDAT", idatData);

  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

/** 16x16 캐릭터 얼굴 스타일 트레이 아이콘 픽셀을 절차적으로 그린다 */
function buildIconPixels(size = 16) {
  const OUTLINE = [43, 43, 43, 255];
  const BODY = [255, 182, 119, 255];
  const SCREEN = [13, 31, 23, 255];
  const ACCENT = [92, 255, 143, 255];
  const TRANSPARENT = [0, 0, 0, 0];

  const r = 3; // 바깥 모서리를 둥글게 깎을 반지름
  const pixels = new Uint8Array(size * size * 4);

  const cornerInside = (x, y, cx, cy) =>
    (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;

  const insideOuter = (x, y) => {
    if (x >= r && x < size - r) return true; // 위/아래 가장자리 제외 중앙 세로띠
    if (y >= r && y < size - r) return true; // 좌/우 가장자리 제외 중앙 가로띠
    if (x < r && y < r) return cornerInside(x, y, r, r);
    if (x >= size - r && y < r) return cornerInside(x, y, size - r - 1, r);
    if (x < r && y >= size - r) return cornerInside(x, y, r, size - r - 1);
    return cornerInside(x, y, size - r - 1, size - r - 1);
  };

  // 화면(얼굴판) 영역
  const screenX0 = 3;
  const screenX1 = size - 3;
  const screenY0 = 5;
  const screenY1 = size - 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      let color = TRANSPARENT;

      if (insideOuter(x, y)) {
        const onEdge = !insideOuter(x - 1, y) || !insideOuter(x + 1, y) || !insideOuter(x, y - 1) || !insideOuter(x, y + 1);
        color = onEdge ? OUTLINE : BODY;

        if (x >= screenX0 && x < screenX1 && y >= screenY0 && y < screenY1) {
          color = SCREEN;
          // 눈(">"): 화면 왼쪽에 치우친 작은 꺾쇠 두 픽셀
          if ((x === screenX0 + 1 && y === screenY0 + 1) || (x === screenX0 + 2 && y === screenY0 + 2)) {
            color = ACCENT;
          }
          // 입("_"): 화면 아래쪽 가로 막대
          if (y === screenY1 - 2 && x >= screenX0 + 2 && x < screenX1 - 2) {
            color = ACCENT;
          }
        }
      }

      pixels[idx] = color[0];
      pixels[idx + 1] = color[1];
      pixels[idx + 2] = color[2];
      pixels[idx + 3] = color[3];
    }
  }

  return pixels;
}

function buildTrayIconPng() {
  const size = 16;
  return encodePng(size, size, buildIconPixels(size));
}

module.exports = { encodePng, buildIconPixels, buildTrayIconPng };
