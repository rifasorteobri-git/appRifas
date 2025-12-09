const express = require('express');
//variable router para utilizar la solicitud http (GET/POST/PUT/DELETE) en express
const router = express.Router();
//llamada a la conexion de la base de datos
const supabase = require('../db/supabaseClient'); //conexión a Supabase API (service_role)
const generarBoletos = require('../utils/generarBoletos');
const sharp = require('sharp'); //Necesario para convertir el buffer
const multer = require('multer');
const upload = multer(); // Usamos memoria (sin archivos físicos)

//creación de rifa y generar boletos
router.post('/administrador/crearRifas', upload.single('imagenRifas'), async (req, res) => {
  try {
    if (!req.file) {
        console.log('No se ha proporcionado ninguna imagen');
        return res.status(400).json({ message: 'No se ha proporcionado ninguna imagen.' });
    }

    const imagenNombreRifa = req.file.originalname;

    const { data: existente, error: existingError } = await supabase
        .storage
        .from('imagen-rifas')
        .list('', { search: imagenNombreRifa });
    
    if (existingError) {
        console.error('Error al verificar existencia de imagen:', existingError.message);
        return res.status(500).json({ message: 'Error al verificar la existencia de la imagen en Supabase.' });
    }

    if (existente.length > 0) {
        console.log('La imagen ya existe en Supabase');
        return res.status(400).json({ message: 'Esta imagen ya está registrada en la base de datos. Por favor, cargue una imagen con otro nombre.' });
    }

    const buffer = await sharp(req.file.buffer).toBuffer();
    const { error: uploadError } = await supabase
        .storage
        .from('imagen-rifas')
        .upload(imagenNombreRifa, buffer, {
            contentType: req.file.mimetype,
            upsert: false
        });
    
    if (uploadError) {
        console.error('Error al subir la imagen a Supabase:', uploadError.message);
        return res.status(500).json({ message: 'Error al subir la imagen a Supabase.' });
    }

    const urlPublica = `${process.env.SUPABASE_URL}/storage/v1/object/public/imagen-rifas/${imagenNombreRifa}`;

    const { titulo, cantidad_boletos, descripcion, condicion } = req.body;
    const n = parseInt(cantidad_boletos, 10);
    
    if (!titulo || !descripcion || !urlPublica || !imagenNombreRifa || !condicion || isNaN(n) || n < 1 || n > 1000) return res.status(400).json({ error: 'Datos inválidos' });

    // crear rifa
    const { data: rifa, error: errR } = await supabase
      .from('rifas')
      .insert({ titulo, cantidad_boletos: n, estado: 'activa', descripcion, url_imagen_rifa: urlPublica, nombre_imagen_rifa: imagenNombreRifa, condicion })
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
      const { error: errIns } = await supabase.from('boletos').insert(batch);
      if (errIns) throw errIns;
    }

    res.json({ rifa, boletos: numeros });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Listar rifas
router.get('/administrador/listarRifas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rifas').select('*').order('id_rifas', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

//Obtener una sola rifa
router.get('/administrador/obtenerRifa/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('rifas').select('*').eq('id_rifas', id).single();
    if (error) throw error;
    res.json(data);
  } catch(err) {
    res.status(500).json({ error: err.message || err });
  }
})

//Obtener el total de vendidos
router.get('/administrador/obtenerVendidosRifa/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('boletos').select('*', {count: 'exact', head: true}).eq('rifa_id', id).eq('estado', 'vendido');
    if (error) throw error;
    res.json({vendidos: data});
  } catch(err) {
    res.status(500).json({ error: err.message || err });
  }
})

