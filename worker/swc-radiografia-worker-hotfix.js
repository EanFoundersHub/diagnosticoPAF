// API de diagnosticos Swisscontact. No incluir URLs de Power Automate en este archivo.
const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};

function respuesta(data, status = 200, responseHeaders = headers) {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

const esObjeto = valor => !!valor && typeof valor === "object" && !Array.isArray(valor);
const CAMPOS_FINANCIEROS = new Set([
  "ing_act", "ing_c1", "ing_c2", "cv_act", "cv_c1", "cv_c2",
  "uo_act", "uo_c1", "uo_c2", "ebitda_act", "ebitda_c1", "ebitda_c2",
  "un_act", "un_c1", "un_c2", "activos_act", "activos_c1", "pas_act",
  "pas_c1", "cxc_act", "cxc_c1", "cxp_act", "cxp_c1", "inv_act",
  "inv_c1", "caja", "gasto_mensual", "monto", "deuda_fin",
  "cuota_mensual", "monto_eq"
]);
const CAMPOS_QUE_ADMITEN_NEGATIVOS = new Set([
  "uo_act", "uo_c1", "uo_c2", "ebitda_act", "ebitda_c1", "ebitda_c2",
  "un_act", "un_c1", "un_c2"
]);

function normalizarEstado(estado, empresa, id) {
  if (!esObjeto(estado)) return { ok: false, status: 400, mensaje: "Estado invalido" };
  if (estado.empresa !== empresa) {
    return { ok: false, status: 403, mensaje: "La empresa del estado no coincide con el enlace" };
  }
  if (estado.id != null && estado.id !== id) {
    return { ok: false, status: 403, mensaje: "El expediente no coincide con el enlace" };
  }
  if (estado.instrumentVersion != null && estado.instrumentVersion !== "0.6.1") {
    return { ok: false, status: 409, mensaje: "Version del instrumento no compatible" };
  }
  if (estado.schemaVersion != null && estado.schemaVersion !== 1) {
    return { ok: false, status: 409, mensaje: "Version del estado no compatible" };
  }
  if (estado.inst != null && !esObjeto(estado.inst)) {
    return { ok: false, status: 400, mensaje: "Instrumentos invalidos" };
  }
  if (estado.inst?.equity != null && typeof estado.inst.equity !== "boolean") {
    return { ok: false, status: 400, mensaje: "Seleccion de Equity invalida" };
  }
  if (estado._session != null) {
    if (!esObjeto(estado._session) ||
        typeof estado._session.id !== "string" ||
        !/^[A-Za-z0-9_-]{8,160}$/.test(estado._session.id) ||
        typeof estado._session.ts !== "number" ||
        !Number.isFinite(estado._session.ts) || estado._session.ts <= 0) {
      return { ok: false, status: 400, mensaje: "Sesion de edicion invalida" };
    }
    estado._session = { id: estado._session.id, ts: estado._session.ts };
  }
  for (const clave of ["r", "f", "g", "m", "us", "tx", "fl"]) {
    if (!esObjeto(estado[clave])) return { ok: false, status: 400, mensaje: "Estructura de estado invalida" };
  }
	  for (const [clave, valor] of Object.entries(estado.f)) {
	    if (!CAMPOS_FINANCIEROS.has(clave)) {
	      return { ok: false, status: 400, mensaje: "Campo financiero desconocido" };
	    }
    if (valor !== "nd" && (typeof valor !== "number" || !Number.isFinite(valor))) {
      return { ok: false, status: 400, mensaje: "Cifra financiera invalida" };
    }
	    if (typeof valor === "number" && valor < 0 && !CAMPOS_QUE_ADMITEN_NEGATIVOS.has(clave)) {
	      return { ok: false, status: 400, mensaje: "Cifra financiera fuera de rango" };
	    }
  }
  for (const valor of Object.values(estado.g)) {
    if (typeof valor !== "string" && (typeof valor !== "number" || !Number.isFinite(valor))) {
      return { ok: false, status: 400, mensaje: "Dato complementario invalido" };
    }
  }
  if (estado.precarga != null) {
    if (!esObjeto(estado.precarga) || !Array.isArray(estado.precarga.pendientesValidacion || [])) {
      return { ok: false, status: 400, mensaje: "Control de precarga invalido" };
    }
    if ((estado.precarga.pendientesValidacion || []).some(k => typeof k !== "string" || !(k in estado.f))) {
      return { ok: false, status: 400, mensaje: "Campo de precarga invalido" };
    }
  }
  estado.id = id;
  estado.empresa = empresa;
  estado.inst = { deuda: true, equity: estado.inst?.equity === true };
  estado.schemaVersion = 1;
  estado.instrumentVersion = "0.6.1";
  return { ok: true, estado };
}

async function llamarFlujo(url, payload, timeoutMs = 12000) {
  if (!url || !url.startsWith("https://")) throw new Error("FLUJO_NO_CONFIGURADO");
  const control = new AbortController();
  const limite = setTimeout(() => control.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: control.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const agotado = new Error("FLUJO_TIMEOUT");
      agotado.codigo = "FLUJO_TIMEOUT";
      throw agotado;
    }
    throw error;
  } finally {
    clearTimeout(limite);
  }
  let contenido = null;
  try { contenido = await r.json(); } catch { /* Respuesta no JSON */ }
  return { ok: r.ok, status: r.status, contenido };
}

