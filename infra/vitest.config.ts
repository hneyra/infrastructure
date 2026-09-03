import { defineConfig } from "vitest/config";

// Las pruebas de esta carpeta no levantan Pulumi ni tocan un clúster: cubren las
// invariantes puras de `config.ts` y comprueban que las reglas de ESLint muerden.
// Son las que impiden que una configuración que contradice la documentación llegue
// a `pulumi up`.
export default defineConfig({
  test: {
    include: ["config.test.ts", "verificaciones/**/*.test.ts"],
    environment: "node",
  },
});
