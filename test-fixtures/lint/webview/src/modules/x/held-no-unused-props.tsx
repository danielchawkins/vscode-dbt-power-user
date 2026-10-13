// lint-expect-none: any @eslint-react/no-unused-props
export function Held(props: { name: string; unused: number }) {
  return <span>{props.name}</span>;
}
