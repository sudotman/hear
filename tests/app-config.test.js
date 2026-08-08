import { expect, test } from "vitest";
import { getModelDownloadDetails, KITTEN_DEFAULT_MODEL } from "../app-config.js";

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
