// ============================================================
// MONITOREO DIDÁCTICO DE TANQUE AÉREO · UPT ARAGUA
// ============================================================
//
// FUNCIONAMIENTO:
// - Representar la última información recibida del ESP32.
// - Mostrar advertencias sin corregir las salidas.
// - Mantener separados modo reportado y modo solicitado.
// - No bloquear por sensores, fallas o antigüedad de lectura.
//
// CONVENCIÓN:
// ls101  = 1: agua disponible en tanque subterráneo.
// lsh201 = 1: agua en sensor superior del tanque aéreo.
// lsl202 = 1: agua en sensor inferior del tanque aéreo.
// bomba  = 1: salida de bomba reportada encendida.
// fallo  = 1: condición de falla reportada.
//
// MODO:
// estado.modo  = modo reportado por el ESP32.
// control.modo = modo solicitado desde la web.
//
// NIVEL VISUAL:
// Esta versión representa zonas según los sensores.
// No acumula nivel por tiempo de bomba encendida.
// El campo opcional "nivel" no modifica este dibujo.
//
// IMPORTANTE:
// Una salida reportada no confirma funcionamiento físico.
// Las prácticas con errores intencionales deben realizarse
// en simulación o con salidas de baja potencia.
// ============================================================


// ============================================================
// 1. VARIABLES GENERALES
// ============================================================

const $ = id => document.getElementById(id);

const INTERVALO_CONSULTA_MS = 3000;
const INTERVALO_ANIMACION_MS = 700;
const MAX_EDAD_SEGUNDOS = 60;
const TIEMPO_ESPERA_HTTP_MS = 10000;

let S = null;
let apiOK = false;
let est = 0;
let chart = null;

let enviandoControl = false;
let vaciandoHistorial = false;

// Permite compartir una consulta que ya está en curso.
let consultaEnCurso = null;

// Evita reconstruir mensajes idénticos en cada animación.
let firmaAvisos = '';


// ============================================================
// 2. FUNCIONES AUXILIARES
// ============================================================

function esActivo(valor) {
  if (typeof valor === 'string') {
    valor = valor.trim().toLowerCase();
  }

  return (
    valor === 1 ||
    valor === true ||
    valor === '1' ||
    valor === 'true' ||
    valor === 'on'
  );
}

function estadoFallo(valor) {
  if (typeof valor === 'string') {
    valor = valor.trim().toLowerCase();
  }

  if (
    valor === 1 ||
    valor === true ||
    valor === '1' ||
    valor === 'true' ||
    valor === 'on'
  ) {
    return 1;
  }

  if (
    valor === 0 ||
    valor === false ||
    valor === '0' ||
    valor === 'false' ||
    valor === 'off'
  ) {
    return 0;
  }

  return null;
}

function normalizarModo(valor) {
  if (typeof valor !== 'string') return null;

  const modo = valor.trim().toLowerCase();

  return modo === 'auto' || modo === 'manual'
    ? modo
    : null;
}

function nombreModo(valor) {
  const modo = normalizarModo(valor);

  if (modo === 'auto') return 'Automático';
  if (modo === 'manual') return 'Manual';

  return 'No informado';
}

function edadLectura(estado) {
  if (!estado?.ts) return Infinity;

  const fecha = new Date(estado.ts).getTime();

  if (!Number.isFinite(fecha)) return Infinity;

  return Math.max(0, (Date.now() - fecha) / 1000);
}

function horaLocal(fecha) {
  if (!fecha) return 'sin datos';

  const objetoFecha = new Date(fecha);

  if (!Number.isFinite(objetoFecha.getTime())) {
    return 'fecha inválida';
  }

  return objetoFecha.toLocaleTimeString('es-VE');
}

// Peticiones con tiempo máximo de espera.
// Esta función solo realiza la solicitud; cada operación
// decide si debe leer JSON u otro formato.
async function solicitar(url) {
  const controlador = new AbortController();

  const temporizador = setTimeout(
    () => controlador.abort(),
    TIEMPO_ESPERA_HTTP_MS
  );

  try {
    const respuesta = await fetch(url, {
      cache: 'no-store',
      signal: controlador.signal
    });

    if (!respuesta.ok) {
      throw new Error(`Error HTTP ${respuesta.status}`);
    }

    // Leer el cuerpo dentro del tiempo de espera.
    const texto = await respuesta.text();

    return texto;
  } finally {
    clearTimeout(temporizador);
  }
}


