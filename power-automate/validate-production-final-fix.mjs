import fs from "node:fs";
import path from "node:path";

const root = path.resolve("power-automate");
const asset = "0fdf623a-b849-4526-a0a9-da8465ca3e20";
const originalFile = path.join(root, "production-final-source-20261103", "Microsoft.Flow", "flows", asset, "definition.json");
const fixedFile = path.join(root, "build", "SWC-FLUJO-FINAL-PRODUCCION-CORREGIDO", "Microsoft.Flow", "flows", asset, "definition.json");
const original = JSON.parse(fs.readFileSync(originalFile, "utf8"));
const fixed = JSON.parse(fs.readFileSync(fixedFile, "utf8"));
const errors = [];
const actions = [];

function walk(group, scope = "root") {
  for (const [name, action] of Object.entries(group || {})) {
    actions.push({ name, action, scope });
    walk(action.actions, `${scope}/${name}:true`);
    walk(action.else?.actions, `${scope}/${name}:false`);
  }
}
walk(fixed.properties.definition.actions);
const map = new Map(actions.map(x => [x.name, x.action]));

if (fixed.name !== "ac504cb2-26b7-4ec9-b243-f7d0eae8b925") errors.push("Cambió el ID del flujo");
if (fixed.properties.definition.triggers.manual.type !== "Request") errors.push("Cambió el tipo de disparador");
if (JSON.stringify(fixed.properties.connectionReferences) !== JSON.stringify(original.properties.connectionReferences)) errors.push("Cambiaron las referencias de conexión");

for (const { name, action } of actions) {
  if (action.type === "OpenApiConnection") {
    if (action.inputs?.retryPolicy?.type !== "none") errors.push(`${name}: reintentos activos`);
    if (action.inputs?.parameters?.dataset !== "https://universidadeaneduco.sharepoint.com/sites/FaseFoundersHub") errors.push(`${name}: sitio SharePoint inesperado`);
  }
}

const text = JSON.stringify(fixed);
if (text.includes("SWC_Radiografia_HOTFIX_PRUEBAS")) errors.push("Queda una referencia a la biblioteca de pruebas");
if (text.includes("overwrite=true")) errors.push("Hay una creación con sobrescritura");
if (text.includes('"IF-MATCH":"*"')) errors.push("Hay actualización sin control ETag");

const expected = {
  Ruta_Archivo_Verificar: "SWC_Radiografia_JSON",
  Leer_Estado_Verificar: "GetFileByServerRelativePath",
  Crear_Carpeta_Aislada: "Folders/AddUsingPath",
  Crear_Estado_Sin_Sobrescribir: "Files/AddUsingPath"
};
for (const [name, needle] of Object.entries(expected)) {
  if (!JSON.stringify(map.get(name)).includes(needle)) errors.push(`${name}: falta ${needle}`);
}
if (!JSON.stringify(map.get("Crear_Estado_Sin_Sobrescribir")).includes("overwrite=false")) errors.push("La creación inicial puede sobrescribir");
if (!JSON.stringify(map.get("Actualizar_Con_ETag")).includes("IF-MATCH")) errors.push("La actualización no usa ETag");

function stripAllowed(doc) {
  const copy = structuredClone(doc);
  delete copy.properties.definition.metadata.clientLastModifiedTime;
  delete copy.properties.definition.metadata.modifiedSources;
  const changes = ["Ruta_Archivo_Verificar", "Leer_Estado_Verificar", "Crear_Carpeta_Aislada", "Crear_Estado_Sin_Sobrescribir"];
  const found = new Map();
  function remove(group) {
    for (const [name, action] of Object.entries(group || {})) {
      if (changes.includes(name)) { found.set(name, structuredClone(action)); group[name] = { __allowed_change__: name }; continue; }
      remove(action.actions); remove(action.else?.actions);
    }
  }
  remove(copy.properties.definition.actions);
  return { copy, found };
}
const before = stripAllowed(original);
const after = stripAllowed(fixed);
if (JSON.stringify(before.copy) !== JSON.stringify(after.copy)) errors.push("Se modificaron elementos fuera de las cuatro acciones autorizadas y metadatos de edición");

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(JSON.stringify({
  ok: true,
  flowId: fixed.name,
  actions: actions.length,
  changedActions: [...after.found.keys()],
  retryPolicies: "none",
  productionLibrary: "SWC_Radiografia_JSON"
}, null, 2));
