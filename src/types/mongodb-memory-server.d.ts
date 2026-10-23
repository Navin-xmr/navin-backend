/**
 * Minimal ambient declaration for mongodb-memory-server.
 *
 * The package ships its own type definitions; this file exists only to
 * satisfy the TypeScript compiler (TS7016) when the module is referenced via
 * a dynamic import inside src/infra/mongo/connection.ts during type-checking.
 * The real type definitions are loaded at runtime from node_modules.
 *
 * Only the public API surface used by this project is declared here
 * (MongoMemoryServer.create() and getUri()).
 */
declare module 'mongodb-memory-server' {
  export class MongoMemoryServer {
    static create(opts?: Record<string, unknown>): Promise<MongoMemoryServer>;
    getUri(dbName?: string): string;
    stop(opts?: { doCleanup?: boolean; force?: boolean }): Promise<boolean>;
  }
}
