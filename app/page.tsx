"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";

const PROVINCES = ["京", "津", "沪", "渝", "冀", "豫", "云", "辽", "黑", "湘", "皖", "鲁", "新", "苏", "浙", "赣", "鄂", "桂", "甘", "晋", "蒙", "陕", "吉", "闽", "贵", "粤", "青", "藏", "川", "宁", "琼"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const SERIAL = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const TEMP_KINDS: PlateKind[] = ["temp", "tempTrial", "tempOversize", "tempEntry"];
const REAR_KINDS: PlateKind[] = ["yellowRear", "trailer"];
const GLYPH_KINDS: PlateKind[] = ["blue", "yellow", "yellowRear", "nevSmall", "nevLarge", "coach", "trailer", "hkmo"];

type PlateKind = "blue" | "yellow" | "yellowRear" | "nevSmall" | "nevLarge" | "coach" | "trailer" | "hkmo" | "tractor" | "field" | "port" | "aviation" | "temp" | "tempTrial" | "tempOversize" | "tempEntry";

const PLATE_SPECS: Record<PlateKind, { width: number; height: number }> = {
  blue: { width: 440, height: 140 }, yellow: { width: 440, height: 140 }, yellowRear: { width: 440, height: 220 },
  nevSmall: { width: 480, height: 140 }, nevLarge: { width: 480, height: 140 }, coach: { width: 440, height: 140 },
  trailer: { width: 440, height: 220 }, hkmo: { width: 440, height: 140 }, tractor: { width: 440, height: 140 },
  field: { width: 440, height: 140 }, port: { width: 440, height: 140 }, aviation: { width: 440, height: 140 },
  temp: { width: 220, height: 140 }, tempTrial: { width: 220, height: 140 }, tempOversize: { width: 220, height: 140 }, tempEntry: { width: 220, height: 140 },
};

const TEMP_LAYOUT = {
  titleY: 45,
  numberY: 132,
  expiryY: 211,
  noteY: 249,
  horizontalPadding: 24,
};

type GlyphBox = { char: string; x: number; y: number; width: number; height: number; row: "single" | "upper" | "lower" };
type VehiclePlacement = { x: number; y: number; width: number; height: number; rotation: number; brightness: number };
type PlateDetection = { placement: VehiclePlacement; confidence: number };

const DEFAULT_VEHICLE_PLACEMENT: VehiclePlacement = { x: .5, y: .68, width: .26, height: .085, rotation: 0, brightness: 1 };

function detectVehiclePlate(image: HTMLImageElement): PlateDetection | null {
  const width = Math.min(640, image.naturalWidth);
  const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  const plateColor = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);

  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    const brightness = (red + green + blue) / 3;
    const saturation = Math.max(red, green, blue) - Math.min(red, green, blue);
    const isWhite = brightness > 145 && saturation < 75;
    const isBlue = blue > 85 && blue > red * 1.16 && blue > green * 1.05;
    const isYellow = red > 120 && green > 85 && blue < 135 && red + green > blue * 2.15;
    gray[index] = red * .299 + green * .587 + blue * .114;
    plateColor[index] = isWhite || isBlue || isYellow ? 1 : 0;
    dark[index] = brightness < 85 ? 1 : 0;
  }

  const integralWidth = width + 1;
  const integralSize = integralWidth * (height + 1);
  const colorIntegral = new Float64Array(integralSize);
  const edgeIntegral = new Float64Array(integralSize);
  const darkIntegral = new Float64Array(integralSize);
  const grayIntegral = new Float64Array(integralSize);
  const graySquareIntegral = new Float64Array(integralSize);
  for (let y = 0; y < height; y += 1) {
    let colorRow = 0;
    let edgeRow = 0;
    let darkRow = 0;
    let grayRow = 0;
    let squareRow = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const value = gray[pixelIndex];
      const horizontalEdge = x ? Math.abs(value - gray[pixelIndex - 1]) : 0;
      const verticalEdge = y ? Math.abs(value - gray[pixelIndex - width]) : 0;
      colorRow += plateColor[pixelIndex];
      edgeRow += Math.min(1, (horizontalEdge + verticalEdge) / 100);
      darkRow += dark[pixelIndex];
      grayRow += value;
      squareRow += value * value;
      const integralIndex = (y + 1) * integralWidth + x + 1;
      const above = integralIndex - integralWidth;
      colorIntegral[integralIndex] = colorIntegral[above] + colorRow;
      edgeIntegral[integralIndex] = edgeIntegral[above] + edgeRow;
      darkIntegral[integralIndex] = darkIntegral[above] + darkRow;
      grayIntegral[integralIndex] = grayIntegral[above] + grayRow;
      graySquareIntegral[integralIndex] = graySquareIntegral[above] + squareRow;
    }
  }

  const areaSum = (integral: Float64Array, x: number, y: number, areaWidth: number, areaHeight: number) => {
    const left = x;
    const right = x + areaWidth;
    const top = y;
    const bottom = y + areaHeight;
    return integral[bottom * integralWidth + right]
      - integral[top * integralWidth + right]
      - integral[bottom * integralWidth + left]
      + integral[top * integralWidth + left];
  };

  let best = { score: -Infinity, x: 0, y: 0, width: 0, height: 0, mean: 150 };
  const aspects = [2.8, 3.2, 3.6, 4, 4.5, 5];
  for (let candidateWidth = Math.round(width * .1); candidateWidth <= width * .34; candidateWidth += 8) {
    for (const aspect of aspects) {
      const candidateHeight = Math.max(12, Math.round(candidateWidth / aspect));
      const step = Math.max(4, Math.floor(candidateWidth / 16));
      const maxY = Math.round(height * .88) - candidateHeight;
      const maxX = Math.round(width * .92) - candidateWidth;
      for (let y = Math.round(height * .38); y <= maxY; y += step) {
        for (let x = Math.round(width * .08); x <= maxX; x += step) {
          const area = candidateWidth * candidateHeight;
          const colorRatio = areaSum(colorIntegral, x, y, candidateWidth, candidateHeight) / area;
          const edgeRatio = areaSum(edgeIntegral, x, y, candidateWidth, candidateHeight) / area;
          const darkRatio = areaSum(darkIntegral, x, y, candidateWidth, candidateHeight) / area;
          const mean = areaSum(grayIntegral, x, y, candidateWidth, candidateHeight) / area;
          const variance = Math.max(0, areaSum(graySquareIntegral, x, y, candidateWidth, candidateHeight) / area - mean * mean);
          const texture = Math.min(1, Math.sqrt(variance) / 80);
          const centerX = (x + candidateWidth / 2) / width;
          const centerY = (y + candidateHeight / 2) / height;
          const positionPrior = Math.exp(-(((centerX - .5) / .28) ** 2) - (((centerY - .66) / .24) ** 2));
          const characterMix = Math.max(0, 1 - Math.abs(darkRatio - .28) / .32);
          const sizePrior = Math.exp(-(((candidateWidth / width - .19) / .11) ** 2));
          const score = colorRatio * 2.5 + edgeRatio * 1.6 + texture * .55 + characterMix * .45 + positionPrior * .55 + sizePrior * .75;
          if (score > best.score) best = { score, x, y, width: candidateWidth, height: candidateHeight, mean };
        }
      }
    }
  }

  if (best.score < 2.85) return null;
  const expandedWidth = Math.min(width * .55, best.width * 1.12);
  const expandedHeight = Math.min(height * .22, best.height * 1.18);
  return {
    placement: {
      x: Math.min(.95, Math.max(.05, (best.x + best.width / 2) / width)),
      y: Math.min(.95, Math.max(.05, (best.y + best.height / 2) / height)),
      width: expandedWidth / width,
      height: expandedHeight / height,
      rotation: 0,
      brightness: Math.min(1.12, Math.max(.8, .78 + best.mean / 255 * .38)),
    },
    confidence: Math.min(.99, Math.max(.35, (best.score - 2.85) / 1.35)),
  };
}

