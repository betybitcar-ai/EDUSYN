// Uso: npm run cargar-profesores  (crea las cuentas de los 18 profesores y deja el horario de Silvio en la suya)
require('dotenv').config();
const { crearCuentasProfesores } = require('../lib/cuentasProfesores');
const { cargarHorarioSilvio } = require('../lib/horarioSilvio');
const { cargarHorarioSaul } = require('../lib/horarioSaul');
const { cargarHorarioValentina } = require('../lib/horarioValentina');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');
const r = crearCuentasProfesores();
for (const p of r) console.log(`${p.creada ? 'creada ' : 'ya existía'}  ${p.nombre.padEnd(20)} ${p.email}`);
cargarHorarioSilvio();
cargarHorarioSaul();
cargarHorarioValentina();
console.log(`Clases vinculadas a cuentas: ${vincularBloquesPorNombre()}`);
