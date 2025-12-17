const jwt = require('jsonwebtoken');

function verificarToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: 'Token no proporcionado' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // AQUÍ se arma req.user correctamente
        req.user = {
            id_administrador: decoded.id,
            rol: decoded.rol
        };

        next();
    } catch (error) {
        return res.status(401).json({ message: 'Token inválido o expirado' });
    }
}

module.exports = verificarToken;