import { createServerFn } from "@tanstack/react-start";

const SQL = `
  SELECT
    CC.COD_EMPRESA,
    CC.COD_CONTABIL,
    CC.COD_CENTRO_CUSTO,
    CC.VALOR,
    CP.ANO_PPAG || ' - ' || CP.LANCAMENTO || ' - ' || CP.PARCELA AS CONTROLE,
    CP.DATA_ENTRADA,
    CP.DATA_VENCIMENTO,
    CM.NUMERO_NOTA
  FROM nbs.COMPRA_LANC_CONTAB CC
  LEFT JOIN CONTA_PAGAR CP ON (CP.COD_EMPRESA = CC.COD_EMPRESA AND CP.COD_CONTROLE = CC.COD_CONTROLE)
  LEFT JOIN COMPRA CM     ON (CC.COD_EMPRESA = CM.COD_EMPRESA AND CC.COD_CONTROLE = CM.COD_CONTROLE)
  LEFT JOIN EMPRESAS EM   ON (CC.COD_EMPRESA = EM.COD_EMPRESA)
  WHERE TO_CHAR(CM.NUMERO_NOTA) LIKE :numero_nota
    AND CC.COD_EMPRESA = :cod_empresa
    AND EM.SEGMENTO = 'AUTOMOVEIS'
`;

export const buscarNbsNotaServer = createServerFn({ method: "GET" })
  .inputValidator((d: { numeroNota: number; codEmpresa: number }) => d)
  .handler(async ({ data }) => {
    const oracledb = await import("oracledb");

    try {
      oracledb.default.initOracleClient({
        libDir: String(process.env.ORACLE_CLIENT_DIR ?? "C:\\Users\\IcaroCosta\\Downloads\\instantclient-basic-windows.x64-23.26.3.0.0\\instantclient_23_26"),
      });
    } catch (initErr: unknown) {
      const msg = initErr instanceof Error ? initErr.message : String(initErr);
      if (!msg.includes("already")) throw new Error(`initOracleClient: ${msg}`);
    }

    oracledb.default.fetchTypeHandler = (meta: { dbType: number }) => {
      if (
        meta.dbType === oracledb.default.DB_TYPE_DATE ||
        meta.dbType === oracledb.default.DB_TYPE_TIMESTAMP
      ) {
        return {
          mapFn: (v: unknown) => {
            if (!v) return null;
            const d = v instanceof Date ? v : new Date(v as string);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, "0");
            const dd = String(d.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
          },
        };
      }
    };

    const conn = await oracledb.default.getConnection({
      user: process.env.ORACLE_USER,
      password: process.env.ORACLE_PASSWORD,
      connectString: `${process.env.ORACLE_HOST}:${process.env.ORACLE_PORT ?? 1521}/${process.env.ORACLE_SERVICE}`,
    });

    try {
      const result = await conn.execute(
        SQL,
        { numero_nota: String(data.numeroNota), cod_empresa: data.codEmpresa },
        { outFormat: oracledb.default.OUT_FORMAT_OBJECT },
      );

      return ((result.rows ?? []) as Record<string, unknown>[]).map((r) => ({
        cod_empresa: Number(r["COD_EMPRESA"]),
        cod_contabil: String(r["COD_CONTABIL"]),
        cod_centro_custo: Number(r["COD_CENTRO_CUSTO"]),
        valor: Number(r["VALOR"]),
        controle: String(r["CONTROLE"] ?? ""),
        data_entrada: String(r["DATA_ENTRADA"] ?? ""),
        data_vencimento: String(r["DATA_VENCIMENTO"] ?? ""),
        numero_nota: Number(r["NUMERO_NOTA"]),
      }));
    } finally {
      await conn.close();
    }
  });
