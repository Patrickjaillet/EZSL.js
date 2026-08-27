declare module "*.md?raw" {
  const content: string;
  export default content;
}

declare module "*.ezsl?raw" {
  const source: string;
  export default source;
}
