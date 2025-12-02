const express = require('express');
const dbConnect = require('../db/connect');
//variable router para utilizar la solicitud http (GET/POST/PUT/DELETE) en express
const router = express.Router();
//llamada a la conexion de la base de datos
const db = dbConnect();

//creación de rifa
router.get('/log/administrador/crear_rifa', (req, res) => {
    console.log('Hola');
})
