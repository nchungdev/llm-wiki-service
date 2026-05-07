import logging
from typing import List

logger = logging.getLogger(__name__)

class Neo4jRepository:
    def __init__(self, uri: str, user: str, password: str):
        from neo4j import AsyncGraphDatabase
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))
        logger.info(f"🗂️ Neo4j driver initialized: {uri}")

    async def close(self):
        await self.driver.close()

    async def upsert_entities_and_relationships(
        self,
        entities: List[dict],
        relationships: List[dict],
        source_title: str
    ):
        if not entities and not relationships:
            return

        async with self.driver.session() as session:
            for entity in entities:
                name = entity.get('name', '').strip()
                if not name:
                    continue
                await session.run(
                    """
                    MERGE (e:Entity {name: $name})
                    SET e.type = $type,
                        e.description = $description,
                        e.last_seen_in = $source
                    """,
                    name=name,
                    type=entity.get('type', 'Unknown'),
                    description=entity.get('description', ''),
                    source=source_title,
                )

            for rel in relationships:
                src = rel.get('source', '').strip()
                tgt = rel.get('target', '').strip()
                rel_type = rel.get('type', 'RELATED_TO').upper().replace(' ', '_').replace('-', '_')
                if not src or not tgt:
                    continue
                cypher = (
                    f"MATCH (a:Entity {{name: $src}}), (b:Entity {{name: $tgt}}) "
                    f"MERGE (a)-[r:{rel_type}]->(b) "
                    f"SET r.source_doc = $source"
                )
                await session.run(cypher, src=src, tgt=tgt, source=source_title)

        logger.info(
            f"🗂️ Neo4j: upserted {len(entities)} entities, {len(relationships)} relationships "
            f"(source: {source_title})"
        )

    async def query_related(self, entity_name: str, depth: int = 2) -> dict:
        async with self.driver.session() as session:
            result = await session.run(
                f"""
                MATCH path = (e:Entity {{name: $name}})-[*1..{depth}]-(related)
                RETURN e, relationships(path) AS rels, nodes(path) AS nodes
                LIMIT 50
                """,
                name=entity_name,
            )
            records = await result.data()
            return {"entity": entity_name, "related": records}
