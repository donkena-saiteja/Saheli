import mongoose from 'mongoose';
import dns from 'dns';

try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {}

mongoose.set('bufferCommands', false);

export const isDatabaseReady = () => mongoose.connection.readyState === 1;

/** Set when we fell back to the in-process database, so /health can say so. */
let usingMemoryServer = false;
let memoryServerUri: string | null = null;

export const isMemoryDatabase = () => usingMemoryServer;
export const getDatabaseUri = () => memoryServerUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/saheli';

async function connectTo(uri: string): Promise<mongoose.Mongoose> {
  return mongoose.connect(uri, {
    serverSelectionTimeoutMS: Number(process.env.MONGO_SELECTION_TIMEOUT_MS || 5000),
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  });
}

/**
 * Starts an in-process MongoDB. This is what lets the whole stack run with no
 * external services installed — important when the project has to come up
 * cleanly on an unfamiliar machine during judging.
 *
 * Disable with USE_MEMORY_DB=false when a real MongoDB should be mandatory.
 */
async function startMemoryServer(): Promise<boolean> {
  if ((process.env.USE_MEMORY_DB || '').toLowerCase() === 'false') {
    return false;
  }

  try {
    // Imported lazily so production deployments never load the dev dependency.
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create({
      instance: { dbName: 'saheli' },
    });
    memoryServerUri = server.getUri();
    await connectTo(memoryServerUri);
    usingMemoryServer = true;

    console.log('\n🧪 Started in-process MongoDB (no external database required).');
    console.log(`   URI: ${memoryServerUri}`);
    console.log('   Data is ephemeral. Set MONGODB_URI to use a persistent database.\n');

    const shutdown = async () => {
      try {
        await mongoose.connection.close();
        await server.stop();
      } catch {
        /* best effort */
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    return true;
  } catch (error: any) {
    console.error(`❌ Could not start in-process MongoDB: ${error?.message || error}`);
    return false;
  }
}

export const connectDB = async (): Promise<boolean> => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/saheli';

  try {
    const conn = await connectTo(uri);
    console.log(`\n📦 MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error: any) {
    console.warn(`\n⚠️  MongoDB unreachable at ${uri}: ${error.message}`);
    console.warn('   Falling back to an in-process database so the API can still start.');
    return startMemoryServer();
  }
};

mongoose.connection.on('disconnected', () => {
  console.error('⚠️ MongoDB disconnected. API routes requiring DB will return 503 until reconnected.');
});

mongoose.connection.on('error', (err) => {
  console.error(`❌ MongoDB runtime error: ${err.message}`);
});
