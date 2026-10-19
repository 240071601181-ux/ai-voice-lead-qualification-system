const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const envPath = path.resolve(".env");
  const envText = fs.readFileSync(envPath, "utf8");
  const match = envText.match(/^\s*DATABASE_URL\s*=\s*["']?([^"'\r\n]+)["']?\s*$/m);

  if (!match) throw new Error("Could not read DATABASE_URL from .env");

  const appUrl = new URL(match[1].trim());

  if (!["localhost", "127.0.0.1"].includes(appUrl.hostname)) {
    throw new Error("Safety stop: DATABASE_URL is not a localhost connection.");
  }

  if (appUrl.pathname.replace(/^\//, "") !== "lead_qualification") {
    throw new Error("Safety stop: unexpected application database name.");
  }

  const testDb = "madlead_e2e_phase7";
  const adminUrl = new URL(appUrl.toString());
  adminUrl.pathname = "/postgres";

  const client = new Client({
    connectionString: adminUrl.toString(),
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();

    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [testDb]
    );

    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${testDb}"`);
      console.log(`Created disposable database: ${testDb}`);
    } else {
      console.log(`Database already exists; leaving it intact: ${testDb}`);
    }

    console.log("PostgreSQL connection and database setup succeeded.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Database setup failed:", error.message);
  process.exitCode = 1;
});
