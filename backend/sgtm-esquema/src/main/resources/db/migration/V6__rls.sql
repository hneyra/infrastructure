-- ============================================================================
--  V6 — Row Level Security (ARQ-03)
--
--  Toda tabla lleva RLS activa y forzada. Lo que varia es la politica, no su
--  existencia (RNF-031). La lista de tablas exentas es exactamente una,
--  flyway_schema_history, y la prueba de aislamiento lo verifica.
--
--  Este archivo no enumera las tablas de tenant a mano: las descubre por su
--  columna municipalidad_id NOT NULL. Una tabla nueva queda protegida sola; una
--  tabla nueva SIN esa columna queda fuera, y entonces la prueba de aislamiento
--  falla el build hasta que alguien la clasifique como catalogo o exenta.
-- ============================================================================

-- ---------- Tablas de tenant ----------
-- current_setting SIN segundo argumento, a proposito: una consulta sin contexto
-- fijado debe FALLAR, no devolver vacio ni devolver todo (RNF-032).
-- WITH CHECK ademas de USING: sin el, un INSERT puede plantar filas en otro
-- tenant aunque no pueda leerlas.
DO $tenant$
DECLARE
    t text;
BEGIN
    FOR t IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'municipalidad_id'
         WHERE n.nspname = current_schema()
           AND c.relkind IN ('r', 'p')
           AND NOT c.relispartition
           AND a.attnotnull
           AND NOT a.attisdropped
         ORDER BY 1
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I'
            ' USING      (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)'
            ' WITH CHECK (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)',
            t || '_tenant', t);
    END LOOP;
END
$tenant$;

-- ---------- Particiones ----------
-- Hallazgo verificado (DAT-01 §0, hallazgo 2): una particion no hereda
-- relrowsecurity del padre, y al consultarla directamente el filtro no se
-- aplica. Esta es la mitigacion 1 (defensa en profundidad); la que realmente
-- cierra el hueco es la de V7: la aplicacion no tiene ningun privilegio sobre
-- las particiones.
--
-- Toda particion nueva debe repetir este bloque. La prueba de aislamiento falla
-- el build si aparece una particion sin RLS o con privilegios concedidos.
DO $particiones$
DECLARE
    p text;
BEGIN
    FOR p IN
        SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema()
           AND c.relispartition
           AND c.relkind IN ('r', 'p')
         ORDER BY 1
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p);
        EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', p);
        EXECUTE format(
            'CREATE POLICY %I ON %I'
            ' USING      (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)'
            ' WITH CHECK (municipalidad_id = current_setting(''app.municipalidad_id'')::bigint)',
            p || '_tenant', p);
    END LOOP;
END
$particiones$;

-- ---------- Catalogo global: municipalidad ----------
-- No es tabla de tenant: es el registro de tenants. La aplicacion la lee entera
-- porque un proceso masivo itera municipalidad por municipalidad, y no la
-- escribe: dar de alta una municipalidad es una operacion de implantacion.
ALTER TABLE municipalidad ENABLE ROW LEVEL SECURITY;
ALTER TABLE municipalidad FORCE  ROW LEVEL SECURITY;

CREATE POLICY municipalidad_lectura ON municipalidad
    FOR SELECT USING (true);

CREATE POLICY municipalidad_escritura ON municipalidad
    FOR ALL TO sgtm_owner
    USING (true) WITH CHECK (true);

-- ---------- Catalogo nacional: parametro_tributario ----------
-- Excepcion admitida por ADR-0007, implementada por politica.
--
-- Aqui SI se usa la forma de dos argumentos de current_setting, al reves que en
-- las tablas de tenant. El motivo: los parametros de ambito nacional deben poder
-- leerse sin contexto de municipalidad (carga de catalogos, arranque). No hay
-- fuga posible porque sin contexto la comparacion da NULL y las filas locales
-- quedan invisibles; lo unico visible es lo que es nacional por definicion.
ALTER TABLE parametro_tributario ENABLE ROW LEVEL SECURITY;
ALTER TABLE parametro_tributario FORCE  ROW LEVEL SECURITY;

CREATE POLICY parametro_lectura ON parametro_tributario
    FOR SELECT USING (
        municipalidad_id IS NULL
        OR municipalidad_id = nullif(current_setting('app.municipalidad_id', true), '')::bigint
    );

CREATE POLICY parametro_escritura ON parametro_tributario
    FOR ALL TO rol_carga_parametros
    USING (true) WITH CHECK (true);
