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
    /* Imagen principal rifa */
    const { data: rifa, error: errRifa } = await supabase
      .from('rifas')
      .select('nombre_imagen_rifa')
      .eq('id_rifas', id)
      .single();

    if (rifa?.nombre_imagen_rifa) {
      const { error } = await supabase.storage
        .from('imagen-rifas')
        .remove([rifa.nombre_imagen_rifa]);

      if (error) {
        console.error('Error eliminando imagen rifa:', error);
      }
    }

    /* Imágenes ganadores */
    const { data: imagenesGanadores, error: errGanadores } = await supabase
      .from('imagenes_ganadores')
      .select('nombre_imagen_ganadores')
      .eq('rifa_id', id);

    if (errGanadores) throw errGanadores;

    if (imagenesGanadores.length > 0) {
      // Extraer solo los nombres
      const nombresImagenes = imagenesGanadores.map(
        img => img.nombre_imagen_ganadores
      );

      const { error } = await supabase.storage
        .from('imagen-ganadores')
        .remove(nombresImagenes);

      if (error) {
        console.error('Error eliminando imágenes ganadores:', error);
      }
    }

    /* Eliminaciones BD */
    await supabase.from('boletos').delete().eq('rifa_id', id);
    await supabase.from('imagenes_ganadores').delete().eq('rifa_id', id);
    await supabase.from('rifas').delete().eq('id_rifas', id);

    res.json({ message: 'Rifa e imágenes eliminadas correctamente' });

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