function urlFlujo(env, tipo) {
  return env.SWC_FLUJO_URL || (tipo === "consulta" ? env.SWC_CONSULTA_URL : env.SWC_AUTOGUARDADO_URL);
}

function timeoutFlujo(env, clave, predeterminado) {
  const valor = Number(env[clave]);
  return Number.isFinite(valor) ? Math.max(100, Math.min(60000, valor)) : predeterminado;
}

function canonico(valor) {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (esObjeto(valor)) {
    return Object.fromEntries(Object.keys(valor).sort().map(clave => [clave, canonico(valor[clave])]));
  }
  return valor;
}

async function huellaSha256(valor) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonico(valor)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Un listado reciente se reutiliza entre consultas al mismo Worker.
let listadoCache = null;
let listadoCaduca = 0;
let listadoEnCurso = null;
const consultasEnCurso = new Map();
const guardadosEnCurso = new Map();
const guardadosConfirmados = new Map();
async function obtenerListado(env) {
  if (listadoCache && Date.now() < listadoCaduca) return listadoCache;
  if (listadoEnCurso) return listadoEnCurso;
  listadoEnCurso = (async () => {
    const res = await llamarFlujo(urlFlujo(env, "consulta"), { operacion: "consultar" }, timeoutFlujo(env, "SWC_CONSULTA_TIMEOUT_MS", 18000));
    if (!res.ok || !Array.isArray(res.contenido)) throw new Error("CONSULTA_LISTADO_FALLIDA");
    listadoCache = res.contenido;
    listadoCaduca = Date.now() + 30000;
    return listadoCache;
  })();
  try { return await listadoEnCurso; }
  finally { listadoEnCurso = null; }
}

async function consultarExpediente(env, empresa, id) {
  if (consultasEnCurso.has(id)) return consultasEnCurso.get(id);
  const tarea = (async () => {
    const listado = await obtenerListado(env);
    const archivo = listado.find(a =>
      a.nombre === "estado.json" && mismaCarpeta(a.carpeta, empresa)
    );
    if (!archivo) return { existe: false, estado: null };
    if (typeof archivo.identificador !== "string" || !archivo.identificador) {
      throw new Error("ARCHIVO_SIN_IDENTIFICADOR");
    }
    const lectura = await llamarFlujo(urlFlujo(env, "consulta"), {
      operacion: "consultar", modo: "archivo", identificador: archivo.identificador
    }, timeoutFlujo(env, "SWC_CONSULTA_TIMEOUT_MS", 18000));
    if (!lectura.ok || lectura.contenido?.ok !== true) throw new Error("LECTURA_FALLIDA");
    const raw = lectura.contenido.contenido;
    const estado = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!estado || typeof estado !== "object" || estado.empresa !== empresa) {
      throw new Error("EXPEDIENTE_INVALIDO");
    }
    return { existe: true, estado };
  })();
  consultasEnCurso.set(id, tarea);
  try { return await tarea; }
  finally { consultasEnCurso.delete(id); }
}

