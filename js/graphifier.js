// histogramas-variables.js
// Dibuja un histograma por cada variable del CSV, comparando agua potable
// y no potable en la misma gráfica (mismos intervalos, eje Y en proporción).
// Uso en el HTML:
//   <div id="histogramas" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4"></div>
//   <script type="module" src="histogramas-variables.js"></script>

import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

// --------------------------------------------
// Configuración
// --------------------------------------------
const RUTA_CSV = "https://raw.githubusercontent.com/GiovanniCrois/Data_Visualization_Project_Final_Dashboard/5feb4b76bf7ba3bf27dbdd91ac11884a563c8341/data/water_potability.csv";
const NUM_INTERVALOS = 25;

const COLORES = { potable: "#1F5C99", noPotable: "#C8692B" };

// Nombre en español y unidad de cada columna del CSV
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

const contenedor = document.getElementById("histogramas");

// --------------------------------------------
// Leer el CSV
// d3.autoType convierte los textos a números y las celdas vacías a null
// --------------------------------------------
const data = await d3.csv(RUTA_CSV, d3.autoType);
const variables = data.columns.filter((c) => c !== "Potability");

// --------------------------------------------
// Crear una tarjeta por variable (una sola vez)
// --------------------------------------------
const tarjetas = variables.map((variable) => {
	const { nombre, unidad } = ETIQUETAS[variable] ?? { nombre: variable, unidad: "" };

	// Cada variable se filtra por separado: así una fila con un nulo en
	// sulfato no se pierde en las demás gráficas.
	const validos = data.filter((d) => Number.isFinite(d[variable]));
	const faltantes = data.length - validos.length;

	const tarjeta = document.createElement("article");
	tarjeta.className = "min-w-0 rounded-[10px] border border-linea bg-white p-4";
	tarjeta.innerHTML = `
		<header class="flex items-baseline justify-between gap-2">
			<h3 class="m-0 text-sm font-medium">${nombre}</h3>
			<span class="font-mono text-[11px] text-suave">${unidad || "escala 0–14"}</span>
		</header>
		<div class="grafica mt-1"></div>
	`;
	contenedor.append(tarjeta);

	return {
		variable,
		etiqueta: unidad ? `${nombre} (${unidad})` : nombre,
		potable: validos.filter((d) => d.Potability === 1),
		noPotable: validos.filter((d) => d.Potability === 0),
		dominio: d3.extent(validos, (d) => d[variable]),
		lienzo: tarjeta.querySelector(".grafica"),
	};
});

// --------------------------------------------
// Dibujar un histograma
// --------------------------------------------
function dibujarHistograma({ variable, etiqueta, potable, noPotable, dominio, lienzo }) {
	lienzo.innerHTML = "";

	// Los mismos intervalos para ambas clases, para que las barras se alineen
	const umbrales = d3.ticks(dominio[0], dominio[1], NUM_INTERVALOS);

	// Agua NO potable: barras rellenas, como fondo de referencia
	const barrasNoPotable = Plot.rectY(
		noPotable,
		Plot.binX(
			{ y: "proportion" },
			{
				x: variable,
				thresholds: umbrales,
				fill: COLORES.noPotable,
				fillOpacity: 0.35,
				inset: 0.5,
			},
		),
	);

	// Agua potable: contorno escalonado encima de las barras.
	// curve "step" pone los escalones justo en los bordes de cada intervalo,
	// y filter: null conserva los intervalos vacíos para que la línea baje a 0.
	const contornoPotable = Plot.lineY(
		potable,
		Plot.binX(
			{ y: "proportion", filter: null },
			{
				x: variable,
				thresholds: umbrales,
				curve: "step",
				stroke: COLORES.potable,
				strokeWidth: 2,
				tip: true,
			},
		),
	);

	const chart = Plot.plot({
		width: Math.max(lienzo.clientWidth, 240),
		height: 220,
		marginLeft: 44,
		marginRight: 12,
		marginBottom: 40,
		style: { fontFamily: "inherit", fontSize: "11px" },
		x: { label: etiqueta, domain: dominio, grid: true },
		// "proportion" compara la forma de las distribuciones aunque haya
		// más muestras no potables que potables
		y: { label: "Proporción", percent: true, grid: true },
		marks: [
			barrasNoPotable,
			contornoPotable,
			Plot.ruleY([0]),
		],
	});

	lienzo.append(chart);
}

function dibujarTodos() {
	tarjetas.forEach(dibujarHistograma);
}

dibujarTodos();

// --------------------------------------------
// Redibujar al cambiar el tamaño del contenedor
// --------------------------------------------
let temporizador;
let anchoPrevio = contenedor.clientWidth;

new ResizeObserver(() => {
	if (contenedor.clientWidth === anchoPrevio) return;
	anchoPrevio = contenedor.clientWidth;
	clearTimeout(temporizador);
	temporizador = setTimeout(dibujarTodos, 150);
}).observe(contenedor);