import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { authApi } from '../lib/api';

interface AuthUser {
  _id: string;
  name: string;
  phone: string;
  role: 'member' | 'leader' | 'bank';
  shgId?: string;
  token: string;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<AuthUser>;
  register: (body: { name: string; phone: string; password: string; role: string; shgId?: string }) => Promise<AuthUser>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Restore session from localStorage on mount
    const savedToken = localStorage.getItem('saheli-token');
    const savedUser = localStorage.getItem('saheli-user');
    if (savedToken && savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
      } catch {
        localStorage.removeItem('saheli-token');
        localStorage.removeItem('saheli-user');
      }
    }
    setLoading(false);
  }, []);

  const login = async (phone: string, password: string): Promise<AuthUser> => {
    const data = await authApi.login(phone, password);
    localStorage.setItem('saheli-token', data.token);
    localStorage.setItem('saheli-user', JSON.stringify(data));
    // Also sync role so App.tsx dashboards work
    localStorage.setItem('shg-role', data.role);
    setUser(data);
    return data;
  };

  const register = async (body: { name: string; phone: string; password: string; role: string; shgId?: string }): Promise<AuthUser> => {
    const data = await authApi.register(body);
    localStorage.setItem('saheli-token', data.token);
    localStorage.setItem('saheli-user', JSON.stringify(data));
    localStorage.setItem('shg-role', data.role);
    setUser(data);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('saheli-token');
    localStorage.removeItem('saheli-user');
    localStorage.removeItem('shg-role');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
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
