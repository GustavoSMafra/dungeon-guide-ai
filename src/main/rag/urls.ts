export const pageUrl = (title: string): string =>
  `https://tibia.fandom.com/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