// Editar rifa
router.put('/administrador/editarRifa/:id', upload.single('imagenRifas'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { titulo, cantidad_boletos, descripcion, condicion } = req.body;

    const nuevoTotal = parseInt(cantidad_boletos, 10);
    if (!titulo || !descripcion || !condicion || isNaN(nuevoTotal) || nuevoTotal < 1 || nuevoTotal > 1000) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }

    // Obtener rifa actual
    const { data: rifaActual, error: errRifa } = await supabase.from('rifas').select('*').eq('id_rifas', id).single();

    if (errRifa || !rifaActual) {
      return res.status(400).json({ error: 'La rifa no existe' });
    }

    const actualTotal = rifaActual.cantidad_boletos;
    const oldImageUrl = rifaActual.url_imagen_rifa;
    const oldImageName = rifaActual.nombre_imagen_rifa;

    let nuevaUrl = oldImageUrl;
    let nuevoNombreImagen = oldImageName;

    if (req.file) {
        const imagenNombreRifa = req.file.originalname;

        const { data: existente } = await supabase
            .storage
            .from('imagen-rifas')
            .list('', { search: imagenNombreRifa });

        if (existente.length > 0) {
            return res.status(400).json({ message: 'Esta imagen ya está registrada en la base de datos. Por favor, cargue una imagen con otro nombre.' });
        }

        const buffer = await sharp(req.file.buffer).toBuffer();
        const { error: uploadError } = await supabase
            .storage
            .from('imagen-rifas')
            .upload(imagenNombreRifa, buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });

        if (uploadError) {
            console.error('Error al subir la imagen a Supabase:', uploadError);
            return res.status(500).json({ message: 'Error al subir la imagen a Supabase' });
        }

        nuevaUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/imagen-rifas/${imagenNombreRifa}`;
        nuevoNombreImagen = imagenNombreRifa;

        if (oldImageName) {
            await supabase
                .storage
                .from('imagen-rifas')
                .remove([oldImageName]);
        }
    }

    // -------------------------------------------------------
    // CASO 1: AUMENTAR BOLETOS
    // -------------------------------------------------------
    if (nuevoTotal > actualTotal) {
      const cantidadNueva = nuevoTotal - actualTotal;

      // Generar nuevos boletos con la misma lógica del backend
      const nuevosNumeros = generarBoletos(cantidadNueva);

      // Llamar RPC de aumento
      const { data: aumento, error: errAumento } = await supabase.rpc(
        'aumentar_boletos_rifa',
        {
          p_rifa_id: id,
          p_nueva_cantidad: nuevoTotal,
          p_boletos_nuevos: nuevosNumeros // tu función del backend
        }
      );

      if (errAumento) {
        console.error(errAumento);
        return res.status(400).json({ error: errAumento.message });
      }
      //Para saber los boletos que se aumentaron
      //res.json({ creados: aumento });
    }

    // -------------------------------------------------------
    // CASO 2: REDUCIR BOLETOS
    // -------------------------------------------------------
    if (nuevoTotal < actualTotal) {

      const { data: reduccion, error: errReduccion } = await supabase.rpc(
        'reducir_boletos_rifa',
        {
          p_rifa_id: id,
          p_nueva_cantidad: nuevoTotal
        }
      );

      if (errReduccion) {
        console.error(errReduccion);
        return res.status(400).json({ error: errReduccion.message });
      }
      // Para saber los boletos que se redujeron
      //res.json({ eliminados: reduccion });
    }

    // -------------------------------------------------------
    // CASO 3: SI SOLO SE CAMBIA EL TITULO (SIN CAMBIAR CANTIDAD)
    // -------------------------------------------------------
    const { error: errUpdate } = await supabase.from('rifas').update({ titulo, descripcion, url_imagen_rifa:nuevaUrl, nombre_imagen_rifa:nuevoNombreImagen, condicion }).eq('id_rifas', id);

    if (errUpdate) throw errUpdate;

    return res.json({
      message: 'Rifa actualizada correctamente',
      titulo,
      nueva_cantidad: nuevoTotal
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || err });
  }
});

// Eliminar rifa
router.delete('/administrador/eliminarRifa/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // Obtener nombre de la imagen
    const { data: nombreImagenRifa, error: errRifa } = await supabase.from('rifas').select('nombre_imagen_rifa').eq('id_rifas', id).single();
    
    if (errRifa || !nombreImagenRifa) {
      return res.status(400).json({ error: 'Imagen no existe' });
    }

    const nombreImagen = nombreImagenRifa.nombre_imagen_rifa
    // Eliminar la imagen desde Supabase Storage
    const { error: deleteError } = await supabase
      .storage
      .from('imagen-rifas')
      .remove([nombreImagen]);

    if (deleteError) {
      console.error('Error al eliminar la imagen de Supabase:', deleteError);
      return res.status(500).json({ error: 'No se pudo eliminar la imagen del almacenamiento' });
    }

    // Primero eliminar los boletos asociados (si tu DB tiene FK con ON DELETE RESTRICT)
    await supabase.from('boletos').delete().eq('rifa_id', id);
    // Luego eliminar la rifa
    const { error } = await supabase.from('rifas').delete().eq('id_rifas', id);
    if (error) throw error;
    res.json({ message: 'Rifa eliminada correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Obtener boletos de una rifa
router.get('/administrador/rifas/boletos/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { data, error } = await supabase.from('boletos').select('*').eq('rifa_id', id).order('id_boletos');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Endpoint FINALIZAR SORTEO (backend elige ganador de forma segura)
router.post('/administrador/rifas/sorteo/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id rifa inválido' });

    // 1) Obtener todos los boletos (se puede filtrar para solo vendidos si lo deseas)
    const { data: all, error: errAll } = await supabase
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
    const { error: errUpdB } = await supabase
      .from('boletos')
      .update({ ganador: true, estado: 'ganador' })
      .eq('rifa_id', id)
      .eq('numero_boleto', ganador.numero_boleto);
    if (errUpdB) throw errUpdB;

    // actualizar rifas: numero_ganador y estado
    const { data: updatedRifa, error: errUpdR } = await supabase
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
    res.status(500).json({ error: err.message || err });
  }
});

//Revertir sorteo
router.put('/administrador/rifas/revertir-sorteo/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (!id) return res.status(400).json({ error: 'ID de rifa inválido' });
    // Obtener la rifa
    const { data: rifa, error: errRifa } = await supabase
      .from('rifas')
      .select('*')
      .eq('id_rifas', id)
      .single();

    if (errRifa) throw errRifa;

    if (!rifa) return res.status(404).json({ error: 'Rifa no encontrada' });

    if (!rifa.numero_ganador) {
      return res.status(400).json({
        error: "Esta rifa no tiene ganador registrado o no ha sido sorteada"
      });
    }

    const numeroGanador = rifa.numero_ganador;

    // Eliminar ganador de la tabla ganadores
    const { error: errDelWinner } = await supabase
      .from('ganadores')
      .delete()
      .eq('rifa_id', id);

    if (errDelWinner) throw errDelWinner;

    // Reiniciar el boleto ganador
    const { error: errResetBoleto } = await supabase
      .from('boletos')
      .update({
        ganador: false,
        estado: 'vendido' // o 'vendido' si así manejas tus estados
      })
      .eq('rifa_id', id)
      .eq('numero_boleto', numeroGanador);

    if (errResetBoleto) throw errResetBoleto;

    // Actualizar rifa: volver a activa y borrar número ganador
    const { error: errResetRifa } = await supabase
      .from('rifas')
      .update({
        estado: 'activa',
        numero_ganador: null
      })
      .eq('id_rifas', id);

    if (errResetRifa) throw errResetRifa;

    return res.json({
      mensaje: 'Sorteo revertido correctamente',
      detalles: {
        rifa_id: id,
        boleto_revertido: numeroGanador
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

module.exports = router;

