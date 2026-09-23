import { faker } from "@faker-js/faker";
import { QueryHistory } from "@modules/queryPanel/context/types";
import { Sync } from "factory.ts";

function generateRandomSQLQuery(): string {
  // Generate between 1 to 5 column names
  const columnsCount = faker.number.int({ min: 1, max: 5 });
  const columns = Array.from({ length: columnsCount }, () =>
    faker.database.column(),
  ).join(", ");

  // Generate a table name
  const tableName = faker.lorem.word();

  // Optionally, generate a LIMIT value (for simplicity, let's keep queries simple)
  const limit = faker.number.int({ min: 1, max: 100 });

  // Assemble the SQL query
  const query = `SELECT ${columns} FROM ${tableName} LIMIT ${limit};`;

  return query;
}

export const QueryHistoryFactory = Sync.makeFactory<QueryHistory>({
  rawSql: Sync.each(() => generateRandomSQLQuery()),
  compiledSql: Sync.each(() => generateRandomSQLQuery()),
  adapter: faker.lorem.word(),
  duration: faker.number.int({ min: 1, max: 10000 }),
  projectName: faker.lorem.word(),
  timestamp: Sync.each(() => faker.date.past().getTime()),
  modelName: faker.lorem.word(),
});
