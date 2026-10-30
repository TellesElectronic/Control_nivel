// ============================================================
// MONITOREO DIDÁCTICO DE TANQUE AÉREO · UPT ARAGUA
// ============================================================
//
// OBJETIVO:
// - Representar los estados enviados por el ESP32.
// - Mostrar advertencias para que el estudiante revise su programa.
// - No corregir automáticamente una salida incorrecta.
// - No bloquear órdenes manuales por sensores o indicador de falla.
//
// CONVENCIÓN:
// ls101  = 1: agua disponible en tanque subterráneo.
// lsh201 = 1: agua presente en sensor superior del tanque aéreo.
// lsl202 = 1: agua presente en sensor inferior del tanque aéreo.
// bomba  = 1: el ESP32 reporta su salida de bomba encendida.
// fallo  = 1: el ESP32 reporta una condición de falla.
//
// IMPORTANTE:
// "bomba" representa una salida reportada, no una confirmación
// física de funcionamiento del motor.
//
// El nivel dibujado es ilustrativo. No es un porcentaje medido.
// ============================================================


// ============================================================
// 1. VARIABLES GENERALES
// ============================================================

// Acceso abreviado a los elementos del HTML.
const $ = id => document.getElementById(id);

// Última respuesta válida recibida de la API.
let S = null;

// Indica si la última consulta de datos terminó correctamente.
let apiOK = false;

// Altura ilustrativa del agua del tanque aéreo: 0 a 100.
let est = 0;

// Evitan solicitudes duplicadas del mismo tipo.
let consultando = false;
let enviandoControl = false;

// Objeto de la gráfica, si Chart.js está disponible.
let chart = null;

// Frecuencia de consulta y actualización visual.
const INTERVALO_CONSULTA_MS = 3000;
const INTERVALO_ANIMACION_MS = 700;

// Solo genera advertencias de antigüedad.
// NO bloquea botones ni detiene la representación.
const MAX_EDAD_SEGUNDOS = 60;


// ============================================================
// 2. FUNCIONES AUXILIARES
// ============================================================

// Los campos de sensores y bomba deben llegar como números 0/1.
// Esta función también admite booleanos y cadenas habituales.
function esActivo(valor) {
  return (
    valor === 1 ||
    valor === true ||
    valor === '1' ||
    valor === 'true' ||
    valor === 'on'
  );
}

// Clasifica el indicador de falla.
// null significa que no llegó un valor reconocido.
function estadoFallo(valor) {
  if (
    valor === 1 ||
    valor === true ||
    valor === '1' ||
    valor === 'true'
  ) {
    return 1;
  }

  if (
    valor === 0 ||
    valor === false ||
    valor === '0' ||
    valor === 'false'
  ) {
    return 0;
  }

  return null;
}

// Calcula la antigüedad de la última lectura.
function edadLectura(estado) {
  if (!estado?.ts) return Infinity;

  const fecha = new Date(estado.ts).getTime();

  if (!Number.isFinite(fecha)) return Infinity;

  return Math.max(0, (Date.now() - fecha) / 1000);
}

// Convierte una fecha del servidor a la hora local del navegador.
function horaLocal(fecha) {
  if (!fecha) return 'sin datos';

  const objetoFecha = new Date(fecha);

  if (!Number.isFinite(objetoFecha.getTime())) {
    return 'fecha inválida';
  }

  return objetoFecha.toLocaleTimeString('es-VE');
}

// Etiqueta del nivel ilustrativo.
function nivelLabel(valor) {
  if (valor >= 98) return 'Lleno';
  if (valor >= 70) return 'Alto';
  if (valor >= 40) return 'Medio';
  if (valor > 2) return 'Bajo';

  return 'Vacío';
}


// ============================================================
// 3. INICIALIZACIÓN DE LA GRÁFICA
// ============================================================

