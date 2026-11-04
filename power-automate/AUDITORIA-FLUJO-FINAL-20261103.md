# Auditoría del flujo `SWC - Radiografia - PRUEBAS HOTFIX Codex - FINAL`

Fuente auditada: `SWC,FLUJOFINAL_20261104011644.zip`  
Flujo: `ac504cb2-26b7-4ec9-b243-f7d0eae8b925`  
Formato: paquete clásico de exportación de un flujo independiente (`Microsoft.Flow/flows`), no una solución Dataverse.

## Resultado ejecutivo

La exportación ya contiene control de revisión, idempotencia, huella, actualización con ETag, respuestas HTTP y reintentos desactivados. El defecto está concentrado en cuatro acciones: dos de verificación y dos de creación. El paquete corregido conserva el resto de la definición byte a byte, salvo los metadatos de fecha/origen de edición.

No se importó ni ejecutó el flujo. No se leyeron ni modificaron los 28 expedientes.

## Hallazgos y correcciones

| Acción | Problema | Configuración exportada | Corrección | Justificación | Riesgo original |
|---|---|---|---|---|---|
| `Ruta_Archivo_Verificar` | No construía la ruta del expediente; contenía una consulta de listado. | `lists/getbytitle('SWC_Radiografia_JSON')/items...` | `concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', empresaSegura, '/estado.json')` | `verificar` debe leer un solo `estado.json`. | Crítico: verificación falsa o fallo permanente después de timeout. |
| `Leer_Estado_Verificar` | Listaba la biblioteca en lugar de leer el archivo calculado. | GET a `lists/getbytitle(...)/items` | GET `GetFileByServerRelativePath(...)/$value` | Permite comparar revisión, idempotencia y huella realmente persistidas. | Crítico: un resultado incierto no podía confirmarse. |
| `Crear_Carpeta_Aislada` | Ejecutaba un listado y nunca creaba la carpeta. | POST a `lists/getbytitle(...)/items?$select...` | POST `Folders/AddUsingPath(decodedUrl=...)` | Crea únicamente la carpeta de la empresa cuando la rama inicial está autorizada. | Alto: creación inicial imposible. |
| `Crear_Estado_Sin_Sobrescribir` | La URI era texto literal por falta de `@`; además se normalizó la sintaxis REST. | `concat(...)` sin prefijo de expresión | `@concat(.../Files/AddUsingPath(decodedUrl='estado.json',overwrite=false))` | La operación es atómica y no reemplaza archivos existentes. | Crítico: acción inválida o comportamiento distinto al esperado. |

## Controles conservados y verificados

- Biblioteca productiva única: `SWC_Radiografia_JSON`.
- Sitio único: `https://universidadeaneduco.sharepoint.com/sites/FaseFoundersHub`.
- Lectura individual restringida a rutas de producción terminadas en `/estado.json`.
- Actualización existente mediante `IF-MATCH` con el ETag leído y `X-HTTP-Method: PUT`.
- Creación con `overwrite=false`.
- Idempotencia mediante `idempotenciaUltima` y `huellaContenidoUltima`.
- Respuestas `200`, `400`, `403`, `409`, `502` y `503` existentes.
- Todas las acciones SharePoint conservan `retryPolicy.type = none`.
- No hay referencias a `SWC_Radiografia_HOTFIX_PRUEBAS`.
- No hay `overwrite=true` ni `IF-MATCH: *`.
- No hay cambios en el frontend, Worker, preguntas, fórmulas o códigos de acceso.

## Riesgos que solo puede cerrar una prueba real

La validación local no demuestra permisos de la conexión SharePoint, aceptación exacta de las URI por el tenant, conservación de la URL del disparador tras importar ni comportamiento real de ETag/404/409. Estos puntos requieren el expediente aislado descrito en el plan de pruebas.

Referencias técnicas: [archivos y carpetas con SharePoint REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-folders-and-files-with-rest) y [ETag/IF-MATCH en SharePoint REST](https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/working-with-lists-and-list-items-with-rest).
