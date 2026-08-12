const INPUT_WIDTH = 320;
const INPUT_HEIGHT = 240;
const MODEL_URL = "/models/license_plate_detection_lpd_yunet_2023mar.onnx";
const ORT_BASE_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

export type PlatePoint = { x: number; y: number };
export type PlateCorners = [PlatePoint, PlatePoint, PlatePoint, PlatePoint];
export type VehiclePlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  brightness: number;
  corners?: PlateCorners;
};
export type PlateDetection = { placement: VehiclePlacement; confidence: number };

type OrtTensor = { data: Float32Array | Uint8Array; dims: readonly number[] };
type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensor>>;
};
type OrtRuntime = {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
  InferenceSession: { create: (url: string, options: Record<string, unknown>) => Promise<OrtSession> };
};

declare global {
  interface Window { ort?: OrtRuntime }
}

let runtimePromise: Promise<OrtRuntime> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;

function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(message)), milliseconds)),
  ]);
}

function loadRuntime() {
  if (window.ort) return Promise.resolve(window.ort);
  if (runtimePromise) return runtimePromise;
  runtimePromise = new Promise<OrtRuntime>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-plate-ort="true"]');
    const script = existing || document.createElement("script");
    const timeout = window.setTimeout(() => reject(new Error("车牌识别运行库加载超时")), 20000);
    const finish = () => {
      if (!window.ort) {
        reject(new Error("车牌识别运行库不可用"));
        return;
      }
      window.clearTimeout(timeout);
      window.ort.env.wasm.wasmPaths = ORT_BASE_URL;
      window.ort.env.wasm.numThreads = window.crossOriginIsolated
        ? Math.min(4, navigator.hardwareConcurrency || 1)
        : 1;
      resolve(window.ort);
    };
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("车牌识别运行库下载失败")), { once: true });
    if (!existing) {
      script.src = `${ORT_BASE_URL}ort.min.js`;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.plateOrt = "true";
      document.head.appendChild(script);
    }
  });
  runtimePromise.catch(() => { runtimePromise = null; });
  return runtimePromise;
}

async function loadSession() {
  if (sessionPromise) return sessionPromise;
  sessionPromise = loadRuntime().then((ort) => ort.InferenceSession.create(MODEL_URL, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  }));
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

function createPriors(width: number, height: number) {
  const minSizes = [[10, 16, 24], [32, 48], [64, 96], [128, 192, 256]];
  const steps = [8, 16, 32, 64];
  const second = [Math.floor(Math.floor((height + 1) / 2) / 2), Math.floor(Math.floor((width + 1) / 2) / 2)];
  const maps = [
    [Math.floor(second[0] / 2), Math.floor(second[1] / 2)],
    [Math.floor(second[0] / 4), Math.floor(second[1] / 4)],
    [Math.floor(second[0] / 8), Math.floor(second[1] / 8)],
    [Math.floor(second[0] / 16), Math.floor(second[1] / 16)],
  ];
  const priors: number[][] = [];
  maps.forEach(([rows, columns], level) => {
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        minSizes[level].forEach((size) => priors.push([
          (column + .5) * steps[level] / width,
          (row + .5) * steps[level] / height,
          size / width,
          size / height,
        ]));
      }
    }
  });
  return priors;
}

function expandCorners(corners: PlateCorners, amount: number): PlateCorners {
  const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  return corners.map((point) => ({
    x: Math.min(.995, Math.max(.005, center.x + (point.x - center.x) * (1 + amount))),
    y: Math.min(.995, Math.max(.005, center.y + (point.y - center.y) * (1 + amount))),
  })) as PlateCorners;
}

function distance(a: PlatePoint, b: PlatePoint, imageWidth: number, imageHeight: number) {
  return Math.hypot((b.x - a.x) * imageWidth, (b.y - a.y) * imageHeight);
}

