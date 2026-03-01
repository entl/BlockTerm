/**
 * useEnvInfo – polls the main process for git environment context and reads
 * the active Python environment from the pane block registry (populated by
 * the BLOCKTERM:PYENV marker emitted by the shell integration on every prompt).
 *
 * Python detection is intentionally shell-variable-based ($VIRTUAL_ENV,
 * $CONDA_DEFAULT_ENV, $PYENV_VERSION), so the indicator only appears when
 * an environment is actually activated — not merely present on disk.
 *
 * Git polling interval: 5 s.  Python env is reactive (updated on every
 * prompt return via the PTY stream).
 */

import { useState, useEffect, useRef } from 'react';
import type { EnvInfo } from '../../shared/types';
import { getPaneBlockData } from '../services/workspaceStore';

const GIT_POLL_INTERVAL_MS = 5_000;

export function useEnvInfo(cwd: string | null, paneId: string | null = null): EnvInfo | null {
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);

  const cwdRef = useRef<string | null>(cwd);
  cwdRef.current = cwd;
  const paneIdRef = useRef<string | null>(paneId);
  paneIdRef.current = paneId;

  useEffect(() => {
    if (!cwd && !paneId) {
      setEnvInfo(null);
      return;
    }

    let cancelled = false;

    const fetchGit = (dir: string) => {
      window.terminalApi
        .getEnvInfo(dir)
        .then(({ git }) => {
          if (cancelled) return;
          // Python env comes from the PTY stream via the block registry, not
          // from the main-process filesystem scan.
          const python = paneIdRef.current
            ? (getPaneBlockData(paneIdRef.current)?.pythonEnv ?? null)
            : null;
          setEnvInfo({ git, python });
        })
        .catch(() => {
          if (cancelled) return;
          const python = paneIdRef.current
            ? (getPaneBlockData(paneIdRef.current)?.pythonEnv ?? null)
            : null;
          setEnvInfo(prev => prev ? { ...prev, python } : { git: null, python });
        });
    };

    if (cwd) fetchGit(cwd);

    const timer = setInterval(() => {
      const currentCwd = cwdRef.current;
      if (currentCwd) fetchGit(currentCwd);
    }, GIT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cwd, paneId]);

  return envInfo;
}
