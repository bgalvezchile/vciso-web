// Flow llama a esta URL con POST después del pago
// Redirige al usuario a pago-exitoso.html con el token
module.exports = async (req, res) => {
  const token = (req.body && req.body.token) || req.query.token || '';
  return res.redirect(302, `/pago-exitoso.html?token=${token}`);
};
