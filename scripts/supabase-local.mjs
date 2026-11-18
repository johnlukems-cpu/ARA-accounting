/**
 * Local Supabase (docker-compose.supabase.yml): creates .env.supabase.local once (random local-only password and JWT
 * secret, with service-role and anon keys signed by it), then starts the stack. Prints the variables to put in .env.
 */
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const file = ".env.supabase.local";
if (!existsSync(file)) {
  const secret = randomBytes(32).toString("hex");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = (role) => {
    const h = b64({ alg: "HS256", typ: "JWT" });
    const p = b64({ role, iss: "supabase-local", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400 });
    return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  };
  writeFileSync(file, [`SUPABASE_DB_PASSWORD=${randomBytes(18).toString("hex")}`, `SUPABASE_JWT_SECRET=${secret}`, `SUPABASE_SERVICE_ROLE_KEY=${jwt("service_role")}`, `SUPABASE_ANON_KEY=${jwt("anon")}`, ""].join("\n"), { mode: 0o600 });
}
execFileSync("docker", ["compose", "--env-file", file, "-f", "docker-compose.supabase.yml", "up", "-d", "--wait"], { stdio: "inherit" });
const env = Object.fromEntries(readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2)));
console.log(`\nLocal Supabase is running. Put these in .env (local development only):
DATABASE_URL=postgresql://postgres:${env.SUPABASE_DB_PASSWORD}@localhost:54322/postgres
DATABASE_URL_UNPOOLED=postgresql://postgres:${env.SUPABASE_DB_PASSWORD}@localhost:54322/postgres
SUPABASE_URL=http://localhost:54325
SUPABASE_STORAGE_URL=http://localhost:54325
SUPABASE_SERVICE_ROLE_KEY=<see ${file}>
Then: npx prisma migrate deploy && npm run db:seed && npm run dev`);
