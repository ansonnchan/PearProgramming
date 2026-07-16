export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

export function isAllowedProfileImage(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const typeAllowed = !file.type || ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  return typeAllowed && ['jpg', 'jpeg', 'png', 'webp'].includes(extension);
}
