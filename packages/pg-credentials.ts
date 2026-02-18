export const pgTestCredentials = {
    host: 'localhost',
    user: 'duna',
    password: 'duna',
    port: Number(process.env.POSTGRES_PORT ?? 35432),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    maxLifetimeSeconds: 60,
} as const;
