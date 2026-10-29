export const Themes = {
  Dark: "dark",
  Light: "light",
} as const;
export type Themes = (typeof Themes)[keyof typeof Themes];
export interface AppStateProps {
  theme: Themes;
}
