// Verifica que haya una sesión activa (usuario logueado)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'No autenticado. Iniciá sesión para continuar.' });
  }
  next();
}

// Verifica que el usuario logueado tenga uno de los roles permitidos
// Uso: requireRole('admin') o requireRole('admin', 'profesor')
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'No autenticado. Iniciá sesión para continuar.' });
    }
    if (!rolesPermitidos.includes(req.session.user.rol)) {
      return res.status(403).json({
        error: `Acceso denegado. Se requiere rol: ${rolesPermitidos.join(' o ')}.`
      });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
