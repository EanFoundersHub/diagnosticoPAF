# Recuperación mínima: formulario, Worker y flujo combinado

## Arquitectura confirmada para esta recuperación

Power Automate usa actualmente un único flujo combinado, **`SWC - Guardar Radiografia`**, que atiende `consultar`, `guardar` y, con este hotfix, `verificar`. No se presupone ni se exige separar el flujo para recuperar el servicio.

Las acciones **`Consultar Archivos SWC`** y **`Leer Contenido Archivo SWC`** ya tienen reintentos en **Ninguno**. Se deben conservar así; este procedimiento no las cambia automáticamente.

El Worker acepta `SWC_FLUJO_URL` como URL única. Los nombres anteriores `SWC_CONSULTA_URL` y `SWC_AUTOGUARDADO_URL` quedan solamente como compatibilidad. No se deben incluir URLs de Power Automate en HTML ni en el repositorio.

## Garantías y límites

- `vivo.html` consulta al abrir y solo vuelve a consultar ante una conciliación o transferencia de control. No hay polling remoto.
- Un cambio que deja el estado igual a la base no se guarda. El navegador hace como máximo dos reintentos, a los 2 y 4 minutos.
- Los `Map()` del Worker únicamente agrupan solicitudes dentro de una instancia. **No proporcionan exclusión ni idempotencia entre instancias.** La garantía efectiva debe residir en SharePoint y en la escritura condicional del flujo.
- Un timeout HTTP no cancela Power Automate. El Worker espera hasta 25 segundos para `guardar`; si pierde la respuesta, ejecuta una sola operación `verificar` de hasta 10 segundos. El navegador espera 45 segundos, de modo que no repite antes de recibir esa verificación.
- Si tampoco se puede verificar, se responde `503 RESULTADO_INCIERTO`. Un reintento posterior conserva la misma pareja expediente/revisión e `idempotencia`, por lo que el flujo debe reconocerlo sin reescribir.

## Cambio mínimo en `SWC - Guardar Radiografia`

No modificar todavía la concurrencia global del disparador: al ser un flujo combinado, ese ajuste afectaría consultas y guardados por igual y podría crear una cola nueva. La consistencia se obtiene con ETag/revisión, no serializando todas las empresas.

### Contrato común

1. Añadir `idempotencia` al esquema como texto para `guardar` y `verificar`. El Worker envía `EXPEDIENTE:REVISION`.
2. Determinar la ruta únicamente con el `id` y la empresa autorizados por el Worker. Nunca aceptar una ruta o nombre de archivo libre desde el cliente.
3. Activar **Secure Inputs** y **Secure Outputs** donde aparezcan `estadoJson`, contenido del archivo o identificadores.
4. Mantener sin reintentos `Consultar Archivos SWC` y `Leer Contenido Archivo SWC`.
5. No usar `Do until`, reenvíos al propio flujo ni ramas que vuelvan a invocar `guardar`.

### Rama `consultar`

Conservar las operaciones actuales de listado y lectura por `identificador`. Responder solo con el expediente solicitado. No devolver códigos de acceso, URLs firmadas ni metadatos de otras empresas.

### Rama `guardar`: validación persistente y escritura condicional

1. Leer `estado.json`, su ETag actual y el contenido persistido antes de escribir.
2. El contenido persistido debe conservar `revision` e `idempotenciaUltima` junto al estado existente. No eliminar ni reconstruir respuestas financieras.
3. Si `revision == revision solicitada` e `idempotenciaUltima == idempotencia`, responder `200 {"ok":true,"revision":N,"repetido":true}` sin escribir.
4. Si la revisión persistida no coincide con `revisionBase`, responder `409 REVISION_DESACTUALIZADA` sin modificar el archivo.
5. Escribir mediante una solicitud HTTP a SharePoint con `IF-MATCH` igual al ETag leído, nunca con `*`. En el mismo contenido guardar la nueva revisión y `idempotenciaUltima`.
6. Si SharePoint devuelve `412 Precondition Failed`, releer una vez: si ya aparece la misma idempotencia, responder `200`; en cualquier otro caso responder `409`. No reintentar la escritura.
7. Mantener la acción de escritura con reintentos en **Ninguno**. Responder `200` solo después de confirmación de SharePoint.

