import { useContext, useEffect, useMemo, type DependencyList } from 'react';

import { McpContext } from '@/client/contexts/McpContext';

export const useMcpState = (key: string, factory: () => unknown, deps: DependencyList): void => {
  const ctx = useContext(McpContext);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(factory, deps);

  useEffect(() => {
    if (!ctx) return;
    ctx.setState(key, value);
    return () => {
      ctx.removeState(key);
    };
  }, [ctx, key, value]);
};
