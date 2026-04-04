export interface QueryClientLike {
  getQueryCache: () => {
    getAll: () => Array<{
      queryHash: string;
      queryKey: unknown[];
      state: {
        dataUpdatedAt: number;
        errorUpdatedAt: number;
        fetchStatus: string;
        status: string;
        data?: unknown;
        error?: unknown;
      };
    }>;
  };
  invalidateQueries: (filters?: { queryKey?: unknown[] }) => Promise<void>;
  refetchQueries: (filters?: { queryKey?: unknown[] }) => Promise<void>;
  removeQueries: (filters?: { queryKey?: unknown[] }) => void;
  resetQueries: (filters?: { queryKey?: unknown[] }) => Promise<void>;
}
