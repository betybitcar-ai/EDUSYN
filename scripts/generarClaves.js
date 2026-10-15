// Genera valores aleatorios y seguros para el .env:  npm run generar-claves
const { randomBytes } = require('crypto');
const clave = (n) => randomBytes(n).toString('base64url');
console.log('# Copiá estas líneas en tu .env (y guardá las claves en un lugar seguro)\n');
console.log(`SESSION_SECRET=${clave(32)}`);
console.log(`PROFE_CODE=PROFE-${clave(6)}`);
console.log(`ADMIN_CODE=ADMIN-${clave(6)}`);
console.log('NODE_ENV=production');
