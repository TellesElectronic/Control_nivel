import { load, save, persistente } from './_store.js';

// ============================================================
// API DE MONITOREO DIDÁCTICO · UPT ARAGUA
// ============================================================
//
// FUNCIONES:
// 1. Recibir los estados enviados por el ESP32.
// 2. Recibir el modo que el ESP32 reporta estar ejecutando.
// 3. Guardar la última lectura y las últimas 200 muestras.
// 4. Entregar los datos a la interfaz web.
// 5. Retransmitir las solicitudes de control de la web.
//
// ESTA API NO CORRIGE LA PROGRAMACIÓN DEL ESTUDIANTE:
// - No apaga la bomba por nivel alto.
// - No bloquea la bomba por falta de agua.
// - No cambia la salida por el indicador de falla.
// - No sustituye el diagnóstico enviado por el ESP32.
//
// DIFERENCIA ENTRE MODOS:
//
// estado.modo:
//   Modo reportado por el ESP32: "auto", "manual" o null.
//
// control.modo:
//   Modo solicitado desde la web.
//
// Recibir modo=manual NO modifica automáticamente control.modo.
// Ambos valores se mantienen separados para fines didácticos.
// ============================================================


// ============================================================
// 1. CONVERSIÓN DE VALORES DIGITALES
// ============================================================

// Conserva la convención utilizada por la versión anterior:
// los valores reconocidos como activos se convierten a 1;
// los demás se convierten a 0.
const b = valor =>
  (
    valor === '1' ||
    valor === 'true' ||
    valor === 'on' ||
    valor === 1 ||
    valor === true
  ) ? 1 : 0;


