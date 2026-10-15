// Uso: npm run cargar-silvio  (vuelve a cargar el horario de Silvio Fagundez desde lib/horarioSilvio.js)
require('dotenv').config();
const { cargarHorarioSilvio } = require('../lib/horarioSilvio');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');
console.log(`Clases cargadas: ${cargarHorarioSilvio({ forzar: true })}`);
console.log(`Vinculadas a cuentas existentes: ${vincularBloquesPorNombre()}`);