// Si falla la gráfica, no se interrumpe el resto del panel.
function iniciarGrafica() {
  if (typeof Chart === 'undefined' || !$('ch')) {
    console.warn(
      'Gráfica no disponible. Revisar Chart.js y el elemento #ch.'
    );

    return;
  }

  try {
    chart = new Chart($('ch'), {
      type: 'line',

      data: {
        labels: [],

        datasets: [
          {
            label: 'Bomba',
            data: [],
            borderColor: '#c8303a',
            stepped: true,
            pointRadius: 0
          },
          {
            label: 'LS-101',
            data: [],
            borderColor: '#1a9b55',
            stepped: true,
            pointRadius: 0
          },
          {
            label: 'LSH-201',
            data: [],
            borderColor: '#e08b00',
            stepped: true,
            pointRadius: 0
          },
          {
            label: 'LSL-202',
            data: [],
            borderColor: '#123a8c',
            stepped: true,
            pointRadius: 0
          }
        ]
      },

      options: {
        maintainAspectRatio: false,
        animation: false,

        scales: {
          y: {
            min: 0,
            max: 1.2,

            ticks: {
              stepSize: 1,

              // Correspondencia correcta de estados digitales.
              callback: valor =>
                valor === 0 ? 'OFF' :
                valor === 1 ? 'ON' : ''
            }
          }
        }
      }
    });
  } catch (error) {
    chart = null;
    console.error('No se pudo iniciar la gráfica:', error);
  }
}


// ============================================================
// 4. INFORMACIÓN OPCIONAL DE LA API
// ============================================================

// Este elemento es opcional: el HTML puede no incluirlo.
const ep = $('ep');

if (ep) {
  ep.textContent =
`SUBIDA DE ESTADO DESDE EL ESP32:
GET ${location.origin}/api/data?ls101=1&lsh201=0&lsl202=1&bomba=1&fallo=0&codigo=0&id=ESP32-01&fmt=txt

SOLICITUD DE CONTROL MANUAL:
GET ${location.origin}/api/control?modo=manual&bomba=1

CONSULTA DE ESTADO E HISTORIAL:
GET ${location.origin}/api/data

VACIAR HISTORIAL:
GET ${location.origin}/api/reset`;
}


// ============================================================
// 5. INDICADOR DE COMUNICACIÓN
// ============================================================

function conn(texto, clase) {
  if ($('connTxt')) {
    $('connTxt').textContent = texto;
  }

  if ($('dot')) {
    $('dot').className = `dot ${clase}`;
  }
}

function actualizarConexion() {
  if (!apiOK) {
    conn('Sin actualización de datos', 'bad');
    return;
  }

  if (!S?.estado?.ts) {
    conn('Esperando lecturas del ESP32', '');
    return;
  }

  const reciente =
    edadLectura(S.estado) < MAX_EDAD_SEGUNDOS;

  conn(
    reciente
      ? 'Lectura reciente recibida'
      : 'Mostrando última lectura recibida',
    reciente ? 'ok' : ''
  );
}


// ============================================================
// 6. BOTONES
// ============================================================
//
// Los sensores, las fallas y la antigüedad de la lectura
// NO bloquean los botones.
//
// Se conserva únicamente la selección de modo:
// las órdenes de encendido/apagado se solicitan en manual.
// ============================================================

function actualizarBotones() {
  // Utilizar el modo que el ESP32 reporta estar ejecutando,
  // no la selección pendiente guardada en control.modo.
  const manual = S?.estado?.modo === 'manual';

  // No bloquear por sensores, fallas ni antigüedad.
  if ($('on')) {
    $('on').disabled =
      enviandoControl ||
      !manual;
  }

  if ($('off')) {
    $('off').disabled =
      enviandoControl ||
      !manual;
  }

  // Permitir solicitar un cambio de modo.
  document.querySelectorAll('.seg button').forEach(boton => {
    boton.disabled = enviandoControl;
  });
}

// ============================================================
// 7. REPRESENTACIÓN DE BOMBA Y FLUJO
// ============================================================
//
// Se utiliza SOLO el último estado de "bomba".
// No se detiene la animación por:
// - tanque lleno;
// - falta de agua;
// - indicador de falla;
// - lectura antigua;
// - error posterior de comunicación.
//
// Esas condiciones se muestran como advertencias separadas.
// ============================================================

function renderActuadores(estado) {
  const encendida = esActivo(estado.bomba);

  if ($('flow')) {
    $('flow').classList.toggle('on', encendida);
  }

  if ($('rotor')) {
    $('rotor').classList.toggle('on', encendida);
  }

  if ($('kB')) {
    $('kB').textContent =
      encendida ? 'ENCENDIDA' : 'APAGADA';

    $('kB').style.color =
      encendida ? '#1a9b55' : '#c8303a';
  }
}


// ============================================================
// 8. REPRESENTACIÓN DEL AGUA
// ============================================================

