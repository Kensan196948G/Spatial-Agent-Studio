import type { User } from '../shared/types';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}
