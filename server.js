const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dbConnect = require('./db/connect');
const administradorRoutes = require('./routes/administradorRoutes')
const supabase = require('./db/supabaseClient');
require('dotenv').config();

const app = express();

app.use(cors());

//Middleware general
app.use(express.json());
app.use(bodyParser.json());
app.use(express.json({ limit: '50mb' })); // Middleware para parsear JSON en el body de las peticiones

//Conectar base de datos
dbConnect();

//Rutas de los endpoints
app.use(
    administradorRoutes
);

//Crear la raíz de la API (una vez subido a vercel)
app.get('/', (req, res) => {
    res.send('API backendRifas funcionando correctamente');
})

//Exporta como función para vercel
module.exports = app