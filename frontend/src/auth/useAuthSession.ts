import { useCallback, useEffect, useRef, useState } from 'react';
import { logoutAuthSession, restoreAuthSession, signInGuest, updateAuthProfile } from '../api';
import type { Member } from '../types';

const SESSION_REFRESH_MS = 8 * 60_000;
const DEFAULT_USER: Member = { id: '', name: 'You', color: '#000000' };

export function useAuthSession() {
  const [user, setUser] = useState<Member>(DEFAULT_USER);
  const [realtimeToken, setRealtimeToken] = useState('');
  const [ready, setReady] = useState(false);
  const userRef = useRef<Member>(DEFAULT_USER);

  const applySession = useCallback((session: { userId: string; displayName: string; avatarUrl?: string | null; realtimeToken: string }) => {
    const authenticatedUser: Member = {
      id: session.userId,
      name: session.displayName,
      color: '#000000',
      avatarUrl: session.avatarUrl ?? undefined
    };
    userRef.current = authenticatedUser;
    setUser(authenticatedUser);
    setRealtimeToken(session.realtimeToken);
    return authenticatedUser;
  }, []);

  useEffect(() => {
    let cancelled = false;
    restoreAuthSession()
      .then((session) => {
        if (!cancelled && session) {
          applySession(session);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [applySession]);

  useEffect(() => {
    if (!ready || !user.id) {
      return;
    }
    const timer = window.setInterval(() => {
      void restoreAuthSession().then((session) => {
        if (session) {
          applySession(session);
        }
      }).catch(() => undefined);
    }, SESSION_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [applySession, ready, user.id]);

  const signIn = useCallback(async (displayName: string, avatarUrl?: string) => {
    const session = await signInGuest(displayName, avatarUrl);
    return applySession(session);
  }, [applySession]);

  const updateProfile = useCallback(async (displayName: string, avatarUrl?: string) => {
    const session = await updateAuthProfile(displayName, avatarUrl);
    return applySession(session);
  }, [applySession]);

  const signOut = useCallback(async () => {
    try {
      await logoutAuthSession();
    } finally {
      userRef.current = DEFAULT_USER;
      setUser(DEFAULT_USER);
      setRealtimeToken('');
    }
  }, []);

  return { ready, realtimeToken, signIn, signOut, updateProfile, user, userRef };
}