// Character boxes use GA 36 dimensions also demonstrated by the referenced open-source generators.
function getGlyphBoxes(value: string, kind: PlateKind): GlyphBox[] {
  if (REAR_KINDS.includes(kind)) {
    return value.split("").map((char, index) => index < 2
      ? { char, x: index === 0 ? 110 : 250, y: 15, width: 80, height: 60, row: "upper" }
      : { char, x: 27 + (index - 2) * 80, y: 90, width: 65, height: 110, row: "lower" });
  }

  const energy = kind === "nevSmall" || kind === "nevLarge";
  let right = 0;
  return value.split("").map((char, index) => {
    const width = energy && index > 0 ? 43 : 45;
    const x = index === 0 ? 15 : right + (index === 2 ? (energy ? 34 : 34) : energy ? 9 : 12);
    right = x + width;
    return { char, x, y: 25, width, height: 90, row: "single" };
  });
}

const PLATE_TYPES: { id: PlateKind; name: string; note: string; sample: string }[] = [
  { id: "blue", name: "小型汽车", note: "蓝底白字 · 7 位", sample: "京A·A2088" },
  { id: "yellow", name: "大型汽车前牌", note: "黄底黑字 · 440×140", sample: "沪B·58216" },
  { id: "yellowRear", name: "大型汽车后牌", note: "双行黄牌 · 440×220", sample: "沪B 58216" },
  { id: "nevSmall", name: "小型新能源", note: "渐变绿底 · 8 位", sample: "粤B·D12345" },
  { id: "nevLarge", name: "大型新能源", note: "黄绿双拼 · 8 位", sample: "川A·12345F" },
  { id: "coach", name: "教练汽车", note: "黄底黑字 · 末位学", sample: "浙C·2314学" },
  { id: "trailer", name: "挂车", note: "双行黄牌 · 440×220", sample: "鲁Q 7253挂" },
  { id: "hkmo", name: "港澳入出境", note: "黑底白字 · 末位港/澳", sample: "粤Z·A88港" },
  { id: "tractor", name: "拖拉机", note: "绿底白字 · 农用机械", sample: "京01-00001" },
  { id: "field", name: "厂（场）内车辆", note: "绿底白字 · 场内专用", sample: "场内京A·00001" },
  { id: "port", name: "港口内部车辆", note: "绿底白字 · 港区专用", sample: "连港·A0018" },
  { id: "aviation", name: "民航场内车辆", note: "绿底白字 · 机场专用", sample: "民航A·A0125" },
  { id: "temp", name: "临时号牌", note: "纸质蓝字 · 普通临牌", sample: "京A·12345" },
  { id: "tempTrial", name: "试验车临牌", note: "纸质号牌 · 末位试", sample: "苏A·1234试" },
  { id: "tempOversize", name: "特型车临牌", note: "纸质号牌 · 末位超", sample: "冀A·1234超" },
  { id: "tempEntry", name: "临时入境", note: "纸质号牌 · 标注路线", sample: "临时入境 京A·12345" },
];