function renderWater() {
  if (!S?.estado?.ts) {
    if ($('pctA')) $('pctA').textContent = 'Sin datos';
    if ($('kN')) $('kN').textContent = '—';

    return;
  }

  const estado = S.estado;

  const lsh = esActivo(estado.lsh201);
  const lsl = esActivo(estado.lsl202);
  const ls = esActivo(estado.ls101);

  let etiquetaIndicador;
  let etiquetaTanque;

  // Las etiquetas dependen de sensores, no de la variable est.
  if (lsh && !lsl) {
    etiquetaIndicador = 'Revisar sensores';
    etiquetaTanque = 'Revisar';
  } else if (lsh) {
    etiquetaIndicador = 'Lleno';
    etiquetaTanque = 'Lleno';
  } else if (lsl) {
    etiquetaIndicador = 'Entre sensores';
    etiquetaTanque = 'Medio';
  } else {
    etiquetaIndicador = 'Bajo';
    etiquetaTanque = 'Bajo';
  }

  // est solo controla la transición visual del agua.
  if ($('wa')) {
    $('wa').setAttribute('height', 1.5 * est);
    $('wa').setAttribute('y', 180 - 1.5 * est);
  }

  if ($('pctA')) {
    $('pctA').textContent = etiquetaTanque;
  }

  if ($('kN')) {
    $('kN').textContent = etiquetaIndicador;
  }

  // Presencia de agua en el tanque subterráneo.
  const nivelSubterraneo = ls ? 70 : 6;

  if ($('ws')) {
    $('ws').setAttribute(
      'height',
      1.2 * nivelSubterraneo
    );

    $('ws').setAttribute(
      'y',
      370 - 1.2 * nivelSubterraneo
    );
  }
}


// ============================================================
// 9. REPRESENTACIÓN DE SENSORES Y MODO
// ============================================================

function render(estado, control) {
  const sensores = [
    ['sLS', 'tLS', estado.ls101],
    ['sLSH', 'tLSH', estado.lsh201],
    ['sLSL', 'tLSL', estado.lsl202]
  ];

  sensores.forEach(([idLed, idTexto, valor]) => {
    const activo = esActivo(valor);
    const led = $(idLed);
    const contenedor = $(idTexto);

    if (led) {
      led.classList.toggle('on', activo);
    }

    if (contenedor) {
      const indicador = document.createElement('span');

      indicador.className = `pill ${activo ? 'on' : ''}`;
      indicador.textContent = activo ? 'ACTIVO' : 'INACTIVO';

      contenedor.replaceChildren(indicador);
    }
  });

  // Modo realmente reportado por el ESP32.
  const modoReportado = estado.modo;

  const etiquetas = {
    auto: 'Automático',
    manual: 'Manual'
  };

  if ($('kM')) {
    $('kM').textContent =
      etiquetas[modoReportado] || 'No informado';
  }

  // Resaltar el modo reportado, no la solicitud de la web.
  // Si el ESP32 no informa modo, ninguno queda seleccionado.
  document.querySelectorAll('.seg button').forEach(boton => {
    boton.classList.toggle(
      'act',
      boton.dataset.m === modoReportado
    );
  });

  if ($('kT')) {
    $('kT').textContent = horaLocal(estado.ts);
  }

  // Mostrar separadamente la solicitud pendiente de la web.
  const informacionModo = $('modoInfo');

  if (informacionModo) {
    const solicitado =
      etiquetas[control.modo] || 'No informado';

    const reportado =
      etiquetas[modoReportado] || 'No informado';

    informacionModo.textContent =
      `Reportado por ESP32: ${reportado}. ` +
      `Solicitado desde la web: ${solicitado}.` +
      (
        modoReportado &&
        control.modo &&
        modoReportado !== control.modo
          ? ' Los modos difieren: comprobar cómo el programa procesa la solicitud.'
          : ''
      );
  }

  renderActuadores(estado);
  renderWater();
  actualizarBotones();
}


// ============================================================
// 10. ADVERTENCIAS DIDÁCTICAS
// ============================================================
//
// Esta función SOLO genera mensajes.
//
// No modifica:
// - estado.bomba;
// - control.bomba;
// - órdenes manuales;
// - estado de los sensores;
// - animación de bomba.
//
// La web puede detectar una combinación problemática incluso
// si el programa del estudiante envía fallo=0.
// ============================================================

