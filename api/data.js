import { load, save, persistente } from './_store.js';

// ============================================================
// API DE MONITOREO DIDÁCTICO · UPT ARAGUA
// ============================================================
//
// FUNCIONES:
// 1. Recibir estados enviados por el ESP32.
// 2. Guardar la última lectura y su historial.
// 3. Permitir que la web consulte esa información.
// 4. Retransmitir la orden manual configurada.
//
// ESTA API NO DEBE:
// - Apagar la bomba por nivel alto.
// - Bloquear la bomba por falta de agua.
// - Cambiar la salida por el indicador de falla.
// - Corregir automáticamente la programación del estudiante.
//
// Las advertencias se muestran en la web.
// El programa del ESP32 es el responsable de su salida.
// ============================================================


// Convierte los valores digitales recibidos a números 0 o 1.
const b = valor =>
  (
    valor === '1' ||
    valor === 'true' ||
    valor === 'on' ||
    valor === 1 ||
    valor === true
  ) ? 1 : 0;


// ============================================================
// MANEJADOR PRINCIPAL
// ============================================================

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  try {
    const q = req.query;
    const s = await load();

    // --------------------------------------------------------
    // 1. IDENTIFICAR UNA SUBIDA DE DATOS
    // --------------------------------------------------------
    //
    // Se considera subida si llega alguno de estos campos.
    // También se admite actualizar solo bomba, fallo o codigo.
    //
    // Una consulta sin estos parámetros únicamente lee datos.
    // --------------------------------------------------------

    const esSubida = [
      'ls101',
      'lsh201',
      'lsl202',
      'bomba',
      'b',
      'fallo',
      'codigo',
      'nivel'
    ].some(campo => q[campo] !== undefined);

    // --------------------------------------------------------
    // 2. CONSULTA DE ESTADO E HISTORIAL
    // --------------------------------------------------------

    if (!esSubida) {
      return res.json({
        ...s,
        persistente
      });
    }

    // --------------------------------------------------------
    // 3. VALIDACIÓN DE CLAVE PARA SUBIDAS
    // --------------------------------------------------------
    //
    // Si API_KEY no está configurada, no se exige una clave.
    // --------------------------------------------------------

    if (
      process.env.API_KEY &&
      q.key !== process.env.API_KEY
    ) {
      return res.status(401).json({
        error: 'key inválida'
      });
    }

    // Último estado disponible.
    const p = s.estado;

    // --------------------------------------------------------
    // 4. VALIDAR EL CÓDIGO DE FALLA
    // --------------------------------------------------------
    //
    // Se aceptan enteros no negativos.
    // No se limita a 3, para permitir nuevos códigos didácticos.
    // Si no se envía, queda en null.
    // --------------------------------------------------------

    let codigo = null;

    if (q.codigo !== undefined) {
      const textoCodigo = String(q.codigo).trim();
      const numeroCodigo = Number(textoCodigo);

      if (
        textoCodigo === '' ||
        !Number.isSafeInteger(numeroCodigo) ||
        numeroCodigo < 0
      ) {
        return res.status(400).json({
          error: 'codigo debe ser un entero no negativo'
        });
      }

      codigo = numeroCodigo;
    }

    // --------------------------------------------------------
    // 5. VALIDAR EL NIVEL OPCIONAL
    // --------------------------------------------------------

    let nivel;

    if (q.nivel !== undefined) {
      const textoNivel = String(q.nivel).trim();
      const numeroNivel = Number(textoNivel);

      if (
        textoNivel === '' ||
        !Number.isFinite(numeroNivel) ||
        numeroNivel < 0 ||
        numeroNivel > 100
      ) {
        return res.status(400).json({
          error: 'nivel debe ser un número entre 0 y 100'
        });
      }

      nivel = numeroNivel;
    }

    // --------------------------------------------------------
    // 6. CONSTRUIR EL ESTADO REPORTADO
    // --------------------------------------------------------
    //
    // Los sensores o la bomba no enviados conservan su valor.
    //
    // fallo y codigo quedan en null si no se envían:
    // así no se presenta como actual un diagnóstico anterior.
    //
    // Para una muestra completa y coherente, el ESP32 debe
    // enviar todos los campos en cada petición.
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

      // "b" se conserva como alias de "bomba".
      bomba:
        q.bomba !== undefined
          ? b(q.bomba)
          : (
              q.b !== undefined
                ? b(q.b)
                : p.bomba
            ),

      // Diagnóstico calculado y enviado por el ESP32.
      fallo:
        q.fallo !== undefined
          ? b(q.fallo)
          : null,

      codigo,

      // Fecha de recepción en el servidor.
      ts: new Date().toISOString(),

      dispositivo: String(q.id || 'ESP32')
    };

    if (nivel !== undefined) {
      e.nivel = nivel;
    }

    // --------------------------------------------------------
    // 7. GUARDAR LA LECTURA EN EL HISTORIAL
    // --------------------------------------------------------

    s.estado = e;

    if (!Array.isArray(s.historial)) {
      s.historial = [];
    }

    s.historial.push({
      t: e.ts,
      dispositivo: e.dispositivo,
      b: e.bomba,
      ls: e.ls101,
      lsh: e.lsh201,
      lsl: e.lsl202,
      f: e.fallo,
      cod: e.codigo,
      m: s.control.modo
    });

    // Conservar solamente las últimas 200 lecturas.
    if (s.historial.length > 200) {
      s.historial = s.historial.slice(-200);
    }

    await save(s);

    // --------------------------------------------------------
    // 8. SELECCIONAR LA RESPUESTA PARA EL ESP32
    // --------------------------------------------------------
    //
    // MANUAL:
    // Retransmitir la solicitud guardada en s.control.bomba.
    //
    // AUTOMÁTICO:
    // Devolver la salida que el propio ESP32 reportó.
    // En este modo no es una nueva decisión de control.
    //
    // No evaluar sensores ni fallas para alterar esta respuesta.
    // --------------------------------------------------------

    const orden =
      s.control.modo === 'manual'
        ? s.control.bomba
        : e.bomba;

    // --------------------------------------------------------
    // 9. RESPUESTA EN TEXTO PARA EL SKETCH EXISTENTE
    // --------------------------------------------------------

    if (q.fmt === 'txt') {
      res.setHeader(
        'Content-Type',
        'text/plain; charset=utf-8'
      );

      return res.send(
        `BOMBA=${orden};MODO=${s.control.modo}`
      );
    }

    // --------------------------------------------------------
    // 10. RESPUESTA JSON
    // --------------------------------------------------------
    //
    // bomba:
    // Valor devuelto al ESP32 según el modo.
    //
    // bomba_reportada:
    // Salida que llegó en esta lectura.
    //
    // Ambos pueden ser distintos en modo manual mientras
    // el dispositivo todavía no aplica o reporta la solicitud.
    // --------------------------------------------------------

    return res.json({
      ok: true,
      bomba: orden,
      bomba_reportada: e.bomba,
      modo: s.control.modo,
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
