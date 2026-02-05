// db.js
import mysql from 'mysql2/promise';
import 'dotenv/config';

// Cria um "pool" de conexões. É mais eficiente que uma única conexão.
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Função para testar a conexão
export async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conectado ao banco de dados MySQL com sucesso!');
    connection.release();
  } catch (error) {
    console.error('❌ Erro ao conectar ao banco de dados:', error.message);
    process.exit(1); // Encerra o bot se não conseguir conectar ao DB
  }
}