// ============================================================
// 2. MANEJADOR PRINCIPAL
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const q = req.query;
    const s = await load();

    // --------------------------------------------------------
    // 3. IDENTIFICAR UNA SUBIDA DE DATOS
    // --------------------------------------------------------
    //
    // Ahora también se admite "modo" como dato de subida.
    //
    // Sin ninguno de estos campos, la petición solo consulta.
    // Los parámetros id, key y fmt no generan una lectura
    // por sí solos.
    // --------------------------------------------------------

    const esSubida = [
      'ls101',
      'lsh201',
      'lsl202',
      'bomba',
      'b',
      'fallo',
      'codigo',
      'nivel',
      'modo'
    ].some(campo => q[campo] !== undefined);

    // --------------------------------------------------------
    // 4. CONSULTA DE ESTADO E HISTORIAL
    // --------------------------------------------------------

    if (!esSubida) {
      return res.json({
        ...s,
        persistente
      });
    }

    // --------------------------------------------------------
    // 5. VALIDAR LA CLAVE DE SUBIDA
    // --------------------------------------------------------
    //
    // Solo se exige si existe API_KEY en el entorno de Vercel.
    // --------------------------------------------------------

    if (
      process.env.API_KEY &&
      q.key !== process.env.API_KEY
    ) {
      return res.status(401).json({
        ok: false,
        error: 'key inválida'
      });
    }

    const p = s.estado;

    // --------------------------------------------------------
    // 6. VALIDAR EL MODO REPORTADO POR EL ESP32
    // --------------------------------------------------------
    //
    // Valores aceptados:
    //   modo=auto
    //   modo=manual
    //
    // Si no llega el campo, se guarda null.
    // No se utiliza control.modo como sustituto, porque eso
    // confundiría una solicitud con un estado reportado.
    // --------------------------------------------------------

    let modoReportado = null;

    if (q.modo !== undefined) {
      if (Array.isArray(q.modo)) {
        return res.status(400).json({
          ok: false,
          error: 'modo debe enviarse una sola vez'
        });
      }

      modoReportado = String(q.modo).trim().toLowerCase();

      if (
        modoReportado !== 'auto' &&
        modoReportado !== 'manual'
      ) {
        return res.status(400).json({
          ok: false,
          error: 'modo debe ser auto o manual'
        });
      }
    }

    // --------------------------------------------------------
    // 7. VALIDAR EL CÓDIGO DE FALLA
    // --------------------------------------------------------
    //
    // Se aceptan enteros no negativos.
    // No se limita a 3, para permitir ampliar las prácticas.
    // --------------------------------------------------------

    let codigo = null;

    if (q.codigo !== undefined) {
      if (Array.isArray(q.codigo)) {
        return res.status(400).json({
          ok: false,
          error: 'codigo debe enviarse una sola vez'
        });
      }

      const textoCodigo = String(q.codigo).trim();
      const numeroCodigo = Number(textoCodigo);

      if (
        textoCodigo === '' ||
        !Number.isSafeInteger(numeroCodigo) ||
        numeroCodigo < 0
      ) {
        return res.status(400).json({
          ok: false,
          error: 'codigo debe ser un entero no negativo'
        });
      }

      codigo = numeroCodigo;
    }

    // --------------------------------------------------------
    // 8. VALIDAR EL NIVEL OPCIONAL
    // --------------------------------------------------------
    //
    // Si se envía, debe estar entre 0 y 100.
    // No se calcula a partir del tiempo de bomba encendida.
    // --------------------------------------------------------

    let nivel;

    if (q.nivel !== undefined) {
      if (Array.isArray(q.nivel)) {
        return res.status(400).json({
          ok: false,
          error: 'nivel debe enviarse una sola vez'
        });
      }

      const textoNivel = String(q.nivel).trim();
      const numeroNivel = Number(textoNivel);

      if (
        textoNivel === '' ||
        !Number.isFinite(numeroNivel) ||
        numeroNivel < 0 ||
        numeroNivel > 100
      ) {
        return res.status(400).json({
          ok: false,
          error: 'nivel debe ser un número entre 0 y 100'
        });
      }

      nivel = numeroNivel;
    }

    // --------------------------------------------------------
    // 9. CONSTRUIR EL ESTADO REPORTADO
    // --------------------------------------------------------
    //
    // Sensores y bomba:
    // conservan su último valor si no se envían.
    //
    // fallo, codigo y modo:
    // quedan en null si no se incluyen en esta petición.
    //
    // nivel:
    // solo se incluye si se envía en esta petición.
    //
    // RECOMENDACIÓN PARA LA PRÁCTICA:
    // enviar una muestra completa en cada GET.
    // --------------------------------------------------------

    const e = {
      ls101:
        q.ls101 !== undefined
          ? b(q.ls101)
          : p.ls101,

      lsh201:
        q.lsh201 !== undefined
          ? b(q.lsh201)
          : p.lsh201,

      lsl202:
        q.lsl202 !== undefined
          ? b(q.lsl202)
          : p.lsl202,

      // "b" se mantiene como alias de "bomba".
      bomba:
        q.bomba !== undefined
          ? b(q.bomba)
          : (
              q.b !== undefined
                ? b(q.b)
                : p.bomba
            ),

      // Indicador enviado por el programa del estudiante.
      fallo:
        q.fallo !== undefined
          ? b(q.fallo)
          : null,

      codigo,

      // Modo reportado, independiente del solicitado por la web.
      modo: modoReportado,

      // Fecha de recepción de esta petición.
      ts: new Date().toISOString(),

      dispositivo: String(q.id || 'ESP32')
    };

    if (nivel !== undefined) {
      e.nivel = nivel;
    }

    // --------------------------------------------------------
    // 10. CONSTRUIR EL REGISTRO HISTÓRICO
    // --------------------------------------------------------
    //
    // "m" ahora guarda el modo reportado por el ESP32.
    //
    // "modo_solicitado" conserva por separado la selección
    // de la web para poder comparar ambos valores.
    // --------------------------------------------------------

    const registro = {
      t: e.ts,
      dispositivo: e.dispositivo,

      b: e.bomba,
      ls: e.ls101,
      lsh: e.lsh201,
      lsl: e.lsl202,

      f: e.fallo,
      cod: e.codigo,

      m: e.modo,
      modo_solicitado: s.control.modo
    };

    if (nivel !== undefined) {
      registro.nivel = nivel;
    }

    // --------------------------------------------------------
    // 11. GUARDAR ESTADO E HISTORIAL
    // --------------------------------------------------------

    s.estado = e;

    if (!Array.isArray(s.historial)) {
      s.historial = [];
    }

    s.historial.push(registro);

    // Mantener las últimas 200 muestras.
    if (s.historial.length > 200) {
      s.historial = s.historial.slice(-200);
    }

    await save(s);

    // --------------------------------------------------------
    // 12. SELECCIONAR LA RESPUESTA PARA EL ESP32
    // --------------------------------------------------------
    //
    // Se mantiene la compatibilidad con el sketch existente.
    //
    // Si la web solicita manual:
    //   devolver la orden guardada en control.bomba.
    //
    // Si la web solicita automático:
    //   devolver la salida reportada por el ESP32.
    //
    // NO se usan sensores, fallas ni modoReportado para
    // corregir o bloquear esa respuesta.
    // --------------------------------------------------------

    const modoSolicitado = s.control.modo;

    const orden =
      modoSolicitado === 'manual'
        ? s.control.bomba
        : e.bomba;

    // --------------------------------------------------------
    // 13. RESPUESTA EN TEXTO
    // --------------------------------------------------------
    //
    // IMPORTANTE:
    // MODO representa el modo SOLICITADO DESDE LA WEB.
    // No es una confirmación del modo reportado por el ESP32.
    //
    // Se conserva exactamente el formato que usa el sketch:
    // BOMBA=1;MODO=manual
    // --------------------------------------------------------

    if (q.fmt === 'txt') {
      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      return res.send(
        `BOMBA=${orden};MODO=${modoSolicitado}`
      );
    }

    // --------------------------------------------------------
    // 14. RESPUESTA JSON
    // --------------------------------------------------------
    //
    // Se conservan "bomba" y "modo" por compatibilidad.
    // Se agregan nombres explícitos para distinguir:
    // - lo solicitado desde la web;
    // - lo reportado por el ESP32.
    // --------------------------------------------------------

    return res.json({
      ok: true,

      bomba: orden,
      bomba_reportada: e.bomba,

      modo: modoSolicitado,
      modo_solicitado: modoSolicitado,
      modo_reportado: e.modo,

      fallo: e.fallo,
      codigo: e.codigo
    });

  } catch (error) {
    console.error('Error en /api/data:', error);

    return res.status(500).json({
      ok: false,
      error: 'No se pudo completar la operación de datos'
    });
  }
}
