import { z } from 'zod';

export const CreateUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
});