async function guardarConVerificacion(env, payload) {
  const url = urlFlujo(env, "guardar");
  try {
    return await llamarFlujo(url, payload, timeoutFlujo(env, "SWC_GUARDADO_TIMEOUT_MS", 25000));
  } catch (error) {
    if (error?.codigo !== "FLUJO_TIMEOUT") throw error;
    // Abortar la espera HTTP no cancela una ejecución ya iniciada de Power Automate.
    // Antes de permitir un reintento se consulta la marca persistente de SharePoint.
    let verificacion;
    try {
      verificacion = await llamarFlujo(url, {
        operacion: "verificar", id: payload.id, empresa: payload.empresa,
        revision: payload.revision, idempotencia: payload.idempotencia,
        huellaContenido: payload.huellaContenido
      }, timeoutFlujo(env, "SWC_VERIFICACION_TIMEOUT_MS", 10000));
    } catch {
      const incierto = new Error("RESULTADO_INCIERTO");
      incierto.codigo = "RESULTADO_INCIERTO";
      throw incierto;
    }
    if (verificacion.ok && verificacion.contenido?.ok === true &&
        verificacion.contenido?.confirmado === true &&
        Number(verificacion.contenido?.revision) === payload.revision &&
        verificacion.contenido?.huellaContenido === payload.huellaContenido) {
      return { ok: true, status: 200, contenido: { ok: true, verificado: true } };
    }
    if (verificacion.status === 409 || verificacion.contenido?.codigo === "REVISION_DESACTUALIZADA") {
      return { ok: false, status: 409, contenido: verificacion.contenido };
    }
    const incierto = new Error("RESULTADO_INCIERTO");
    incierto.codigo = "RESULTADO_INCIERTO";
    throw incierto;
  }
}

function limpiarConfirmaciones(ahora = Date.now()) {
  for (const [clave, valor] of guardadosConfirmados) {
    if (valor.caduca <= ahora) guardadosConfirmados.delete(clave);
  }
}

