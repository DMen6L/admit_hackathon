/** Vite's running dev server may not refresh its public-file index after new audio is added. */
export function audioAssetUrl(file: string): string {
  const directory = import.meta.env.DEV ? 'public/assets/audio/' : 'assets/audio/';
  return `${import.meta.env.BASE_URL}${directory}${encodeURIComponent(file)}`;
}