// ============================================================
// 3. GRÁFICA
// ============================================================

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
    console.error('Error al iniciar la gráfica:', error);
  }
}


// ============================================================
// 4. INFORMACIÓN OPCIONAL DE LA API
// ============================================================

function mostrarInstrucciones() {
  const ep = $('ep');

  if (!ep) return;

  ep.textContent =
`SUBIDA DESDE EL ESP32:
GET ${location.origin}/api/data?ls101=1&lsh201=0&lsl202=1&bomba=1&fallo=0&codigo=0&modo=manual&id=ESP32-01&fmt=txt

SOLICITUD MANUAL DESDE LA WEB:
GET ${location.origin}/api/control?modo=manual&bomba=1

CONSULTA DE ESTADO E HISTORIAL:
GET ${location.origin}/api/data

VACIAR HISTORIAL:
GET ${location.origin}/api/reset

IMPORTANTE:
El modo enviado por el ESP32 es un reporte.
El modo enviado a /api/control es una solicitud.`;
}


// ============================================================
// 5. ESTADO DE COMUNICACIÓN
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
// 6. MODO REPORTADO Y MODO SOLICITADO
// ============================================================

function actualizarModo() {
  const reportado = normalizarModo(S?.estado?.modo);
  const solicitado = normalizarModo(S?.control?.modo);

  if ($('kM')) {
    $('kM').textContent = nombreModo(reportado);
  }

  document.querySelectorAll('.seg button').forEach(boton => {
    const seleccionado = boton.dataset.m === reportado;

    // Resaltar únicamente el modo reportado por el ESP32.
    boton.classList.toggle('act', seleccionado);
    boton.setAttribute('aria-pressed', String(seleccionado));
  });

  const informacion = $('modoInfo');

  if (informacion) {
    const difieren =
      reportado &&
      solicitado &&
      reportado !== solicitado;

    informacion.textContent =
      `Reportado por ESP32: ${nombreModo(reportado)}. ` +
      `Solicitado desde la web: ${nombreModo(solicitado)}.` +
      (
        difieren
          ? ' Los modos difieren: revisar cómo el programa procesa la solicitud.'
          : ''
      );
  }
}


// ============================================================
// 7. BOTONES
// ============================================================
//
// Solo se exige modo reportado manual para solicitar
// encendido o apagado desde estos botones.
//
// No se bloquean por sensores, fallas ni datos antiguos.
// ============================================================

function actualizarBotones() {
  const manual =
    normalizarModo(S?.estado?.modo) === 'manual';

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

  document.querySelectorAll('.seg button').forEach(boton => {
    boton.disabled = enviandoControl;
  });

  if ($('clear')) {
    $('clear').disabled = vaciandoHistorial;
  }
}


// ============================================================
// 8. BOMBA Y FLUJO
// ============================================================
//
// Dependen únicamente de la salida reportada.
// Si hay una falla o una lectura antigua, se informa aparte.
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
// 9. NIVEL ILUSTRATIVO SEGÚN SENSORES
// ============================================================
//
// No se utiliza el tiempo de funcionamiento de la bomba.
//
// LSH=0 y LSL=0: zona baja.
// LSH=0 y LSL=1: zona entre sensores.
// LSH=1 y LSL=1: lleno.
// LSH=1 y LSL=0: incoherencia; representar superior activo
//                y mostrar la advertencia.
// ============================================================

function representacionNivel(estado) {
  const lsh = esActivo(estado.lsh201);
  const lsl = esActivo(estado.lsl202);

  if (lsh && !lsl) {
    return {
      objetivo: 100,
      indicador: 'Revisar sensores',
      tanque: 'Revisar'
    };
  }

  if (lsh) {
    return {
      objetivo: 100,
      indicador: 'Lleno',
      tanque: 'Lleno'
    };
  }

  if (lsl) {
    return {
      objetivo: 50,
      indicador: 'Entre sensores',
      tanque: 'Medio'
    };
  }

  return {
    objetivo: 5,
    indicador: 'Bajo',
    tanque: 'Bajo'
  };
}

