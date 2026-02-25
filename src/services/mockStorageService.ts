export const mockUploadToStorage = async (_file: Express.Multer.File): Promise<string> => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return `https://mock-storage.com/proof${Date.now()}.jpg`;
};