Esta escritura condicional protege entre ejecuciones concurrentes, instancias distintas del Worker y respuestas tardías. Una lista auxiliar de operaciones puede servir para auditoría, pero no debe sustituir el ETag del propio expediente ni crear dos escrituras no atómicas.

### Rama `verificar`

1. Recibir `id`, `empresa`, `revision` e `idempotencia`; no escribir nada.
2. Leer el `estado.json` del expediente.
3. Si coinciden `revision` e `idempotenciaUltima`, responder `200 {"ok":true,"confirmado":true,"revision":N}`.
4. Si la revisión almacenada es mayor o pertenece a otra idempotencia, responder `409 REVISION_DESACTUALIZADA`.
5. Si todavía no se observa la operación, responder `200 {"ok":true,"confirmado":false,"revision":actual}`. No esperar en bucle.

## Secuencia mínima de recuperación — aún no ejecutar

1. Exportar una copia del flujo combinado y registrar su configuración de concurrencia actual. No cambiarla durante la recuperación inicial.
2. Exportar/copiar los 28 `estado.json` y verificar que cada empresa tenga una revisión legible. No modificar estos respaldos.
3. En una copia del flujo, añadir `verificar`, la idempotencia persistente y la escritura con ETag. Mantener las acciones de consulta sin reintentos.
4. Probar la copia exclusivamente con el expediente aislado: consulta, guardado, repetición idéntica, conflicto y timeout simulado.
5. Ejecutar las pruebas reales descritas abajo y guardar IDs de ejecución, códigos HTTP, revisión anterior/nueva y conteo de escrituras.
6. Solo con autorización, reemplazar el flujo combinado, configurar `SWC_FLUJO_URL`, publicar el Worker y después publicar `vivo.html` como `index.html`.
7. Mantener `SWC_MANTENIMIENTO=true` durante las verificaciones técnicas. Retirarlo únicamente con autorización y después de una lectura y un guardado reales exitosos del expediente aislado.
8. Observar 15 minutos: una pestaña sin cambios debe generar cero ejecuciones nuevas. Después habilitar gradualmente las 28 empresas.

## Pruebas simuladas incluidas

`npm test` usa dobles de HTTP; no accede a Power Automate ni a SharePoint. Cubre 28 empresas aisladas, listado compartido, duplicados dentro de una instancia, dos instancias con idempotencia persistente simulada, conflicto de contenidos, timeout seguido de verificación, fallos sin reintento y rechazo de cruces de empresa.

Estas pruebas demuestran el comportamiento del código y el contrato esperado. **No prueban que el flujo real tenga ETag, idempotencia persistida, permisos correctos ni respuestas HTTP correctas.**

## Pruebas reales obligatorias antes de producción

Usar solo el expediente aislado, nunca una de las 28 empresas:

1. Consultar y confirmar que no hubo escritura.
2. Guardar un cambio controlado y confirmar exactamente una escritura, revisión `N+1` e `idempotenciaUltima`.
3. Repetir el mismo payload y confirmar `200 repetido:true`, cero escrituras adicionales y contenido idéntico.
4. Enviar dos contenidos distintos con la misma `revisionBase`; uno debe guardar y el otro responder `409`, o `412` convertido a `409`.
5. Forzar pérdida de respuesta después de la escritura; `verificar` debe confirmar el resultado sin segunda escritura.
6. Forzar timeout antes de escribir; `verificar` debe devolver `confirmado:false` y el reintento posterior debe producir una sola escritura.
7. Abrir el formulario cinco minutos sin cambios y confirmar cero ejecuciones adicionales.

## Reversión

1. Poner `SWC_MANTENIMIENTO=true`; no apagar ni borrar SharePoint.
2. Restaurar el Worker y el HTML desde `respaldo-antes-mantenimiento-2026-11-03`.
3. Restaurar la exportación del flujo combinado, conservando las dos acciones de consulta con reintentos en Ninguno.
4. No restaurar los 28 `estado.json` salvo decisión explícita basada en auditoría: la reversión normal es de código y flujo, no de datos.
5. Comparar revisiones y hashes de los expedientes antes de cualquier reapertura.
