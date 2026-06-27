/**
 * Mocks file upload to storage and returns a generated URL.
 * @param {Express.Multer.File} _file - Uploaded file object.
 * @returns {Promise<string>} Mocked storage URL.
 */
export const mockUploadToStorage = async (_file: Express.Multer.File): Promise<string> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  return `https://mock-storage.com/proof${Date.now()}.jpg`;
};
