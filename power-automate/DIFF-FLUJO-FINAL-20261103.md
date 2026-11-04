# Comparativo exacto del paquete corregido

Solo se modificaron las propiedades siguientes:

## `Ruta_Archivo_Verificar.inputs`

```diff
- _api/web/lists/getbytitle('SWC_Radiografia_JSON')/items?$select=FileLeafRef,FileRef,Modified,FSObjType&$top=5000
+ @concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro_Verificar'), '/estado.json')
```

## `Leer_Estado_Verificar.inputs.parameters`

```diff
- parameters/uri: _api/web/lists/getbytitle('SWC_Radiografia_JSON')/items?$select=FileLeafRef,FileRef,Modified,FSObjType&$top=5000
+ parameters/uri: @concat('_api/web/GetFileByServerRelativePath(decodedUrl=''', replace(outputs('Ruta_Archivo_Verificar'), '''', ''''''), ''')/$value')
  parameters/method: GET
  parameters/headers.Accept: application/json
  retryPolicy.type: none
```

## `Crear_Carpeta_Aislada.inputs.parameters`

```diff
- parameters/uri: _api/web/lists/getbytitle('SWC_Radiografia_JSON')/items?$select=FileLeafRef,FileRef,Modified,FSObjType&$top=5000
+ parameters/uri: @concat('_api/web/Folders/AddUsingPath(decodedUrl=''', replace(concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro')), '''', ''''''), ''')')
  parameters/method: POST
  parameters/body: ""
  retryPolicy.type: none
```

## `Crear_Estado_Sin_Sobrescribir.inputs.parameters`

```diff
- parameters/uri: concat(...GetFolderByServerRelativePath...Files/AddUsingPath...)
+ parameters/uri: @concat('_api/web/GetFolderByServerRelativePath(decodedUrl=''', replace(concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro')), '''', ''''''), ''')/Files/AddUsingPath(decodedUrl=''estado.json'',overwrite=false)')
  parameters/method: POST
  parameters/body: @string(outputs('Construir_Expediente'))
  retryPolicy.type: none
```

También se actualizaron únicamente `metadata.clientLastModifiedTime` y `metadata.modifiedSources`. El validador compara el resto del documento y falla si detecta cualquier cambio adicional.