export async function detectPlateWithYuNet(image: HTMLImageElement): Promise<PlateDetection | null> {
  const ort = await loadRuntime();
  // The first WASM load can be slow on constrained networks. Fall back without
  // blocking the UI; the cached session may still be ready on the next retry.
  const session = await withTimeout(loadSession(), 45000, "AI 模型首次加载超时");
  const canvas = document.createElement("canvas");
  canvas.width = INPUT_WIDTH;
  canvas.height = INPUT_HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  const rgba = ctx.getImageData(0, 0, INPUT_WIDTH, INPUT_HEIGHT).data;
  const input = new Float32Array(3 * INPUT_WIDTH * INPUT_HEIGHT);
  const plane = INPUT_WIDTH * INPUT_HEIGHT;
  for (let pixel = 0; pixel < plane; pixel += 1) {
    const source = pixel * 4;
    input[pixel] = rgba[source + 2];
    input[plane + pixel] = rgba[source + 1];
    input[plane * 2 + pixel] = rgba[source];
  }

  const tensor = new ort.Tensor("float32", input, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]);
  const output = await withTimeout(session.run({ [session.inputNames[0]]: tensor }), 20000, "AI 模型推理超时");
  const loc = output.loc?.data || output[session.outputNames[0]]?.data;
  const conf = output.conf?.data || output[session.outputNames[1]]?.data;
  const iou = output.iou?.data || output[session.outputNames[2]]?.data;
  if (!loc || !conf || !iou) throw new Error("车牌识别模型输出不完整");

  const priors = createPriors(INPUT_WIDTH, INPUT_HEIGHT);
  const candidateCount = Math.min(priors.length, Math.floor(loc.length / 14));
  let best: { score: number; corners: PlateCorners } | null = null;
  for (let index = 0; index < candidateCount; index += 1) {
    const score = Math.sqrt(Math.max(0, Number(conf[index * 2 + 1])) * Math.min(1, Math.max(0, Number(iou[index]))));
    if (score < .62 || (best && score <= best.score)) continue;
    const prior = priors[index];
    const offset = index * 14;
    const corners = [[4, 5], [6, 7], [10, 11], [12, 13]].map(([xIndex, yIndex]) => ({
      x: prior[0] + Number(loc[offset + xIndex]) * .1 * prior[2],
      y: prior[1] + Number(loc[offset + yIndex]) * .1 * prior[3],
    })) as PlateCorners;
    if (corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
    best = { score, corners };
  }
  if (!best) return null;

  const corners = expandCorners(best.corners, .055);
  const center = corners.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
  const topWidth = distance(corners[0], corners[1], image.naturalWidth, image.naturalHeight);
  const bottomWidth = distance(corners[3], corners[2], image.naturalWidth, image.naturalHeight);
  const leftHeight = distance(corners[0], corners[3], image.naturalWidth, image.naturalHeight);
  const rightHeight = distance(corners[1], corners[2], image.naturalWidth, image.naturalHeight);
  const rotation = Math.atan2(
    (corners[1].y - corners[0].y) * image.naturalHeight,
    (corners[1].x - corners[0].x) * image.naturalWidth,
  ) * 180 / Math.PI;

  let brightnessTotal = 0;
  let brightnessPixels = 0;
  const minX = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.x)) * INPUT_WIDTH));
  const maxX = Math.min(INPUT_WIDTH, Math.ceil(Math.max(...corners.map((point) => point.x)) * INPUT_WIDTH));
  const minY = Math.max(0, Math.floor(Math.min(...corners.map((point) => point.y)) * INPUT_HEIGHT));
  const maxY = Math.min(INPUT_HEIGHT, Math.ceil(Math.max(...corners.map((point) => point.y)) * INPUT_HEIGHT));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const source = (y * INPUT_WIDTH + x) * 4;
      brightnessTotal += rgba[source] * .299 + rgba[source + 1] * .587 + rgba[source + 2] * .114;
      brightnessPixels += 1;
    }
  }
  const mean = brightnessPixels ? brightnessTotal / brightnessPixels : 150;
  return {
    placement: {
      x: center.x,
      y: center.y,
      width: ((topWidth + bottomWidth) / 2) / image.naturalWidth,
      height: ((leftHeight + rightHeight) / 2) / image.naturalHeight,
      rotation,
      brightness: Math.min(1.12, Math.max(.78, .76 + mean / 255 * .4)),
      corners,
    },
    confidence: best.score,
  };
}
