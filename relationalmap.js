import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// --------------------------------------------
// Configuración
// --------------------------------------------
const RUTA_CSV = "../water_potability.csv";
const INTERVALOS_MAPA = 12; // celdas aproximadas por eje
const INTERVALOS_HIST = 25; // intervalos del histograma
const MIN_MUESTRAS = 5; // celdas con menos muestras: gris y fuera de la métrica
const TOP_PARES = 4; // pares que muestra «Mayor relación» (llena el 3 × 3)
const PERMUTACIONES = 100; // repeticiones para la línea base
const PERCENTIL_BASE = 0.95;
// "potable": solo cuenta celdas MÁS potables que el promedio (zonas favorables)
// "absoluta": cuenta cualquier desviación, hacia potable o no potable
const METRICA = "potable";

const MODO_TOP = "__top__";
const COLORES = {
	potable: "#1F5C99",
	noPotable: "#C8692B",
	neutro: "#F4F4F2",
	escaso: "#E4E9EC",
};

const ETIQUETAS = {
	ph: { nombre: "pH", unidad: "" },
	Hardness: { nombre: "Dureza", unidad: "mg/L" },
	Solids: { nombre: "Sólidos disueltos", unidad: "ppm" },
	Chloramines: { nombre: "Cloraminas", unidad: "ppm" },
	Sulfate: { nombre: "Sulfato", unidad: "mg/L" },
	Conductivity: { nombre: "Conductividad", unidad: "μS/cm" },
	Organic_carbon: { nombre: "Carbono orgánico", unidad: "ppm" },
	Trihalomethanes: { nombre: "Trihalometanos", unidad: "μg/L" },
	Turbidity: { nombre: "Turbidez", unidad: "NTU" },
};

const selector = document.getElementById("variableMapa");
const panel = document.getElementById("panelMapas");
const leyenda = document.getElementById("leyendaMapas");    

// --------------------------------------------
// Datos
// --------------------------------------------
const data = await d3.csv(RUTA_CSV, d3.autoType);
const variables = data.columns.filter((c) => c !== "Potability");
const etiquetas = data.map((d) => d.Potability); // 0 / 1 por fila

const nombre = (v) => ETIQUETAS[v]?.nombre ?? v;
const etiquetaEje = (v) =>
	ETIQUETAS[v]?.unidad ? `${nombre(v)} (${ETIQUETAS[v].unidad})` : nombre(v);
const fmt = d3.format(",.4~r");
const pct = d3.format(".0%");
const fmtMetrica = d3.format(".3f");

const tasaGlobal = d3.mean(etiquetas);

// Rejilla fija por variable: todos los mapas que comparten variable usan los mismos bordes
const rejilla = Object.fromEntries(
	variables.map((v) => {
		const ext = d3.extent(data, (d) => d[v]);
		const interiores = d3
			.ticks(ext[0], ext[1], INTERVALOS_MAPA)
			.filter((t) => t > ext[0] && t < ext[1]);
		return [v, { ext, bordes: [ext[0], ...interiores, ext[1]] }];
	}),
);

function indiceIntervalo(bordes, valor) {
	return Math.min(d3.bisectRight(bordes, valor) - 1, bordes.length - 2);
}

// --------------------------------------------
// Escala de color compartida
// --------------------------------------------
const escalaColor = {
	type: "diverging",
	domain: [0, 1],
	pivot: tasaGlobal,
	interpolate: d3.piecewise(d3.interpolateRgb, [
		COLORES.noPotable,
		COLORES.neutro,
		COLORES.potable,
	]),
};

function dibujarLeyenda() {
	leyenda.innerHTML = "";
	leyenda.append(
		Plot.legend({
			color: escalaColor,
			tickFormat: "%",
			width: 250,
			style: {
				fontFamily: "inherit",
				fontSize: "11px",
				background: "transparent",
			},
		}),
	);
}

// --------------------------------------------
// Celdas de un par (para dibujar)
// --------------------------------------------
function calcularCeldas(vx, vy) {
	const bx = rejilla[vx].bordes;
	const by = rejilla[vy].bordes;
	const celdas = new Map();

	for (const d of data) {
		const x = d[vx];
		const y = d[vy];
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const i = indiceIntervalo(bx, x);
		const j = indiceIntervalo(by, y);
		const clave = `${i}-${j}`;
		let c = celdas.get(clave);
		if (!c) {
			c = {
				x1: bx[i],
				x2: bx[i + 1],
				y1: by[j],
				y2: by[j + 1],
				n: 0,
				potables: 0,
			};
			celdas.set(clave, c);
		}
		c.n += 1;
		c.potables += d.Potability;
	}
	return Array.from(celdas.values(), (c) => ({ ...c, tasa: c.potables / c.n }));
}