function randomFrom(chars: string | string[]) {
  return chars[Math.floor(Math.random() * chars.length)];
}

function randomSerial(length: number) {
  return Array.from({ length }, () => randomFrom(SERIAL)).join("");
}

function generate(kind: PlateKind, province?: string, city?: string) {
  const p = kind === "hkmo" ? "粤" : province || randomFrom(PROVINCES);
  const c = kind === "hkmo" ? "Z" : kind === "tractor" ? city || String(Math.floor(1 + Math.random() * 99)).padStart(2, "0") : city || randomFrom(LETTERS);
  if (kind === "nevSmall") return `${p}${c}${randomFrom("DABCEF")}${randomSerial(5)}`;
  if (kind === "nevLarge") return `${p}${c}${randomSerial(5)}${randomFrom("DF")}`;
  if (kind === "coach") return `${p}${c}${randomSerial(4)}学`;
  if (kind === "trailer") return `${p}${c}${randomSerial(4)}挂`;
  if (kind === "hkmo") return `${p}${c}${randomFrom(LETTERS)}${Math.floor(100 + Math.random() * 900)}${randomFrom("港澳")}`;
  if (kind === "port") return `${p}${c}${randomSerial(4)}`;
  if (kind === "tempTrial") return `${p}${c}${randomSerial(4)}试`;
  if (kind === "tempOversize") return `${p}${c}${randomSerial(4)}超`;
  if (kind === "tractor") return `${p}${c}${Array.from({ length: 5 }, () => randomFrom("0123456789")).join("")}`;
  return `${p}${c}${randomSerial(5)}`;
}

function formatPlate(value: string, kind: PlateKind = "blue") {
  if (kind === "tractor") return `${value.slice(0, 3)}-${value.slice(3)}`;
  if (kind === "field") return `场内${value.slice(0, 2)}·${value.slice(2)}`;
  if (kind === "port") return `连港·${value.slice(1)}`;
  if (kind === "aviation") return `民航${value.slice(1, 2)}·${value.slice(2)}`;
  if (kind === "tempEntry") return `临时入境 ${value.slice(0, 2)}·${value.slice(2)}`;
  return value.length > 2 ? `${value.slice(0, 2)}·${value.slice(2)}` : value;
}

