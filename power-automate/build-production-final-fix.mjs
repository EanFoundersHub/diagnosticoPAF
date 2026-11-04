import fs from "node:fs";
import path from "node:path";

const root = path.resolve("power-automate");
const source = path.join(root, "production-final-source-20261103");
const output = path.join(root, "build", "SWC-FLUJO-FINAL-PRODUCCION-CORREGIDO");
const asset = "0fdf623a-b849-4526-a0a9-da8465ca3e20";
const definitionPath = path.join(output, "Microsoft.Flow", "flows", asset, "definition.json");

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.cpSync(source, output, { recursive: true });

const doc = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
const byName = new Map();
function visit(actions, scope = "root") {
  for (const [name, action] of Object.entries(actions || {})) {
    if (byName.has(name)) throw new Error(`Acción duplicada: ${name}`);
    byName.set(name, { action, scope });
    visit(action.actions, `${scope}/${name}:true`);
    visit(action.else?.actions, `${scope}/${name}:false`);
  }
}
visit(doc.properties.definition.actions);

function action(name) {
  const found = byName.get(name);
  if (!found) throw new Error(`No existe la acción ${name}`);
  return found.action;
}

action("Ruta_Archivo_Verificar").inputs = "@concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro_Verificar'), '/estado.json')";

const leerVerificar = action("Leer_Estado_Verificar");
leerVerificar.inputs.parameters["parameters/method"] = "GET";
leerVerificar.inputs.parameters["parameters/uri"] = "@concat('_api/web/GetFileByServerRelativePath(decodedUrl=''', replace(outputs('Ruta_Archivo_Verificar'), '''', ''''''), ''')/$value')";
leerVerificar.inputs.parameters["parameters/headers"] = { Accept: "application/json" };
delete leerVerificar.inputs.parameters["parameters/body"];
leerVerificar.inputs.retryPolicy = { type: "none" };
delete leerVerificar.retryPolicy;

const crearCarpeta = action("Crear_Carpeta_Aislada");
crearCarpeta.inputs.parameters["parameters/method"] = "POST";
crearCarpeta.inputs.parameters["parameters/uri"] = "@concat('_api/web/Folders/AddUsingPath(decodedUrl=''', replace(concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro')), '''', ''''''), ''')')";
crearCarpeta.inputs.parameters["parameters/headers"] = { Accept: "application/json;odata=nometadata" };
crearCarpeta.inputs.parameters["parameters/body"] = "";
crearCarpeta.inputs.retryPolicy = { type: "none" };
delete crearCarpeta.retryPolicy;

const crearEstado = action("Crear_Estado_Sin_Sobrescribir");
crearEstado.inputs.parameters["parameters/method"] = "POST";
crearEstado.inputs.parameters["parameters/uri"] = "@concat('_api/web/GetFolderByServerRelativePath(decodedUrl=''', replace(concat('/sites/FaseFoundersHub/SWC_Radiografia_JSON/', outputs('Nombre_Empresa_Seguro')), '''', ''''''), ''')/Files/AddUsingPath(decodedUrl=''estado.json'',overwrite=false)')";
crearEstado.inputs.parameters["parameters/headers"] = { "Content-Type": "application/json; charset=utf-8", Accept: "application/json;odata=nometadata" };
crearEstado.inputs.parameters["parameters/body"] = "@string(outputs('Construir_Expediente'))";
crearEstado.inputs.retryPolicy = { type: "none" };
delete crearEstado.retryPolicy;

doc.properties.definition.metadata.clientLastModifiedTime = new Date().toISOString();
doc.properties.definition.metadata.modifiedSources = "Import";
fs.writeFileSync(definitionPath, JSON.stringify(doc));
console.log(definitionPath);
