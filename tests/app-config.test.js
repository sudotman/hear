import { expect, test } from "vitest";
import {
  defaultKokoroDtype,
  getModelDownloadDetails,
  KITTEN_DEFAULT_MODEL,
  KITTEN_MODELS,
  KOKORO_DTYPES,
  SPEECH_ENGINES,
  SPEECH_MODEL_CHOICES,
} from "../app-config.js";

test("Kokoro WebGPU consent always describes fp32", () => {
  const details = getModelDownloadDetails({ backend: "kokoro", kokoroDevice: "webgpu", kokoroDtype: "q8" });
  const fp32 = getModelDownloadDetails({ backend: "kokoro", kokoroDevice: "wasm", kokoroDtype: "fp32" });
  expect(details.label).toMatch(/fp32 · WebGPU/);
  expect(details.sizeMb).toBeGreaterThan(fp32.sizeMb);
});

test("Kitten default consent names the persisted model", () => {
  const details = getModelDownloadDetails({ backend: "kitten", kittenModel: KITTEN_DEFAULT_MODEL });
  expect(details.model).toBe(KITTEN_DEFAULT_MODEL);
  expect(details.label).toMatch(/WASM/);
});

test("retired Kokoro precisions fall back to q8", () => {
  expect(getModelDownloadDetails({ backend: "kokoro", kokoroDtype: "q4" }).label).toMatch(/q8 · WASM/);
});

test("phones default Kokoro to the low-memory precision, computers to the faster one", () => {
  const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", maxTouchPoints: 5 };
  const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", maxTouchPoints: 5 };
  const mac = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", maxTouchPoints: 0 };
  expect(defaultKokoroDtype(iphone)).toBe("q8");
  expect(defaultKokoroDtype(ipad)).toBe("q8");
  expect(defaultKokoroDtype(mac)).toBe("uint8f16");
});

test("every engine has variants, and each engine's default exists", () => {
  expect(SPEECH_MODEL_CHOICES[0].id).toBe("system");
  for (const engine of SPEECH_ENGINES) {
    expect(SPEECH_MODEL_CHOICES.some((choice) => choice.id === engine.defaultChoice && choice.engine === engine.id)).toBe(true);
  }
  const kitten = SPEECH_MODEL_CHOICES.filter((choice) => choice.backend === "kitten");
  expect(new Set(kitten.map((choice) => choice.model))).toEqual(new Set(KITTEN_MODELS));
  expect(kitten.map((choice) => choice.sizeMb)).toEqual([...kitten.map((choice) => choice.sizeMb)].sort((a, b) => a - b));
  const kokoroWasm = SPEECH_MODEL_CHOICES.filter((choice) => choice.backend === "kokoro" && choice.device === "wasm");
  expect(new Set(kokoroWasm.map((choice) => choice.dtype))).toEqual(new Set(KOKORO_DTYPES));
  expect(kokoroWasm.map((choice) => choice.sizeMb)).toEqual([...kokoroWasm.map((choice) => choice.sizeMb)].sort((a, b) => a - b));
});
