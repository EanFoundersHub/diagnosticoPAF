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
- Si tampoco se puede verificar, se responde `503 RESULTADO_INCIERTO`. Un reintento posterior conserva la misma pareja expediente/revisión, `idempotencia` y `huellaContenido`, por lo que el flujo debe reconocerlo sin reescribir.
- `huellaContenido` es SHA-256 hexadecimal sobre JSON canónico de `{estado normalizado, avance, reporteHtml}`. Las claves de objetos se ordenan recursivamente; los arreglos conservan su orden y la ausencia de reporte se representa como `null`.

## Cambio mínimo en `SWC - Guardar Radiografia`

No modificar todavía la concurrencia global del disparador: al ser un flujo combinado, ese ajuste afectaría consultas y guardados por igual y podría crear una cola nueva. La consistencia se obtiene con ETag/revisión, no serializando todas las empresas.

### Contrato común

1. Añadir `idempotencia` y `huellaContenido` al esquema como textos obligatorios para `guardar` y `verificar`. Validar `huellaContenido` con la expresión `^[0-9a-f]{64}$`. El Worker envía `EXPEDIENTE:REVISION` y calcula la huella después de normalizar y validar el estado.
2. Determinar la ruta únicamente con el `id` y la empresa autorizados por el Worker. Nunca aceptar una ruta o nombre de archivo libre desde el cliente.
3. Activar **Secure Inputs** y **Secure Outputs** donde aparezcan `estadoJson`, contenido del archivo o identificadores.
4. Mantener sin reintentos `Consultar Archivos SWC` y `Leer Contenido Archivo SWC`.
5. No usar `Do until`, reenvíos al propio flujo ni ramas que vuelvan a invocar `guardar`.

### Rama `consultar`

Conservar las operaciones actuales de listado y lectura por `identificador`. Responder solo con el expediente solicitado. No devolver códigos de acceso, URLs firmadas ni metadatos de otras empresas.

### Rama `guardar`: validación persistente y escritura condicional

1. Leer `estado.json`, su ETag actual y el contenido persistido antes de escribir.
2. El contenido persistido debe conservar `revision`, `idempotenciaUltima` y `huellaContenidoUltima` junto al estado existente. No eliminar ni reconstruir respuestas financieras.
3. Si `revision == revision solicitada`, comparar ambas marcas. Solo si `idempotenciaUltima == idempotencia` **y** `huellaContenidoUltima == huellaContenido`, responder `200 {"ok":true,"revision":N,"repetido":true}` sin escribir. Si coincide la idempotencia pero cambia la huella, responder `409 CONTENIDO_DIFERENTE`.
4. Si la revisión persistida no coincide con `revisionBase`, responder `409 REVISION_DESACTUALIZADA` sin modificar el archivo.
5. Escribir mediante una solicitud HTTP a SharePoint con `IF-MATCH` igual al ETag leído, nunca con `*`. En el mismo contenido guardar la nueva revisión, `idempotenciaUltima` y `huellaContenidoUltima`.
6. Si SharePoint devuelve `412 Precondition Failed`, releer una vez: responder `200` solo si coinciden idempotencia y huella; responder `409 CONTENIDO_DIFERENTE` si la idempotencia coincide pero la huella no; en cualquier otro caso responder `409 REVISION_DESACTUALIZADA`. No reintentar la escritura.
7. Mantener la acción de escritura con reintentos en **Ninguno**. Responder `200` solo después de confirmación de SharePoint.

Esta escritura condicional protege entre ejecuciones concurrentes, instancias distintas del Worker y respuestas tardías. Una lista auxiliar de operaciones puede servir para auditoría, pero no debe sustituir el ETag del propio expediente ni crear dos escrituras no atómicas.

### Creación inicial cuando no existe `estado.json`

No hacer primero «comprobar si existe» y después una creación ordinaria: dos ejecuciones podrían superar la comprobación. La creación debe ser atómica.

