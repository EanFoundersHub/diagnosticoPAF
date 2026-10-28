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

async function llamarFlujo(url, payload) {
  if (!url || !url.startsWith("https://")) throw new Error("FLUJO_NO_CONFIGURADO");
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    redirect: "manual"
  });
  let contenido = null;
  try { contenido = await r.json(); } catch { /* Respuesta no JSON */ }
  return { ok: r.ok, status: r.status, contenido };
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
    if (request.method === "GET" && path === "/") {
      return responder({ ok: true, servicio: "SWC Radiografia", estado: "disponible" });
    }
    if (path !== "/api/diagnostico" || request.method !== "POST") {
      return responder({ ok: false, mensaje: "Ruta no disponible" }, 404);
    }
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
        const listado = await llamarFlujo(env.SWC_CONSULTA_URL, { operacion: "consultar" });
        if (!listado.ok || !Array.isArray(listado.contenido)) {
          return responder({ ok: false, mensaje: "No se pudo consultar el diagnostico" }, 502);
        }
        const archivo = listado.contenido.find(a =>
          a.nombre === "estado.json" && mismaCarpeta(a.carpeta, empresa)
        );
        if (!archivo) return responder({ ok: true, empresa, existe: false, estado: null });
        if (typeof archivo.identificador !== "string" || !archivo.identificador) {
          return responder({ ok: false, mensaje: "Archivo sin identificador" }, 502);
        }
        const lectura = await llamarFlujo(env.SWC_CONSULTA_URL, {
          operacion: "consultar", modo: "archivo", identificador: archivo.identificador
        });
        if (!lectura.ok || lectura.contenido?.ok !== true) {
          return responder({ ok: false, mensaje: "No se pudo leer el diagnostico" }, 502);
        }
        const raw = lectura.contenido.contenido;
        const estado = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!estado || typeof estado !== "object" || estado.empresa !== empresa) {
          return responder({ ok: false, mensaje: "Expediente no valido" }, 502);
        }
        return responder({ ok: true, empresa, existe: true, estado });
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
        const payload = {
          operacion: "guardar", tipoRespaldo: "autoguardado", id, empresa,
          avance: datos.avance, revisionBase: base, revision: nueva, estadoJson
        };
        if (typeof datos.reporteHtml === "string") {
          if (datos.reporteHtml.length > 700000) {
            return responder({ ok: false, mensaje: "Reporte HTML demasiado grande" }, 413);
          }
          payload.reporteHtml = datos.reporteHtml;
        }
        const guardado = await llamarFlujo(env.SWC_AUTOGUARDADO_URL, payload);
        if (guardado.status === 409) {
	          return responder({ ok: false, guardado: false,
            codigo: "REVISION_DESACTUALIZADA", mensaje: "Hay un respaldo mas reciente" }, 409);
        }
        if (!guardado.ok || guardado.contenido?.ok !== true) {
	          return responder({ ok: false, guardado: false,
            mensaje: "SharePoint no confirmo el guardado" }, 503);
        }
	        return responder({ ok: true, guardado: true, empresa, revision: nueva });
      }
	      return responder({ ok: false, mensaje: "Operacion no permitida" }, 400);
    } catch {
	      return responder({ ok: false, mensaje: "No se pudo completar la solicitud" }, 502);
    }
  }
};
