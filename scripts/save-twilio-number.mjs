import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);

await conn.execute(
  `INSERT INTO settings (\`key\`, \`value\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`value\` = ?`,
  ["twilio_phone_number", "+17039978510", "+17039978510"]
);

console.log("✅ Saved twilio_phone_number: +17039978510");
await conn.end();
process.exit(0);
