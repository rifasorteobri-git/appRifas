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

    const { titulo, cantidad_boletos, descripcion, condicion, precio, cantidad_premios } = req.body;
    const n = parseInt(cantidad_boletos, 10);
    
    if (!titulo || !descripcion || !urlPublica || !imagenNombreRifa || !condicion || !precio || !cantidad_premios || isNaN(n) || n < 1 || n > 1000) return res.status(400).json({ error: 'Datos inválidos' });

    // crear rifa
    const { data: rifa, error: errR } = await supabase
      .from('rifas')
      .insert({ titulo, cantidad_boletos: n, estado: 'activa', descripcion, url_imagen_rifa: urlPublica, nombre_imagen_rifa: imagenNombreRifa, condicion, precio, cantidad_premios })
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

// Listar rifas activas modo publico
router.get('/publico/rifas/activas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rifas').select('*').eq('condicion', "Visible").order('id_rifas', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || err });
  }
});

// Listar rifas finalizadas modo publico
router.get('/publico/rifas/inactivas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('rifas').select('*').eq('condicion', "No visible").order('id_rifas', { ascending: false });
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

//Obtener el porcentaje de boletos de una rifa
router.get('/administrador/obtenerPorcentajeBoletos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.rpc('porcentaje_boletos', { rifa: Number(id) });
    if (error) throw error;
    res.json({ porcentaje: data });
  } catch(err) {
    res.status(500).json({ error: err.message || err });
  }
})