//Sorteo en vivo --> este endpoint se usará para realizar los sorteos en vivo. Se crea una nueva tabla para manejar los sorteos en vivo
//Tabla sorteos_en_vivo
router.post('/administrador/rifas/sorteo-en-vivo/:rifaId', async (req, res) => {
  try {
    const rifaId = parseInt(req.params.rifaId, 10);
    const { id_productos } = req.body;

    if (!rifaId || !id_productos) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    /* =====================================
       OBTENER LA RIFA Y VALIDAR PREMIOS
    ===================================== */
    const { data: rifa, error: errRifa } = await supabase
      .from('rifas')
      .select('cantidad_premios, estado')
      .eq('id_rifas', rifaId)
      .single();

    if (errRifa || !rifa) {
      return res.status(404).json({ error: 'Rifa no encontrada' });
    }

    if (rifa.estado === 'sorteada') {
      return res.status(400).json({
        error: 'La rifa ya fue sorteada'
      });
    }

    /* =====================================
       CUÁNTOS PREMIOS YA SE SORTEARON
    ===================================== */
    const { data: ganadoresPrevios, error: errPrevios } = await supabase
      .from('ganadores')
      .select('orden')
      .eq('rifa_id', rifaId);

    if (errPrevios) throw errPrevios;

    if (ganadoresPrevios.length >= rifa.cantidad_premios) {
      return res.status(400).json({
        error: 'Ya se han sorteado todos los premios de esta rifa'
      });
    }

    const ordenPremio = ganadoresPrevios.length + 1;

    /* =====================================
       OBTENER EL PRODUCTO (PREMIO)
    ===================================== */
    const { data: producto, error: errProducto } = await supabase
      .from('productos')
      .select('nombre_producto, url_imagen_producto')
      .eq('id_productos', id_productos)
      .single();

    if (errProducto || !producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    /* =====================================
       OBTENER BOLETOS PARTICIPANTES
    ===================================== */
    const { data: boletos, error: errBoletos } = await supabase
      .from('boletos')
      .select(`
        id_boletos,
        numero_boleto,
        nombre_cliente,
        apellido_cliente,
        telefono_cliente
      `)
      .eq('rifa_id', rifaId)
      .neq('ganador', true);

    if (errBoletos || !boletos || boletos.length < 3) {
      return res.status(400).json({
        error: 'No hay suficientes boletos para sortear'
      });
    }

    /* =====================================
       MEZCLAR BOLETOS
    ===================================== */
    for (let i = boletos.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [boletos[i], boletos[j]] = [boletos[j], boletos[i]];
    }

    const perdedores = boletos.slice(0, 2);
    const ganador = boletos[2];

    /* =====================================
       GUARDAR EN SORTEOS EN VIVO
    ===================================== */
    const eventosSorteo = [
      ...perdedores.map(p => ({
        rifa_id: rifaId,
        orden: ordenPremio,
        boleto_id: p.id_boletos,
        numero_boleto: p.numero_boleto,
        nombre_cliente: p.nombre_cliente,
        apellido_cliente: p.apellido_cliente,
        telefono_cliente: p.telefono_cliente,
        nombre_premio: producto.nombre_producto,
        imagen_premio: producto.url_imagen_producto,
        estado: 'perdedor'
      })),
      {
        rifa_id: rifaId,
        orden: ordenPremio,
        boleto_id: ganador.id_boletos,
        numero_boleto: ganador.numero_boleto,
        nombre_cliente: ganador.nombre_cliente,
        apellido_cliente: ganador.apellido_cliente,
        telefono_cliente: ganador.telefono_cliente,
        nombre_premio: producto.nombre_producto,
        imagen_premio: producto.url_imagen_producto,
        estado: 'ganador'
      }
    ];

    const { error: errSorteoEnVivo } = await supabase
      .from('sorteos_en_vivo')
      .insert(eventosSorteo);

    if (errSorteoEnVivo) throw errSorteoEnVivo;

    /* =====================================
       GUARDAR GANADOR FINAL
    ===================================== */
    const { error: errGanador } = await supabase
      .from('ganadores')
      .insert({
        rifa_id: rifaId,
        boleto_id: ganador.id_boletos,
        numero_ganador: ganador.numero_boleto,
        nombre_ganador: ganador.nombre_cliente,
        apellido_ganador: ganador.apellido_cliente,
        telefono_ganador: ganador.telefono_cliente,
        nombre_premio: producto.nombre_producto,
        imagen_premio: producto.url_imagen_producto,
        orden: ordenPremio
      });

    if (errGanador) throw errGanador;

    /* =====================================
       ACTUALIZAR BOLETO GANADOR
    ===================================== */
    const { error: errUpdateBoleto } = await supabase
      .from('boletos')
      .update({
        ganador: true,
        estado: 'ganador'
      })
      .eq('id_boletos', ganador.id_boletos);

    if (errUpdateBoleto) throw errUpdateBoleto;

    /* =====================================
      ACTUALIZAR ESTADO DE LA RIFA
    ===================================== */
    if (ordenPremio < rifa.cantidad_premios) {
      // Aún faltan premios → EN PROCESO
      const { error: errProceso } = await supabase
        .from('rifas')
        .update({ estado: 'en_proceso' })
        .eq('id_rifas', rifaId);

      if (errProceso) throw errProceso;

    } else {
      // Ya se sortearon todos → SORTEADA
      const { error: errFinalizar } = await supabase
        .from('rifas')
        .update({ estado: 'sorteada' })
        .eq('id_rifas', rifaId);

      if (errFinalizar) throw errFinalizar;
    }


    /* =====================================
       RESPUESTA
    ===================================== */
    res.json({
      mensaje: 'Sorteo realizado correctamente',
      premio: {
        orden: ordenPremio,
        nombre: producto.nombre_producto
      },
      ganador: {
        numero: ganador.numero_boleto,
        nombre: ganador.nombre_cliente,
        apellido: ganador.apellido_cliente,
        telefono: ganador.telefono_cliente
      },
      perdedores: perdedores.map(p => p.numero_boleto)
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Error en sorteo en vivo'
    });
  }
});

//Revertir sorteo
router.post('/administrador/rifas/revertir-sorteo/:rifaId', async (req, res) => {
  const rifaId = req.params.rifaId;
  try {
    /* Obtener ganadores */
    const { data: ganadores, error: errG } = await supabase
      .from('ganadores')
      .select('boleto_id')
      .eq('rifa_id', rifaId);

    if (errG) throw errG;

    /* Restaurar boletos */
    if (ganadores.length) {
      const boletoIds = ganadores.map(g => g.boleto_id);

      await supabase
        .from('boletos')
        .update({ estado: 'vendido', ganador: false })
        .in('id_boletos', boletoIds);
    }

    /* Eliminar registros */
    await supabase.from('ganadores').delete().eq('rifa_id', rifaId);
    await supabase.from('sorteos_en_vivo').delete().eq('rifa_id', rifaId);

    /* Restaurar rifa */
    await supabase
      .from('rifas')
      .update({ estado: 'activa' })
      .eq('id_rifas', rifaId);

    res.json({ mensaje: 'Sorteo revertido completamente' });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al revertir sorteo' });
  }
});

//Revertir 1 ganador
router.post('/administrador/rifas/revertir-ganador/:ganadorId', async (req, res) => {
  const ganadorId = req.params.ganadorId;

  try {
    /* Obtener ganador */
    const { data: ganador, error: errG } = await supabase
      .from('ganadores')
      .select('id_ganadores, rifa_id, boleto_id, orden')
      .eq('id_ganadores', ganadorId)
      .single();

    if (errG || !ganador) {
      return res.status(404).json({ error: 'Ganador no encontrado' });
    }

    /* Restaurar boleto */
    await supabase
      .from('boletos')
      .update({ estado: 'vendido', ganador: false })
      .eq('id_boletos', ganador.boleto_id);

    /* Eliminar ganador */
    await supabase.from('ganadores').delete().eq('id_ganadores', ganadorId);

    /* Eliminar eventos del sorteo */
    await supabase
      .from('sorteos_en_vivo')
      .delete()
      .eq('rifa_id', ganador.rifa_id)
      .eq('orden', ganador.orden);
    
    /* VER CUÁNTOS GANADORES QUEDAN */
    const { data: ganadoresRestantes, error: errRestantes } = await supabase
      .from('ganadores')
      .select('id_ganadores')
      .eq('rifa_id', ganador.rifa_id);

    if (errRestantes) throw errRestantes;

    /* ACTUALIZAR ESTADO DE LA RIFA */
    let nuevoEstado = 'activa';

    if (ganadoresRestantes.length > 0) {
      nuevoEstado = 'en_proceso';
    }

    await supabase
      .from('rifas')
      .update({ estado: nuevoEstado })
      .eq('id_rifas', ganador.rifa_id);

    /* RESPUESTA */
    res.json({
      mensaje: 'Ganador revertido correctamente',
      estado_rifa: nuevoEstado
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al revertir ganador' });
  }
});

//Eliminar registros de la tabla sorteos_en_vivo
router.delete('/administrador/rifas/sorteo-en-vivo/limpiar/:rifaId', async (req, res) => {
  try {
    const rifaId = parseInt(req.params.rifaId, 10);

    if (!rifaId) {
      return res.status(400).json({
        error: 'ID de rifa inválido'
      });
    }

    // Verificar que la rifa exista
    const { data: rifa, error: errRifa } = await supabase
      .from('rifas')
      .select('id_rifas')
      .eq('id_rifas', rifaId)
      .single();

    if (errRifa || !rifa) {
      return res.status(404).json({
        error: 'Rifa no encontrada'
      });
    }

    // Eliminar todos los registros del sorteo en vivo
    const { error: errDelete } = await supabase
      .from('sorteos_en_vivo')
      .delete()
      .eq('rifa_id', rifaId);

    if (errDelete) {
      throw errDelete;
    }

    res.json({
      mensaje: 'Registros de sorteo en vivo eliminados correctamente',
      rifaId: rifaId
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message || 'Error al limpiar sorteo en vivo'
    });
  }
});

//listar registros de la tabla sorteo-en-vivo
router.get('/administrador/rifas/sorteo-en-vivo/listar/:rifa_id', async (req, res) => {
  const rifa_id = req.params.rifa_id;
  try {
    const {data, error} = await supabase
    .from('sorteos_en_vivo')
    .select('*')
    .eq('rifa_id', rifa_id)
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener los registros' });
  }
} )



////////////////////// GANADORES ////////////////////////////////////
//Listar ganadores por rifa
router.get('/administrador/ganadores/:rifa_id', async (req, res) => {
  const rifa_id = req.params.rifa_id;
  try {
    const { data, error } = await supabase
    .from('ganadores')
    .select('*')
    .eq('rifa_id', rifa_id)
    .order('orden', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener ganadores' });
  }
})

//Subir imagenes de ganadores
router.post('/administrador/ganadores/subirImagenes/:rifa_id', upload.array('imagenGanadores', 10), async (req, res) => {
  const rifa_id = req.params.rifa_id;
  try {
    if (!req.files || req.files.length === 0) {
      console.log('No se ha proporcionado ninguna imagen');
      return res.status(400).json({ message: 'No se ha proporcionado ninguna imagen.' });
    }

    const resultados = [];

    for (const file of req.files) {
      const imagenNombreGanadores = file.originalname;
      /* Verificar si ya existe en Supabase Storage */
      const { data: existente, error: existingError } = await supabase
        .storage
        .from('imagen-ganadores')
        .list('', { search: imagenNombreGanadores });

      if (existingError) {
        console.error('Error al verificar existencia:', existingError.message);
        continue;
      }

      if (existente.length > 0) {
        resultados.push({
          nombre: imagenNombreGanadores,
          estado: 'duplicada'
        });
        continue;
      }

      /* Procesar imagen */
      const buffer = await sharp(file.buffer).toBuffer();

      /* Subir a Supabase Storage */
      const { error: uploadError } = await supabase
        .storage
        .from('imagen-ganadores')
        .upload(imagenNombreGanadores, buffer, {
          contentType: file.mimetype,
          upsert: false
        });

      if (uploadError) {
        console.error('Error al subir imagen:', uploadError.message);
        continue;
      }

      /* URL pública */
      const urlPublica = `${process.env.SUPABASE_URL}/storage/v1/object/public/imagen-ganadores/${imagenNombreGanadores}`;

      /* Insertar en BD */
      const { error: errR } = await supabase
        .from('imagenes_ganadores')
        .insert({
          rifa_id: rifa_id,
          url_imagen_ganadores: urlPublica,
          nombre_imagen_ganadores: imagenNombreGanadores
        });

      if (errR) {
        console.error('Error al insertar en BD:', errR.message);
        continue;
      }

      resultados.push({
        nombre: imagenNombreGanadores,
        estado: 'subida'
      });
    }

    /* Respuesta final */
    res.json({
      ok: true,
      message: 'Proceso de subida finalizado',
      resultados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al subir imágenes' });
  }
});


//Obtener imagenes ganadores
router.get('/administrador/ganadores/obtenerImagenes/:rifa_id', async (req, res) => {
  const rifa_id = req.params.rifa_id;
  try {
    const { data, error } = await supabase
      .from('imagenes_ganadores')
      .select('*')
      .eq('rifa_id', rifa_id)
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al obtener imagen/es' });
  }
})

//Eliminar una imagen
router.delete('/administrador/ganadores/eliminarImagen/:id', async (req, res) => {
  try {
    const {id} = req.params;
    //Obtener nombre de la imagen
    const { data: nombreImagenGanadores, error: errGanadores } = await supabase
      .from('imagenes_ganadores')
      .select('nombre_imagen_ganadores')
      .eq('id_imagenes', id)
      .single();

    if (errGanadores || !nombreImagenGanadores) {
      return res.status(400).json({ error: 'Imagen no existe' });
    }

    const nombreImagen = nombreImagenGanadores.nombre_imagen_ganadores;
    // Eliminar la imagen desde Supabase Storage
    const { error: deleteError } = await supabase
      .storage
      .from('imagen-ganadores')
      .remove([nombreImagen]);
    
    if (deleteError) {
      console.error('Error al eliminar la imagen de Supabase:', deleteError);
      return res.status(500).json({ error: 'No se pudo eliminar la imagen del almacenamiento' });
    }

    //Eliminar la imagen
    const {error} = await supabase.from('imagenes_ganadores').delete().eq('id_imagenes', id)
    if (error) throw error;
    res.json({ message: 'Imagen eliminada correctamente' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al eliminar imagen/es' });
  }
})

module.exports = router;

