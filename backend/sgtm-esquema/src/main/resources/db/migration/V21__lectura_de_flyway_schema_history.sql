-- ============================================================================
--  V21 — Lectura de flyway_schema_history (issue #158)
--
--  `sgtm_app` no leia esta tabla (V7 la dejo fuera a proposito: es libro de
--  Flyway, no una tabla de negocio). Pero el Job de implantacion espera al de
--  migracion consultandola con las credenciales de `sgtm_app` —el pod que
--  espera ya las tiene, y pedir una cuenta nueva solo para preguntar «¿ya
--  corrio la migracion?» es mas superficie que preguntarle a la base
--  directamente (ver el docstring de Migracion.ts en el repositorio de
--  infraestructura). Sin este GRANT, esa espera falla con «permission denied»
--  en cada intento, indefinidamente: no es que la migracion no haya corrido,
--  es que la consulta nunca pudo verlo. Encontrado reconstruyendo un cluster
--  real desde cero, no en revision.
-- ============================================================================

GRANT SELECT ON flyway_schema_history TO sgtm_app;