// Editar rifa
router.put('/administrador/editarRifa/:id', upload.single('imagenRifas'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { titulo, cantidad_boletos, descripcion, condicion, precio, cantidad_premios } = req.body;

    const nuevoTotal = parseInt(cantidad_boletos, 10);
    if (!titulo || !descripcion || !condicion || !precio || !cantidad_premios || isNaN(nuevoTotal) || nuevoTotal < 1 || nuevoTotal > 1000) {
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
    const { error: errUpdate } = await supabase.from('rifas').update({ titulo, descripcion, url_imagen_rifa:nuevaUrl, nombre_imagen_rifa:nuevoNombreImagen, condicion, precio, cantidad_premios }).eq('id_rifas', id);

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

// Endpoint FINALIZAR SORTEO (backend elige ganador de forma segura) uso para rifas rapidas u otros casos
router.post('/administrador/rifas/sorteo/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const PERDEDORES_POR_PREMIO = 2;

    // Obtener rifa (para saber cuántos premios tiene)
    const { data: rifa, error: errRifa } = await supabase
      .from('rifas')
      .select('cantidad_premios, estado')
      .eq('id_rifas', id)
      .single();

    if (errRifa) throw errRifa;
    if (rifa.estado === 'sorteada') {
      return res.status(400).json({ error: 'La rifa ya fue sorteada' });
    }

    const cantidadPremios = rifa.cantidad_premios || 1;

    // Obtener boletos vendidos
    const { data: boletos, error } = await supabase
      .from('boletos')
      .select('numero_boleto, nombre_cliente, apellido_cliente, telefono_cliente')
      .eq('rifa_id', id)
      .eq('estado', 'vendido');

    if (error) throw error;
    if (!boletos || boletos.length === 0)
      return res.status(400).json({ error: 'No hay boletos vendidos' });

    // Validación mínima de boletos
    const minBoletos = cantidadPremios * (PERDEDORES_POR_PREMIO + 1);
    if (boletos.length < minBoletos) {
      return res.status(400).json({
        error: `Se requieren al menos ${minBoletos} boletos para ${cantidadPremios} premio(s)`
      });
    }

    // Mezclar boletos (Fisher-Yates)
    for (let i = boletos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [boletos[i], boletos[j]] = [boletos[j], boletos[i]];
    }

    // Seleccionar ganadores (2 pierden, 1 gana)
    let index = 0;
    const ganadores = [];

    for (let i = 0; i < cantidadPremios; i++) {
      index += PERDEDORES_POR_PREMIO; // saltamos perdedores

      const ganador = boletos[index];
      if (!ganador) break;

      ganadores.push({
        rifa_id: id,
        orden: i + 1,
        numero_ganador: ganador.numero_boleto,
        nombre_ganador: ganador.nombre_cliente,
        apellido_ganador: ganador.apellido_cliente,
        telefono_ganador: ganador.telefono_cliente
      });

      index++; // seguimos
    }

    // Guardar ganadores
    const { error: errInsert } = await supabase
      .from('ganadores')
      .insert(ganadores);

    if (errInsert) throw errInsert;

    // Marcar boletos ganadores
    for (const g of ganadores) {
      await supabase
        .from('boletos')
        .update({ ganador: true, estado: 'ganador' })
        .eq('rifa_id', id)
        .eq('numero_boleto', g.numero_ganador);
    }

    // Actualizar rifa
    await supabase
      .from('rifas')
      .update({ estado: 'sorteada' })
      .eq('id_rifas', id);

    res.json({
      mensaje: 'Sorteo realizado correctamente',
      cantidad_premios: cantidadPremios,
      ganadores
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//Sorteo en vivo --> este endpoint se usará para realizar los sorteos en vivo. Se crea una nueva tabla para manejar los sorteos en vivo
//Tabla sorteos_en_vivo
router.post('/administrador/rifas/sorteo-vivo/:id', async (req, res) => {
  try {
    const rifaId = req.params.id;

    // boletos vendidos
    const { data: boletos } = await supabase
      .from('boletos')
      .select('numero_boleto, nombre_cliente, apellido_cliente, telefono_cliente')
      .eq('rifa_id', rifaId)
      .eq('estado', 'vendido');

    if (!boletos || boletos.length < 3) {
      return res.status(400).json({ error: 'No hay suficientes boletos' });
    }

    // mezclar
    for (let i = boletos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [boletos[i], boletos[j]] = [boletos[j], boletos[i]];
    }

    // limpiar sorteos anteriores
    await supabase
      .from('sorteos_en_vivo')
      .delete()
      .eq('rifa_id', rifaId);

    // insertar perdedores
    for (let i = 0; i < 2; i++) {
      await supabase.from('sorteos_en_vivo').insert({
        rifa_id: rifaId,
        tipo: 'perdedor',
        numero_boleto: boletos[i].numero_boleto,
        orden: i + 1
      });

      await delay(2000);
    }

    // ganador
    const ganador = boletos[2];

    await supabase.from('sorteos_en_vivo').insert({
      rifa_id: rifaId,
      tipo: 'ganador',
      numero_boleto: ganador.numero_boleto,
      orden: 3
    });

    // persistir ganador
    await supabase.from('ganadores').insert({
      rifa_id: rifaId,
      numero_ganador: ganador.numero_boleto,
      nombre_ganador: ganador.nombre_cliente,
      apellido_ganador: ganador.apellido_cliente,
      telefono_ganador: ganador.telefono_cliente
    });

    await supabase
      .from('rifas')
      .update({ estado: 'sorteada', numero_ganador: ganador.numero_boleto })
      .eq('id_rifas', rifaId);

    res.json({ mensaje: 'Sorteo en vivo finalizado' });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

//Revertir sorteo
router.post('/administrador/rifas/revertir-sorteo/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'ID de rifa inválido' });

    // 1. Obtener ganadores de la rifa
    const { data: ganadores, error: errGan } = await supabase
      .from('ganadores')
      .select('numero_ganador')
      .eq('rifa_id', id);

    if (errGan) throw errGan;

    // 2. Revertir boletos ganadores
    if (ganadores.length > 0) {
      const numeros = ganadores.map(g => g.numero_ganador);

      const { error: errBol } = await supabase
        .from('boletos')
        .update({
          ganador: false,
          estado: 'vendido'
        })
        .eq('rifa_id', id)
        .in('numero_boleto', numeros);

      if (errBol) throw errBol;
    }

    // 3. Eliminar ganadores
    const { error: errDel } = await supabase
      .from('ganadores')
      .delete()
      .eq('rifa_id', id);

    if (errDel) throw errDel;

    // 4. Revertir rifa
    const { error: errRifa } = await supabase
      .from('rifas')
      .update({
        estado: 'activa',
        numero_ganador: null
      })
      .eq('id_rifas', id);

    if (errRifa) throw errRifa;

    // 5. (Opcional) limpiar sorteos en vivo
    await supabase
      .from('sorteos_en_vivo')
      .delete()
      .eq('rifa_id', id);

    res.json({ mensaje: 'Sorteo revertido completamente' });

  } catch (error) {
    res.status(500).json({ error: error.message || error });
  }
});

//Revertir 1 ganador
router.post('/administrador/rifas/revertir-ganador', async (req, res) => {
  try {
    const { rifa_id, numero_boleto } = req.body;

    if (!rifa_id || !numero_boleto) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // 1. Verificar que existe el ganador
    const { data: ganador, error: errGan } = await supabase
      .from('ganadores')
      .select('*')
      .eq('rifa_id', rifa_id)
      .eq('numero_ganador', numero_boleto)
      .single();

    if (errGan || !ganador) {
      return res.status(404).json({ error: 'Ganador no encontrado' });
    }

    // 2. Revertir boleto
    const { error: errBol } = await supabase
      .from('boletos')
      .update({
        ganador: false,
        estado: 'vendido'
      })
      .eq('rifa_id', rifa_id)
      .eq('numero_boleto', numero_boleto);

    if (errBol) throw errBol;

    // 3. Eliminar ganador
    const { error: errDel } = await supabase
      .from('ganadores')
      .delete()
      .eq('rifa_id', rifa_id)
      .eq('numero_ganador', numero_boleto);

    if (errDel) throw errDel;

    res.json({
      mensaje: 'Ganador revertido correctamente',
      numero_boleto
    });

  } catch (error) {
    res.status(500).json({ error: error.message || error });
  }
});


module.exports = router;

