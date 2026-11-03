import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/swc-radiografia-worker-hotfix.js";

const empresas = Array.from({ length: 28 }, (_, i) => ({
  codigo: `acceso_empresa_${String(i + 1).padStart(2, "0")}_seguro`,
  empresa: `Empresa ${String(i + 1).padStart(2, "0")}`,
  id: `EXP-${String(i + 1).padStart(2, "0")}`
}));

const env = {
  SWC_FLUJO_URL: "https://power.example/SWC-Guardar-Radiografia",
  SWC_ORIGENES_PERMITIDOS: "https://eanfoundershub.github.io",
  SWC_ACCESOS: JSON.stringify(Object.fromEntries(empresas.map(e => [e.codigo, { empresa: e.empresa, id: e.id }])))
};

function estado(e, valor = "") {
  return {
    id: e.id, empresa: e.empresa, schemaVersion: 1, instrumentVersion: "0.6.1",
    inst: { deuda: true, equity: false }, r: {}, f: {}, g: {}, m: {}, us: {}, tx: { nota: valor }, fl: {}
  };
}

function solicitud(e, accion, extra = {}) {
  return new Request("https://worker.example/api/diagnostico", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://eanfoundershub.github.io" },
    body: JSON.stringify({ accion, acceso: e.codigo, ...extra })
  });
}

async function json(res) { return { status: res.status, body: await res.json() }; }

test("28 empresas consultan su propio expediente con un solo listado compartido", async () => {
  const llamadas = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    llamadas.push(payload);
    if (payload.modo === "archivo") {
      const e = empresas.find(x => x.id === payload.identificador);
      return Response.json({ ok: true, contenido: JSON.stringify({ empresa: e.empresa, revision: 7, estadoJson: JSON.stringify(estado(e)) }) });
    }
    return Response.json(empresas.map(e => ({ nombre: "estado.json", carpeta: `/expedientes/${e.empresa}`, identificador: e.id })));
  };

  const resultados = await Promise.all(empresas.map(e => worker.fetch(solicitud(e, "consultar"), env)));
  const cuerpos = await Promise.all(resultados.map(json));
  assert.equal(cuerpos.filter(x => x.status === 200 && x.body.ok).length, 28);
  cuerpos.forEach((x, i) => assert.equal(x.body.estado.empresa, empresas[i].empresa));
  assert.equal(llamadas.filter(x => x.operacion === "consultar" && !x.modo).length, 1);
  assert.equal(llamadas.filter(x => x.modo === "archivo").length, 28);
});

test("dos guardados idénticos simultáneos producen una sola llamada a Power Automate", async () => {
  let llamadas = 0;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.operacion === "guardar") {
      llamadas++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return Response.json({ ok: true });
    }
    throw new Error("llamada inesperada");
  };
  const e = empresas[0];
  const extra = { revisionBase: 40, revision: 41, avance: 50, estadoJson: JSON.stringify(estado(e, "uno")) };
  const [a, b] = await Promise.all([
    worker.fetch(solicitud(e, "guardar", extra), env),
    worker.fetch(solicitud(e, "guardar", extra), env)
  ]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(llamadas, 1);
});

test("contenidos distintos para la misma revisión no se confunden como duplicados", async () => {
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    await new Promise(resolve => setTimeout(resolve, 30));
    return Response.json({ ok: true });
  };
  const e = empresas[1];
  const base = { revisionBase: 50, revision: 51, avance: 60 };
  const primero = worker.fetch(solicitud(e, "guardar", { ...base, estadoJson: JSON.stringify(estado(e, "A")) }), env);
  await new Promise(resolve => setTimeout(resolve, 5));
  const segundo = worker.fetch(solicitud(e, "guardar", { ...base, estadoJson: JSON.stringify(estado(e, "B")) }), env);
  const [a, b] = await Promise.all([primero, segundo]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 409);
  assert.equal(llamadas, 1);
});

test("un fallo de Power Automate no inicia reintentos desde el Worker", async () => {
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas++;
    return Response.json({ ok: false }, { status: 503 });
  };
  const e = empresas[2];
  const res = await worker.fetch(solicitud(e, "guardar", {
    revisionBase: 60, revision: 61, avance: 70, estadoJson: JSON.stringify(estado(e, "fallo"))
  }), env);
  assert.equal(res.status, 503);
  assert.equal(llamadas, 1);
});

test("un timeout de guardado se verifica persistentemente antes de responder", async () => {
  const e = empresas[5];
  const envRapido = { ...env, SWC_GUARDADO_TIMEOUT_MS: "100", SWC_VERIFICACION_TIMEOUT_MS: "100" };
  let guardados = 0, verificaciones = 0;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.operacion === "guardar") {
      guardados++;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }
    if (payload.operacion === "verificar") {
      verificaciones++;
      return Response.json({ ok: true, confirmado: true, revision: payload.revision });
    }
    throw new Error("llamada inesperada");
  };
  const res = await worker.fetch(solicitud(e, "guardar", {
    revisionBase: 80, revision: 81, avance: 80, estadoJson: JSON.stringify(estado(e, "incierto"))
  }), envRapido);
  assert.equal(res.status, 200);
  assert.equal(guardados, 1);
  assert.equal(verificaciones, 1);
});

test("la idempotencia persistente protege entre dos instancias del Worker", async () => {
  const marca = Date.now();
  const [instanciaA, instanciaB] = await Promise.all([
    import(`../worker/swc-radiografia-worker-hotfix.js?instancia=a-${marca}`),
    import(`../worker/swc-radiografia-worker-hotfix.js?instancia=b-${marca}`)
  ]);
  const e = empresas[6];
  const procesadas = new Map();
  let escrituras = 0;
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    if (payload.operacion !== "guardar") throw new Error("llamada inesperada");
    if (!procesadas.has(payload.idempotencia)) {
      procesadas.set(payload.idempotencia, payload.revision);
      escrituras++;
    }
    return Response.json({ ok: true, revision: procesadas.get(payload.idempotencia) });
  };
  const extra = { revisionBase: 90, revision: 91, avance: 90, estadoJson: JSON.stringify(estado(e, "persistente")) };
  const a = await instanciaA.default.fetch(solicitud(e, "guardar", extra), env);
  const b = await instanciaB.default.fetch(solicitud(e, "guardar", extra), env);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(escrituras, 1);
});

test("los códigos y expedientes no se pueden cruzar", async () => {
  let llamadas = 0;
  globalThis.fetch = async () => { llamadas++; return Response.json({ ok: true }); };
  const e = empresas[3];
  const ajeno = estado(empresas[4]);
  const res = await worker.fetch(solicitud(e, "guardar", {
    revisionBase: 70, revision: 71, avance: 10, estadoJson: JSON.stringify(ajeno)
  }), env);
  assert.equal(res.status, 403);
  assert.equal(llamadas, 0);
});
