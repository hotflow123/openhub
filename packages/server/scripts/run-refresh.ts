import { refreshCatalogMappings } from "../src/engine/catalog/refresh-mappings.js";

const result = await refreshCatalogMappings();
console.log(JSON.stringify(result, null, 2));
