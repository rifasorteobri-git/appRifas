const express = require('express');
const dbConnect = require('../db/connect');
const router = express.Router();
//llamada a la conexion de la base de datos
const db = dbConnect();

// Asignar boletos (llama a la RPC)
router.post('/log/administrador/boletos/asignar/:rifaId', async (req, res) => {
    try {
        const rifaId = parseInt(req.params.rifaId, 10);
        const { nombre, apellido, telefono, cantidad } = req.body;
        const cant = parseInt(cantidad, 10);
        if (!nombre || !apellido || isNaN(cant) || cant <= 0) return res.status(400).json({ error: 'Datos inválidos' });

        const { data, error } = await db.rpc('asignar_boletos_a_persona', {
        p_rifa_id: rifaId,
        p_nombre_cliente: nombre,
        p_apellido_cliente: apellido,
        p_telefono_cliente: telefono || null,
        p_cantidad_boletos: cant
        });

        if (error) {
        console.error('RPC assign error', error);
        return res.status(400).json({ error: error.message || error });
        }

        res.json({ asignados: data });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || err });
    }
});

module.exports = router;
