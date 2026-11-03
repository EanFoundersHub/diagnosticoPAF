import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../vivo.html", import.meta.url), "utf8");

test("el formulario no contiene polling remoto", () => {
  assert.doesNotMatch(html, /iniciarPulsoSesionRemota/);
  assert.doesNotMatch(html, /setInterval\s*\(\s*async/);
  assert.match(html, /Sin consultas automaticas peri[oó]dicas/i);
});

test("el formulario limita timeout y reintentos", () => {
  assert.match(html, /const TIMEOUT_API_MS = 45000/);
  assert.match(html, /fallosConsecutivosGuardado <= 2/);
  assert.match(html, /no seguira reintentando automaticamente/);
});

test("un evento sin diferencias reales no agenda guardado", () => {
  assert.match(html, /const cambioReal = !baseEstado \|\| !ConflictEngine\.iguales\(sinSesion\(st\), sinSesion\(baseEstado\)\)/);
  assert.match(html, /if \(!cambioReal\) \{[\s\S]*?cancelarSyncProgramado\(\);[\s\S]*?return;/);
});
