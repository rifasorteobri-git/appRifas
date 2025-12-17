const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const express = require('express');
//variable router para utilizar la solicitud http (GET/POST/PUT/DELETE) en express
const router = express.Router();
//llamada a la conexion de la base de datos
const supabase = require('../db/supabaseClient');

/********************************Metodos protocolo http********************************/
//lista administrador
router.get('/log/administrador/lista', async (req, res) => {
    try {
        const idAdminLogueado = req.user.id_administrador;

        const { data, error } = await supabase
            .from('usuario_administrador')
            .select('*')
            .neq('id_administrador', 2)               // excluir admin master
            .neq('id_administrador', idAdminLogueado); // excluir admin logueado

        if (error) throw error;

        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
});

//obtener administrador por id
router.get('/log/administrador/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { data, error } = await supabase
        .from('usuario_administrador')
        .select('*')
        .eq('id_administrador', id)
        .single(); // devuelve 1 solo registro o error si no existe
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
})

//Agregar un usuario
router.post('/log/administrador/agregar', async (req, res) => {
    const { correo_administrador, contrasena_administrador, rol_administrador } = req.body;
    // Validar campos obligatorios
    if (!correo_administrador || !contrasena_administrador || !rol_administrador) {
        return res.status(400).json({
            message: 'Correo, contraseña y rol son obligatorios.'
        });
    }
    try {
        // Verificar si el correo ya existe
        const { data: existeCorreo, error: errorCorreo } = await supabase
            .from('usuario_administrador')
            .select('id_administrador')
            .eq('correo_administrador', correo_administrador)
            .maybeSingle();
        if (errorCorreo) {
            console.error('Error en consulta de correo:', errorCorreo.message);
            return res.status(500).json({ error: errorCorreo.message });
        }
        if (existeCorreo) {
            return res.status(409).json({
                message: 'El correo electrónico ya está en uso.'
            });
        }
        // Hashear contraseña
        const hashedPassword = bcrypt.hashSync(contrasena_administrador, 10);
        // Insertar usuario
        const { data: nuevoAdmin, error: errorInsert } = await supabase
            .from('usuario_administrador')
            .insert([{
                correo_administrador,
                contrasena_administrador: hashedPassword,
                rol_administrador
            }])
            .select('id_administrador') // equivalente al RETURNING
            .single();
        if (errorInsert) {
            console.error('Error al insertar administrador:', errorInsert.message);
            return res.status(500).json({ error: errorInsert.message });
        }
        // Éxito
        return res.status(201).json({
            message: 'Usuario creado exitosamente',
            id: nuevoAdmin.id_administrador
        });
    } catch (error) {
        res.status(500).json({ error: err.message || err });
    }
});

//editar contraseña administrador master
router.put('/log/administrador/editarContrasena/:id', async (req, res) => {
    const { id } = req.params;
    const { contra_actual, contra_nueva } = req.body;
    if (!contra_actual || !contra_nueva) {
        return res.status(400).json({
            message: 'Debe enviar la contraseña actual y la nueva contraseña.'
        });
    }
    try {
        // Obtener la contraseña actual del administrador
        const { data: admin, error: errorSelect } = await supabase
            .from('usuario_administrador')
            .select('contrasena_administrador')
            .eq('id_administrador', id)
            .single();
        if (errorSelect) {
            console.error('Error consultando admin:', errorSelect.message);
            return res.status(500).json({ message: 'Error en la consulta' });
        }
        if (!admin) {
            return res.status(404).json({
                message: 'Administrador no encontrado'
            });
        }
        // Comparar contraseñas
        const isMatch = bcrypt.compareSync(contra_actual, admin.contrasena_administrador);
        if (!isMatch) {
            return res.status(401).json({
                message: 'La contraseña actual no es correcta'
            });
        }
        // Hashear la nueva contraseña
        const hashedPassword = bcrypt.hashSync(contra_nueva, 10);
        //Actualizar contraseña en Supabase
        const { error: errorUpdate } = await supabase
            .from('usuario_administrador')
            .update({
                contrasena_administrador: hashedPassword
            })
            .eq('id_administrador', id);
        if (errorUpdate) {
            console.error('Error al actualizar contraseña:', errorUpdate.message);
            return res.status(500).json({
                message: 'Error al actualizar la contraseña'
            });
        }
        return res.json({
            message: 'Contraseña actualizada correctamente'
        });
    } catch (error) {
        res.status(500).json({ error: err.message || err });
    }
});

//borrar administrador
router.delete('/log/administrador/borrar/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const { error } = await supabase.from('usuario_administrador').delete().eq('id_administrador', id);
        if (error) throw error;
        res.json({ message: 'Administrador eliminado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
})

/*************************************************LOGIN ADMINISTRADOR*************************************************/
//ruta para loguearse (entrar al sistema con sus credenciales que provienen del frontend)
//aqui se genera un token el cual se almacena en el local storage
router.post('/login/administrador', async (req, res) => {
    const { correo_admin, contrasena_admin } = req.body;
    try {
        // Verificar si el correo existe
        const { data: usuario, error } = await supabase
            .from('usuario_administrador')
            .select('*')
            .eq('correo_administrador', correo_admin)
            .single();
        if (error) {
            console.error("Error al buscar administrador:", error.message);
            return res.status(500).json({ error: "Error en la base de datos" });
        }
        // Validar existencia
        if (!usuario) {
            return res.status(401).json({ message: 'Credenciales incorrectas' });
        }
        // Verificar contraseña
        const passwordMatch = bcrypt.compareSync(contrasena_admin, usuario.contrasena_administrador);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Credenciales incorrectas' });
        }
        // Generar token
        const token = jwt.sign(
            {
                id: usuario.id_administrador,
                rol: usuario.rol_administrador
            },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );
        // Respuesta
        res.json({
            token,
            rol_administrador: usuario.rol_administrador
        });
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
});

//editar contraseña desde el administrador a un administrador (en caso de que la olvide)
router.put('/log/administrador/editar_contra_administrador/:id', async (req, res) => {
    const { id } = req.params;
    const { nueva_contrasena_administrador } = req.body;
    try {
        // Validar campo obligatorio
        if (!nueva_contrasena_administrador) {
        return res.status(400).json({ message: 'Campo obligatorio.' });
        }
        // Hashear contraseña
        const hashedPassword = bcrypt.hashSync(nueva_contrasena_administrador, 10);
        // Actualizar usando Supabase
        const { error } = await supabase
        .from('usuario_administrador')
        .update({ contrasena_administrador: hashedPassword })
        .eq('id_administrador', id)
        .select(); // para devolver la fila afectada (opcional)

        if (error) throw error;
        res.json({message: 'Se actualizó correctamente la contraseña del administrador'});
    } catch (err) {
        res.status(500).json({ error: err.message || err });
    }
});

module.exports = router;