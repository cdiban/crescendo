export type PageRequest = { limit: number; offset: number };
export type Page<T> = { items: T[]; total: number };
