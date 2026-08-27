import { jest } from '@jest/globals';

export type FakeQuery<T> = {
  sort: (value?: unknown) => FakeQuery<T>;
  skip: (value?: number) => FakeQuery<T>;
  limit: (value?: number) => FakeQuery<T>;
  select: (value?: unknown) => FakeQuery<T>;
  lean: () => Promise<T>;
  exec: () => Promise<T>;
  then: Promise<T>['then'];
  catch: Promise<T>['catch'];
};

export type FakeAggregate<T> = {
  option: (value?: unknown) => Promise<T>;
};

export type FakeModel<T> = {
  find: (filter?: unknown) => FakeQuery<T[]>;
  findOne: (filter?: unknown) => FakeQuery<T | null>;
  findById: (id: unknown) => FakeQuery<T | null>;
  create: (document: unknown) => Promise<T>;
  findByIdAndUpdate: (
    id: unknown,
    update: unknown,
    options?: unknown
  ) => FakeQuery<T | null>;
  updateMany: (filter?: unknown, update?: unknown) => Promise<unknown>;
  aggregate: (pipeline?: unknown[]) => FakeAggregate<T[]>;
};

export function fakeQuery<T>(fixture: T): FakeQuery<T> {
  const query: FakeQuery<T> = {
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    select: jest.fn(() => query),
    lean: jest.fn(async () => fixture),
    exec: jest.fn(async () => fixture),
    then: (onfulfilled, onrejected) => Promise.resolve(fixture).then(onfulfilled, onrejected),
    catch: onrejected => Promise.resolve(fixture).catch(onrejected),
  };

  return query;
}

export function fakeAggregate<T>(fixture: T): FakeAggregate<T> {
  return {
    option: jest.fn(async () => fixture),
  };
}

export function fakeModel<T>(overrides: Partial<FakeModel<T>> = {}): FakeModel<T> {
  return {
    find: () => fakeQuery<T[]>([]),
    findOne: () => fakeQuery<T | null>(null),
    findById: () => fakeQuery<T | null>(null),
    create: async document => document as T,
    findByIdAndUpdate: () => fakeQuery<T | null>(null),
    updateMany: async () => undefined,
    aggregate: () => fakeAggregate<T[]>([]),
    ...overrides,
  };
}
