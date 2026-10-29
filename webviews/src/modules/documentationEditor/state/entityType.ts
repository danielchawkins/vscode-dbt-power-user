export const EntityType = {
  COLUMN: "column",
  MODEL: "model",
} as const;
export type EntityType = (typeof EntityType)[keyof typeof EntityType];