function renderAvisos(estado) {
  const contenedor = $('alarmas');

  if (!contenedor) return;

  const avisos = [];

  const agregar = (tipo, texto) => {
    avisos.push({ tipo, texto });
  };

  const ls = esActivo(estado.ls101);
  const lsh = esActivo(estado.lsh201);
  const lsl = esActivo(estado.lsl202);
  const bomba = esActivo(estado.bomba);
  const fallo = estadoFallo(estado.fallo);

  // Comunicación y antigüedad: no alteran la representación.
  if (!apiOK) {
    agregar(
      'warn',
      'No se pudo actualizar la información. ' +
      'Se conserva la última salida reportada, incluida su animación. ' +
      'Esto no confirma el estado actual del equipo.'
    );
  } else if (
    estado.ts &&
    edadLectura(estado) >= MAX_EDAD_SEGUNDOS
  ) {
    agregar(
      'warn',
      'Sin datos recientes del ESP32. ' +
      'La pantalla y la animación representan la última lectura ' +
      'recibida, no una confirmación del estado actual.'
    );
  }

  if (!estado.ts) {
    agregar(
      'info',
      'Esperando la primera lectura del ESP32.'
    );
  } else {
    // Alto activo e inferior inactivo:
    // incoherencia según la convención "1 = agua presente".
    if (lsh && !lsl) {
      agregar(
        'danger',
        'ADVERTENCIA DE MANTENIMIENTO: LSH-201 está activo ' +
        'y LSL-202 está inactivo. Revisar sensores, cableado, ' +
        'polaridad y programación del ESP32.'
      );
    }

    // Tanque lleno con bomba todavía encendida.
    if (lsh && bomba) {
      agregar(
        'danger',
        'POSIBLE SOBRELLENADO: el ESP32 reporta nivel alto ' +
        'y mantiene la salida de bomba encendida. ' +
        'El estudiante debe revisar la condición de parada ' +
        'de su programa.'
      );
    } else if (lsh) {
      agregar(
        'info',
        'Nivel alto reportado. La salida de bomba se reporta apagada.'
      );
    }

    // Falta de agua disponible con bomba encendida.
    if (!ls && bomba) {
      agregar(
        'danger',
        'POSIBLE MARCHA EN SECO: la salida de bomba está encendida ' +
        'sin agua disponible en LS-101. Revisar la programación ' +
        'del ESP32.'
      );
    } else if (!ls) {
      agregar(
        'info',
        'LS-101 no reporta agua disponible. ' +
        'La salida de bomba se reporta apagada.'
      );
    }

    // Indicador de falla calculado por el estudiante.
    if (fallo === 1) {
      const descripciones = {
        0: 'Sin una causa específica en el código enviado.',
        1: 'Lecturas incoherentes entre LSH-201 y LSL-202.',
        2: 'Ausencia de agua disponible en LS-101.',
        3: 'Lecturas incoherentes y ausencia de agua en LS-101.'
      };

      const descripcion =
        descripciones[estado.codigo] ||
        'Código no informado o no reconocido por esta interfaz.';

      agregar(
        'warn',
        `El ESP32 reporta fallo=1. ` +
        `Código: ${estado.codigo ?? 'no informado'}. ${descripcion}`
      );

      if (bomba) {
        agregar(
          'warn',
          'El ESP32 reporta una falla y mantiene la salida ' +
          'de bomba encendida. Revisar si ese comportamiento ' +
          'corresponde a la estrategia programada en la práctica.'
        );
      }
    } else if (fallo === null) {
      agregar(
        'warn',
        'La lectura no incluye un indicador de falla reconocido. ' +
        'Revisar el envío de fallo y codigo desde el ESP32. ' +
        'La representación y las órdenes manuales no se bloquean.'
      );
    }

    // Comparación entre diagnóstico del alumno y observación web.
    if (fallo === 0 && lsh && !lsl) {
      agregar(
        'warn',
        'REVISIÓN DEL DIAGNÓSTICO: el ESP32 envía fallo=0, ' +
        'pero las lecturas de nivel son incoherentes. ' +
        'Revisar cómo se calcula el indicador de falla.'
      );
    }

    if (fallo === 0 && estado.codigo != null &&
        Number(estado.codigo) !== 0) {
      agregar(
        'warn',
        'REVISIÓN DEL REPORTE: se recibió fallo=0 junto con ' +
        'un código de falla distinto de cero.'
      );
    }

    if (!avisos.length) {
      agregar(
        'ok',
        'No se detectan advertencias en la última lectura recibida. ' +
        'La web representa la salida reportada por el ESP32.'
      );
    }
  }

  contenedor.replaceChildren();

  avisos.forEach(aviso => {
    const div = document.createElement('div');

    div.className = `aviso ${aviso.tipo}`;
    div.textContent = aviso.texto;

    contenedor.appendChild(div);
  });
}


