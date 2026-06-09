import { MongoClient, type Collection, type Db, type Document } from "mongodb";

const DEFAULT_DATABASE_NAME = "litmatch_top_up";

type MongoGlobal = typeof globalThis & {
  __litmatchMongoClientPromise?: Promise<MongoClient>;
  __litmatchMongoIndexesPromise?: Promise<void>;
};

async function ensureBankTransferContentIndex(db: Db) {
  const collection = db.collection("bank_payments");
  const indexName = "transferContent_1";
  const existingIndex = (await collection.indexes()).find(
    (index) => index.name === indexName,
  );

  if (existingIndex?.unique) {
    await collection.dropIndex(indexName);
  }

  await collection.createIndex({ transferContent: 1 });
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in environment");
  }

  return databaseUrl;
}

function getDatabaseName(databaseUrl: string) {
  const databaseName = process.env.DATABASE_NAME?.trim();

  if (databaseName) {
    return databaseName;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    const pathDatabaseName = parsedUrl.pathname.replace(/^\//, "").split("/")[0];

    return pathDatabaseName
      ? decodeURIComponent(pathDatabaseName)
      : DEFAULT_DATABASE_NAME;
  } catch {
    return DEFAULT_DATABASE_NAME;
  }
}

export async function getMongoDb(): Promise<Db> {
  const databaseUrl = getDatabaseUrl();
  const globalForMongo = globalThis as MongoGlobal;

  if (!globalForMongo.__litmatchMongoClientPromise) {
    const client = new MongoClient(databaseUrl);
    globalForMongo.__litmatchMongoClientPromise = client.connect();
  }

  const client = await globalForMongo.__litmatchMongoClientPromise;
  return client.db(getDatabaseName(databaseUrl));
}

export async function ensureMongoIndexes() {
  const globalForMongo = globalThis as MongoGlobal;

  if (!globalForMongo.__litmatchMongoIndexesPromise) {
    globalForMongo.__litmatchMongoIndexesPromise = (async () => {
      const db = await getMongoDb();

      await Promise.all([
        ensureBankTransferContentIndex(db),
        db
          .collection("bank_payments")
          .createIndex(
            { "sepay.id": 1 },
            {
              unique: true,
              partialFilterExpression: { "sepay.id": { $exists: true } },
            },
          ),
        db.collection("bank_payments").createIndex({ updatedAt: -1 }),
        db
          .collection("bank_payments")
          .createIndex({ "ctvRef.ctvId": 1, updatedAt: -1 }),
        db.collection("card_payments").createIndex({ updatedAt: -1 }),
        db
          .collection("card_payments")
          .createIndex({ "ctvRef.ctvId": 1, updatedAt: -1 }),
        db
          .collection("card_payments")
          .createIndex(
            { requestId: 1 },
            {
              unique: true,
              partialFilterExpression: { requestId: { $exists: true } },
            },
          ),
        db
          .collection("sepay_webhook_events")
          .createIndex({ sepayId: 1 }, { unique: true }),
        db
          .collection("lifetime_bank_qrs")
          .createIndex({ transferContent: 1 }, { unique: true }),
        db.collection("lifetime_bank_qrs").createIndex({ updatedAt: -1 }),
        db
          .collection("lifetime_bank_qrs")
          .createIndex({ "ctvRef.ctvId": 1, updatedAt: -1 }),
        db
          .collection("card_webhook_events")
          .createIndex({ eventKey: 1 }, { unique: true }),
        db.collection("admin_direct_recharges").createIndex({ createdAt: -1 }),
        db.collection("admin_direct_recharges").createIndex({ updatedAt: -1 }),
        db.collection("admin_direct_recharges").createIndex({ litmatchId: 1 }),
        db
          .collection("admin_direct_recharges")
          .createIndex({ note: 1, updatedAt: -1 }),
        db.collection("bank_qr_blacklist").createIndex(
          { litmatchId: 1 },
          {
            unique: true,
            partialFilterExpression: { status: "active" },
          },
        ),
        db.collection("bank_qr_blacklist").createIndex({ updatedAt: -1 }),
        db.collection("bank_qr_blacklist").createIndex({ status: 1 }),
        db.collection("app_settings").createIndex({ key: 1 }, { unique: true }),
        db.collection("ctvs").createIndex({ code: 1 }, { unique: true }),
        db.collection("ctvs").createIndex({ username: 1 }, { unique: true }),
        db.collection("ctvs").createIndex({ updatedAt: -1 }),
      ]);
    })();
  }

  return globalForMongo.__litmatchMongoIndexesPromise;
}

export async function getCollection<T extends Document>(
  collectionName: string,
): Promise<Collection<T>> {
  await ensureMongoIndexes();
  const db = await getMongoDb();

  return db.collection<T>(collectionName);
}
