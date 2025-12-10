const express = require('express');
const router = express.Router();
//llamada a la conexion de la base de datos
const supabase = require('../db/supabaseClient'); //conexión a Supabase API (service_role)

// Asignar boletos (llama a la RPC)
router.post('/administrador/boletos/asignar/:rifaId', async (req, res) => {
    try {
        const rifaId = parseInt(req.params.rifaId, 10);
        const { nombre_cliente, apellido_cliente, telefono_cliente, cantidad } = req.body;
        const cant = parseInt(cantidad, 10);
        if (!nombre || !apellido || !telefono || isNaN(cant) || cant <= 0) return res.status(400).json({ error: 'Datos inválidos' });

        const { data, error } = await supabase.rpc('asignar_boletos_a_persona', {
        p_rifa_id: rifaId,
        p_nombre: nombre_cliente,
        p_apellido: apellido_cliente,
        p_telefono: telefono_cliente,
        p_cantidad: cant
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

//Buscar por nombre
router.get('/administrador/boletos/buscar/:rifa_id/:nombre', async (req, res) => {
    const {rifa_id, nombre} = req.params;
    try {
        const { data, error } = await supabase
        .from('boletos')
        .select('*')
        .eq('rifa_id', rifa_id)
        .ilike('nombre_cliente', `%${nombre}%`);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
})

//Eliminar un boleto y volverlo a poner en libre
router.put('/administrador/boletos/liberarBoleto/:id_boleto', async (req, res) => {
    const { id_boleto } = req.params;
    try {
        const { data, error } = await supabase
        .rpc('liberar_boleto', { p_id_boleto: id_boleto });

        if (error) throw error;
        res.json({
            mensaje: 'Boleto liberado correctamente',
            boleto: data[0]
        });
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
})

module.exports = router;
