export const fetchAudioCatalog = async () => {
  const response = await fetch('/api/public/catalog');
  if (!response.ok) throw new Error('Gagal mengambil data katalog');
  return await response.json();
};