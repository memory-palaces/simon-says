/** Download an embedded asset (an image/mesh data URL) as a real file. */

/** Pick a file extension from a data URL's mime type. */
export function assetExt(src: string): string {
  const mime = /^data:([^;,]+)/.exec(src)?.[1] ?? '';
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gltf-binary') || mime.includes('glb')) return 'glb';
  if (mime.includes('gltf')) return 'gltf';
  return 'bin';
}

export function downloadAsset(src: string, baseName: string): void {
  const a = document.createElement('a');
  a.href = src;
  a.download = `${baseName}.${assetExt(src)}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
