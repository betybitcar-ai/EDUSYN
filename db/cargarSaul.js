// Uso: npm run cargar-saul  (vuelve a cargar el horario de Saúl Pereira desde lib/horarioSaul.js)
require('dotenv').config();
const { cargarHorarioSaul } = require('../lib/horarioSaul');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');
console.log(`Clases cargadas: ${cargarHorarioSaul({ forzar: true })}`);
console.log(`Vinculadas a cuentas existentes: ${vincularBloquesPorNombre()}`);
