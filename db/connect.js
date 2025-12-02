const { Pool } = require('pg');
require('dotenv').config();

const dbConnect = () => {
    const pool = new Pool({
        host: process.env.DEV_HOST,
        database: process.env.DEV_DATABASE,
        user: process.env.DEV_USER,
        password: process.env.DEV_PASSWORD,
        port: process.env.DEV_PORT, // Supabase usa el puerto 5432 pero como estamos utilizando transaction pooler se usa el 6543
        ssl: { rejectUnauthorized: false } // Importante si estás en Vercel o producción
    });

    pool.connect((err, client, release) => {
        if (err) {
            console.error('Error al conectar con PostgreSQL:', err.stack);
        } else {
            console.log('Conexión a PostgreSQL exitosa');
            release(); 
        }
    });

    return pool;
};

module.exports = dbConnect;