// --------------------------------------------
// Métrica de relación de un par
// Se precalcula en qué celda cae cada fila, para poder repetir la métrica
// rápido con etiquetas permutadas.
// --------------------------------------------
function prepararPar(vx, vy) {
	const bx = rejilla[vx].bordes;
	const by = rejilla[vy].bordes;
	const ny = by.length - 1;
	const filas = [];
	const celda = [];
	data.forEach((d, fila) => {
		const x = d[vx];
		const y = d[vy];
		if (!Number.isFinite(x) || !Number.isFinite(y)) return;
		filas.push(fila);
		celda.push(indiceIntervalo(bx, x) * ny + indiceIntervalo(by, y));
	});
	return { vx, vy, filas, celda, numCeldas: (bx.length - 1) * ny };
}

// Desviación ponderada: Σ (n_c / N) · |p_c − p_global|
// En modo "potable" solo suman las celdas con p_c > p_global.
function metrica(par, etq) {
	const n = new Float64Array(par.numCeldas);
	const pot = new Float64Array(par.numCeldas);
	let totalPot = 0;
	for (let k = 0; k < par.filas.length; k++) {
		const e = etq[par.filas[k]];
		n[par.celda[k]] += 1;
		pot[par.celda[k]] += e;
		totalPot += e;
	}
	const N = par.filas.length;
	const base = totalPot / N; // proporción global de ESTE par (filas válidas)
	let suma = 0;
	for (let c = 0; c < par.numCeldas; c++) {
		if (n[c] < MIN_MUESTRAS) continue;
		const dif = pot[c] / n[c] - base;
		if (METRICA === "potable" ? dif > 0 : true)
			suma += (n[c] / N) * Math.abs(dif);
	}
	return suma;
}

