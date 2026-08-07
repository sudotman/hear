import { readFileSync, writeFileSync, existsSync } from "node:fs";
const files = ["node_modules/phonemizer/dist/phonemizer.js", "node_modules/phonemizer/dist/phonemizer.cjs"];
let patched = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  let code = readFileSync(file, "utf8");
  if (code.includes('for await(const A of e)C.push(A)')) {
    code = code.replace(
      'new Blob([A]).stream().pipeThrough(new DecompressionStream("gzip")),C=[];for await(const A of e)C.push(A);const a=await new Blob(C).arrayBuffer()',
      'new Blob([A]).stream().pipeThrough(new DecompressionStream("gzip")),C=[];{const R=e.getReader();try{for(;;){const{done:A,value:I}=await R.read();if(A)break;C.push(I)}}finally{R.releaseLock()}}const a=await new Blob(C).arrayBuffer()'
    );
    writeFileSync(file, code);
    patched++;
  }
  // Also generic fallback if minified differently (just ensure no for await remains using getReader)
  if (code.includes("for await") && code.includes("DecompressionStream")) {
    const before = code;
    code = code.replace(
      /for await\s*\(\s*const\s+(\w+)\s+of\s+(\w+)\s*\)\s*(\w+)\.push\(\1\)/g,
      (_m, chunk, stream, arr) => `{const _r=${stream}.getReader();try{for(;;){const{done:${chunk},value:_v}=await _r.read();if(${chunk})break;${arr}.push(_v)}}finally{_r.releaseLock()}}`
    );
    if (code !== before) {
      writeFileSync(file, code);
      patched++;
    }
  }
}
if (patched) console.log(`[patch-phonemizer] patched ${patched} file(s) for WebKit`);
