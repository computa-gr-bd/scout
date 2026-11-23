import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import typescript from "typescript";

const source = await readFile(new URL("../src/lib/leagueDifferences.ts", import.meta.url), "utf8");
const javascript = typescript.transpileModule(source, {
  compilerOptions: { module: typescript.ModuleKind.ESNext },
}).outputText;
const { leagueDifferences } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("calcula as diferenças dos valores exibidos", () => {
  const result = leagueDifferences(28, 16, 26, 17.25);
  assert.equal(result.points, 12);
  assert.equal(result.goals, 8.75);
});

test("mantém zero e valores negativos; não inventa métricas ausentes", () => {
  assert.deepEqual(leagueDifferences(0, 0, 1, 2), { points: 0, goals: -1 });
  assert.deepEqual(leagueDifferences(28, null, null, 17.25), { points: null, goals: null });
});
