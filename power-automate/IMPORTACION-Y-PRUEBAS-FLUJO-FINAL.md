# Importación, prueba controlada y reversión

## Importación como actualización

El ZIP es un paquete clásico de flujo independiente. Debe importarse desde **Power Automate → Mis flujos → Importar → Importar paquete (heredado)**.

1. Mantener producción en mantenimiento y conservar una exportación del flujo actual.
2. Cargar `SWC-FLUJO-FINAL-PRODUCCION-CORREGIDO-VALIDADO.zip` (SHA-256 `A8E2AF3149C4990F75E91D01B47C8F0B0691FDD577DD90F831568300744CA259`).
3. En el recurso del flujo elegir **Actualizar**, nunca **Crear como nuevo**.
4. Seleccionar explícitamente el flujo existente `SWC - Radiografia - PRUEBAS HOTFIX Codex - FINAL`, ID `ac504cb2-26b7-4ec9-b243-f7d0eae8b925`.
5. Mapear `shared_sharepointonline-1` a la conexión existente `foundershub@universidadean.edu.co`. No crear otra conexión ni cambiar credenciales.
6. Importar sin activar ejecuciones de prueba sobre empresas reales.

### Advertencia sobre el desencadenador HTTP

Aunque el paquete conserva el mismo ID y está marcado como `Update`, se debe copiar la URL HTTP antes de importar y compararla después. Si cambia, **no modificar Cloudflare todavía**: mantener mantenimiento y solicitar autorización antes de actualizar `SWC_FLUJO_URL`.

## Pruebas reales obligatorias

Usar exclusivamente un expediente aislado autorizado para pruebas. Registrar ID de ejecución, código HTTP, ETag, revisión y hash del archivo antes/después.

1. `consultar` lista: debe devolver únicamente elementos de `SWC_Radiografia_JSON` y no escribir.
2. `consultar` archivo: leer el expediente aislado; una ruta fuera de producción debe devolver `403`.
3. `verificar` existente: misma revisión/idempotencia/huella devuelve confirmado; huella distinta devuelve `409`.
4. `guardar` con revisión correcta: una sola escritura y revisión `N+1`.
5. Repetir el payload idéntico: `200`, sin nueva escritura ni cambio de ETag.
6. Misma revisión con contenido diferente: `409 CONTENIDO_DIFERENTE`.
7. Revisión base obsoleta: `409 REVISION_DESACTUALIZADA`.
8. Cambio concurrente de ETag: la actualización debe fallar, releer y devolver éxito idempotente o `409`, nunca sobrescribir.
9. Creación inicial en una carpeta aislada inexistente: crea un solo `estado.json` con revisión 1.
10. Repetir creación: no reemplaza el archivo; contenido idéntico es idempotente y distinto devuelve `409`.
11. Simular 404 diferente al archivo inexistente y 5xx de SharePoint: no debe crear ni responder éxito.
12. Mantener el formulario abierto cinco minutos sin cambios: cero ejecuciones periódicas.

No declarar recuperado el servicio hasta completar lectura y escritura reales sobre el expediente aislado.

## Reversión

1. Mantener Cloudflare/Pages en mantenimiento.
2. Reimportar la exportación previa seleccionando **Actualizar** sobre el mismo flujo.
3. Mapear la misma conexión SharePoint.
4. Confirmar que el disparador HTTP conserva la URL previa.
5. No restaurar, reemplazar ni borrar ningún `estado.json` como parte de la reversión.
