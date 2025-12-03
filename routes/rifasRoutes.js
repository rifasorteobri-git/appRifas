const express = require('express');
const dbConnect = require('../db/connect');
//variable router para utilizar la solicitud http (GET/POST/PUT/DELETE) en express
const router = express.Router();
//llamada a la conexion de la base de datos
const db = dbConnect();
const generarBoletos = require('../utils/generarBoletos');

//creación de rifa y generar boletos
router.post('/log/administrador/crearRifas', async (req, res) => {
  try {
    const { titulo, cantidad_boletos } = req.body;
    const n = parseInt(cantidad_boletos, 10);
    if (!titulo || isNaN(n) || n < 1 || n > 1000) return res.status(400).json({ error: 'Datos inválidos' });

    // crear rifa
    const { data: rifa, error: errR } = await db
      .from('rifas')
      .insert({ titulo, cantidad_boletos: n, estado: 'activa' })
      .select()
      .single();

    if (errR) throw errR;

    // generar boletos
    const numeros = generarBoletos(n);

    // insertar boletos (por lotes)
    const inserts = numeros.map(num => ({
      rifa_id: rifa.id_rifas,
      numero_boleto: num,
      estado: 'libre'
    }));

    // supabase limita inserts; si son muchos, dividir en batches de 300
    const BATCH = 300;
    for (let i = 0; i < inserts.length; i += BATCH) {
      const batch = inserts.slice(i, i + BATCH);
      const { error: errIns } = await db.from('boletos').insert(batch);
      if (errIns) throw errIns;
    }

    res.json({ rifa, boletos: numeros });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || err });
  }
});

// Listar rifas
router.get('/log/administrador/listarRifas', async (req, res) => {
  try {
    const { data, error } = await db.from('rifas').select('*').order('id_rifas', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Obtener boletos de una rifa
router.get('/log/administrador/rifas/boletos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { data, error } = await db.from('boletos').select('*').eq('rifa_id', id).order('id_boletos');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Endpoint FINALIZAR SORTEO (backend elige ganador de forma segura)
router.post('/log/administrador/rifas/sorteo/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id rifa inválido' });

    // 1) Obtener todos los boletos (se puede filtrar para solo vendidos si lo deseas)
    const { data: all, error: errAll } = await db
      .from('boletos')
      .select('numero_boleto, nombre_cliente, apellido_cliente, telefono_cliente')
      .eq('rifa_id', id);

    if (errAll) throw errAll;
    if (!all || all.length === 0) return res.status(400).json({ error: 'No hay boletos' });

    // 2) mezclar (Fisher-Yates)
    for (let i = all.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [all[i], all[j]] = [all[j], all[i]];
    }
    const ganador = all[0];

    // 3) persistir ganador y actualizar rifas y boletos (en transacciones separadas)
    const { error: errG } = await supabase.from('ganadores').insert([{
      rifa_id: id,
      numero_ganador: ganador.numero_boleto,
      nombre_ganador: ganador.nombre_cliente,
      apellido_ganador: ganador.apellido_cliente,
      telefono_ganador: ganador.telefono_cliente
    }]);
    if (errG) throw errG;

    // actualizar boleto ganador (set ganador true y estado)
    const { error: errUpdB } = await db
      .from('boletos')
      .update({ ganador: true, estado: 'vendido' })
      .eq('rifa_id', id)
      .eq('numero_boleto', ganador.numero_boleto);
    if (errUpdB) throw errUpdB;

    // actualizar rifas: numero_ganador y estado
    const { data: updatedRifa, error: errUpdR } = await db
      .from('rifas')
      .update({ numero_ganador: ganador.numero_boleto, estado: 'sorteada' })
      .eq('id_rifas', id)
      .select()
      .single();
    if (errUpdR) throw errUpdR;

    // Responder al admin
    res.json({
      mensaje: 'Sorteo finalizado',
      ganador: {
        numero: ganador.numero_boleto,
        nombre: ganador.nombre_ganador,
        apellido: ganador.apellido_ganador,
        telefono: ganador.telefono_ganador
      },
      rifa: updatedRifa
    });
  } catch (err) {
    console.error('error sorteo', err);
    res.status(500).json({ error: err.message || err });
  }
});

module.exports = router;

