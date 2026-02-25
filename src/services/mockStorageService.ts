type UploadLikeFile = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

export const mockUploadToStorage = async (_file: UploadLikeFile): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return `https://mock-storage.com/proof${Date.now()}.jpg`;
};