// ============================================================
// 11. TABLA DEL HISTORIAL
// Mantiene las siete columnas del index.html actual.
// ============================================================

function agregarCelda(fila, texto, clase = '') {
  const celda = document.createElement('td');

  celda.textContent = texto;

  if (clase) {
    celda.className = clase;
  }

  fila.appendChild(celda);

  return celda;
}

function agregarEstado(fila, valor) {
  const celda = document.createElement('td');
  const indicador = document.createElement('span');
  const activo = esActivo(valor);

  indicador.className = `pill ${activo ? 'on' : ''}`;
  indicador.textContent = activo ? 'ACTIVO' : 'INACTIVO';

  celda.appendChild(indicador);
  fila.appendChild(celda);
}

function renderTabla(historial) {
  const tabla = $('tb');

  if (!tabla) return;

  tabla.replaceChildren();

  if ($('tbEmpty')) {
    $('tbEmpty').style.display =
      historial.length ? 'none' : 'block';
  }

  const fragmento = document.createDocumentFragment();

  [...historial].reverse().forEach(registro => {
    const fila = document.createElement('tr');

    // Compatibilidad con historial antiguo, que no guarda
    // el identificador de dispositivo en cada registro.
    const dispositivo =
      registro.dispositivo ||
      (
        registro.t === S.estado.ts
          ? S.estado.dispositivo || 'ESP32'
          : '—'
      );

    agregarCelda(fila, horaLocal(registro.t), 'num');
    agregarCelda(fila, dispositivo);

    agregarEstado(fila, registro.ls);
    agregarEstado(fila, registro.lsh);
    agregarEstado(fila, registro.lsl);
    agregarEstado(fila, registro.b);

    agregarCelda(fila, registro.m || '—');

    fragmento.appendChild(fila);
  });

  tabla.appendChild(fragmento);
}


// ============================================================
// 12. ACTUALIZACIÓN DE LA GRÁFICA
// ============================================================

function renderGrafica(historial) {
  if (!chart) return;

  try {
    chart.data.labels = historial.map(registro =>
      horaLocal(registro.t)
    );

    chart.data.datasets[0].data = historial.map(registro =>
      esActivo(registro.b) ? 1 : 0
    );

    chart.data.datasets[1].data = historial.map(registro =>
      esActivo(registro.ls) ? 1 : 0
    );

    chart.data.datasets[2].data = historial.map(registro =>
      esActivo(registro.lsh) ? 1 : 0
    );

    chart.data.datasets[3].data = historial.map(registro =>
      esActivo(registro.lsl) ? 1 : 0
    );

    chart.update();
  } catch (error) {
    console.error('Error al actualizar la gráfica:', error);
  }
}


// ============================================================
// 13. ACTUALIZACIÓN GENERAL DEL PANEL
// ============================================================

function renderData() {
  if (!S) return;

  render(S.estado, S.control);
  renderAvisos(S.estado);
  renderTabla(S.historial);
  renderGrafica(S.historial);
}


// ============================================================
// 14. CONSULTA PERIÓDICA DE DATOS
// ============================================================

