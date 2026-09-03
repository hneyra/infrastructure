-- ============================================================================
--  V7 — Privilegios (ARQ-03 §3.5, §4)
--
--  Tres reglas gobiernan este archivo:
--
--  1. Los privilegios se conceden SOLO sobre las tablas padre. Nunca sobre una
--     particion. Es la mitigacion que cierra el hallazgo de las particiones, y
--     tiene una propiedad valiosa: es imposible olvidarla al crear una particion
--     nueva, porque una particion nueva no recibe privilegios salvo que alguien
--     se los conceda expresamente. Por eso NO se usa GRANT ... ON ALL TABLES IN
--     SCHEMA, que si las alcanzaria.
--
--  2. La aplicacion no borra nada (RNF-051). Se anula, se da de baja o se
--     reversa. Sacar a un usuario de un grupo o un giro de una licencia tambien
--     es dar de baja: por eso esas tablas llevan `activo`.
--
--  3. El libro de asientos y la auditoria ademas no se actualizan (ADR-0006,
--     ADR-0008): solo admiten SELECT e INSERT.
-- ============================================================================

-- ---------- Tablas de negocio: leer, insertar y actualizar ----------
GRANT SELECT, INSERT, UPDATE ON
    -- Parametros y catastro
    conjunto_parametros,
    conjunto_parametro_detalle,
    contribuyente,
    domicilio,
    contacto,
    via,
    sector,
    manzana,
    predio,
    ficha_catastral,
    construccion,
    otra_instalacion,
    titularidad,
    inquilino,
    arancel,
    valor_unitario_edificacion,
    depreciacion,
    -- Rentas
    vehiculo,
    valor_referencial_vehiculo,
    declaracion_jurada,
    beneficio,
    transferencia,
    espectaculo,
    determinacion,
    saldo_proyectado,
    -- Tesoreria
    area,
    tasa,
    caja,
    recibo,
    recibo_detalle,
    cierre_caja,
    convenio,
    convenio_cuota,
    -- Valores y coactiva
    valor,
    valor_detalle,
    notificacion,
    expediente_coactivo,
    expediente_valor,
    acto_coactivo,
    costa_procesal,
    -- Sanciones y fiscalizacion
    codigo_infraccion,
    notificacion_administrativa,
    papeleta,
    descargo,
    internamiento,
    programa_fiscalizacion,
    acta_fiscalizacion,
    -- Licencias
    ciiu,
    licencia_funcionamiento,
    licencia_giro,
    licencia_duplicado,
    licencia_edificacion,
    anuncio,
    -- Seguridad
    modulo_sistema,
    acceso,
    grupo,
    usuario,
    miembro,
    permiso,
    sesion
TO sgtm_app;

-- ---------- Tablas de solo agregar ----------
-- Libro de asientos: inmutable. Se asienta y se reversa con otro asiento
-- (ADR-0006); no se corrige en el sitio.
GRANT SELECT, INSERT ON cuenta_corriente_asiento TO sgtm_app;

-- Auditoria: quien puede modificarla puede borrar su propio rastro (ADR-0008).
GRANT SELECT, INSERT ON auditoria TO sgtm_app;

-- Traza del cambio de numero de papeleta: se agrega, no se edita.
GRANT SELECT, INSERT ON papeleta_cambio_numero TO sgtm_app;

-- ---------- Catalogos: la aplicacion solo lee ----------
GRANT SELECT ON municipalidad, parametro_tributario TO sgtm_app;

-- Carga de catalogos normativos, con su propio rol (SoD-1 de REQ-03).
GRANT SELECT, INSERT, UPDATE ON parametro_tributario TO rol_carga_parametros;

-- ---------- Replica de lectura y reportes ----------
GRANT SELECT ON
    municipalidad, parametro_tributario, conjunto_parametros, conjunto_parametro_detalle,
    contribuyente, domicilio, contacto, via, sector, manzana, predio, ficha_catastral,
    construccion, otra_instalacion, titularidad, inquilino, arancel,
    valor_unitario_edificacion, depreciacion,
    vehiculo, valor_referencial_vehiculo, declaracion_jurada, beneficio, transferencia,
    espectaculo, determinacion, cuenta_corriente_asiento, saldo_proyectado,
    area, tasa, caja, recibo, recibo_detalle, cierre_caja, convenio, convenio_cuota,
    valor, valor_detalle, notificacion, expediente_coactivo, expediente_valor,
    acto_coactivo, costa_procesal,
    codigo_infraccion, notificacion_administrativa, papeleta, papeleta_cambio_numero,
    descargo, internamiento, programa_fiscalizacion, acta_fiscalizacion,
    ciiu, licencia_funcionamiento, licencia_giro, licencia_duplicado, licencia_edificacion,
    anuncio,
    modulo_sistema, acceso, grupo, usuario, miembro, permiso, sesion, auditoria
TO sgtm_readonly;

-- ---------- Secuencias ----------
-- Las columnas IDENTITY necesitan USAGE sobre su secuencia para poder insertar.
-- Aqui si vale la forma amplia: una secuencia no contiene filas de nadie, y
-- olvidarla al agregar una tabla romperia toda insercion en ella.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO sgtm_app, rol_carga_parametros;
ALTER DEFAULT PRIVILEGES FOR ROLE sgtm_owner IN SCHEMA public
    GRANT USAGE ON SEQUENCES TO sgtm_app;

-- ---------- Constancia explicita ----------
-- Redundante con lo anterior —nunca se concedieron— pero explicito a proposito:
-- deja constancia de la intencion en el diff y protege de un GRANT amplio futuro.
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM sgtm_app, sgtm_readonly;
REVOKE UPDATE ON cuenta_corriente_asiento     FROM sgtm_app;
REVOKE UPDATE ON auditoria                    FROM sgtm_app;
REVOKE UPDATE ON papeleta_cambio_numero       FROM sgtm_app;