function renderWater() {
  if (!S?.estado?.ts) {
    if ($('pctA')) $('pctA').textContent = 'Sin datos';
    if ($('kN')) $('kN').textContent = '—';

    return;
  }

  const estado = S.estado;
  const nivel = representacionNivel(estado);

  // est solo representa la transición visual.
  if ($('wa')) {
    $('wa').setAttribute('height', 1.5 * est);
    $('wa').setAttribute('y', 180 - 1.5 * est);
  }

  // Las etiquetas dependen del sensor, no de la transición.
  if ($('pctA')) {
    $('pctA').textContent = nivel.tanque;
  }

  if ($('kN')) {
    $('kN').textContent = nivel.indicador;
  }

  const nivelSubterraneo =
    esActivo(estado.ls101) ? 70 : 6;

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
// 10. SENSORES E INDICADORES
// ============================================================

function render(estado) {
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

  if ($('kT')) {
    $('kT').textContent = horaLocal(estado.ts);
  }

  actualizarModo();
  actualizarBotones();
  renderActuadores(estado);
  renderWater();
}


// ============================================================
// 11. ADVERTENCIAS DIDÁCTICAS
// ============================================================
//
// Solo muestran mensajes.
// No cambian estados, órdenes ni animación de bomba.
// ============================================================

function renderAvisos(estado) {
  const contenedor = $('alarmas');

  if (!contenedor) return;

  const avisos = [];
  const agregar = (tipo, texto) => avisos.push({ tipo, texto });

  const ls = esActivo(estado.ls101);
  const lsh = esActivo(estado.lsh201);
  const lsl = esActivo(estado.lsl202);
  const bomba = esActivo(estado.bomba);
  const fallo = estadoFallo(estado.fallo);

  const reportado = normalizarModo(estado.modo);
  const solicitado = normalizarModo(S?.control?.modo);

  if (!apiOK) {
    agregar(
      'warn',
      'No se pudo actualizar la información. Se conserva la última ' +
      'salida reportada, incluida su animación. Esto no confirma ' +
      'el estado actual del equipo.'
    );
  } else if (
    estado.ts &&
    edadLectura(estado) >= MAX_EDAD_SEGUNDOS
  ) {
    agregar(
      'warn',
      'Sin datos recientes del ESP32. La pantalla y la animación ' +
      'representan la última lectura recibida, no una confirmación ' +
      'del estado actual.'
    );
  }

  if (!estado.ts) {
    agregar('info', 'Esperando la primera lectura del ESP32.');
  } else {
    if (!reportado) {
      agregar(
        'warn',
        'El ESP32 no reporta un modo reconocido. Enviar modo=auto ' +
        'o modo=manual en cada lectura.'
      );
    } else if (solicitado && reportado !== solicitado) {
      agregar(
        'info',
        `Modo reportado: ${nombreModo(reportado)}. ` +
        `Modo solicitado desde la web: ${nombreModo(solicitado)}. ` +
        'Revisar si el programa ya procesó la solicitud o si existe ' +
        'otra prioridad de control definida por el estudiante.'
      );
    }

    if (lsh && !lsl) {
      agregar(
        'danger',
        'ADVERTENCIA DE MANTENIMIENTO: LSH-201 activo y LSL-202 ' +
        'inactivo. Revisar sensores, cableado, polaridad ' +
        'y programación del ESP32.'
      );
    }

    if (lsh && bomba) {
      agregar(
        'danger',
        'POSIBLE SOBRELLENADO: el ESP32 reporta nivel alto y mantiene ' +
        'la salida de bomba encendida. Revisar la condición de parada.'
      );
    } else if (lsh) {
      agregar(
        'info',
        'Nivel alto reportado. La salida de bomba se reporta apagada.'
      );
    }

    if (!ls && bomba) {
      agregar(
        'danger',
        'POSIBLE MARCHA EN SECO: la salida de bomba está encendida ' +
        'sin agua disponible en LS-101. Revisar la programación.'
      );
    } else if (!ls) {
      agregar(
        'info',
        'LS-101 no reporta agua disponible. ' +
        'La salida de bomba se reporta apagada.'
      );
    }

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
        `El ESP32 reporta fallo=1. Código: ` +
        `${estado.codigo ?? 'no informado'}. ${descripcion}`
      );

      if (bomba) {
        agregar(
          'warn',
          'El ESP32 reporta una falla y mantiene la salida encendida. ' +
          'Revisar si corresponde a la estrategia de la práctica.'
        );
      }
    } else if (fallo === null) {
      agregar(
        'warn',
        'La lectura no incluye un indicador de falla reconocido. ' +
        'Revisar el envío de fallo y codigo. Esta advertencia ' +
        'no modifica la salida ni bloquea órdenes por sensores.'
      );
    }

    if (fallo === 0 && lsh && !lsl) {
      agregar(
        'warn',
        'REVISIÓN DEL DIAGNÓSTICO: el ESP32 envía fallo=0, pero las ' +
        'lecturas de nivel son incoherentes. Revisar su diagnóstico.'
      );
    }

    if (
      fallo === 0 &&
      estado.codigo != null &&
      Number(estado.codigo) !== 0
    ) {
      agregar(
        'warn',
        'REVISIÓN DEL REPORTE: se recibió fallo=0 junto con un código ' +
        'de falla distinto de cero.'
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

  // No reconstruir mensajes si su contenido no ha cambiado.
  const nuevaFirma = JSON.stringify(avisos);

  if (nuevaFirma === firmaAvisos) return;

  firmaAvisos = nuevaFirma;

  const fragmento = document.createDocumentFragment();

  avisos.forEach(aviso => {
    const div = document.createElement('div');

    div.className = `aviso ${aviso.tipo}`;
    div.textContent = aviso.texto;

    fragmento.appendChild(div);
  });

  contenedor.replaceChildren(fragmento);
}


// ============================================================
// 12. TABLA DEL HISTORIAL
// ============================================================

function agregarCelda(fila, texto, clase = '') {
  const celda = document.createElement('td');

  celda.textContent = texto;

  if (clase) celda.className = clase;

  fila.appendChild(celda);
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

  if ($('tbEmpty')) {
    $('tbEmpty').style.display =
      historial.length ? 'none' : 'block';
  }

  const fragmento = document.createDocumentFragment();

  [...historial].reverse().forEach(registro => {
    const fila = document.createElement('tr');

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

    const modo = normalizarModo(registro.m);

    agregarCelda(
      fila,
      modo ? nombreModo(modo) : 'No informado'
    );

    fragmento.appendChild(fila);
  });

  tabla.replaceChildren(fragmento);
}


// ============================================================
// 13. ACTUALIZACIÓN DE LA GRÁFICA
// ============================================================

function renderGrafica(historial) {
  if (!chart) return;

  try {
    chart.data.labels = historial.map(registro =>
      horaLocal(registro.t)
    );

    const campos = ['b', 'ls', 'lsh', 'lsl'];

    campos.forEach((campo, indice) => {
      chart.data.datasets[indice].data = historial.map(registro =>
        esActivo(registro[campo]) ? 1 : 0
      );
    });

    chart.update();
  } catch (error) {
    console.error('Error al actualizar la gráfica:', error);
  }
}


// ============================================================
// 14. ACTUALIZACIÓN GENERAL
// ============================================================

function renderData() {
  if (!S) return;

  render(S.estado);
  renderAvisos(S.estado);
  renderTabla(S.historial);
  renderGrafica(S.historial);
}


// ============================================================
// 15. CONSULTA PERIÓDICA
// ============================================================

function poll() {
  // Si ya se consulta, entregar la misma promesa.
  if (consultaEnCurso) return consultaEnCurso;

  consultaEnCurso = (async () => {
    try {
      const texto = await solicitar('/api/data');
      const datos = JSON.parse(texto);

      if (
        !datos ||
        !datos.estado ||
        typeof datos.estado !== 'object' ||
        Array.isArray(datos.estado) ||
        !datos.control ||
        typeof datos.control !== 'object' ||
        Array.isArray(datos.control) ||
        !Array.isArray(datos.historial)
      ) {
        throw new Error(
          'La API no devolvió la estructura esperada.'
        );
      }

      S = datos;
      apiOK = true;
    } catch (error) {
      apiOK = false;
      console.error('Error al consultar /api/data:', error);
    }

    actualizarConexion();
    actualizarBotones();

    if (S) {
      renderData();
    } else if ($('alarmas')) {
      firmaAvisos = '';

      $('alarmas').textContent =
        'No fue posible obtener una respuesta válida de la API. ' +
        'Consulta la consola del navegador.';
    }
  })().finally(() => {
    consultaEnCurso = null;
  });

  return consultaEnCurso;
}

// Después de modificar control o historial, esperar cualquier
// consulta anterior y luego solicitar una respuesta nueva.
async function consultarDespuesDeCambio() {
  if (consultaEnCurso) {
    await consultaEnCurso;
  }

  await poll();
}


// ============================================================
// 16. SOLICITUDES DE CONTROL
// ============================================================
//
// No cambian directamente estado.bomba ni estado.modo.
// La pantalla espera el reporte posterior del ESP32.
// ============================================================

async function ctl(parametros) {
  if (enviandoControl) return;

  enviandoControl = true;
  actualizarBotones();

  try {
    const consulta = new URLSearchParams(parametros);

    await solicitar(`/api/control?${consulta}`);
    await consultarDespuesDeCambio();
  } catch (error) {
    console.error('Error al enviar la orden:', error);

    alert(
      'No se pudo confirmar el envío de la solicitud. ' +
      'Verifica la conexión y el estado del equipo.'
    );
  } finally {
    enviandoControl = false;
    actualizarBotones();
  }
}


// ============================================================
// 17. EVENTOS DE BOTONES
// ============================================================

function configurarEventos() {
  document.querySelectorAll('.seg button').forEach(boton => {
    boton.onclick = () => {
      ctl({ modo: boton.dataset.m });
    };
  });

  if ($('on')) {
    $('on').onclick = () => {
      // Incluir el modo manual para que la orden no quede
      // ignorada por un control.modo anterior en automático.
      ctl({
        modo: 'manual',
        bomba: 1
      });
    };
  }

  if ($('off')) {
    $('off').onclick = () => {
      ctl({
        modo: 'manual',
        bomba: 0
      });
    };
  }

  if ($('clear')) {
    $('clear').onclick = async () => {
      if (vaciandoHistorial) return;

      const confirmado = confirm(
        '¿Deseas vaciar el historial de lecturas?'
      );

      if (!confirmado) return;

      vaciandoHistorial = true;
      actualizarBotones();

      try {
        await solicitar('/api/reset');
        await consultarDespuesDeCambio();
      } catch (error) {
        console.error('Error al vaciar el historial:', error);

        alert(
          'No se pudo confirmar el vaciado del historial.'
        );
      } finally {
        vaciandoHistorial = false;
        actualizarBotones();
      }
    };
  }
}


// ============================================================
// 18. ANIMACIÓN
// ============================================================

function tick() {
  actualizarConexion();
  actualizarBotones();

  if (!S) return;

  const estado = S.estado;

  renderAvisos(estado);
  renderActuadores(estado);

  if (!estado.ts) return;

  // El objetivo depende de sensores, no de la bomba.
  const objetivo = representacionNivel(estado).objetivo;

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
// 19. INICIO
// ============================================================

function iniciarPanel() {
  iniciarGrafica();
  mostrarInstrucciones();
  configurarEventos();

  actualizarModo();
  actualizarBotones();
  renderWater();

  setInterval(poll, INTERVALO_CONSULTA_MS);
  setInterval(tick, INTERVALO_ANIMACION_MS);

  poll();
}

// Esperar al HTML si el archivo se carga antes de terminar
// de construir la página.
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    iniciarPanel,
    { once: true }
  );
} else {
  iniciarPanel();
}
