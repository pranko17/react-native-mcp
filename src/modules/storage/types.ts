export interface StorageAdapter {
  get: (key: string) => string | undefined | null | Promise<string | undefined | null>;
  delete?: (key: string) => void | Promise<void>;
  getAllKeys?: () => string[] | Promise<string[]>;
  set?: (key: string, value: string) => void | Promise<void>;
}

export interface NamedStorage {
  adapter: StorageAdapter;
  name: string;
}
