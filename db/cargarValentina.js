// Uso: npm run cargar-valentina  (vuelve a cargar el horario de Valentina Rodríguez desde lib/horarioValentina.js)
require('dotenv').config();
const { cargarHorarioValentina } = require('../lib/horarioValentina');
const { vincularBloquesPorNombre } = require('../lib/horariosLib');
console.log(`Clases cargadas: ${cargarHorarioValentina({ forzar: true })}`);
console.log(`Vinculadas a cuentas existentes: ${vincularBloquesPorNombre()}`);
