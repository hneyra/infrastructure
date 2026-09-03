import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Reglas de ESLint de `infra/`.
 *
 * Mismo criterio que en el frontend (FRO-04 §9): **toda prohibición que pueda
 * expresarse como verificación automática se expresa así.** Una prohibición que solo
 * vive en un documento se incumple en seis meses.
 *
 * Cada regla tiene su muestra que la viola en `verificaciones/muestras/`, y
 * `verificaciones/reglas-de-eslint.test.ts` exige que muerda: una regla que no puede
 * fallar no protege nada.
 *
 * Las dos últimas son las que sostienen la estructura. Sin ellas, un `config.require()`
 * dentro de un componente corre el fallo de «falta un valor» desde el arranque hasta la
 * mitad del despliegue, que es exactamente lo que `config.ts` existe para impedir.
 */

/** Tildes y eñe: prohibidas en identificadores (idioma del repositorio). */
const LETRAS_ACENTUADAS = "áéíóúÁÉÍÓÚñÑüÜ";

/** El único archivo que puede leer configuración. */
const LECTOR_DE_CONFIGURACION = ["config.ts"];

/** Prohibiciones que valen en todo el árbol. */
const EN_TODAS_PARTES = [
  {
    selector: `Identifier[name=/[${LETRAS_ACENTUADAS}]/]`,
    message: "Sin tildes ni enie en identificadores. El texto con tildes va en las cadenas.",
  },
  {
    // Una etiqueta móvil convierte cualquier reinicio de pod en una actualización no
    // planificada, y con un solo nodo eso ocurre en cada mantenimiento del VPS.
    selector: "Literal[value=/:(latest|main|stable)$/]",
    message:
      "Etiqueta de imagen movil. Fija la version: en un solo nodo, cada reinicio del VPS se convertiria en una actualizacion que nadie planifico (INF-01 §5).",
  },
];

/** Prohibiciones que valen en todas partes **menos** en `config.ts`. */
const FUERA_DEL_LECTOR = [
  {
    selector: "NewExpression[callee.property.name='Config']",
    message:
      "La configuracion se lee en config.ts, no aqui. Un valor que falta tiene que reventar al principio y con su nombre; leido dentro de un componente, el fallo se corre hasta la mitad del despliegue.",
  },
  {
    selector: "NewExpression[callee.name='Config']",
    message:
      "La configuracion se lee en config.ts, no aqui. Un valor que falta tiene que reventar al principio y con su nombre; leido dentro de un componente, el fallo se corre hasta la mitad del despliegue.",
  },
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      "Nada de process.env suelto: la configuracion entra por config.ts y se valida ahi. Una variable de entorno leida en un componente no aparece en `pulumi config` y nadie sabe que existe.",
  },
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/*.config.mjs",
      "**/*.config.ts",
      // Violan las reglas a propósito. Se lintan desde la prueba, no desde `yarn lint`.
      "verificaciones/muestras/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.es2022 },
    },
    rules: {
      // `any` prohibido: el tipado es la mitad del motivo de elegir TypeScript.
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": ["error", ...EN_TODAS_PARTES],
    },
  },

  {
    files: ["**/*.ts"],
    ignores: LECTOR_DE_CONFIGURACION,
    rules: {
      "no-restricted-syntax": ["error", ...EN_TODAS_PARTES, ...FUERA_DEL_LECTOR],
    },
  },

  {
    files: ["**/*.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