function mismaCarpeta(ruta, empresa) {
  return String(ruta || "").replace(/\\/g, "/").split("/")
    .some(segmento => segmento.trim().toLowerCase() === empresa.trim().toLowerCase());
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const origen = request.headers.get("Origin") || "";
    const origenes = String(env.SWC_ORIGENES_PERMITIDOS || "https://eanfoundershub.github.io")
      .split(",").map(x => x.trim()).filter(Boolean);
    const origenPermitido = !origen || origenes.includes(origen);
    const responseHeaders = { ...headers, "Vary": "Origin" };
    if (origen && origenPermitido) responseHeaders["Access-Control-Allow-Origin"] = origen;
    const responder = (data, status = 200) => respuesta(data, status, responseHeaders);
    if (!origenPermitido) return responder({ ok: false, mensaje: "Origen no permitido" }, 403);
    if (request.method === "OPTIONS" && path === "/api/diagnostico") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }
    const mantenimiento = String(env.SWC_MANTENIMIENTO || "").toLowerCase() === "true";
    if (request.method === "GET" && path === "/") {
      return responder({ ok: true, servicio: "SWC Radiografia", estado: mantenimiento ? "mantenimiento" : "disponible" });
    }
    if (path !== "/api/diagnostico" || request.method !== "POST") {
      return responder({ ok: false, mensaje: "Ruta no disponible" }, 404);
    }
    if (mantenimiento) return responder({ ok: false, mensaje: "Servicio temporalmente en mantenimiento" }, 503);
    try {
      if (Number(request.headers.get("content-length") || 0) > 2000000) {
        return responder({ ok: false, mensaje: "Solicitud demasiado grande" }, 413);
      }
      let datos;
      try { datos = await request.json(); }
      catch { return responder({ ok: false, mensaje: "JSON invalido" }, 400); }
      if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
        return responder({ ok: false, mensaje: "Solicitud invalida" }, 400);
      }
      const accesos = JSON.parse(env.SWC_ACCESOS || "{}");
      const codigo = typeof datos.acceso === "string" ? datos.acceso : "";
      const autorizado = Object.prototype.hasOwnProperty.call(accesos, codigo)
        ? accesos[codigo] : null;
      if (!autorizado || !autorizado.empresa || !autorizado.id) {
        return responder({ ok: false, mensaje: "Enlace no valido" }, 403);
      }
      const { empresa, id } = autorizado;

      if (datos.accion === "consultar") {
        let expediente;
        try { expediente = await consultarExpediente(env, empresa, id); }
        catch { return responder({ ok: false, mensaje: "No se pudo consultar el diagnostico" }, 502); }
        return responder({ ok: true, empresa, ...expediente });
      }

      if (datos.accion === "guardar") {
        const base = datos.revisionBase;
        const nueva = datos.revision;
        if (!Number.isInteger(base) || base < 0 || !Number.isInteger(nueva) || nueva !== base + 1) {
          return responder({ ok: false, mensaje: "Revision invalida" }, 400);
        }
        if (typeof datos.avance !== "number" || !Number.isFinite(datos.avance) ||
            datos.avance < 0 || datos.avance > 100) {
          return responder({ ok: false, mensaje: "Avance invalido" }, 400);
        }
	        let estadoJson = typeof datos.estadoJson === "string"
          ? datos.estadoJson : JSON.stringify(datos.estadoJson);
        if (!estadoJson || estadoJson.length > 1000000) {
          return responder({ ok: false, mensaje: "Estado invalido o demasiado grande" }, 400);
        }
        let estado;
        try { estado = JSON.parse(estadoJson); }
	        catch { return responder({ ok: false, mensaje: "Estado JSON invalido" }, 400); }
	        const validacion = normalizarEstado(estado, empresa, id);
	        if (!validacion.ok) return responder({ ok: false, mensaje: validacion.mensaje }, validacion.status);
	        estado = validacion.estado;
	        estadoJson = JSON.stringify(estado);
        const reporteHtml = typeof datos.reporteHtml === "string" ? datos.reporteHtml : null;
        if (reporteHtml !== null && reporteHtml.length > 700000) {
          return responder({ ok: false, mensaje: "Reporte HTML demasiado grande" }, 413);
        }
        const huellaContenido = await huellaSha256({
          estado: estado,
          avance: datos.avance,
          reporteHtml
        });
        const idempotencia = id + ":" + nueva;
        limpiarConfirmaciones();
        const firma = huellaContenido;
        const confirmado = guardadosConfirmados.get(idempotencia);
        if (confirmado) {
          if (confirmado.firma !== firma) {
            return responder({ ok: false, guardado: false, codigo: "REVISION_DESACTUALIZADA", mensaje: "Hay un respaldo mas reciente" }, 409);
          }
          return responder(confirmado.respuesta);
        }
        const payload = {
          operacion: "guardar", tipoRespaldo: "autoguardado", id, empresa,
          avance: datos.avance, revisionBase: base, revision: nueva, estadoJson,
          idempotencia, huellaContenido
        };
        if (reporteHtml !== null) payload.reporteHtml = reporteHtml;
        let entrada = guardadosEnCurso.get(idempotencia);
        if (entrada && entrada.firma !== firma) {
          return responder({ ok: false, guardado: false, codigo: "REVISION_DESACTUALIZADA", mensaje: "Hay un respaldo mas reciente" }, 409);
        }
        if (!entrada) {
          entrada = { firma, tarea: guardarConVerificacion(env, payload) };
          guardadosEnCurso.set(idempotencia, entrada);
        }
        let guardado;
        try { guardado = await entrada.tarea; }
        catch (error) {
          const mensaje = error?.codigo === "RESULTADO_INCIERTO"
            ? "No fue posible confirmar el resultado del guardado"
            : "No se pudo guardar el diagnostico";
          return responder({ ok: false, guardado: false, codigo: error?.codigo || "GUARDADO_FALLIDO", mensaje }, 503);
        }
        finally { guardadosEnCurso.delete(idempotencia); }
        if (guardado.status === 409) {
	          return responder({ ok: false, guardado: false,
            codigo: "REVISION_DESACTUALIZADA", mensaje: "Hay un respaldo mas reciente" }, 409);
        }
        if (!guardado.ok || guardado.contenido?.ok !== true) {
	          return responder({ ok: false, guardado: false,
            mensaje: "SharePoint no confirmo el guardado" }, 503);
        }
        const respuestaOk = { ok: true, guardado: true, empresa, revision: nueva };
        guardadosConfirmados.set(idempotencia, { firma, respuesta: respuestaOk, caduca: Date.now() + 120000 });
        listadoCache = null;
        listadoCaduca = 0;
        return responder(respuestaOk);
      }
	      return responder({ ok: false, mensaje: "Operacion no permitida" }, 400);
    } catch {
	      return responder({ ok: false, mensaje: "No se pudo completar la solicitud" }, 502);
    }
  }
};
