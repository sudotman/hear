const runButton = document.querySelector("#run");
const status = document.querySelector("#status");
const results = document.querySelector("#results");
const audio = document.querySelector("#audio");
let worker;

function showResult(payload) {
  results.textContent = JSON.stringify(payload, null, 2);
}

runButton.addEventListener("click", () => {
  runButton.disabled = true;
  status.className = "";
  status.textContent = "Loading the latest compatible Transformers.js and ONNX Runtime Web stack…";
  worker = new Worker(new URL("./webgpu-test-worker.js", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "status") status.textContent = message.message;
    if (message.type === "progress") showResult(message);
    if (message.type === "complete") {
      const blob = new Blob([message.lastAudio], { type: "audio/wav" });
      audio.src = URL.createObjectURL(blob);
      status.className = "pass";
      status.textContent = `Passed ${message.runs.length}/20 consecutive generations.`;
      showResult(message.summary);
      runButton.disabled = false;
      worker.terminate();
    }
    if (message.type === "failure") {
      status.className = "fail";
      status.textContent = `Failed: ${message.message}`;
      showResult(message);
      runButton.disabled = false;
      worker.terminate();
    }
  });
  worker.addEventListener("error", (event) => {
    status.className = "fail";
    status.textContent = `Worker crashed: ${event.message}`;
    runButton.disabled = false;
  });
  worker.postMessage({ type: "run" });
});

showResult({
  crossOriginIsolated,
  sharedArrayBuffer: typeof SharedArrayBuffer !== "undefined",
  cores: navigator.hardwareConcurrency,
  webgpu: "gpu" in navigator,
});
