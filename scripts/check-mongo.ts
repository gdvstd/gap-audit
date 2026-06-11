/**
 * Verify MongoDB connectivity using the same driver + env the app uses.
 * Connects, pings, lists collections in MONGODB_DATABASE, and exits.
 * Reads NOTHING destructive — connect + ping + read only.
 *
 * Usage:
 *   export $(grep -v '^#' .env.local | grep -v '^$' | xargs)
 *   pnpm exec tsx scripts/check-mongo.ts
 */
import { MongoClient } from "mongodb";

async function main(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  const dbName = process.env["MONGODB_DATABASE"] ?? "silentops";

  if (uri === undefined || uri === "") {
    console.error("✗ MONGODB_URI is not set. Add it to .env.local and `export` it first.");
    process.exit(1);
  }

  // Mask credentials when echoing the target.
  const masked = uri.replace(/\/\/([^:]+):([^@]+)@/, "//$1:****@");
  console.log(`Connecting to: ${masked}`);
  console.log(`Database:      ${dbName}\n`);

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const admin = client.db(dbName).admin();
    const pong = await admin.ping();
    console.log(`✓ ping ok: ${JSON.stringify(pong)}`);

    const cols = await client.db(dbName).listCollections().toArray();
    console.log(`✓ database "${dbName}" reachable — ${cols.length} collection(s): ` +
      (cols.length > 0 ? cols.map((c) => c.name).join(", ") : "(empty, will be created on first write)"));

    console.log("\n✓ MongoDB connection OK. Set MONGODB_ENABLED=true to use it as audit memory.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n✗ Connection FAILED: ${msg}`);
    console.error("  Common causes: Network Access not set to 0.0.0.0/0, wrong password, " +
      "or special characters in the password not URL-encoded.");
    process.exit(1);
  } finally {
    await client.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
