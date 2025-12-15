const express = require('express');
//variable router para utilizar la solicitud http (GET/POST/PUT/DELETE) en express
const router = express.Router();
//llamada a la conexion de la base de datos
const supabase = require('../db/supabaseClient');
const sharp = require('sharp'); //Necesario para convertir el buffer
const multer = require('multer');
const upload = multer(); // Usamos memoria (sin archivos físicos)

//Creación de productos
router.post('/administrador/crearProductos', upload.single('imagenProductos'), async (req, res) => {
    try {
        if (!req.file) {
            console.log('No se ha proporcionado ninguna imagen');
            return res.status(400).json({ message: 'No se ha proporcionado ninguna imagen.' });
        }

        const imagenNombreProducto = req.file.originalname;

        const { data: existente, error: existingError } = await supabase
            .storage
            .from('imagen-productos')
            .list('', { search: imagenNombreProducto });
        
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
            .from('imagen-productos')
            .upload(imagenNombreProducto, buffer, {
                contentType: req.file.mimetype,
                upsert: false
            });
        
        if (uploadError) {
            console.error('Error al subir la imagen a Supabase:', uploadError.message);
            return res.status(500).json({ message: 'Error al subir la imagen a Supabase.' });
        }

        const urlPublica = `${process.env.SUPABASE_URL}/storage/v1/object/public/imagen-productos/${imagenNombreProducto}`;

        const { nombre_producto } = req.body;

        if ( !nombre_producto || !urlPublica || !imagenNombreProducto) return res.status(400).json({ error: 'Datos inválidos' });

        //Crear producto
        const { data: producto, error: errR } = await supabase
            .from('productos')
            .insert({nombre_producto, url_imagen_producto:urlPublica, nombre_imagen_producto:imagenNombreProducto})
            .select()
            .single();
        
        if (errR) throw errR;

        //Se crea el producto
        res.json({ producto });
    } catch(err) {
        res.status(500).json({ error: err.message || err });
    }
})

//Editar un producto
router.put('/administrador/editarProducto/:id', upload.single('imagenProductos'), async (req, res) => {
    try {
        const { id } = req.params;
        const { nombre_producto } = req.body;

        if ( !nombre_producto ) return res.status(400).json({ error: 'Datos inválidos' });

        // Obtener producto actual
        const { data: productoActual, error: errProducto } = await supabase.from('productos').select('*').eq('id_productos', id).single();

        if (errProducto || !productoActual) {
            return res.status(400).json({ error: 'El producto no existe' });
        }

        const oldImageUrl = productoActual.url_imagen_producto;
        const oldImageName = productoActual.nombre_imagen_producto;

        let nuevaUrl = oldImageUrl;
        let nuevoNombreImagen = oldImageName;

        if (req.file) {
            const imagenNombreProducto = req.file.originalname;

            const { data: existente } = await supabase
                .storage
                .from('imagen-productos')
                .list('', { search: imagenNombreProducto });

            if (existente.length > 0) {
                return res.status(400).json({ message: 'Esta imagen ya está registrada en la base de datos. Por favor, cargue una imagen con otro nombre.' });
            }

            const buffer = await sharp(req.file.buffer).toBuffer();
            const { error: uploadError } = await supabase
                .storage
                .from('imagen-productos')
                .upload(imagenNombreProducto, buffer, {
                    contentType: req.file.mimetype,
                    upsert: false
                });

            if (uploadError) {
                console.error('Error al subir la imagen a Supabase:', uploadError);
                return res.status(500).json({ message: 'Error al subir la imagen a Supabase' });
            }

            nuevaUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/imagen-productos/${imagenNombreProducto}`;
            nuevoNombreImagen = imagenNombreProducto;

            if (oldImageName) {
                await supabase
                    .storage
                    .from('imagen-productos')
                    .remove([oldImageName]);
            }
        }

        const { error: errUpdate } = await supabase.from('productos').update({nombre_producto, url_imagen_producto:nuevaUrl, nombre_imagen_producto:nuevoNombreImagen}).eq('id_productos', id);

        if (errUpdate) throw errUpdate;

        return res.json({
            message: 'Rifa actualizada correctamente'
        });
    } catch(err) {
        res.status(500).json({ error: err.message || err });
    }
});

//Listar productos
router.get('/administrador/listarProductos', async (req, res) => {
    try {
        const {data, error} = await supabase.from('productos').select('*').order('nombre_producto', {ascending: true});
        if (error) throw error;
        res.json(data);
    } catch(err) {
        res.status(500).json({ error: err.message || err });
    }
});

//Eliminar producto
router.delete('/administrador/eliminarProducto/:id', async (req, res) => {
    try {
        const {id} = req.params;
        // Obtener nombre de la imagen
        const { data: nombreImagenProducto, error: errProducto } = await supabase.from('productos').select('nombre_imagen_producto').eq('id_productos', id).single();

        if (errProducto || !nombreImagenProducto) {
            return res.status(400).json({ error: 'Imagen no existe' });
        }

        const nombreImagen = nombreImagenProducto.nombre_imagen_producto;
        // Eliminar la imagen desde Supabase Storage
        const { error: deleteError } = await supabase
            .storage
            .from('imagen-productos')
            .remove([nombreImagen]);

        if (deleteError) {
            console.error('Error al eliminar la imagen de Supabase:', deleteError);
            return res.status(500).json({ error: 'No se pudo eliminar la imagen del almacenamiento' });
        }

        // Luego eliminar el producto
        const { error } = await supabase.from('productos').delete().eq('id_productos', id);
        if (error) throw error;
        res.json({ message: 'Producto eliminado correctamente' });
    } catch(err) {
        res.status(500).json({ error: err.message || err });
    }
})

module.exports = router;