import { createCanvas } from "@napi-rs/canvas";

/** Original synthetic pixels; generated lazily only by the opt-in real-media suite. */
export async function generatedCanvasPipelinePng() {
  const width = 1280,
    height = 720,
    canvas = createCanvas(width, height),
    context = canvas.getContext("2d"),
    pixels = context.createImageData(width, height);
  let seed = 0x6d2b79f5;
  for (let offset = 0; offset < pixels.data.length; offset += 4) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    pixels.data[offset] = seed & 255;
    pixels.data[offset + 1] = (seed >>> 8) & 255;
    pixels.data[offset + 2] = (seed >>> 16) & 255;
    pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  return { width, height, bytes: await canvas.encode("png") };
}