// Generador aleatorio con semilla: la línea base sale igual en cada recarga
function mulberry32(semilla) {
	return function () {
		let t = (semilla += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function barajar(arreglo, aleatorio) {
	const copia = arreglo.slice();
	for (let i = copia.length - 1; i > 0; i--) {
		const j = Math.floor(aleatorio() * (i + 1));
		[copia[i], copia[j]] = [copia[j], copia[i]];
	}
	return copia;
}

function rankingPares() {
	const pares = [];
	for (let a = 0; a < variables.length; a++) {
		for (let b = a + 1; b < variables.length; b++) {
			pares.push(prepararPar(variables[a], variables[b]));
		}
	}

	const reales = pares.map((p) => metrica(p, etiquetas));

	// Línea base: misma métrica con la potabilidad mezclada al azar
	const aleatorio = mulberry32(2026);
	const nulas = pares.map(() => []);
	for (let r = 0; r < PERMUTACIONES; r++) {
		const mezcladas = barajar(etiquetas, aleatorio);
		pares.forEach((p, i) => nulas[i].push(metrica(p, mezcladas)));
	}

	return pares
		.map((p, i) => {
			const base = d3.quantile(nulas[i].sort(d3.ascending), PERCENTIL_BASE);
			return {
				vx: p.vx,
				vy: p.vy,
				valor: reales[i],
				base,
				senal: reales[i] > base,
				razon: reales[i] / base,
			};
		})
		.sort((a, b) => d3.descending(a.valor, b.valor));
}

// --------------------------------------------
// Gráficas
// --------------------------------------------
function dibujarMapa(vx, vy, lienzo) {
	const celdas = calcularCeldas(vx, vy);
	const suficientes = celdas.filter((c) => c.n >= MIN_MUESTRAS);
	const escasas = celdas.filter((c) => c.n < MIN_MUESTRAS);

	const texto = (c) =>
		`${nombre(vx)}: ${fmt(c.x1)} – ${fmt(c.x2)}\n` +
		`${nombre(vy)}: ${fmt(c.y1)} – ${fmt(c.y2)}\n` +
		`Potable: ${pct(c.tasa)} (${c.potables} de ${c.n})`;

	return Plot.plot({
		width: Math.max(lienzo.clientWidth, 240),
		height: 240,
		marginLeft: 52,
		marginRight: 10,
		marginBottom: 40,
		style: { fontFamily: "inherit", fontSize: "11px" },
		x: { label: etiquetaEje(vx), domain: rejilla[vx].ext, ticks: 4 },
		y: { label: etiquetaEje(vy), domain: rejilla[vy].ext, ticks: 4 },
		color: escalaColor,
		marks: [
			Plot.rect(escasas, {
				x1: "x1",
				x2: "x2",
				y1: "y1",
				y2: "y2",
				fill: COLORES.escaso,
				inset: 0.5,
			}),
			Plot.rect(suficientes, {
				x1: "x1",
				x2: "x2",
				y1: "y1",
				y2: "y2",
				fill: "tasa",
				inset: 0.5,
				title: texto,
				tip: true,
			}),
			Plot.frame({ stroke: "#D9E0E4" }),
		],
	});
}

function dibujarHistograma(v, lienzo) {
	const validos = data.filter((d) => Number.isFinite(d[v]));
	const potable = validos.filter((d) => d.Potability === 1);
	const noPotable = validos.filter((d) => d.Potability === 0);
	const { ext } = rejilla[v];
	const umbrales = d3.ticks(ext[0], ext[1], INTERVALOS_HIST);

	return Plot.plot({
		width: Math.max(lienzo.clientWidth, 240),
		height: 240,
		marginLeft: 52,
		marginRight: 10,
		marginBottom: 40,
		style: { fontFamily: "inherit", fontSize: "11px" },
		x: { label: etiquetaEje(v), domain: ext, ticks: 4 },
		y: { label: "Proporción", percent: true, grid: true },
		marks: [
			Plot.rectY(
				noPotable,
				Plot.binX(
					{ y: "proportion" },
					{
						x: v,
						thresholds: umbrales,
						fill: COLORES.noPotable,
						fillOpacity: 0.35,
						inset: 0.5,
					},
				),
			),
			Plot.lineY(
				potable,
				Plot.binX(
					{ y: "proportion", filter: null },
					{
						x: v,
						thresholds: umbrales,
						curve: "step",
						stroke: COLORES.potable,
						strokeWidth: 2,
						tip: true,
					},
				),
			),
			Plot.ruleY([0]),
		],
	});
}

// --------------------------------------------
// Panel
// --------------------------------------------
function crearTarjeta(titulo) {
	const tarjeta = document.createElement("article");
	tarjeta.className = "min-w-0 rounded-[10px] border border-linea bg-white p-4";
	const badge = "";
	tarjeta.innerHTML = `
		<header class="flex items-start justify-between gap-2">
			<div class="min-w-0">
				<h3 class="m-0 text-sm font-medium">${titulo}</h3>
				<p class="m-0 mt-0.5 text-[11px] text-suave"></p>
			</div>
			${badge}
		</header>
		<div class="grafica mt-2"></div>`;
	panel.append(tarjeta);
	return tarjeta.querySelector(".grafica");
}

let graficas = [];
let ranking = null;

function construirPanel(modo) {
	panel.innerHTML = "";
	graficas = [];

	if (modo === MODO_TOP) {
		const top = ranking.slice(0, TOP_PARES);
		const conSenal = top.filter((p) => p.senal).length;
		top.forEach((p, i) => {
			const lienzo = crearTarjeta(
				`${i + 1}. ${nombre(p.vx)} × ${nombre(p.vy)}`,
				`Relación ${fmtMetrica(p.valor)}, azar ${fmtMetrica(p.base)} (${p.razon.toFixed(1)}×)`,
				p,
			);
			graficas.push({ lienzo, dibujar: (l) => dibujarMapa(p.vx, p.vy, l) });
		});
	} else {
		const vx = modo;
		variables
			.filter((vy) => vy !== vx)
			.forEach((vy) => {
				const par = ranking.find(
					(p) => (p.vx === vx && p.vy === vy) || (p.vx === vy && p.vy === vx),
				);
				const lienzo = crearTarjeta(
					`${nombre(vx)} × ${nombre(vy)}`,
					`Relación ${fmtMetrica(par.valor)}, azar ${fmtMetrica(par.base)}`,
					par,
				);
				graficas.push({ lienzo, dibujar: (l) => dibujarMapa(vx, vy, l) });
			});
	}

	dibujarTodas();
}

function dibujarTodas() {
	for (const { lienzo, dibujar } of graficas) {
		lienzo.innerHTML = "";
		lienzo.append(dibujar(lienzo));
	}
}

// --------------------------------------------
// Select: «Mayor relación» primero, luego cada variable
// --------------------------------------------
selector.innerHTML =
	`<optgroup label="Resumen"><option value="${MODO_TOP}">Mayor relación</option></optgroup>` +
	`<optgroup label="Por variable">${variables.map((v) => `<option value="${v}">${nombre(v)}</option>`).join("")}</optgroup>`;
selector.value = MODO_TOP;
selector.disabled = true;

dibujarLeyenda();

// Se deja pintar el mensaje antes del cálculo (tarda menos de un segundo)
setTimeout(() => {
	ranking = rankingPares();
	selector.disabled = false;
	selector.addEventListener("change", () => construirPanel(selector.value));
	construirPanel(selector.value);
}, 30);

// --------------------------------------------
// Redibujar al cambiar el ancho del panel
// --------------------------------------------
let temporizador;
let anchoPrevio = panel.clientWidth;

new ResizeObserver(() => {
	if (panel.clientWidth === anchoPrevio) return;
	anchoPrevio = panel.clientWidth;
	clearTimeout(temporizador);
	temporizador = setTimeout(dibujarTodas, 150);
}).observe(panel);
