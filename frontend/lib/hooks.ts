"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import type { Master } from "./types";

type State<T> = { data: T | undefined; error: Error | null; loading: boolean };

/**
 * API を呼んで結果を持つ。deps が変わるか reload() で呼び直す
 *   const { data, error, loading, reload } = useApi(() => api.company.projects(), []);
 */
export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: undefined, error: null, loading: true });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    fetcher().then(
      (data) => alive && setState({ data, error: null, loading: false }),
      (error: Error) => alive && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      alive = false;
    };
    // fetcher は毎回新しく作られるので deps と version で呼び直しを決める
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { ...state, reload };
}

// スキル・課題の選択肢は変わらないので1回だけ取得して使い回す
let masterPromise: Promise<Master> | null = null;
const emptyMaster: Master = { skills: [], issueOptions: [] };

export function useMaster(): Master & { skillName: (id: number) => string } {
  const { data } = useApi(() => {
    masterPromise ??= api.master().catch((e) => {
      masterPromise = null; // 失敗したら次回やり直す
      throw e;
    });
    return masterPromise;
  }, []);
  const m = data ?? emptyMaster;
  return { ...m, skillName: (id: number) => m.skills.find((s) => s.id === id)?.name ?? "" };
}