1. Permitir creación únicamente con `revisionBase == 0` y `revision == 1`, para un `id` y una carpeta autorizados.
2. Construir el archivo completo con `revision:1`, `idempotenciaUltima` y `huellaContenidoUltima`, sin alterar el estado normalizado recibido.
3. Usar **Enviar una solicitud HTTP a SharePoint** con `POST` a `.../Files/Add(url='estado.json',overwrite=false)`. `overwrite=false` es obligatorio; no usar `true`, `IF-MATCH:*`, «Crear o reemplazar» ni borrar previamente.
4. Si la creación responde éxito, devolver `200` después de leer/confirmar el archivo creado.
5. Si SharePoint informa que el archivo ya existe (`409`), releerlo una vez. Si revisión, idempotencia y huella coinciden, devolver `200 repetido:true`; si la misma revisión tiene otra huella, devolver `409 CONTENIDO_DIFERENTE`; en cualquier otro caso devolver `409 REVISION_DESACTUALIZADA`.
6. Mantener reintentos en **Ninguno** para la creación. Así, dos creaciones concurrentes producen exactamente un archivo y ninguna sobrescritura.
7. Para expedientes existentes que aún no tengan `idempotenciaUltima` o `huellaContenidoUltima`, no ejecutar una migración masiva. Incorporar ambas marcas únicamente en el siguiente guardado válido protegido por el ETag actual. La revisión existente sigue siendo la autoridad.

### Rama `verificar`

1. Recibir `id`, `empresa`, `revision`, `idempotencia` y `huellaContenido`; no escribir nada.
2. Leer el `estado.json` del expediente.
3. Si coinciden revisión, idempotencia y huella, responder `200 {"ok":true,"confirmado":true,"revision":N,"huellaContenido":"..."}`.
4. Si revisión e idempotencia coinciden pero la huella difiere, responder `409 CONTENIDO_DIFERENTE`. Si la revisión es mayor o pertenece a otra idempotencia, responder `409 REVISION_DESACTUALIZADA`.
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

`npm test` usa dobles de HTTP; no accede a Power Automate ni a SharePoint. Cubre 28 empresas aisladas, listado compartido, duplicados dentro de una instancia, repetición idéntica entre dos instancias, rechazo entre instancias de contenidos diferentes para la misma revisión, creación inicial condicional concurrente, timeout seguido de verificación, fallos sin reintento y rechazo de cruces de empresa.

Estas pruebas demuestran el comportamiento del código y el contrato esperado. **No prueban que el flujo real tenga ETag, idempotencia persistida, permisos correctos ni respuestas HTTP correctas.**

## Pruebas reales obligatorias antes de producción

Usar solo el expediente aislado, nunca una de las 28 empresas:

1. Consultar y confirmar que no hubo escritura.
2. Guardar un cambio controlado y confirmar exactamente una escritura, revisión `N+1`, `idempotenciaUltima` y `huellaContenidoUltima`.
3. Repetir el mismo payload y confirmar `200 repetido:true`, cero escrituras adicionales y huella idéntica.
4. Enviar dos contenidos distintos con la misma `revisionBase`; uno debe guardar y el otro responder `409`, o `412` convertido a `409`.
5. Forzar pérdida de respuesta después de la escritura; `verificar` debe confirmar el resultado sin segunda escritura.
6. Forzar timeout antes de escribir; `verificar` debe devolver `confirmado:false` y el reintento posterior debe producir una sola escritura.
7. Abrir el formulario cinco minutos sin cambios y confirmar cero ejecuciones adicionales.
8. En una carpeta aislada sin `estado.json`, lanzar dos creaciones idénticas simultáneas: ambas pueden responder 200, pero debe existir un solo archivo y una sola creación efectiva.
9. Repetir la creación concurrente con contenidos distintos para revisión 1: exactamente una debe persistir y la otra debe responder `409 CONTENIDO_DIFERENTE`.

## Reversión

1. Poner `SWC_MANTENIMIENTO=true`; no apagar ni borrar SharePoint.
2. Restaurar el Worker y el HTML desde `respaldo-antes-mantenimiento-2026-11-03`.
3. Restaurar la exportación del flujo combinado, conservando las dos acciones de consulta con reintentos en Ninguno.
4. No restaurar los 28 `estado.json` salvo decisión explícita basada en auditoría: la reversión normal es de código y flujo, no de datos.
5. Comparar revisiones y hashes de los expedientes antes de cualquier reapertura.
