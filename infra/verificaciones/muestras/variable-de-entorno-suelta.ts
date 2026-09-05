// Viola: `process.env` fuera de `config.ts`.
//
// Una variable de entorno leida aqui no aparece en `pulumi config`, no se puede
// previsualizar y no la ve nadie que revise el stack.
export function destinoDeRespaldo(): string {
  return process.env.KAMAYUK_BACKUP_ENDPOINT ?? "";
}
