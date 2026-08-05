declare module "oracledb" {
  const OUT_FORMAT_OBJECT: number;
  const DB_TYPE_DATE: number;
  const DB_TYPE_TIMESTAMP: number;
  const STRING: number;

  interface Connection {
    execute(
      sql: string,
      binds: Record<string, unknown>,
      options: { outFormat: number },
    ): Promise<{ rows?: unknown[] }>;
    close(): Promise<void>;
  }

  interface ConnectionAttrs {
    user?: string;
    password?: string;
    connectString?: string;
  }

  let fetchTypeHandler:
    | ((meta: { dbType: number }) => { type: number; mapFn?: (v: unknown) => unknown } | undefined)
    | undefined;

  function getConnection(attrs: ConnectionAttrs): Promise<Connection>;

  export {
    OUT_FORMAT_OBJECT,
    DB_TYPE_DATE,
    DB_TYPE_TIMESTAMP,
    STRING,
    fetchTypeHandler,
    getConnection,
  };
}
