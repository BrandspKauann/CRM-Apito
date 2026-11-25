from contextlib import asynccontextmanager
import os

import psycopg
from mcp.server.fastmcp import FastMCP
from psycopg.rows import dict_row

# The authenticated reverse proxy must run on the same host.
server = FastMCP("CRM Apito", host="127.0.0.1", port=8181, stateless_http=True, json_response=True)


@asynccontextmanager
async def database():
    async with await psycopg.AsyncConnection.connect(
        os.environ["MCP_DATABASE_URL"], connect_timeout=5,
        options="-c default_transaction_read_only=on -c statement_timeout=4000",
        row_factory=dict_row,
    ) as connection:
        yield connection


@server.tool()
async def segmentar_contatos(empresa: str = "", com_email: bool = False,
                             com_telefone: bool = False, apos_id: int = 0) -> list[dict]:
    """Liste até 50 contatos por nome parcial da empresa e canais disponíveis. Combine os filtros para exigir ambos. Para avançar, informe o último ID."""
    async with database() as connection:
        cursor = await connection.execute("""
            SELECT c.id, c.name AS nome, e.name AS empresa, c.email, c.phone AS telefone
            FROM public.contacts c LEFT JOIN public.companies e ON e.id = c.company
            WHERE c.id > %s AND strpos(lower(coalesce(e.name, '')), lower(%s)) > 0
              AND (NOT %s OR nullif(trim(c.email), '') IS NOT NULL)
              AND (NOT %s OR nullif(trim(c.phone), '') IS NOT NULL)
            ORDER BY c.id LIMIT 50
        """, (apos_id, empresa, com_email, com_telefone))
        return await cursor.fetchall()


@server.tool()
async def buscar_empresas(nome: str = "", cidade: str = "", apos_id: int = 0) -> list[dict]:
    """Liste até 50 empresas por nome parcial e cidade. Para avançar, informe o último ID."""
    async with database() as connection:
        cursor = await connection.execute("""
            SELECT id, name AS nome, city AS cidade FROM public.companies
            WHERE id > %s AND strpos(lower(name), lower(%s)) > 0
              AND strpos(lower(coalesce(city, '')), lower(%s)) > 0
            ORDER BY id LIMIT 50
        """, (apos_id, nome, cidade))
        return await cursor.fetchall()


if __name__ == "__main__":
    server.run(transport="streamable-http")