export default function Home() {
  const [kind, setKind] = useState<PlateKind>("blue");
  const [province, setProvince] = useState("京");
  const [city, setCity] = useState("A");
  const [plate, setPlate] = useState("京AA2088");
  const [notice, setNotice] = useState("");
  const [expiryDate] = useState(() => new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const vehicleCanvas = useRef<HTMLCanvasElement>(null);
  const vehicleImage = useRef<HTMLImageElement | null>(null);
  const vehicleObjectUrl = useRef<string | null>(null);
  const isDraggingPlate = useRef(false);
  const [vehicleReady, setVehicleReady] = useState(false);
  const [vehicleName, setVehicleName] = useState("");
  const [vehiclePlacement, setVehiclePlacement] = useState<VehiclePlacement>(DEFAULT_VEHICLE_PLACEMENT);
  const [detectedPlacement, setDetectedPlacement] = useState<VehiclePlacement>(DEFAULT_VEHICLE_PLACEMENT);
  const [detectionStatus, setDetectionStatus] = useState("等待车辆图片");

  const current = useMemo(() => PLATE_TYPES.find((item) => item.id === kind)!, [kind]);
  const spec = PLATE_SPECS[kind];
  const glyphBoxes = useMemo(() => getGlyphBoxes(plate, kind), [plate, kind]);
  const serialLength = kind === "nevSmall" || kind === "nevLarge" ? 6 : kind === "port" ? 4 : 5;
  const prefixLength = kind === "tractor" ? 3 : 2;
  const serial = plate.slice(prefixLength);

  const toast = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 2200);
  };

  const chooseKind = (next: PlateKind) => {
    const p = next === "hkmo" ? "粤" : province;
    const c = next === "hkmo" ? "Z" : next === "tractor" ? "01" : city.length === 1 ? city : "A";
    setKind(next);
    setProvince(p);
    setCity(c);
    setPlate(generate(next, p, c));
  };

  const updateParts = (nextProvince: string, nextCity: string, nextSerial = serial) => {
    setProvince(nextProvince);
    setCity(nextCity);
    setPlate(`${nextProvince}${nextCity}${nextSerial}`);
  };

  const randomize = () => {
    const next = generate(kind);
    setProvince(next[0]);
    setCity(kind === "tractor" ? next.slice(1, 3) : next[1]);
    setPlate(next);
    toast("已生成一组新号码");
  };

  const renderPlate = useCallback((canvas: HTMLCanvasElement, scale: number) => {
    const isTemp = TEMP_KINDS.includes(kind);
    const isRear = REAR_KINDS.includes(kind);
    const width = spec.width * 2;
    const height = spec.height * 2;
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    const isGreen = kind === "tractor" || kind === "field" || kind === "port" || kind === "aviation";
    const palette = kind === "blue" ? ["#001b7a", "#001b7a"] : kind === "hkmo" ? ["#000000", "#000000"] : isGreen ? ["#138447", "#075d31"] : isTemp ? ["#f8f5e8", "#e7e7db"] : kind === "nevSmall" ? ["#eef9ef", "#57cf78"] : kind === "nevLarge" ? ["#ffbe00", "#58ca73"] : ["#ffbe00", "#ffbe00"];
    const gradient = kind === "nevLarge"
      ? ctx.createLinearGradient(0, 0, width, 0)
      : ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette[0]);
    if (kind === "nevLarge") {
      gradient.addColorStop(.29, palette[0]);
      gradient.addColorStop(.305, palette[1]);
    }
    gradient.addColorStop(1, palette[1]);
    ctx.fillStyle = gradient;
    ctx.roundRect(2, 2, width - 4, height - 4, isTemp ? 4 : 20);
    ctx.fill();
    if (!isTemp) {
      ctx.globalAlpha = .1;
      ctx.fillStyle = kind === "hkmo" ? "#ffffff" : "#eef8ef";
      for (let y = 10; y < height; y += 10) {
        for (let x = 10; x < width; x += 10) {
          ctx.beginPath(); ctx.arc(x, y, .8, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
    if (isTemp) {
      ctx.globalAlpha = .1;
      ctx.strokeStyle = kind === "temp" || kind === "tempEntry" ? "#1c57a4" : "#9c2721";
      ctx.lineWidth = 1;
      for (let x = -height; x < width; x += 22) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + height, height); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = kind === "blue" || kind === "hkmo" || isGreen ? "#f8fbff" : isTemp ? (kind === "temp" || kind === "tempEntry" ? "#174a9c" : "#9c2721") : "#101317";
    ctx.lineWidth = isTemp ? 4 : 6;
    ctx.roundRect(isTemp ? 8 : 3, isTemp ? 8 : 3, width - (isTemp ? 16 : 6), height - (isTemp ? 16 : 6), isTemp ? 2 : 20);
    ctx.stroke();
    if (!isTemp && kind !== "field") {
      const slotWidth = 46;
      const slotHeight = 16;
      const slotLeft = 192;
      const slotTop = 17;
      ctx.fillStyle = ctx.strokeStyle;
      [[slotLeft, slotTop], [width - slotLeft - slotWidth, slotTop], [slotLeft, height - slotTop - slotHeight], [width - slotLeft - slotWidth, height - slotTop - slotHeight]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.roundRect(x, y, slotWidth, slotHeight, slotHeight / 2); ctx.fill();
      });
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `900 ${kind === "tempEntry" ? 72 : isTemp ? 105 : kind.startsWith("nev") ? 125 : 138}px "Arial Narrow", "Noto Sans SC", sans-serif`;
    ctx.shadowColor = "rgba(0,0,0,.28)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 3;
    const glyphCache = new Map<string, HTMLCanvasElement>();
    const getGlyphSprite = (char: string, boxWidth: number, boxHeight: number, color: string) => {
      const cacheKey = `${char}-${boxWidth}-${boxHeight}-${color}`;
      const cached = glyphCache.get(cacheKey);
      if (cached) return cached;
      const sprite = document.createElement("canvas");
      sprite.width = boxWidth * 2;
      sprite.height = boxHeight * 2;
      const spriteCtx = sprite.getContext("2d", { willReadFrequently: true })!;
      spriteCtx.fillStyle = color;
      spriteCtx.textAlign = "center";
      spriteCtx.textBaseline = "alphabetic";
      // Measure the real ink bounds before scaling so strokes cannot be clipped
      // during rasterization in either preview or export.
      const sourceFontSize = 200;
      spriteCtx.font = `900 ${sourceFontSize}px "Arial Narrow", "Noto Sans SC", sans-serif`;
      const metrics = spriteCtx.measureText(char);
      const inkWidth = Math.max(1, metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight);
      const inkHeight = Math.max(1, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
      const isHan = /[\u3400-\u9fff]/.test(char);
      // The reference sprites fill about 94–95% of their 45px-wide cell. Latin
      // glyphs reach roughly 96% of the 90px height; Han glyphs sit near 92%.
      // Keep vertical scale independent so a wide glyph only compresses on X
      // instead of making the whole character visibly shorter.
      const targetWidthRatio = isHan ? .94 : .95;
      const targetHeightRatio = isHan ? .92 : .96;
      const horizontalRatio = isHan ? .52 : .88;
      const scaleY = sprite.height * targetHeightRatio / inkHeight;
      const scaleX = Math.min(
        horizontalRatio * scaleY,
        sprite.width * targetWidthRatio / inkWidth,
      );
      spriteCtx.save();
      spriteCtx.translate(sprite.width / 2, sprite.height / 2);
      spriteCtx.scale(scaleX, scaleY);
      spriteCtx.fillText(
        char,
        (metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2,
        (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
      );
      spriteCtx.restore();
      // Convert anti-aliased browser text to a stable, sprite-like binary mask.
      const pixels = spriteCtx.getImageData(0, 0, sprite.width, sprite.height);
      for (let index = 3; index < pixels.data.length; index += 4) {
        pixels.data[index] = pixels.data[index] > 72 ? 255 : 0;
      }
      spriteCtx.putImageData(pixels, 0, 0);
      glyphCache.set(cacheKey, sprite);
      return sprite;
    };
    const drawGlyphs = () => {
      const glyphColor = kind === "blue" || kind === "hkmo" ? "#f8fbff" : "#101214";
      ctx.fillStyle = glyphColor;
      ctx.imageSmoothingEnabled = false;
      glyphBoxes.forEach((box) => {
        const sprite = getGlyphSprite(box.char, box.width, box.height, glyphColor);
        ctx.drawImage(sprite, box.x * 2, box.y * 2, box.width * 2, box.height * 2);
      });
      if (!isRear && kind !== "nevSmall" && kind !== "nevLarge") {
        ctx.beginPath(); ctx.arc(134 * 2, 70 * 2, 9, 0, Math.PI * 2); ctx.fill();
      }
      if (kind === "nevSmall" || kind === "nevLarge") {
        const mark = ctx.createLinearGradient(246, 112, 282, 168);
        mark.addColorStop(0, "#29a9df"); mark.addColorStop(1, "#65bb55");
        ctx.fillStyle = mark; ctx.beginPath(); ctx.ellipse(264, 140, 18, 27, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
        [-8, 0, 8].forEach((dy) => { ctx.beginPath(); ctx.moveTo(254, 140 + dy); ctx.lineTo(274, 140 + dy); ctx.stroke(); });
      }
    };
    if (isTemp) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.shadowColor = "transparent";
      const drawFittedText = (text: string, y: number, maxFontSize: number, minFontSize: number, weight: number, family: string) => {
        ctx.font = `${weight} ${maxFontSize}px ${family}`;
        const measuredWidth = Math.max(1, ctx.measureText(text).width);
        const availableWidth = width - TEMP_LAYOUT.horizontalPadding * 2;
        const fittedSize = Math.max(minFontSize, Math.min(maxFontSize, maxFontSize * availableWidth / measuredWidth));
        ctx.font = `${weight} ${fittedSize}px ${family}`;
        ctx.fillText(text, width / 2, y, availableWidth);
      };
      const sans = '"Noto Sans SC", sans-serif';
      const plateFont = '"Arial Narrow", "Noto Sans SC", sans-serif';
      drawFittedText(
        kind === "tempEntry" ? "临时入境机动车号牌" : "机动车临时行驶车号牌",
        TEMP_LAYOUT.titleY,
        28,
        22,
        700,
        sans,
      );
      // The title already identifies an entry plate; repeating "临时入境" in
      // the number line previously pushed both sides beyond the paper canvas.
      drawFittedText(formatPlate(plate), TEMP_LAYOUT.numberY, 82, 58, 900, plateFont);
      drawFittedText(`有效期至  ${expiryDate}`, TEMP_LAYOUT.expiryY, 20, 16, 600, sans);
      drawFittedText(
        kind === "tempEntry" ? "核准路线：登记区域内道路" : "请粘贴于前风窗玻璃内侧",
        TEMP_LAYOUT.noteY,
        16,
        13,
        500,
        sans,
      );
    } else if (GLYPH_KINDS.includes(kind)) {
      drawGlyphs();
    } else if (kind === "field") {
      ctx.fillStyle = "#ffe51f";
      ctx.font = '900 58px "Noto Sans SC", sans-serif';
      ctx.fillText("场", 72, 106);
      ctx.fillText("内", 72, 170);
      ctx.fillStyle = "#f8fbff";
      ctx.font = '900 138px "Arial Narrow", "Noto Sans SC", sans-serif';
      ctx.fillText(`${plate.slice(0, 2)}·${plate.slice(2)}`, 500, height / 2 + 5);
    } else {
      ctx.fillText(formatPlate(plate, kind), width / 2, height / 2 + 5);
    }
    ctx.shadowColor = "transparent";
  }, [expiryDate, glyphBoxes, kind, plate, spec.height, spec.width]);

  useEffect(() => {
    if (previewCanvas.current) renderPlate(previewCanvas.current, 2);
  }, [renderPlate]);

  const renderVehicleComposite = useCallback(() => {
    const image = vehicleImage.current;
    const canvas = vehicleCanvas.current;
    if (!image || !canvas) return;
    const outputScale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * outputScale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * outputScale));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const plateCanvas = document.createElement("canvas");
    renderPlate(plateCanvas, 2);
    const targetWidth = canvas.width * vehiclePlacement.width;
    const targetHeight = canvas.height * vehiclePlacement.height;
    ctx.save();
    ctx.translate(canvas.width * vehiclePlacement.x, canvas.height * vehiclePlacement.y);
    ctx.rotate(vehiclePlacement.rotation * Math.PI / 180);
    ctx.fillStyle = "rgba(5,8,10,.42)";
    ctx.beginPath();
    ctx.roundRect(-targetWidth * .515, -targetHeight * .56, targetWidth * 1.03, targetHeight * 1.12, Math.max(2, targetHeight * .08));
    ctx.fill();
    ctx.shadowColor = "rgba(0,0,0,.5)";
    ctx.shadowBlur = Math.max(2, targetHeight * .06);
    ctx.shadowOffsetY = Math.max(1, targetHeight * .035);
    ctx.filter = `brightness(${vehiclePlacement.brightness}) contrast(.96) saturate(.94)`;
    ctx.globalAlpha = .985;
    ctx.drawImage(plateCanvas, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
    ctx.restore();
  }, [renderPlate, vehiclePlacement]);

  useEffect(() => {
    if (vehicleReady) renderVehicleComposite();
  }, [renderVehicleComposite, vehicleReady]);

  useEffect(() => () => {
    if (vehicleObjectUrl.current) URL.revokeObjectURL(vehicleObjectUrl.current);
  }, []);

  const runVehicleDetection = (source = vehicleImage.current) => {
    if (!source) {
      toast("请先上传车辆正面图片");
      return;
    }
    setDetectionStatus("正在自动识别车牌区域…");
    requestAnimationFrame(() => {
      const detected = detectVehiclePlate(source);
      if (detected) {
        setDetectedPlacement(detected.placement);
        setVehiclePlacement(detected.placement);
        setDetectionStatus(`已自动识别 · 置信度 ${Math.round(detected.confidence * 100)}%`);
        toast("已识别原车牌位置并完成覆盖");
        return;
      }
      const fallbackWidth = .26;
      const fallback = {
        ...DEFAULT_VEHICLE_PLACEMENT,
        width: fallbackWidth,
        height: Math.min(.18, Math.max(.04, fallbackWidth * source.naturalWidth / source.naturalHeight * spec.height / spec.width)),
      };
      setDetectedPlacement(fallback);
      setVehiclePlacement(fallback);
      setDetectionStatus("未可靠识别 · 已使用默认位置");
      toast("未可靠识别车牌，请拖动微调");
    });
  };

  const uploadVehicle = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("请选择 JPG、PNG 或 WebP 车辆图片");
      event.target.value = "";
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (vehicleObjectUrl.current) URL.revokeObjectURL(vehicleObjectUrl.current);
      vehicleObjectUrl.current = nextUrl;
      vehicleImage.current = image;
      setVehicleName(file.name);
      setVehicleReady(true);
      runVehicleDetection(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(nextUrl);
      toast("图片读取失败，请更换文件");
    };
    image.src = nextUrl;
    event.target.value = "";
  };

  const moveVehiclePlate = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingPlate.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(.95, Math.max(.05, (event.clientX - rect.left) / rect.width));
    const y = Math.min(.95, Math.max(.05, (event.clientY - rect.top) / rect.height));
    setVehiclePlacement((currentPlacement) => ({ ...currentPlacement, x, y }));
  };

  const startMovingVehiclePlate = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!vehicleReady) return;
    isDraggingPlate.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveVehiclePlate(event);
  };

  const stopMovingVehiclePlate = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    isDraggingPlate.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const setPlacementValue = (key: keyof VehiclePlacement, value: number) => {
    setVehiclePlacement((currentPlacement) => ({ ...currentPlacement, [key]: value }));
  };

  const downloadVehicleComposite = () => {
    if (!vehicleReady || !vehicleCanvas.current) {
      toast("请先上传车辆正面图片");
      return;
    }
    renderVehicleComposite();
    const link = document.createElement("a");
    link.download = `vehicle-${plate}.png`;
    link.href = vehicleCanvas.current.toDataURL("image/png");
    link.click();
    toast("车辆合成图已导出");
  };

  const download = () => {
    const canvas = document.createElement("canvas");
    // Logical artwork uses 2 px/mm; 6× export yields about 305 dpi at physical size.
    renderPlate(canvas, 6);
    const link = document.createElement("a");
    link.download = `plate-${plate}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast("高清 PNG 已导出");
  };

  return (
    <main>
      <nav className="topbar">
        <a className="brand" href="#top" aria-label="牌研所首页"><span className="brand-mark">牌</span><span>牌研所<small>PLATE LAB</small></span></a>
        <div className="nav-right"><span className="status"><i /> 规则库 GA 36—2018</span><a href="#vehicle-studio">车辆合成</a><a href="https://baike.baidu.com/item/中华人民共和国机动车号牌/65692407" target="_blank" rel="noreferrer">参考文档 ↗</a></div>
      </nav>

      <section className="workspace" id="top">
        <div className="stage">
          <div className="stage-heading"><span>实时预览</span><span className="scale">{spec.width} × {spec.height} mm · 标准比例</span></div>
          <div className="plate-rig">
            <canvas ref={previewCanvas} className={`plate-preview ${TEMP_KINDS.includes(kind) ? "plate-preview-paper" : ""} ${kind.startsWith("nev") ? "plate-preview-energy" : ""} ${REAR_KINDS.includes(kind) ? "plate-preview-rear" : ""}`} aria-label={`车牌预览 ${formatPlate(plate, kind)}`} role="img" />
            <div className="bench-line" />
          </div>
          <div className="plate-meta"><div><b>{current.name}</b><span>{current.note}</span></div><div className="compliance"><i>✓</i><span>格式检查通过<small>字符数与类型匹配</small></span></div></div>
        </div>

        <aside className="control-panel">
          <header><span>生成控制台</span><span className="step">01 / 03</span></header>
          <section className="control-section">
            <span className="section-label">选择号牌类型</span>
            <div className="type-list">
              {PLATE_TYPES.map((item) => <button key={item.id} className={kind === item.id ? "active" : ""} onClick={() => chooseKind(item.id)} title={item.sample}><span className={`swatch swatch-${item.id}`}/><span><b>{item.name}</b><small>{item.note}</small></span><i>{kind === item.id ? "●" : "○"}</i></button>)}
            </div>
          </section>
          <section className="control-section manual">
            <div className="section-row"><span className="section-label">指定生成</span><button className="dice" onClick={randomize}>⌁ 随机填充</button></div>
            <div className="fields">
              <label><span>省份</span><select value={province} disabled={kind === "hkmo"} onChange={(e) => updateParts(e.target.value, city)}>{PROVINCES.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label><span>{kind === "tractor" ? "县市代码" : "城市代码"}</span><select value={city} disabled={kind === "hkmo"} onChange={(e) => updateParts(province, e.target.value)}>{kind === "tractor" ? Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, "0")).map((l) => <option key={l}>{l}</option>) : [...LETTERS].map((l) => <option key={l}>{l}</option>)}</select></label>
              <label className="serial-field"><span>号码段</span><input value={serial} maxLength={serialLength} onChange={(e) => updateParts(province, city, e.target.value.toUpperCase().replace(/[^A-Z0-9学挂港澳试超]/g, ""))}/><small>{serial.length}/{serialLength}</small></label>
            </div>
          </section>
          <div className="actions"><button className="generate" onClick={randomize}><span>↻</span> 随机生成</button><button className="export" onClick={download}>↓ 导出 PNG</button></div>
          <p className="disclaimer">生成内容为随机示意，不代表真实车辆登记信息，请勿用于伪造证件或违法用途。</p>
        </aside>
      </section>

      <section className="vehicle-studio" id="vehicle-studio">
        <div className="vehicle-studio-heading">
          <div><span className="eyebrow">车辆图片合成</span><h2>把当前车牌安装到车辆正面图</h2></div>
          <p>图片只在本机浏览器处理。载入后自动识别原车牌位置与大小并完成覆盖，也可继续拖动微调。</p>
        </div>
        <div className="vehicle-studio-grid">
          <div className={`vehicle-photo-stage ${vehicleReady ? "has-image" : ""}`}>
            {vehicleReady ? (
              <canvas
                ref={vehicleCanvas}
                className="vehicle-canvas"
                aria-label={`车辆合成预览，车牌 ${formatPlate(plate, kind)}`}
                role="img"
                onPointerDown={startMovingVehiclePlate}
                onPointerMove={moveVehiclePlate}
                onPointerUp={stopMovingVehiclePlate}
                onPointerCancel={stopMovingVehiclePlate}
              />
            ) : (
              <label className="vehicle-empty">
                <span>＋</span>
                <b>上传车辆正面图片</b>
                <small>支持 JPG、PNG、WebP · 自动识别车牌位置和尺寸</small>
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadVehicle} />
              </label>
            )}
          </div>
          <aside className="vehicle-tools">
            <div className="vehicle-tool-head"><span>定位控制</span><small>{vehicleReady ? vehicleName : "等待车辆图片"}</small></div>
            <div className="vehicle-detection-status"><i className={detectionStatus.startsWith("已自动") ? "success" : ""} />{detectionStatus}</div>
            <div className="vehicle-detection-actions">
              <label className="vehicle-upload-button">选择车辆图片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadVehicle} /></label>
              <button disabled={!vehicleReady} onClick={() => runVehicleDetection()}>重新识别</button>
            </div>
            <div className="vehicle-range-list">
              <label><span>水平位置 <i>{Math.round(vehiclePlacement.x * 100)}%</i></span><input type="range" min="5" max="95" value={vehiclePlacement.x * 100} disabled={!vehicleReady} onChange={(event) => setPlacementValue("x", Number(event.target.value) / 100)} /></label>
              <label><span>垂直位置 <i>{Math.round(vehiclePlacement.y * 100)}%</i></span><input type="range" min="5" max="95" value={vehiclePlacement.y * 100} disabled={!vehicleReady} onChange={(event) => setPlacementValue("y", Number(event.target.value) / 100)} /></label>
              <label><span>车牌宽度 <i>{Math.round(vehiclePlacement.width * 100)}%</i></span><input type="range" min="10" max="60" value={vehiclePlacement.width * 100} disabled={!vehicleReady} onChange={(event) => setPlacementValue("width", Number(event.target.value) / 100)} /></label>
              <label><span>车牌高度 <i>{Math.round(vehiclePlacement.height * 100)}%</i></span><input type="range" min="3" max="25" step="0.5" value={vehiclePlacement.height * 100} disabled={!vehicleReady} onChange={(event) => setPlacementValue("height", Number(event.target.value) / 100)} /></label>
              <label><span>旋转角度 <i>{vehiclePlacement.rotation.toFixed(1)}°</i></span><input type="range" min="-15" max="15" step="0.5" value={vehiclePlacement.rotation} disabled={!vehicleReady} onChange={(event) => setPlacementValue("rotation", Number(event.target.value))} /></label>
            </div>
            <div className="vehicle-tool-actions">
              <button disabled={!vehicleReady} onClick={() => setVehiclePlacement(detectedPlacement)}>恢复识别</button>
              <button className="vehicle-export" disabled={!vehicleReady} onClick={downloadVehicleComposite}>↓ 导出车辆图片</button>
            </div>
            <p>自动识别会优先寻找车辆下半部的白、蓝或黄底矩形车牌，并匹配原区域尺寸与现场亮度。特殊角度可继续拖动和微调。</p>
          </aside>
        </div>
      </section>

      <section className="info-strip">
        <div><span className="eyebrow">编码结构</span><strong><i>省</i><i>发牌机关</i><i>序号</i></strong><p>省级简称 + 地市字母代码 + 五位或六位序号</p></div>
        <div><span className="eyebrow">生成规则</span><strong className="rule-icons"><i>I</i><i>O</i><span>自动排除易混淆字母</span></strong><p>普通序号不使用 I、O，降低机器识别与肉眼辨识歧义</p></div>
        <div><span className="eyebrow">视觉工艺</span><strong className="material">反光膜 <i/> 压印边框 <i/> 长圆标记</strong><p>用标准尺寸、固定字位与轻微颗粒模拟真实号牌材质</p></div>
      </section>
      <footer><span>牌研所 · 中国机动车号牌样式生成工具</span><span>依据公开资料制作 · 非官方服务</span></footer>
      {notice && <div className="toast">✓ {notice}</div>}
    </main>
  );
}
