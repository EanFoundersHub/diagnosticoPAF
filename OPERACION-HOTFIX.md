# Hotfix operativo: formulario, Worker y Power Automate

## Archivos definitivos preparados

- `vivo.html`: formulario en línea. Consulta una vez al abrir; vuelve a consultar únicamente al resolver un conflicto de revisión o cuando la persona solicita transferir el control.
- `worker/swc-radiografia-worker-hotfix.js`: Worker con validación por empresa, timeout, consulta compartida, coalescencia de duplicados e idempotencia por expediente/revisión.
- `tests/worker-load.test.js`: simulación automatizada de 28 empresas, duplicados, concurrencia y fallos.

No se cambió el banco de preguntas, el motor financiero, las fórmulas, los datos precargados ni los códigos de acceso. Este cambio no despliega ni reactiva componentes.

## Hallazgos de saturación

1. La versión anterior consultaba SharePoint cada 15 segundos por sesión abierta. Con 28 empresas abiertas, eran hasta 112 consultas por minuto antes de contar lecturas de archivo.
2. La renovación de sesión modificaba `_session` y provocaba guardados aunque no hubiera respuestas nuevas.
3. Cada consulta hacía listado global y luego lectura del archivo. El hotfix comparte el listado durante 30 segundos y agrupa consultas simultáneas del mismo expediente.
4. Los fallos podían encadenar sincronizaciones inmediatas y temporizadas. El cliente definitivo hace como máximo dos reintentos automáticos, separados por 2 y 4 minutos, y después conserva el borrador local.
5. Dos solicitudes iguales podían llegar juntas al flujo. El Worker ahora envía una sola; solicitudes distintas para la misma revisión reciben `409`.
6. Las llamadas del Worker no tenían límite de tiempo. Ahora se abortan a los 12 segundos y no se reintentan en el Worker.

Los intervalos de 5 segundos que permanecen en el navegador son exclusivamente un `lease` de `localStorage` entre pestañas. No hacen solicitudes de red.

## Cambios obligatorios en Power Automate

### Flujo de consulta

1. Mantener el disparador HTTP y las dos operaciones actuales: listado y lectura por `identificador`.
2. En **Configuración** del disparador, activar control de concurrencia con grado `4` (no `1`, para mantener disponibles las 28 empresas).
3. En cada acción de SharePoint, fijar la política de reintento en **Exponencial**, máximo `2` reintentos, intervalo inicial `PT5S`, intervalo máximo `PT20S`.
4. La operación de lectura por identificador debe devolver únicamente el archivo solicitado. No incluir códigos de acceso, URLs de flujo ni archivos de otras empresas en la respuesta.
5. Conservar respuestas HTTP explícitas: `200`, `404` si no existe, `429` si SharePoint limita y `5xx` para fallos transitorios.

### Flujo de autoguardado

1. Agregar `idempotencia` al esquema JSON del disparador como texto obligatorio. Su valor llega como `EXPEDIENTE:REVISION`.
2. Activar control de concurrencia del disparador con grado `1`. Esto serializa la comparación y escritura y evita que dos ejecuciones validen la misma revisión a la vez.
3. Antes de escribir, localizar el `estado.json` **por el `id` autorizado**, no por un nombre recibido libremente. Validar también que la carpeta corresponda a `empresa`.
4. Leer la revisión actual del archivo. Solo continuar si `revisionBase` es exactamente la revisión almacenada.
5. Si la revisión almacenada ya es `revision` y la `idempotencia` coincide, responder `200 {"ok":true}` sin volver a escribir. Es el caso de una respuesta perdida después de un guardado correcto.
6. Si `revisionBase` no coincide, responder `409 {"ok":false,"codigo":"REVISION_DESACTUALIZADA"}` sin crear ni modificar archivos.
7. Escribir el nuevo contenido y la nueva revisión en una única rama secuencial. Confirmar la escritura antes de responder `200 {"ok":true}`.
8. Desactivar reintentos en la acción de escritura de SharePoint (`None`). La idempotencia se resuelve explícitamente; un reintento oculto no debe repetir escrituras.
9. Configurar tiempo de espera del flujo en `PT10S`. En error o timeout, responder `503`; no usar bucles `Do until`.
10. No registrar `estadoJson`, códigos de acceso o URLs firmadas en nombres de acciones, Compose, historial personalizado, correos o trazas. Activar **Secure Inputs** y **Secure Outputs** en disparador, lectura y escritura.

## Secuencia de despliegue manual (requiere autorización)

1. Exportar y guardar una copia de ambos flujos de Power Automate.
2. Aplicar primero los cambios del flujo de autoguardado y probar con un expediente aislado.
3. Aplicar el flujo de consulta y probar una lectura por identificador.
4. Publicar `worker/swc-radiografia-worker-hotfix.js` con `SWC_MANTENIMIENTO=true`; verificar `/` y CORS sin invocar los flujos.
5. Publicar `vivo.html` como `index.html` en GitHub Pages.
6. Poner `SWC_MANTENIMIENTO=false` y realizar una consulta y un guardado con el expediente aislado.
7. Verificar historial: una apertura debe producir una consulta de listado y una lectura; cinco minutos sin cambios deben producir cero ejecuciones adicionales.
8. Solo después habilitar el acceso de las 28 empresas.

## Reversión

1. Poner `SWC_MANTENIMIENTO=true` en el Worker. Esto corta nuevas llamadas sin borrar datos.
2. Restaurar el Worker y `index.html` desde la rama `respaldo-antes-mantenimiento-2026-11-03`.
3. Importar las copias exportadas de los flujos y mantenerlos apagados mientras se verifica el incidente.
4. No restaurar ni sobrescribir archivos `estado.json`: la reversión es de código y flujos, no de datos.
5. Para reanudar, validar primero el expediente aislado y retirar mantenimiento únicamente con autorización.
