import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../lib/api';
import {
  connectPera,
  disconnectPera,
  onPeraDisconnect,
  reconnectPera,
  signChallenge,
} from '../lib/pera';

interface AuthUser {
  _id: string;
  name: string;
  phone?: string;
  role: 'member' | 'leader' | 'bank';
  shgId?: string;
  token: string;
  /** Set when the account signed in with (or later linked) a Pera wallet. */
  walletAddress?: string;
  authProvider?: 'password' | 'pera-wallet';
  isNewAccount?: boolean;
  explorerUrl?: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  /** Address of the connected Pera wallet, even before it has signed in. */
  walletAddress: string | null;
  walletConnecting: boolean;
  login: (phone: string, password: string) => Promise<AuthUser>;
  register: (body: { name: string; phone: string; password: string; role: string; shgId?: string }) => Promise<AuthUser>;
  /** Full Pera flow: connect → challenge → sign → verify → session. */
  loginWithPera: (options?: { role?: string; name?: string; shgId?: string }) => Promise<AuthUser>;
  /** Links a Pera wallet to the account that is already signed in. */
  linkPeraWallet: () => Promise<string>;
  disconnectWallet: () => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'saheli-token';
const USER_KEY = 'saheli-user';
const ROLE_KEY = 'shg-role';

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletConnecting, setWalletConnecting] = useState(false);

  const persist = useCallback((data: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data));
    // Kept in sync so App.tsx dashboards resolve the right role.
    localStorage.setItem(ROLE_KEY, data.role);
    setUser(data);
  }, []);

  const clearSession = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLE_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    // Restore session from localStorage on mount
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);
    if (savedToken && savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      }
    }
    setLoading(false);
  }, []);

  // Restore a previously approved Pera session so the address shows up again
  // after a refresh, and react when the user disconnects from inside the app.
  useEffect(() => {
    let cancelled = false;
    const unsubscribe = onPeraDisconnect(() => setWalletAddress(null));

    reconnectPera().then((accounts) => {
      if (cancelled || accounts.length === 0) return;
      setWalletAddress(accounts[0]);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const login = async (phone: string, password: string): Promise<AuthUser> => {
    const data = await authApi.login(phone, password);
    persist(data);
    return data;
  };

  const register = async (body: { name: string; phone: string; password: string; role: string; shgId?: string }): Promise<AuthUser> => {
    const data = await authApi.register(body);
    persist(data);
    return data;
  };

  /**
   * Connects Pera (if needed), signs the server's challenge and exchanges the
   * signature for a JWT. Creates the account on first sign-in.
   */
  const loginWithPera = async (options?: { role?: string; name?: string; shgId?: string }): Promise<AuthUser> => {
    setWalletConnecting(true);
    try {
      let address = walletAddress;
      if (!address) {
        const accounts = await connectPera();
        address = accounts[0];
        if (!address) throw new Error('Pera Wallet returned no account.');
        setWalletAddress(address);
      }

      const challenge = await authApi.walletChallenge(address);
      const signature = await signChallenge(challenge.message, address);

      const data = await authApi.walletVerify({
        address,
        nonce: challenge.nonce,
        signature,
        // A returning wallet keeps the profile it already has; these only
        // apply the first time an address is seen.
        name: options?.name,
        role: options?.role,
        shgId: options?.shgId,
      });

      persist(data);
      return data;
    } finally {
      setWalletConnecting(false);
    }
  };

  const linkPeraWallet = async (): Promise<string> => {
    setWalletConnecting(true);
    try {
      let address = walletAddress;
      if (!address) {
        const accounts = await connectPera();
        address = accounts[0];
        if (!address) throw new Error('Pera Wallet returned no account.');
        setWalletAddress(address);
      }

      const challenge = await authApi.walletChallenge(address);
      const signature = await signChallenge(challenge.message, address);
      const data = await authApi.walletLink({ address, nonce: challenge.nonce, signature });

      setUser((current) => {
        if (!current) return current;
        const next = { ...current, walletAddress: data.walletAddress as string };
        localStorage.setItem(USER_KEY, JSON.stringify(next));
        return next;
      });

      return data.walletAddress as string;
    } finally {
      setWalletConnecting(false);
    }
  };

  const disconnectWallet = async () => {
    await disconnectPera();
    setWalletAddress(null);
  };

  const logout = () => {
    clearSession();
    // Signing out of Saheli should not silently keep the wallet paired.
    void disconnectPera();
    setWalletAddress(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        walletAddress,
        walletConnecting,
        login,
        register,
        loginWithPera,
        linkPeraWallet,
        disconnectWallet,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