async function poll() {
  if (consultando) return;

  consultando = true;

  try {
    const respuesta = await fetch('/api/data', {
      cache: 'no-store'
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    const datos = await respuesta.json();

    if (
      !datos ||
      !datos.estado ||
      !datos.control ||
      !Array.isArray(datos.historial)
    ) {
      throw new Error(
        'La respuesta de la API no tiene la estructura esperada.'
      );
    }

    S = datos;
    apiOK = true;
  } catch (error) {
    apiOK = false;

    console.error('Error al consultar /api/data:', error);
  } finally {
    consultando = false;
  }

  actualizarConexion();
  actualizarBotones();

  // Si una consulta falla, se conserva la respuesta anterior.
  if (S) {
    renderData();
  } else if ($('alarmas')) {
    $('alarmas').textContent =
      'Todavía no fue posible obtener una respuesta válida de la API. ' +
      'Consulta la consola del navegador.';
  }
}


// ============================================================
// 15. ENVÍO DE ÓRDENES MANUALES
// ============================================================
//
// No se comprueban sensores ni fallas para enviar la solicitud.
// El programa del estudiante decide cómo procesarla.
//
// Una solicitud de control NO cambia directamente S.estado.bomba.
// La representación cambia cuando la API devuelve una nueva
// lectura reportada por el ESP32.
// ============================================================

async function ctl(parametros) {
  if (enviandoControl) return;

  enviandoControl = true;
  actualizarBotones();

  try {
    const consulta = new URLSearchParams(parametros);

    const respuesta = await fetch(`/api/control?${consulta}`, {
      cache: 'no-store'
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    await poll();
  } catch (error) {
    console.error('Error al enviar la orden:', error);

    alert(
      'No se pudo confirmar el envío de la orden. ' +
      'Verifica la conexión y consulta el estado del equipo.'
    );
  } finally {
    enviandoControl = false;
    actualizarBotones();
  }
}

// Selección del modo.
document.querySelectorAll('.seg button').forEach(boton => {
  boton.onclick = () => {
    ctl({ modo: boton.dataset.m });
  };
});

// Solicitud de encendido manual.
if ($('on')) {
  $('on').onclick = () => {
    ctl({ bomba: 1 });
  };
}

// Solicitud de apagado manual.
if ($('off')) {
  $('off').onclick = () => {
    ctl({ bomba: 0 });
  };
}


// ============================================================
// 16. VACIAR HISTORIAL
// ============================================================

if ($('clear')) {
  $('clear').onclick = async () => {
    const confirmado = confirm(
      '¿Deseas vaciar el historial de lecturas?'
    );

    if (!confirmado) return;

    $('clear').disabled = true;

    try {
      const respuesta = await fetch('/api/reset', {
        cache: 'no-store'
      });

      if (!respuesta.ok) {
        throw new Error(`Error HTTP ${respuesta.status}`);
      }

      await poll();
    } catch (error) {
      console.error('Error al vaciar el historial:', error);

      alert(
        'No se pudo confirmar el vaciado del historial.'
      );
    } finally {
      $('clear').disabled = false;
    }
  };
}


// ============================================================
// ANIMACIÓN DIDÁCTICA SEGÚN LO REPORTADO POR EL ESP32
//
// La bomba depende únicamente del campo "bomba".
//
// El agua se mueve hacia una representación ilustrativa:
// - LSH activo: zona de tanque lleno.
// - LSH inactivo y LSL activo: zona entre sensores.
// - Ambos inactivos: zona por debajo del sensor inferior.
//
// Si llega "nivel", se utiliza ese valor enviado por el ESP32.
// No se calcula el nivel acumulando tiempo de bomba encendida.
// ============================================================

function tick() {
  actualizarConexion();
  actualizarBotones();

  if (!S) return;

  const estado = S.estado;

  // Mostrar advertencias sin modificar las salidas.
  renderAvisos(estado);

  // Mantener la representación de la última salida recibida.
  renderActuadores(estado);

  if (!estado.ts) return;

  const lsh = esActivo(estado.lsh201);
  const lsl = esActivo(estado.lsl202);

  let objetivo;

  // Comprobar si el ESP32 envió un nivel explícito.
  const tieneNivel =
    estado.nivel !== undefined &&
    estado.nivel !== null &&
    String(estado.nivel).trim() !== '' &&
    Number.isFinite(Number(estado.nivel));

  if (tieneNivel) {
    // Representar el valor enviado, limitado al rango del dibujo.
    objetivo = Math.max(
      0,
      Math.min(100, Number(estado.nivel))
    );
  } else if (lsh) {
    // Incluso si los sensores son incoherentes, se representa
    // el superior activo y la advertencia explica el problema.
    objetivo = 100;
  } else if (lsl) {
    // Altura simbólica: agua entre los sensores.
    // No significa que se haya medido exactamente un 50 %.
    objetivo = 50;
  } else {
    // Altura simbólica por debajo del sensor inferior.
    // No se afirma que el tanque esté completamente vacío.
    objetivo = 5;
  }

  // Transición visual hacia el estado reportado.
  // Permite que el dibujo suba o baje.
  const diferencia = objetivo - est;
  const paso = 3;

  if (Math.abs(diferencia) <= paso) {
    est = objetivo;
  } else {
    est += Math.sign(diferencia) * paso;
  }

  renderWater();
}


// ============================================================
// 18. INICIO DEL PANEL
// ============================================================

iniciarGrafica();
actualizarBotones();

// Consultar estados e historial.
setInterval(poll, INTERVALO_CONSULTA_MS);

// Actualizar animación y mensajes.
setInterval(tick, INTERVALO_ANIMACION_MS);

// Primera consulta al abrir la página.
poll();
