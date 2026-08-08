import { expect, test } from "vitest";
import {
  getModelDownloadDetails,
  KITTEN_DEFAULT_MODEL,
  KITTEN_MODELS,
  KOKORO_DTYPES,
  SPEECH_MODEL_CHOICES,
} from "../app-config.js";

test("Kokoro WebGPU consent always describes fp32", () => {
  const details = getModelDownloadDetails({ backend: "kokoro", kokoroDevice: "webgpu", kokoroDtype: "q8" });
  expect(details.sizeMb).toBe(326);
  expect(details.label).toMatch(/fp32 · WebGPU/);
});

test("Kitten default consent names the persisted model", () => {
  const details = getModelDownloadDetails({ backend: "kitten", kittenModel: KITTEN_DEFAULT_MODEL });
  expect(details.model).toBe(KITTEN_DEFAULT_MODEL);
  expect(details.label).toMatch(/WASM/);
});

test("flat model choices contain every model and are sorted for comparison", () => {
  expect(SPEECH_MODEL_CHOICES[0].id).toBe("system");
  const kitten = SPEECH_MODEL_CHOICES.filter((choice) => choice.backend === "kitten");
  expect(new Set(kitten.map((choice) => choice.model))).toEqual(new Set(KITTEN_MODELS));
  expect(kitten.map((choice) => choice.sizeMb)).toEqual([...kitten.map((choice) => choice.sizeMb)].sort((a, b) => a - b));
  const kokoroWasm = SPEECH_MODEL_CHOICES.filter((choice) => choice.backend === "kokoro" && choice.device === "wasm");
  expect(new Set(kokoroWasm.map((choice) => choice.dtype))).toEqual(new Set(KOKORO_DTYPES));
  expect(kokoroWasm.map((choice) => choice.sizeMb)).toEqual([...kokoroWasm.map((choice) => choice.sizeMb)].sort((a, b) => a - b));
});
